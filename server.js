var express = require('express');
var path = require('path');
var https = require('https');
var crypto = require('crypto');
var { Pool } = require('pg');
var ethers = require('ethers');

var app = express();
var PORT = process.env.PORT || 5000;
var ADMIN_EMAIL = 'guillaumelauzier@gmail.com';
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

var pool = new Pool({ connectionString: process.env.DATABASE_URL });

var fs = require('fs');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function requireAdmin(req, res, next) {
    var token = req.headers['x-admin-token'] || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    pool.query(
        'SELECT id FROM admin_sessions WHERE token = $1 AND expires_at > NOW()',
        [token]
    ).then(function(result) {
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        next();
    }).catch(function(err) {
        res.status(500).json({ error: 'Server error' });
    });
}

app.get('/api/luma-events', function(req, res) {
    var calendarId = req.query.calendar_id || 'cal-on7sN7ID2LgtAB9';
    var url = 'https://api.lu.ma/calendar/get-items?calendar_api_id=' + encodeURIComponent(calendarId);

    var lumaReq = https.get(url, function(lumaRes) {
        if (lumaRes.statusCode !== 200) {
            res.status(502).json({ error: 'Luma API returned status ' + lumaRes.statusCode, entries: [] });
            lumaRes.resume();
            return;
        }
        var data = '';
        lumaRes.on('data', function(chunk) { data += chunk; });
        lumaRes.on('end', function() {
            try {
                JSON.parse(data);
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'public, max-age=300');
                res.send(data);
            } catch(e) {
                res.status(502).json({ error: 'Invalid JSON from Luma', entries: [] });
            }
        });
    }).on('error', function(err) {
        res.status(502).json({ error: 'Failed to fetch from Luma: ' + err.message, entries: [] });
    });
    lumaReq.setTimeout(10000, function() {
        lumaReq.destroy();
        res.status(504).json({ error: 'Luma API timeout', entries: [] });
    });
});

app.post('/api/newsletter/subscribe', function(req, res) {
    var email = (req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email address required' });
    }
    pool.query(
        'INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET active = true RETURNING id',
        [email]
    ).then(function(result) {
        res.json({ success: true, message: 'Successfully subscribed!' });
    }).catch(function(err) {
        if (err.code === '23505') {
            return res.json({ success: true, message: 'Already subscribed!' });
        }
        console.error('Newsletter subscribe error:', err.message);
        res.status(500).json({ error: 'Failed to subscribe. Please try again.' });
    });
});

