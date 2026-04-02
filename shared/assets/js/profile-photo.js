var TokenomicProfile = (function() {
    var STORAGE_KEY = 'tkn_profile_photo';

    function getStoredPhoto() {
        try {
            var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return data.url || '';
        } catch(e) { return ''; }
    }

    function setStoredPhoto(url) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url, updated: Date.now() }));
        } catch(e) {}
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(function(n) { return n[0]; }).join('').toUpperCase();
    }

    function renderAvatar(opts) {
        var name = opts.name || '';
        var photoUrl = opts.photoUrl || '';
        var size = opts.size || 60;
        var gradient = opts.gradient || 'linear-gradient(135deg,#ff6000,#ff8f00)';
        var fontSize = opts.fontSize || (size * 0.35) + 'px';

        if (photoUrl) {
            return '<img src="' + photoUrl + '" alt="' + name + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex-shrink:0;" />';
        }
        return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + gradient + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:' + fontSize + ';font-weight:700;flex-shrink:0;">' + getInitials(name) + '</div>';
    }

    function uploadPhoto(file, walletAddress, callback) {
        if (!file || !walletAddress) {
            callback({ error: 'File and wallet address required' });
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            callback({ error: 'Image too large. Maximum 5MB.' });
            return;
        }

        if (!file.type.startsWith('image/')) {
            callback({ error: 'Please select an image file.' });
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            var base64 = e.target.result;
            fetch('/api/profile/upload-photo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photo: base64, wallet: walletAddress })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    setStoredPhoto(data.url);
                    callback({ success: true, url: data.url });
                } else {
                    callback({ error: data.error || 'Upload failed' });
                }
            })
            .catch(function(err) {
                callback({ error: 'Upload failed: ' + err.message });
            });
        };
        reader.readAsDataURL(file);
    }

    function applyUserPhotoToPage() {
        var photoUrl = getStoredPhoto();
        if (!photoUrl) return;

        document.querySelectorAll('[data-user-avatar]').forEach(function(el) {
            var size = parseInt(el.getAttribute('data-avatar-size') || '60');
            el.innerHTML = '<img src="' + photoUrl + '" alt="Profile" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;" />';
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(applyUserPhotoToPage, 500);
    });

    return {
        getStoredPhoto: getStoredPhoto,
        setStoredPhoto: setStoredPhoto,
        getInitials: getInitials,
        renderAvatar: renderAvatar,
        uploadPhoto: uploadPhoto,
        applyUserPhotoToPage: applyUserPhotoToPage
    };
})();
