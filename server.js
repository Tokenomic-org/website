var express = require('express');
var path = require('path');
var https = require('https');

var app = express();
var PORT = process.env.PORT || 5000;

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