app.post('/api/admin/login', function(req, res) {
    var email = (req.body.email || '').trim().toLowerCase();
    var password = req.body.password || '';

    if (!ADMIN_PASSWORD) {
        return res.status(503).json({ error: 'Admin access not configured' });
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    var token = generateToken();
    var expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    pool.query(
        'INSERT INTO admin_sessions (token, expires_at) VALUES ($1, $2)',
        [token, expiresAt]
    ).then(function() {
        res.json({ success: true, token: token, expiresAt: expiresAt.toISOString() });
    }).catch(function(err) {
        console.error('Admin login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    });
});

app.get('/api/admin/verify', requireAdmin, function(req, res) {
    res.json({ valid: true, email: ADMIN_EMAIL });
});

app.post('/api/admin/logout', function(req, res) {
    var token = req.headers['x-admin-token'] || req.body.token;
    if (!token) {
        return res.json({ success: true });
    }
    pool.query('DELETE FROM admin_sessions WHERE token = $1', [token])
        .then(function() { res.json({ success: true }); })
        .catch(function() { res.json({ success: true }); });
});

app.get('/api/admin/subscribers', requireAdmin, function(req, res) {
    var page = parseInt(req.query.page) || 1;
    var limit = parseInt(req.query.limit) || 50;
    var offset = (page - 1) * limit;

    Promise.all([
        pool.query('SELECT id, email, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
        pool.query('SELECT COUNT(*) as total FROM newsletter_subscribers'),
        pool.query('SELECT COUNT(*) as active FROM newsletter_subscribers WHERE active = true')
    ]).then(function(results) {
        res.json({
            subscribers: results[0].rows,
            total: parseInt(results[1].rows[0].total),
            active: parseInt(results[2].rows[0].active),
            page: page,
            pages: Math.ceil(parseInt(results[1].rows[0].total) / limit)
        });
    }).catch(function(err) {
        console.error('List subscribers error:', err.message);
        res.status(500).json({ error: 'Failed to fetch subscribers' });
    });
});

app.get('/api/admin/subscribers/export', requireAdmin, function(req, res) {
    pool.query('SELECT email, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC')
        .then(function(result) {
            var csv = 'Email,Subscribed Date,Active\n';
            result.rows.forEach(function(row) {
                csv += row.email + ',' + row.subscribed_at.toISOString() + ',' + row.active + '\n';
            });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=subscribers_' + new Date().toISOString().split('T')[0] + '.csv');
            res.send(csv);
        })
        .catch(function(err) {
            console.error('Export subscribers error:', err.message);
            res.status(500).json({ error: 'Failed to export subscribers' });
        });
});

app.delete('/api/admin/subscribers/:id', requireAdmin, function(req, res) {
    pool.query('DELETE FROM newsletter_subscribers WHERE id = $1', [req.params.id])
        .then(function(result) {
            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Subscriber not found' });
            }
            res.json({ success: true });
        })
        .catch(function(err) {
            console.error('Delete subscriber error:', err.message);
            res.status(500).json({ error: 'Failed to delete subscriber' });
        });
});

app.get('/api/admin/pending', requireAdmin, function(req, res) {
    var type = req.query.type;

    var queries = [];
    if (!type || type === 'content') {
        queries.push(
            pool.query("SELECT * FROM pending_content WHERE status = 'pending' ORDER BY submitted_at DESC")
                .then(function(r) { return { type: 'content', items: r.rows }; })
        );
    }
    if (!type || type === 'users') {
        queries.push(
            pool.query("SELECT * FROM pending_users WHERE status = 'pending' ORDER BY submitted_at DESC")
                .then(function(r) { return { type: 'users', items: r.rows }; })
        );
    }

    Promise.all(queries).then(function(results) {
        var response = {};
        results.forEach(function(r) { response[r.type] = r.items; });
        res.json(response);
    }).catch(function(err) {
        console.error('List pending error:', err.message);
        res.status(500).json({ error: 'Failed to fetch pending items' });
    });
});

app.post('/api/admin/approve/:type/:id', requireAdmin, function(req, res) {
    var type = req.params.type;
    var id = req.params.id;
    var table = type === 'content' ? 'pending_content' : type === 'users' ? 'pending_users' : null;

    if (!table) {
        return res.status(400).json({ error: 'Invalid type. Use "content" or "users"' });
    }

    pool.query(
        'UPDATE ' + table + ' SET status = $1, reviewed_at = NOW() WHERE id = $2 AND status = $3',
        ['approved', id, 'pending']
    ).then(function(result) {
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Item not found or already reviewed' });
        }
        res.json({ success: true, status: 'approved' });
    }).catch(function(err) {
        console.error('Approve error:', err.message);
        res.status(500).json({ error: 'Failed to approve item' });
    });
});

app.post('/api/admin/reject/:type/:id', requireAdmin, function(req, res) {
    var type = req.params.type;
    var id = req.params.id;
    var table = type === 'content' ? 'pending_content' : type === 'users' ? 'pending_users' : null;

    if (!table) {
        return res.status(400).json({ error: 'Invalid type. Use "content" or "users"' });
    }

    pool.query(
        'UPDATE ' + table + ' SET status = $1, reviewed_at = NOW() WHERE id = $2 AND status = $3',
        ['rejected', id, 'pending']
    ).then(function(result) {
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Item not found or already reviewed' });
        }
        res.json({ success: true, status: 'rejected' });
    }).catch(function(err) {
        console.error('Reject error:', err.message);
        res.status(500).json({ error: 'Failed to reject item' });
    });
});

app.get('/api/admin/stats', requireAdmin, function(req, res) {
    Promise.all([
        pool.query('SELECT COUNT(*) as total FROM newsletter_subscribers'),
        pool.query('SELECT COUNT(*) as active FROM newsletter_subscribers WHERE active = true'),
        pool.query("SELECT COUNT(*) as pending FROM pending_content WHERE status = 'pending'"),
        pool.query("SELECT COUNT(*) as pending FROM pending_users WHERE status = 'pending'")
    ]).then(function(results) {
        res.json({
            subscribers: { total: parseInt(results[0].rows[0].total), active: parseInt(results[1].rows[0].active) },
            pendingContent: parseInt(results[2].rows[0].pending),
            pendingUsers: parseInt(results[3].rows[0].pending)
        });
    }).catch(function(err) {
        console.error('Stats error:', err.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    });
});

var GITHUB_ORG = 'Tokenomic-org';
var COMMUNITY_TOPIC = 'tokenomic-community';
var COMMUNITY_REPO_PREFIX = 'tokenomic-community-';

function ghRequest(method, apiPath, body, callback) {
    var token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) return callback(new Error('GITHUB_PERSONAL_ACCESS_TOKEN not configured'), null, 0);
    var payload = body ? JSON.stringify(body) : '';
    var options = {
        hostname: 'api.github.com',
        path: apiPath,
        method: method,
        headers: {
            'Authorization': 'Bearer ' + token,
            'User-Agent': 'Tokenomic-Dashboard',
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    var req = https.request(options, function(resp) {
        var data = '';
        resp.on('data', function(c) { data += c; });
        resp.on('end', function() {
            try {
                var parsed = data ? JSON.parse(data) : {};
                callback(null, parsed, resp.statusCode);
            } catch(e) {
                callback(null, { raw: data }, resp.statusCode);
            }
        });
    });
    req.on('error', function(e) { callback(e, null, 0); });
    if (payload) req.write(payload);
    req.end();
}

function makeSlug(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

app.get('/api/communities', function(req, res) {
    if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
        return res.json({ communities: [], warning: 'GitHub token not configured' });
    }
    var q = 'topic:' + COMMUNITY_TOPIC + ' org:' + GITHUB_ORG;
    var searchPath = '/search/repositories?q=' + encodeURIComponent(q) + '&per_page=100&sort=created&order=desc';
    ghRequest('GET', searchPath, null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error: ' + err.message });
        if (status !== 200) return res.status(status).json({ error: data.message || 'GitHub search failed' });
        var communities = (data.items || []).map(function(repo) {
            var slug = repo.name.replace(COMMUNITY_REPO_PREFIX, '');
            return {
                id: slug,
                repo_name: repo.name,
                name: repo.description ? repo.description.split(' | ')[0] : slug,
                description: repo.description || '',
                type: 'general',
                access: repo.private ? 'invite' : 'open',
                visibility: repo.private ? 'private' : 'public',
                members_count: 0,
                discussions_count: repo.open_issues_count || 0,
                created_at: repo.created_at,
                updated_at: repo.updated_at,
                html_url: repo.html_url,
                full_name: repo.full_name
            };
        });
        var pending = communities.length;
        if (pending === 0) return res.json({ communities: [] });
        communities.forEach(function(c, i) {
            var metaPath = '/repos/' + GITHUB_ORG + '/' + c.repo_name + '/contents/.tokenomic/community.json';
            ghRequest('GET', metaPath, null, function(err2, fileData, s2) {
                if (!err2 && s2 === 200 && fileData.content) {
                    try {
                        var decoded = Buffer.from(fileData.content, 'base64').toString('utf-8');
                        var meta = JSON.parse(decoded);
                        c.name = meta.name || c.name;
                        c.type = meta.type || c.type;
                        c.access = meta.access || c.access;
                        c.description = meta.description || c.description;
                        c.members_count = meta.memberCount || 0;
                        c.creator_wallet = meta.creatorWallet || '';
                    } catch(e) {}
                }
                pending--;
                if (pending === 0) {
                    communities.sort(function(a, b) {
                        return new Date(b.created_at) - new Date(a.created_at);
                    });
                    res.json({ communities: communities });
                }
            });
        });
    });
});

app.get('/api/communities/:slug', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid community slug' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName, null, function(err, repo, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status === 404) return res.status(404).json({ error: 'Community not found' });
        if (status !== 200) return res.status(status).json({ error: repo.message || 'Failed to fetch community' });
        var community = {
            id: slug,
            repo_name: repoName,
            name: slug,
            description: repo.description || '',
            type: 'general',
            access: repo.private ? 'invite' : 'open',
            visibility: repo.private ? 'private' : 'public',
            members_count: 0,
            discussions_count: repo.open_issues_count || 0,
            created_at: repo.created_at,
            html_url: repo.html_url,
            full_name: repo.full_name
        };
        var metaPath = '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/.tokenomic/community.json';
        ghRequest('GET', metaPath, null, function(err2, fileData, s2) {
            if (!err2 && s2 === 200 && fileData.content) {
                try {
                    var meta = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
                    community.name = meta.name || community.name;
                    community.type = meta.type || community.type;
                    community.access = meta.access || community.access;
                    community.description = meta.description || community.description;
                    community.members_count = meta.memberCount || 0;
                    community.creator_wallet = meta.creatorWallet || '';
                } catch(e) {}
            }
            res.json(community);
        });
    });
});

