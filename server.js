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

app.use(express.json());
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

app.use(express.static(path.join(__dirname, '_site'), {
    extensions: ['html']
}));

app.use(function(req, res) {
    var reqPath = req.path;
    if (reqPath.endsWith('/')) {
        reqPath += 'index.html';
    }
    var filePath = path.join(__dirname, '_site', reqPath);
    res.sendFile(filePath, function(err) {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '_site', '404.html'), function(err2) {
                if (err2) res.status(404).send('Not Found');
            });
        }
    });
});

app.listen(PORT, '0.0.0.0', function() {
    console.log('Tokenomic server running on port ' + PORT);
});
