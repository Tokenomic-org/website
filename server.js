var express = require('express');
var path = require('path');
var https = require('https');
var crypto = require('crypto');
var { Pool } = require('pg');

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

var COMMUNITIES_DIR = path.join(__dirname, 'global-community');

app.get('/api/communities', function(req, res) {
    try {
        if (!fs.existsSync(COMMUNITIES_DIR)) {
            return res.json({ communities: [] });
        }
        var dirs = fs.readdirSync(COMMUNITIES_DIR, { withFileTypes: true })
            .filter(function(d) { return d.isDirectory(); })
            .map(function(d) { return d.name; });

        var communities = [];
        dirs.forEach(function(dirName) {
            var communityFile = path.join(COMMUNITIES_DIR, dirName, 'community.json');
            if (fs.existsSync(communityFile)) {
                try {
                    var data = JSON.parse(fs.readFileSync(communityFile, 'utf-8'));
                    data.id = data.id || dirName;
                    var commentsFile = path.join(COMMUNITIES_DIR, dirName, 'comments.json');
                    if (fs.existsSync(commentsFile)) {
                        var comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
                        data.comments_count = comments.length;
                    } else {
                        data.comments_count = 0;
                    }
                    communities.push(data);
                } catch(e) {
                    console.error('Error reading community ' + dirName + ':', e.message);
                }
            }
        });

        communities.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });

        res.json({ communities: communities });
    } catch(err) {
        console.error('List communities error:', err.message);
        res.status(500).json({ error: 'Failed to load communities' });
    }
});

app.get('/api/communities/:id', function(req, res) {
    var communityId = req.params.id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!communityId) return res.status(400).json({ error: 'Invalid community ID' });
    var communityDir = path.join(COMMUNITIES_DIR, communityId);

    if (!fs.existsSync(communityDir)) {
        return res.status(404).json({ error: 'Community not found' });
    }

    try {
        var data = JSON.parse(fs.readFileSync(path.join(communityDir, 'community.json'), 'utf-8'));
        data.id = data.id || communityId;

        var commentsFile = path.join(communityDir, 'comments.json');
        data.comments = fs.existsSync(commentsFile)
            ? JSON.parse(fs.readFileSync(commentsFile, 'utf-8'))
            : [];

        res.json(data);
    } catch(err) {
        console.error('Get community error:', err.message);
        res.status(500).json({ error: 'Failed to load community' });
    }
});

app.post('/api/communities', function(req, res) {
    var name = (req.body.name || '').trim();
    var type = req.body.type || 'institution';
    var access = req.body.access || 'open';
    var description = (req.body.description || '').trim();
    var wallet = req.body.wallet || '';

    if (!name) {
        return res.status(400).json({ error: 'Community name is required' });
    }

    var slug = name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);

    if (!slug || slug.length < 2) {
        return res.status(400).json({ error: 'Community name must contain at least 2 alphanumeric characters' });
    }

    var communityDir = path.join(COMMUNITIES_DIR, slug);
    if (fs.existsSync(communityDir)) {
        return res.status(409).json({ error: 'A community with a similar name already exists' });
    }

    try {
        fs.mkdirSync(communityDir, { recursive: true });

        var communityData = {
            id: slug,
            name: name,
            type: type,
            access: access,
            description: description,
            members_count: 1,
            educator_wallet: wallet,
            created_at: new Date().toISOString()
        };

        fs.writeFileSync(path.join(communityDir, 'community.json'), JSON.stringify(communityData, null, 2));
        fs.writeFileSync(path.join(communityDir, 'comments.json'), '[]');

        communityData.comments_count = 0;
        res.json({ success: true, community: communityData });
    } catch(err) {
        console.error('Create community error:', err.message);
        res.status(500).json({ error: 'Failed to create community' });
    }
});

app.get('/api/communities/:id/comments', function(req, res) {
    var communityId = req.params.id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!communityId) return res.status(400).json({ error: 'Invalid community ID' });
    var commentsFile = path.join(COMMUNITIES_DIR, communityId, 'comments.json');

    if (!fs.existsSync(commentsFile)) {
        return res.status(404).json({ error: 'Community not found' });
    }

    try {
        var comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
        res.json({ comments: comments });
    } catch(err) {
        console.error('Get comments error:', err.message);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

app.post('/api/communities/:id/comments', function(req, res) {
    var communityId = req.params.id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!communityId) return res.status(400).json({ error: 'Invalid community ID' });
    var communityDir = path.join(COMMUNITIES_DIR, communityId);
    var commentsFile = path.join(communityDir, 'comments.json');

    if (!fs.existsSync(communityDir)) {
        return res.status(404).json({ error: 'Community not found' });
    }

    var text = (req.body.text || '').trim();
    var author = (req.body.author || 'Anonymous').trim();
    var wallet = (req.body.wallet || '').trim();

    if (!text) {
        return res.status(400).json({ error: 'Comment text is required' });
    }

    try {
        var comments = [];
        if (fs.existsSync(commentsFile)) {
            comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
        }

        var newComment = {
            id: 'c' + Date.now(),
            author: author,
            wallet: wallet,
            text: text,
            created_at: new Date().toISOString()
        };

        comments.push(newComment);
        fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));

        res.json({ success: true, comment: newComment });
    } catch(err) {
        console.error('Add comment error:', err.message);
        res.status(500).json({ error: 'Failed to add comment' });
    }
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

app.use(express.static(path.join(__dirname, '_site'), {
    extensions: ['html'],
    setHeaders: function(res, filePath) {
        if (filePath.endsWith('.xml')) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        }
    }
}));

var SITE_ROOT = path.resolve(path.join(__dirname, '_site'));

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