app.post('/api/communities', function(req, res) {
    var token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: 'GitHub token not configured. Set GITHUB_PERSONAL_ACCESS_TOKEN.' });

    var name = (req.body.name || '').trim();
    var slug = (req.body.slug || '').trim() || makeSlug(name);
    slug = makeSlug(slug);
    var type = req.body.type || 'general';
    var access = req.body.access || 'open';
    var description = (req.body.description || '').trim();
    var visibility = req.body.visibility || 'public';
    var wallet = (req.body.wallet || '').trim();

    if (!name) return res.status(400).json({ error: 'Community name is required' });
    if (!slug || slug.length < 2) return res.status(400).json({ error: 'Community name must contain at least 2 alphanumeric characters' });

    var repoName = COMMUNITY_REPO_PREFIX + slug;
    var isPrivate = visibility === 'private';

    var communityMeta = {
        name: name,
        slug: slug,
        type: type,
        access: access,
        description: description,
        creatorWallet: wallet,
        createdAt: new Date().toISOString(),
        memberCount: 1
    };

    var readmeContent = '---\n' +
        'name: "' + name.replace(/"/g, '\\"') + '"\n' +
        'type: ' + type + '\n' +
        'access: ' + access + '\n' +
        'created: ' + communityMeta.createdAt + '\n' +
        '---\n\n' +
        '# ' + name + '\n\n' +
        (description || 'A Tokenomic learning community.') + '\n\n' +
        '## About\n\n' +
        'This is a Tokenomic community repository. All community data, members, and resources are managed through this repo.\n\n' +
        '## Links\n\n' +
        '- [Community Dashboard](https://tokenomic.org/dashboard-communities/)\n' +
        '- [Public Page](https://tokenomic.org/communities/' + slug + ')\n';

    var membersData = JSON.stringify({
        members: [
            { wallet: wallet || 'creator', role: 'admin', joinedAt: communityMeta.createdAt }
        ]
    }, null, 2);

    var resourcesReadme = '# Resources\n\nShared files, courses, and articles for this community.\n';

    var communityResult = {
        id: slug, repo_name: repoName, name: name, type: type, access: access,
        description: description, visibility: visibility, members_count: 1,
        discussions_count: 0, created_at: communityMeta.createdAt,
        creator_wallet: wallet
    };

    ghRequest('POST', '/orgs/' + GITHUB_ORG + '/repos', {
        name: repoName,
        description: name + ' | ' + type + ' | ' + access,
        private: isPrivate,
        auto_init: true,
        has_issues: true,
        has_projects: false,
        has_wiki: false
    }, function(err, repoData, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error: ' + err.message });
        if (status === 422) return res.status(409).json({ error: 'A community with this name already exists on GitHub' });
        if (status !== 201) return res.status(status).json({ error: repoData.message || 'Failed to create repository' });

        communityResult.html_url = repoData.html_url;
        communityResult.full_name = repoData.full_name;

        ghRequest('PUT', '/repos/' + GITHUB_ORG + '/' + repoName + '/topics', {
            names: [COMMUNITY_TOPIC, 'tokenomic', type]
        }, function() {

            ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/ref/heads/main', null, function(errRef, refData, sRef) {
                if (errRef || sRef !== 200) {
                    return res.json({ success: true, community: communityResult, warning: 'Repo created but could not read default branch' });
                }
                var parentSha = refData.object.sha;

                ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/commits/' + parentSha, null, function(errC, parentCommit, sC) {
                    if (errC || sC !== 200) {
                        return res.json({ success: true, community: communityResult, warning: 'Repo created but could not read parent commit' });
                    }
                    var baseTreeSha = parentCommit.tree.sha;

                    var files = [
                        { path: 'README.md', content: readmeContent },
                        { path: '.tokenomic/community.json', content: JSON.stringify(communityMeta, null, 2) },
                        { path: 'members.json', content: membersData },
                        { path: 'resources/README.md', content: resourcesReadme }
                    ];

                    var treeItems = files.map(function(f) {
                        return { path: f.path, mode: '100644', type: 'blob', content: f.content };
                    });

                    ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/trees', {
                        base_tree: baseTreeSha,
                        tree: treeItems
                    }, function(err3, treeData, s3) {
                        if (err3 || s3 !== 201) {
                            return res.json({ success: true, community: communityResult, warning: 'Repo created but initial files may not have been committed' });
                        }

                        ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/commits', {
                            message: 'Initialize Tokenomic community: ' + name,
                            tree: treeData.sha,
                            parents: [parentSha]
                        }, function(err4, commitData, s4) {
                            if (err4 || s4 !== 201) {
                                return res.json({ success: true, community: communityResult, warning: 'Repo created but commit may have failed' });
                            }

                            ghRequest('PATCH', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/refs/heads/main', {
                                sha: commitData.sha
                            }, function() {
                                res.json({ success: true, community: communityResult });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/communities/:slug/discussions', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid community slug' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    var page = parseInt(req.query.page) || 1;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/issues?state=all&per_page=30&page=' + page + '&sort=created&direction=desc', null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status === 404) return res.status(404).json({ error: 'Community not found' });
        if (status !== 200) return res.status(status).json({ error: 'Failed to fetch discussions' });
        var discussions = (Array.isArray(data) ? data : []).map(function(issue) {
            return {
                id: issue.number,
                title: issue.title,
                body: issue.body || '',
                author: issue.user ? issue.user.login : 'unknown',
                avatar_url: issue.user ? issue.user.avatar_url : '',
                created_at: issue.created_at,
                updated_at: issue.updated_at,
                comments_count: issue.comments || 0,
                state: issue.state,
                labels: (issue.labels || []).map(function(l) { return l.name; }),
                html_url: issue.html_url
            };
        });
        res.json({ discussions: discussions });
    });
});

app.post('/api/communities/:slug/discussions', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid community slug' });
    var title = (req.body.title || '').trim();
    var body = (req.body.body || '').trim();
    var wallet = (req.body.wallet || '').trim();
    if (!title) return res.status(400).json({ error: 'Discussion title is required' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    var fullBody = body;
    if (wallet) fullBody += '\n\n---\n*Posted by wallet: `' + wallet + '`*';
    ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/issues', {
        title: title,
        body: fullBody,
        labels: ['discussion']
    }, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status !== 201) return res.status(status).json({ error: data.message || 'Failed to create discussion' });
        res.json({
            success: true,
            discussion: {
                id: data.number,
                title: data.title,
                body: data.body,
                author: data.user ? data.user.login : 'unknown',
                created_at: data.created_at,
                comments_count: 0,
                html_url: data.html_url
            }
        });
    });
});

app.get('/api/communities/:slug/discussions/:number/comments', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    var number = parseInt(req.params.number);
    if (!slug || !number) return res.status(400).json({ error: 'Invalid parameters' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/issues/' + number + '/comments?per_page=100', null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status !== 200) return res.status(status).json({ error: 'Failed to fetch comments' });
        var comments = (Array.isArray(data) ? data : []).map(function(c) {
            return {
                id: c.id,
                body: c.body || '',
                author: c.user ? c.user.login : 'unknown',
                avatar_url: c.user ? c.user.avatar_url : '',
                created_at: c.created_at,
                html_url: c.html_url
            };
        });
        res.json({ comments: comments });
    });
});

app.post('/api/communities/:slug/discussions/:number/comments', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    var number = parseInt(req.params.number);
    if (!slug || !number) return res.status(400).json({ error: 'Invalid parameters' });
    var body = (req.body.body || '').trim();
    var wallet = (req.body.wallet || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    var fullBody = body;
    if (wallet) fullBody += '\n\n---\n*Posted by wallet: `' + wallet + '`*';
    ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/issues/' + number + '/comments', {
        body: fullBody
    }, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status !== 201) return res.status(status).json({ error: data.message || 'Failed to post comment' });
        res.json({
            success: true,
            comment: {
                id: data.id,
                body: data.body,
                author: data.user ? data.user.login : 'unknown',
                avatar_url: data.user ? data.user.avatar_url : '',
                created_at: data.created_at
            }
        });
    });
});

app.get('/api/communities/:slug/members', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid community slug' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/members.json', null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status === 404) return res.json({ members: [] });
        if (status !== 200) return res.status(status).json({ error: 'Failed to fetch members' });
        try {
            var decoded = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
            res.json({ members: decoded.members || [], sha: data.sha });
        } catch(e) {
            res.json({ members: [] });
        }
    });
});

app.post('/api/communities/:slug/members', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid community slug' });
    var wallet = (req.body.wallet || '').trim();
    var role = req.body.role || 'member';
    if (!wallet) return res.status(400).json({ error: 'Wallet address is required' });
    var repoName = COMMUNITY_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/members.json', null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        var members = [];
        var sha = null;
        if (status === 200 && data.content) {
            try {
                var decoded = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
                members = decoded.members || [];
                sha = data.sha;
            } catch(e) {}
        }
        var exists = members.some(function(m) { return m.wallet === wallet; });
        if (exists) return res.status(409).json({ error: 'Member already exists in this community' });
        members.push({ wallet: wallet, role: role, joinedAt: new Date().toISOString() });
        var updatedContent = Buffer.from(JSON.stringify({ members: members }, null, 2)).toString('base64');
        var putBody = {
            message: 'Add member ' + wallet.substring(0, 10) + '...',
            content: updatedContent
        };
        if (sha) putBody.sha = sha;
        ghRequest('PUT', '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/members.json', putBody, function(err2, putData, s2) {
            if (err2) return res.status(500).json({ error: 'Failed to update members' });
            if (s2 !== 200 && s2 !== 201) return res.status(s2).json({ error: putData.message || 'Failed to add member' });
            var metaPath = '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/.tokenomic/community.json';
            ghRequest('GET', metaPath, null, function(err3, metaFile, s3) {
                if (!err3 && s3 === 200 && metaFile.content) {
                    try {
                        var meta = JSON.parse(Buffer.from(metaFile.content, 'base64').toString('utf-8'));
                        meta.memberCount = members.length;
                        var metaUpdated = Buffer.from(JSON.stringify(meta, null, 2)).toString('base64');
                        ghRequest('PUT', metaPath, {
                            message: 'Update member count to ' + members.length,
                            content: metaUpdated,
                            sha: metaFile.sha
                        }, function() {});
                    } catch(e) {}
                }
            });
            res.json({ success: true, member: { wallet: wallet, role: role }, total: members.length });
        });
    });
});

var COURSE_TOPIC = 'tokenomic-course';
var COURSE_REPO_PREFIX = 'tokenomic-course-';

app.get('/api/courses', function(req, res) {
    if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
        return res.json({ courses: [], warning: 'GitHub token not configured' });
    }
    var q = 'topic:' + COURSE_TOPIC + ' org:' + GITHUB_ORG;
    var searchPath = '/search/repositories?q=' + encodeURIComponent(q) + '&per_page=100&sort=created&order=desc';
    ghRequest('GET', searchPath, null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error: ' + err.message });
        if (status !== 200) return res.status(status).json({ error: data.message || 'GitHub search failed' });
        var courses = (data.items || []).map(function(repo) {
            var slug = repo.name.replace(COURSE_REPO_PREFIX, '');
            return {
                id: slug,
                repo_name: repo.name,
                name: slug,
                title: slug,
                description: repo.description || '',
                level: 'beginner',
                priceUSDC: 0,
                status: 'draft',
                enrolledCount: 0,
                revenue: 0,
                modules: 0,
                visibility: repo.private ? 'private' : 'public',
                created_at: repo.created_at,
                updated_at: repo.updated_at,
                html_url: repo.html_url,
                full_name: repo.full_name,
                has_pages: repo.has_pages || false
            };
        });
        var pending = courses.length;
        if (pending === 0) return res.json({ courses: [] });
        courses.forEach(function(c) {
            var metaPath = '/repos/' + GITHUB_ORG + '/' + c.repo_name + '/contents/course.json';
            ghRequest('GET', metaPath, null, function(err2, fileData, s2) {
                if (!err2 && s2 === 200 && fileData.content) {
                    try {
                        var meta = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
                        c.title = meta.title || c.title;
                        c.name = meta.title || c.name;
                        c.level = meta.level || c.level;
                        c.priceUSDC = meta.priceUSDC || 0;
                        c.description = meta.description || c.description;
                        c.status = meta.published ? 'published' : 'draft';
                        c.enrolledCount = meta.enrolledCount || 0;
                        c.revenue = meta.revenue || 0;
                        c.educatorWallet = meta.educatorWallet || '';
                    } catch(e) {}
                }
                var modulesPath = '/repos/' + GITHUB_ORG + '/' + c.repo_name + '/contents/modules';
                ghRequest('GET', modulesPath, null, function(err3, modData, s3) {
                    if (!err3 && s3 === 200 && Array.isArray(modData)) {
                        c.modules = modData.filter(function(f) { return f.name.endsWith('.md'); }).length;
                    }
                    pending--;
                    if (pending === 0) {
                        courses.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
                        res.json({ courses: courses });
                    }
                });
            });
        });
    });
});

app.get('/api/courses/:slug', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var repoName = COURSE_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName, null, function(err, repo, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status === 404) return res.status(404).json({ error: 'Course not found' });
        if (status !== 200) return res.status(status).json({ error: repo.message || 'Failed to fetch course' });
        var course = {
            id: slug, repo_name: repoName, title: slug, description: repo.description || '',
            level: 'beginner', priceUSDC: 0, status: 'draft', enrolledCount: 0, revenue: 0, modules: 0,
            visibility: repo.private ? 'private' : 'public', created_at: repo.created_at,
            html_url: repo.html_url, full_name: repo.full_name, has_pages: repo.has_pages || false
        };
        ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/course.json', null, function(err2, fileData, s2) {
            if (!err2 && s2 === 200 && fileData.content) {
                try {
                    var meta = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
                    course.title = meta.title || course.title;
                    course.level = meta.level || course.level;
                    course.priceUSDC = meta.priceUSDC || 0;
                    course.description = meta.description || course.description;
                    course.status = meta.published ? 'published' : 'draft';
                    course.enrolledCount = meta.enrolledCount || 0;
                    course.revenue = meta.revenue || 0;
                    course.educatorWallet = meta.educatorWallet || '';
                } catch(e) {}
            }
            res.json(course);
        });
    });
});

app.post('/api/courses', function(req, res) {
    var token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ error: 'GitHub token not configured. Set GITHUB_PERSONAL_ACCESS_TOKEN.' });
    var VALID_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];
    var title = (req.body.title || '').trim().substring(0, 200);
    var slug = (req.body.slug || '').trim() || makeSlug(title);
    slug = makeSlug(slug).substring(0, 80);
    var level = VALID_LEVELS.indexOf(req.body.level) !== -1 ? req.body.level : 'beginner';
    var priceUSDC = Math.max(0, Math.min(parseFloat(req.body.priceUSDC) || 0, 999999));
    var description = (req.body.description || '').trim().substring(0, 2000);
    var visibility = req.body.visibility === 'private' ? 'private' : 'public';
    var wallet = (req.body.wallet || '').trim().substring(0, 42);
    if (!title) return res.status(400).json({ error: 'Course title is required' });
    if (!slug || slug.length < 2) return res.status(400).json({ error: 'Course title must contain at least 2 alphanumeric characters' });
    var repoName = COURSE_REPO_PREFIX + slug;
    var isPrivate = visibility === 'private';
    var courseMeta = {
        title: title, slug: slug, level: level, priceUSDC: priceUSDC,
        description: description, educatorWallet: wallet,
        createdAt: new Date().toISOString(), published: false,
        enrolledCount: 0, revenue: 0
    };
    var readmeContent = '# ' + title + '\n\n' + (description || 'A Tokenomic course.') + '\n\n' +
        '## Course Details\n\n' +
        '- **Level**: ' + level.charAt(0).toUpperCase() + level.slice(1) + '\n' +
        '- **Price**: ' + (priceUSDC > 0 ? priceUSDC + ' USDC' : 'Free') + '\n' +
        '- **Created**: ' + courseMeta.createdAt + '\n\n' +
        '## Modules\n\n' +
        'Check the `modules/` folder for lesson content.\n\n' +
        '## Links\n\n' +
        '- [Course Dashboard](https://tokenomic.org/dashboard-courses/)\n' +
        '- [Public Page](https://tokenomic.org/courses/' + slug + ')\n';
    var moduleTemplate = '---\ntitle: "Module 1: Getting Started"\norder: 1\n---\n\n' +
        '# Module 1: Getting Started\n\n' +
        'Welcome to **' + title + '**!\n\n' +
        '## Learning Objectives\n\n' +
        '- Understand the fundamentals\n' +
        '- Complete the first exercise\n\n' +
        '## Content\n\n' +
        'Add your lesson content here using Markdown.\n\n' +
        '## Quiz\n\n' +
        '1. What is the main concept covered in this module?\n';
    var deployYml = 'name: Deploy to GitHub Pages\n' +
        'on:\n  push:\n    branches: [main]\n' +
        'permissions:\n  contents: read\n  pages: write\n  id-token: write\n' +
        'jobs:\n  deploy:\n    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - uses: actions/checkout@v4\n' +
        '      - uses: actions/configure-pages@v4\n' +
        '      - uses: actions/upload-pages-artifact@v3\n' +
        '        with:\n          path: \".\"\n' +
        '      - uses: actions/deploy-pages@v4\n';
    var enrolledData = JSON.stringify({ enrolled: [] }, null, 2);
    ghRequest('POST', '/orgs/' + GITHUB_ORG + '/repos', {
        name: repoName, description: title + ' | ' + level + ' | ' + (priceUSDC > 0 ? priceUSDC + ' USDC' : 'Free'),
        private: isPrivate, auto_init: false, has_issues: true, has_projects: false, has_wiki: false
    }, function(err, repoData, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error: ' + err.message });
        if (status === 422) return res.status(409).json({ error: 'A course with this name already exists on GitHub' });
        if (status !== 201) return res.status(status).json({ error: repoData.message || 'Failed to create repository' });
        ghRequest('PUT', '/repos/' + GITHUB_ORG + '/' + repoName + '/topics', {
            names: [COURSE_TOPIC, 'tokenomic', level]
        }, function() {
            var files = [
                { path: 'README.md', content: readmeContent },
                { path: 'course.json', content: JSON.stringify(courseMeta, null, 2) },
                { path: 'modules/module-01.md', content: moduleTemplate },
                { path: 'images/.gitkeep', content: '' },
                { path: '.github/workflows/deploy.yml', content: deployYml },
                { path: 'enrolled.json', content: enrolledData }
            ];
            var treeItems = files.map(function(f) {
                return { path: f.path, mode: '100644', type: 'blob', content: f.content };
            });
            ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/trees', {
                tree: treeItems
            }, function(err3, treeData, s3) {
                if (err3 || s3 !== 201) {
                    return res.json({ success: true, course: {
                        id: slug, repo_name: repoName, title: title, level: level, priceUSDC: priceUSDC,
                        description: description, status: 'draft', enrolledCount: 0, revenue: 0, modules: 1,
                        visibility: visibility, created_at: courseMeta.createdAt,
                        html_url: repoData.html_url, full_name: repoData.full_name, educatorWallet: wallet
                    }, warning: 'Repo created but initial files may not have been committed' });
                }
                ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/commits', {
                    message: 'Initialize Tokenomic course: ' + title, tree: treeData.sha
                }, function(err4, commitData, s4) {
                    if (err4 || s4 !== 201) {
                        return res.json({ success: true, course: {
                            id: slug, repo_name: repoName, title: title, level: level, priceUSDC: priceUSDC,
                            description: description, status: 'draft', enrolledCount: 0, revenue: 0, modules: 1,
                            visibility: visibility, created_at: courseMeta.createdAt,
                            html_url: repoData.html_url, full_name: repoData.full_name, educatorWallet: wallet
                        }, warning: 'Repo created but commit may have failed' });
                    }
                    ghRequest('PATCH', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/refs/heads/main', {
                        sha: commitData.sha
                    }, function(err5, refData, s5) {
                        if (s5 === 422 || s5 === 404) {
                            ghRequest('POST', '/repos/' + GITHUB_ORG + '/' + repoName + '/git/refs', {
                                ref: 'refs/heads/main', sha: commitData.sha
                            }, function() {
                                res.json({ success: true, course: {
                                    id: slug, repo_name: repoName, title: title, level: level, priceUSDC: priceUSDC,
                                    description: description, status: 'draft', enrolledCount: 0, revenue: 0, modules: 1,
                                    visibility: visibility, created_at: courseMeta.createdAt,
                                    html_url: repoData.html_url, full_name: repoData.full_name, educatorWallet: wallet
                                }});
                            });
                        } else {
                            res.json({ success: true, course: {
                                id: slug, repo_name: repoName, title: title, level: level, priceUSDC: priceUSDC,
                                description: description, status: 'draft', enrolledCount: 0, revenue: 0, modules: 1,
                                visibility: visibility, created_at: courseMeta.createdAt,
                                html_url: repoData.html_url, full_name: repoData.full_name, educatorWallet: wallet
                            }});
                        }
                    });
                });
            });
        });
    });
});

app.patch('/api/courses/:slug/publish', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var repoName = COURSE_REPO_PREFIX + slug;
    var publish = req.body.published !== false;
    var metaPath = '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/course.json';
    ghRequest('GET', metaPath, null, function(err, fileData, status) {
        if (err || status !== 200) return res.status(status || 500).json({ error: 'Failed to fetch course metadata' });
        try {
            var meta = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
            meta.published = publish;
            var updated = Buffer.from(JSON.stringify(meta, null, 2)).toString('base64');
            ghRequest('PUT', metaPath, {
                message: (publish ? 'Publish' : 'Unpublish') + ' course: ' + (meta.title || slug),
                content: updated, sha: fileData.sha
            }, function(err2, putData, s2) {
                if (err2 || (s2 !== 200 && s2 !== 201)) return res.status(s2 || 500).json({ error: 'Failed to update course' });
                res.json({ success: true, published: publish });
            });
        } catch(e) {
            res.status(500).json({ error: 'Failed to parse course metadata' });
        }
    });
});

app.get('/api/courses/:slug/modules', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var repoName = COURSE_REPO_PREFIX + slug;
    ghRequest('GET', '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/modules', null, function(err, data, status) {
        if (err) return res.status(500).json({ error: 'GitHub API error' });
        if (status === 404) return res.json({ modules: [] });
        if (status !== 200) return res.status(status).json({ error: 'Failed to fetch modules' });
        var modules = (Array.isArray(data) ? data : [])
            .filter(function(f) { return f.name.endsWith('.md'); })
            .map(function(f) {
                return { name: f.name, path: f.path, sha: f.sha, size: f.size, html_url: f.html_url };
            });
        res.json({ modules: modules });
    });
});

app.post('/api/courses/:slug/thumbnail', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var thumbData = req.body.thumbnail;
    if (!thumbData) return res.status(400).json({ error: 'Thumbnail data required' });
    var match = thumbData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid image data' });
    var ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    var buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large. Max 5MB.' });
    var dir = path.join(__dirname, '_site', 'uploads', 'courses');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var existing = fs.readdirSync(dir);
    existing.forEach(function(f) { if (f.startsWith(slug + '-thumb.')) fs.unlinkSync(path.join(dir, f)); });
    var filename = slug + '-thumb.' + ext;
    fs.writeFileSync(path.join(dir, filename), buffer);
    res.json({ success: true, url: '/uploads/courses/' + filename });
});

app.patch('/api/courses/:slug', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var repoName = COURSE_REPO_PREFIX + slug;
    var metaPath = '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/course.json';
    ghRequest('GET', metaPath, null, function(err, fileData, status) {
        if (err || status !== 200) return res.status(status || 500).json({ error: 'Failed to fetch course metadata' });
        try {
            var meta = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
            var b = req.body;
            if (b.title !== undefined) meta.title = b.title;
            if (b.description !== undefined) meta.description = b.description;
            if (b.level !== undefined) meta.level = b.level;
            if (b.priceUSDC !== undefined) meta.priceUSDC = parseFloat(b.priceUSDC) || 0;
            if (b.visibility !== undefined) meta.visibility = b.visibility;
            if (b.specialization !== undefined) meta.specialization = b.specialization;
            if (b.whatYouLearn !== undefined) meta.whatYouLearn = b.whatYouLearn;
            if (b.prerequisites !== undefined) meta.prerequisites = b.prerequisites;
            if (b.thumbnailUrl !== undefined) meta.thumbnailUrl = b.thumbnailUrl;
            if (b.estimatedHours !== undefined) meta.estimatedHours = b.estimatedHours;
            var updated = Buffer.from(JSON.stringify(meta, null, 2)).toString('base64');
            ghRequest('PUT', metaPath, {
                message: 'Update course metadata: ' + (meta.title || slug),
                content: updated, sha: fileData.sha
            }, function(err2, putData, s2) {
                if (err2 || (s2 !== 200 && s2 !== 201)) return res.status(s2 || 500).json({ error: 'Failed to update course' });
                res.json({ success: true, meta: meta });
            });
        } catch(e) {
            res.status(500).json({ error: 'Failed to parse course metadata' });
        }
    });
});

app.post('/api/courses/:slug/modules', function(req, res) {
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid course slug' });
    var repoName = COURSE_REPO_PREFIX + slug;
    var title = (req.body.title || 'New Module').substring(0, 200);
    var description = (req.body.description || '').substring(0, 2000);
    var videoUrl = (req.body.videoUrl || '').substring(0, 500);
    var duration = (req.body.duration || '').substring(0, 50);
    var order = parseInt(req.body.order) || 1;
    var orderStr = order < 10 ? '0' + order : '' + order;
    var moduleSlug = title.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').substring(0, 60) || 'module';
    var filename = 'module-' + orderStr + '-' + moduleSlug + '.md';
    var frontmatter = '---\ntitle: "' + title.replace(/"/g,'\\"') + '"\norder: ' + order + '\n';
    if (duration) frontmatter += 'duration: "' + duration + '"\n';
    if (videoUrl) frontmatter += 'video_url: "' + videoUrl + '"\n';
    frontmatter += '---\n\n';
    var body = '# ' + title + '\n\n';
    if (description) body += description + '\n\n';
    if (videoUrl) body += '## Video\n\n[![Watch Video](' + videoUrl + ')](' + videoUrl + ')\n\n';
    body += '## Learning Objectives\n\n- Objective 1\n- Objective 2\n\n## Content\n\nAdd your lesson content here.\n\n## Quiz\n\n1. Question?\n   - a) Option A\n   - b) Option B\n';
    var content = Buffer.from(frontmatter + body).toString('base64');
    var filePath = '/repos/' + GITHUB_ORG + '/' + repoName + '/contents/modules/' + filename;
    ghRequest('PUT', filePath, {
        message: 'Add module: ' + title,
        content: content
    }, function(err, data, status) {
        if (err || (status !== 200 && status !== 201)) return res.status(status || 500).json({ error: 'Failed to create module' });
        res.json({ success: true, module: { name: filename, title: title, order: order, duration: duration, videoUrl: videoUrl } });
    });
});

app.post('/api/profile/upload-photo', function(req, res) {
    var photoData = req.body.photo;
    var walletAddress = req.body.wallet;

    if (!photoData || !walletAddress) {
        return res.status(400).json({ error: 'Photo data and wallet address required' });
    }

    var match = photoData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (!match) {
        return res.status(400).json({ error: 'Invalid image data' });
    }

    var ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    var buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large. Maximum 5MB.' });
    }

    var safeWallet = walletAddress.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    var filename = safeWallet + '.' + ext;
    var uploadsDir = path.join(__dirname, '_site', 'uploads', 'profiles');

    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    var existingFiles = fs.readdirSync(uploadsDir);
    existingFiles.forEach(function(f) {
        if (f.startsWith(safeWallet + '.')) {
            fs.unlinkSync(path.join(uploadsDir, f));
        }
    });

    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    var photoUrl = '/uploads/profiles/' + filename + '?t=' + Date.now();
    res.json({ success: true, url: photoUrl });
});

var ASSETS_DIR = path.join(__dirname, 'data', 'assets');
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function getAssetsFile(wallet) {
    var safeWallet = wallet.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return path.join(ASSETS_DIR, safeWallet + '.json');
}

function loadWalletAssets(wallet) {
    var filePath = getAssetsFile(wallet);
    if (fs.existsSync(filePath)) {
        try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
        catch (e) { return { courses: [], certifications: [], revenue: [], articles: [] }; }
    }
    return { courses: [], certifications: [], revenue: [], articles: [] };
}

function saveWalletAssets(wallet, assets) {
    var filePath = getAssetsFile(wallet);
    fs.writeFileSync(filePath, JSON.stringify(assets, null, 2));
}

app.post('/api/verify-signature', function(req, res) {
    var wallet = (req.body.wallet || '').trim().toLowerCase();
    var message = req.body.message || '';
    var signature = req.body.signature || '';
    var timestamp = req.body.timestamp || 0;

    if (!wallet || !message || !signature) {
        return res.status(400).json({ error: 'wallet, message, and signature are required' });
    }

    if (Date.now() - timestamp > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Signature expired. Please sign again.', verified: false });
    }

    if (message.indexOf(wallet) === -1 && message.toLowerCase().indexOf(wallet) === -1) {
        return res.status(400).json({ error: 'Message does not contain the claimed wallet address.', verified: false });
    }

    try {
        var recoveredAddress = ethers.utils.verifyMessage(message, signature).toLowerCase();
        if (recoveredAddress !== wallet) {
            return res.status(403).json({ error: 'Signature does not match the claimed wallet address.', verified: false });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid signature format.', verified: false });
    }

    var proofDir = path.join(__dirname, 'data', 'proofs');
    if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });

    var proofFile = path.join(proofDir, wallet.replace(/[^a-z0-9]/g, '') + '.json');
    var proof = {
        wallet: wallet,
        signature: signature,
        message: message,
        timestamp: timestamp,
        verified_at: new Date().toISOString()
    };
    fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2));

    res.json({ verified: true, wallet: wallet, expires_in: '24h' });
});

app.get('/api/assets/:wallet', function(req, res) {
    var wallet = (req.params.wallet || '').trim();
    if (!wallet || wallet.length < 10) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    var assets = loadWalletAssets(wallet);
    res.json(assets);
});

app.post('/api/assets/register', function(req, res) {
    var asset = req.body;
    var wallet = (asset.owner_wallet || '').trim();

    if (!wallet || !asset.type || !asset.title) {
        return res.status(400).json({ error: 'owner_wallet, type, and title are required' });
    }

    var allowedTypes = ['course', 'certification', 'article', 'revenue_claim'];
    if (allowedTypes.indexOf(asset.type) === -1) {
        return res.status(400).json({ error: 'Invalid asset type. Must be: ' + allowedTypes.join(', ') });
    }

    var assets = loadWalletAssets(wallet);
    var key = asset.type === 'course' ? 'courses' :
              asset.type === 'certification' ? 'certifications' :
              asset.type === 'article' ? 'articles' : 'revenue';

    if (!asset.id) {
        asset.id = 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    if (!asset.created_at) {
        asset.created_at = new Date().toISOString();
    }

    var existingIdx = assets[key].findIndex(function(a) { return a.id === asset.id; });
    if (existingIdx >= 0) {
        assets[key][existingIdx] = asset;
    } else {
        assets[key].push(asset);
    }

    saveWalletAssets(wallet, assets);
    res.json({ success: true, asset: asset });
});

app.post('/api/assets/certify', function(req, res) {
    var wallet = (req.body.wallet || '').trim();
    var courseTitle = req.body.courseTitle || 'Course Certification';
    var txHash = req.body.txHash || null;
    var tokenId = req.body.tokenId || null;

    if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
    }

    var assets = loadWalletAssets(wallet);
    var cert = {
        id: 'cert_' + Date.now(),
        owner_wallet: wallet,
        type: 'certification',
        title: courseTitle,
        description: 'Certification for completing ' + courseTitle,
        tx_hash: txHash,
        token_id: tokenId,
        chain_id: 8453,
        created_at: new Date().toISOString(),
        status: txHash ? 'on_chain' : 'pending_contract'
    };

    assets.certifications.push(cert);
    saveWalletAssets(wallet, assets);
    res.json({ success: true, certification: cert });
});

app.get('/api/assets/summary/:wallet', function(req, res) {
    var wallet = (req.params.wallet || '').trim();
    if (!wallet || wallet.length < 10) {
        return res.status(400).json({ error: 'Invalid wallet address' });
    }
    var assets = loadWalletAssets(wallet);
    res.json({
        totalAssets: assets.courses.length + assets.certifications.length + assets.articles.length,
        courses: assets.courses.length,
        certifications: assets.certifications.length,
        articles: assets.articles.length,
        revenueClaims: assets.revenue.length
    });
});

var ARTICLE_COMMENTS_DIR = path.join(__dirname, 'article-comments');

app.get('/api/articles/:slug/comments', function(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid article slug' });
    var commentsFile = path.join(ARTICLE_COMMENTS_DIR, slug + '.json');

    if (!fs.existsSync(commentsFile)) {
        return res.json({ comments: [] });
    }

    try {
        var comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
        res.json({ comments: comments });
    } catch(err) {
        console.error('Get article comments error:', err.message);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

app.post('/api/articles/:slug/comments', function(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    var slug = req.params.slug.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!slug) return res.status(400).json({ error: 'Invalid article slug' });

    var text = (req.body.text || '').trim();
    var author = (req.body.author || 'Anonymous').trim().substring(0, 50);
    var wallet = (req.body.wallet || '').trim().substring(0, 50);

    if (!author) author = 'Anonymous';

    if (!text) {
        return res.status(400).json({ error: 'Comment text is required' });
    }
    if (text.length > 2000) {
        return res.status(400).json({ error: 'Comment too long. Maximum 2000 characters.' });
    }

    try {
        if (!fs.existsSync(ARTICLE_COMMENTS_DIR)) {
            fs.mkdirSync(ARTICLE_COMMENTS_DIR, { recursive: true });
        }

        var commentsFile = path.join(ARTICLE_COMMENTS_DIR, slug + '.json');
        var comments = [];
        if (fs.existsSync(commentsFile)) {
            comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
        }

        var newComment = {
            id: 'ac' + Date.now(),
            author: author,
            wallet: wallet,
            text: text,
            created_at: new Date().toISOString()
        };

        comments.push(newComment);
        fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));

        res.json({ success: true, comment: newComment });
    } catch(err) {
        console.error('Add article comment error:', err.message);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

app.get('/profile/:slug', function(req, res) {
    res.sendFile(path.join(__dirname, '_site', 'expert', 'index.html'), function(err) {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '_site', '404.html'), function(e) {
                if (e) res.status(404).send('Not Found');
            });
        }
    });
});

app.get('/learn/', function(req, res) { res.redirect(301, '/articles/'); });
app.get('/learn/:slug', function(req, res) { res.redirect(301, '/articles/' + req.params.slug); });
app.get('/learn/:slug/', function(req, res) { res.redirect(301, '/articles/' + req.params.slug + '/'); });

app.use(express.static(path.join(__dirname, '_site'), {
    extensions: ['html'],
    setHeaders: function(res, filePath) {
        if (filePath.endsWith('.xml')) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        }
    }
}));

app.post('/api/github/publish', function(req, res) {
    var token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) {
        return res.status(400).json({ error: 'GITHUB_PERSONAL_ACCESS_TOKEN not configured' });
    }
    var body = req.body;
    if (!body.repo || !body.path || !body.content) {
        return res.status(400).json({ error: 'Missing repo, path, or content' });
    }
    if (body.repo !== 'Tokenomic-org/website') {
        return res.status(403).json({ error: 'Publishing only allowed to Tokenomic-org/website' });
    }
    var pathPattern = /^_posts\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;
    if (!pathPattern.test(body.path)) {
        return res.status(403).json({ error: 'Invalid file path format' });
    }
    var owner = 'Tokenomic-org';
    var repoName = 'website';
    var contentBase64 = Buffer.from(body.content).toString('base64');
    var apiPath = '/repos/' + owner + '/' + repoName + '/contents/' + body.path;

    function doRequest(sha) {
        var payload = JSON.stringify({
            message: body.message || 'Add article via Tokenomic dashboard',
            content: contentBase64,
            branch: 'main'
        });
        if (sha) {
            var parsed = JSON.parse(payload);
            parsed.sha = sha;
            payload = JSON.stringify(parsed);
        }
        var options = {
            hostname: 'api.github.com',
            path: apiPath,
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'User-Agent': 'Tokenomic-Dashboard',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Accept': 'application/vnd.github+json'
            }
        };
        var ghReq = https.request(options, function(ghRes) {
            var data = '';
            ghRes.on('data', function(chunk) { data += chunk; });
            ghRes.on('end', function() {
                try {
                    var result = JSON.parse(data);
                    if (ghRes.statusCode === 200 || ghRes.statusCode === 201) {
                        res.json({
                            success: true,
                            html_url: result.content ? result.content.html_url : '',
                            sha: result.content ? result.content.sha : ''
                        });
                    } else {
                        res.status(ghRes.statusCode).json({ error: result.message || 'GitHub API error', details: result });
                    }
                } catch(e) {
                    res.status(500).json({ error: 'Failed to parse GitHub response' });
                }
            });
        });
        ghReq.on('error', function(e) {
            res.status(500).json({ error: 'GitHub API request failed: ' + e.message });
        });
        ghReq.write(payload);
        ghReq.end();
    }

    var checkOptions = {
        hostname: 'api.github.com',
        path: apiPath + '?ref=main',
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'User-Agent': 'Tokenomic-Dashboard',
            'Accept': 'application/vnd.github+json'
        }
    };
    var checkReq = https.get(checkOptions, function(checkRes) {
        var data = '';
        checkRes.on('data', function(chunk) { data += chunk; });
        checkRes.on('end', function() {
            if (checkRes.statusCode === 200) {
                try {
                    var existing = JSON.parse(data);
                    doRequest(existing.sha);
                } catch(e) {
                    doRequest(null);
                }
            } else {
                doRequest(null);
            }
        });
    });
    checkReq.on('error', function() { doRequest(null); });
});

var SITE_ROOT = path.resolve(path.join(__dirname, '_site'));

app.get('/community/:slug', function(req, res) {
    res.sendFile(path.join(__dirname, '_site', 'community', 'index.html'), function(err) {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '_site', '404.html'), function(e) {
                if (e) res.status(404).send('Not Found');
            });
        }
    });
});

app.get('/expert/:slug', function(req, res) {
    res.sendFile(path.join(__dirname, '_site', 'expert', 'index.html'), function(err) {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '_site', '404.html'), function(e) {
                if (e) res.status(404).send('Not Found');
            });
        }
    });
});

app.use(function(req, res) {
    var reqPath = req.path;
    if (reqPath.endsWith('/')) {
        reqPath += 'index.html';
    }
    var filePath = path.resolve(path.join(__dirname, '_site', reqPath));

    if (filePath.indexOf(SITE_ROOT + path.sep) !== 0 && filePath !== SITE_ROOT) {
        return res.status(400).send('Bad Request');
    }

    var send404 = function() {
        res.status(404).sendFile(path.join(SITE_ROOT, '404.html'), function(err2) {
            if (err2) res.status(404).send('Not Found');
        });
    };

    res.sendFile(filePath, function(err) {
        if (err) {
            if (!reqPath.endsWith('.html') && !reqPath.endsWith('/index.html')) {
                var indexPath = path.resolve(path.join(__dirname, '_site', reqPath, 'index.html'));
                if (indexPath.indexOf(SITE_ROOT + path.sep) !== 0) {
                    return send404();
                }
                res.sendFile(indexPath, function(err2) {
                    if (err2) {
                        send404();
                    }
                });
            } else {
                send404();
            }
        }
    });
});

app.listen(PORT, '0.0.0.0', function() {
    console.log('Tokenomic server running on port ' + PORT);
});
