/* Extracted from dashboard/profile.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
(function(){
              var PROVIDERS = [
                { key:'google',    label:'Google Calendar', icon:'fab fa-google',     color:'#ea4335' },
                { key:'microsoft', label:'Outlook',         icon:'fab fa-microsoft',  color:'#0078d4' },
                { key:'calendly',  label:'Calendly',        icon:'far fa-calendar',   color:'#006bff' },
              ];

              function apiBase() {
                return (window.TOKENOMIC_API_BASE || (window.__TKN_ENV && window.__TKN_ENV.API_BASE) || '').replace(/\/+$/, '');
              }
              function authHeader() {
                var t = '';
                try { t = localStorage.getItem('tkn-jwt') || localStorage.getItem('jwt') || ''; } catch(e){}
                return (t && t !== 'null') ? { authorization: 'Bearer ' + t } : {};
              }
              async function loadStatus() {
                var list = document.getElementById('tkn-calendar-providers-list');
                if (!list) return;
                try {
                  var r = await fetch(apiBase() + '/api/calendar/connections', {
                    headers: Object.assign({ accept: 'application/json' }, authHeader()),
                    credentials: 'include',
                  });
                  if (r.status === 401) {
                    list.innerHTML = '<div style="color:#5a8299;font-size:0.85rem;">Sign in with your wallet to manage calendar integrations.</div>';
                    return;
                  }
                  var d = await r.json();
                  render(d);
                } catch(e) {
                  list.innerHTML = '<div style="color:#c84a4a;font-size:0.82rem;">Failed to load: ' + (e.message || e) + '</div>';
                }
              }
              function render(d) {
                var list = document.getElementById('tkn-calendar-providers-list');
                var configMap = {};
                (d.providers || []).forEach(function(p){ configMap[p.provider] = !!p.configured; });
                var connMap = {};
                (d.connections || []).forEach(function(c){
                  if (c.status === 'connected') connMap[c.provider] = c;
                });
                list.innerHTML = PROVIDERS.map(function(p){
                  var configured = configMap[p.key];
                  var connected  = !!connMap[p.key];
                  var sub = configured
                    ? (connected ? '<span style="color:#00C853;">● Connected</span>'
                                 : '<span style="color:#5a8299;">Not connected</span>')
                    : '<span style="color:#a06a00;">Not configured by admin</span>';
                  var btn = !configured
                    ? '<button type="button" disabled style="background:#e8eef5;color:#9aabb8;border:none;border-radius:8px;padding:8px 16px;font-size:0.82rem;cursor:not-allowed;">Unavailable</button>'
                    : connected
                      ? '<button type="button" data-action="disconnect" data-provider="'+p.key+'" style="background:transparent;color:#c84a4a;border:1px solid #c84a4a;border-radius:8px;padding:8px 16px;font-size:0.82rem;cursor:pointer;">Disconnect</button>'
                      : '<button type="button" data-action="connect" data-provider="'+p.key+'" style="background:'+p.color+';color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:0.82rem;cursor:pointer;">Connect</button>';
                  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#f8fafc;border:1px solid #e8eef5;border-radius:10px;">'
                       +   '<div><div style="font-weight:600;color:#001f29;font-size:0.92rem;"><i class="'+p.icon+'" style="color:'+p.color+';margin-right:8px;"></i>'+p.label+'</div>'
                       +   '<div style="font-size:0.78rem;margin-top:2px;">'+sub+'</div></div>'
                       +   btn
                       + '</div>';
                }).join('');
                list.querySelectorAll('button[data-action]').forEach(function(b){
                  b.addEventListener('click', function(){
                    var p = b.getAttribute('data-provider');
                    if (b.getAttribute('data-action') === 'connect') startConnect(p);
                    else doDisconnect(p);
                  });
                });
              }
              function startConnect(provider) {
                var url = apiBase() + '/api/oauth/' + provider + '/start?return_to=' + encodeURIComponent('/profile/');
                // Browsers block opener-cookies for cross-origin redirects, so
                // pass auth via a query token. The /start endpoint also accepts
                // SIWE cookies; for the worker on *.workers.dev we forward Bearer.
                var t = '';
                try { t = localStorage.getItem('tkn-jwt') || ''; } catch(e){}
                if (t) url += '&t=' + encodeURIComponent(t); // start endpoint reads cookie/JWT; query carries fallback
                var w = window.open(url, 'tkn-oauth-' + provider, 'width=520,height=680');
                if (!w) { alert('Please allow popups to connect a calendar.'); return; }
                function onMsg(ev){
                  if (!ev.data || ev.data.type !== 'tkn-oauth-callback') return;
                  window.removeEventListener('message', onMsg);
                  setTimeout(loadStatus, 400);
                }
                window.addEventListener('message', onMsg);
              }
              async function doDisconnect(provider) {
                if (!confirm('Disconnect ' + provider + '? Your bookings stay, but new slots will not be calendar-backed.')) return;
                try {
                  var r = await fetch(apiBase() + '/api/oauth/' + provider + '/disconnect', {
                    method: 'POST',
                    headers: Object.assign({ accept: 'application/json' }, authHeader()),
                    credentials: 'include',
                  });
                  if (!r.ok) throw new Error('HTTP ' + r.status);
                  loadStatus();
                } catch(e) {
                  alert('Disconnect failed: ' + (e.message || e));
                }
              }
              document.addEventListener('DOMContentLoaded', function(){ setTimeout(loadStatus, 800); });
              window.addEventListener('tokenomic:wallet-connected', loadStatus);
              window.addEventListener('tokenomic:siwe-signed', loadStatus);
            })();

(function(){
                  async function compute(){
                    if (!window.TokenomicAssets || !window.TokenomicWallet) return;
                    var a = window.TokenomicWallet.getAddress && window.TokenomicWallet.getAddress();
                    if (!a) return;
                    try {
                      var r = await window.TokenomicAssets.getTokenomicScore(a);
                      document.getElementById('tkn-score-value').textContent = r.score;
                      var b = r.breakdown;
                      document.getElementById('tkn-score-breakdown').innerHTML =
                        '<div>Certificates owned: <strong>'+b.ownedCertificates+'</strong></div>' +
                        '<div>Lifetime purchases: <strong>'+b.lifetimePurchases+'</strong></div>' +
                        '<div>Courses published: <strong>'+b.coursesRegistered+'</strong></div>' +
                        '<div>Lifetime earnings: <strong>'+b.totalEarnedUSDC.toFixed(2)+' USDC</strong></div>';
                    } catch(e){ console.warn(e); }
                  }
                  document.addEventListener('DOMContentLoaded', function(){ setTimeout(compute, 1500); });
                  window.addEventListener('tokenomic:wallet-connected', compute);
                })();

function profilePage() {
    return {
        profile: { name:'Tokenomic User', email:'user@tokenomic.org', role:'Educator', bio:'DeFi educator and researcher.', wallet:'', xp:2340, courses:4, badges:6 },
        badgeList: ['DeFi Explorer','Yield Farmer','Smart Contract Dev','Community Builder','Top 10%','Early Adopter'],
        notifications: [
            { label:'Course Updates', description:'New module releases and course changes.', enabled:true },
            { label:'Community Messages', description:'New messages in your channels.', enabled:true },
            { label:'Revenue Alerts', description:'Payment received and split distributions.', enabled:true },
            { label:'Event Reminders', description:'Upcoming event notifications.', enabled:false },
            { label:'Leaderboard Changes', description:'Rank changes and achievements.', enabled:false }
        ],
        consultantForm: { specialty:'', rate:'', experience:'3-5' },
        async init() {
            // Wallet is the source of truth for identity; D1 is the source of
            // truth for everything else. localStorage is a one-way fallback for
            // the optimistic UI before the network call completes.
            var w = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.getAddress)
                      ? TokenomicWallet.getAddress() : (TokenomicWallet && TokenomicWallet.account);
            if (w) this.profile.wallet = w;

            var saved = {};
            try { saved = JSON.parse(localStorage.getItem('tkn_profile_data') || '{}'); } catch(e) {}
            if (saved.name)  this.profile.name  = saved.name;
            if (saved.email) this.profile.email = saved.email;
            if (saved.role)  this.profile.role  = saved.role;
            if (saved.bio)   this.profile.bio   = saved.bio;
            applyStoredAvatar();

            if (w && window.TokenomicAPI) {
                try {
                    var d1Profile = await window.TokenomicAPI.getProfile(w);
                    if (d1Profile) {
                        this.profile.name  = d1Profile.display_name || this.profile.name;
                        this.profile.email = d1Profile.email        || this.profile.email;
                        this.profile.bio   = d1Profile.bio          || this.profile.bio;
                        // Capitalize legacy 'student'/'educator' -> 'Student'/'Educator' for the select
                        var r = (d1Profile.role || 'student');
                        this.profile.role = r.charAt(0).toUpperCase() + r.slice(1);
                        if (d1Profile.avatar_url) setAvatarPhoto(d1Profile.avatar_url);
                    }
                } catch (e) { console.warn('Failed to load profile from D1:', e.message); }
            }
        },
        async saveProfile() {
            var statusEl = document.getElementById('photo-status');
            var w = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.getAddress)
                      ? TokenomicWallet.getAddress() : null;
            if (!w) {
                statusEl.textContent = 'Connect your wallet first.';
                statusEl.className = 'photo-status error';
                return;
            }
            // Optimistic local cache so the sidebar avatar updates instantly.
            localStorage.setItem('tkn_profile_data', JSON.stringify({
                name: this.profile.name, email: this.profile.email,
                role: this.profile.role, bio:   this.profile.bio
            }));
            statusEl.textContent = 'Saving…';
            statusEl.className = 'photo-status loading';

            // Auth: ensure we have a JWT (sign-in is a no-op if cached).
            try {
                if (window.TokenomicAPI && !window.TokenomicAPI.isSignedIn(w)) {
                    await window.TokenomicAPI.signIn(w);
                }
                var saved = await window.TokenomicAPI.upsertProfile({
                    display_name: this.profile.name,
                    email:        this.profile.email,
                    bio:          this.profile.bio,
                    role:         (this.profile.role || 'student').toLowerCase()
                });
                statusEl.textContent = 'Profile saved.';
                statusEl.className   = 'photo-status success';
                window.dispatchEvent(new CustomEvent('tokenomic:profile-updated', { detail: saved }));
                setTimeout(function() { statusEl.textContent = ''; statusEl.className = 'photo-status'; }, 3000);
            } catch (e) {
                statusEl.textContent = 'Save failed: ' + (e.message || 'unknown error');
                statusEl.className = 'photo-status error';
            }
        }
    };
}

function applyStoredAvatar() {
    var photoUrl = '';
    try {
        var data = JSON.parse(localStorage.getItem('tkn_profile_photo') || '{}');
        photoUrl = data.url || '';
    } catch(e) {}
    if (photoUrl) {
        setAvatarPhoto(photoUrl);
    }
}

function setAvatarPhoto(url) {
    var circle = document.getElementById('avatar-circle');
    var initials = document.getElementById('avatar-initials');
    if (!circle) return;
    if (initials) initials.style.display = 'none';
    var existing = circle.querySelector('img');
    if (existing) existing.remove();
    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Profile photo';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    circle.appendChild(img);
}

function setPhotoStatus(msg, type) {
    var el = document.getElementById('photo-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'photo-status ' + (type || '');
    if (type === 'success') {
        setTimeout(function() { el.textContent = ''; el.className = 'photo-status'; }, 4000);
    }
}

function processAvatarFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        setPhotoStatus('Please select an image file.', 'error');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        setPhotoStatus('Image too large. Max 5MB.', 'error');
        return;
    }

    setPhotoStatus('Uploading...', 'loading');

    var reader = new FileReader();
    reader.onload = function(e) {
        var dataUrl = e.target.result;
        setAvatarPhoto(dataUrl);

        var wallet = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.account) ? TokenomicWallet.account : '';

        if (wallet) {
            // Phase 6: prefer the Worker R2-backed endpoint (/api/profile/avatar
            // at apiBase). Falls back to the legacy Express filesystem endpoint
            // when the Worker is not configured (local dev without R2).
            var base = apiBase();
            var primary = base ? (base + '/api/profile/avatar') : '/api/profile/upload-photo';
            fetch(primary, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photo: dataUrl, wallet: wallet })
            })
            .then(function(r) {
                if (!r.ok && base && primary !== '/api/profile/upload-photo') {
                    return fetch('/api/profile/upload-photo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ photo: dataUrl, wallet: wallet })
                    }).then(function(r2) { return r2.json(); });
                }
                return r.json();
            })
            .then(function(data) {
                if (data && (data.success || data.ok) && data.url) {
                    try { localStorage.setItem('tkn_profile_photo', JSON.stringify({ url: data.url, updated: Date.now() })); } catch(e) {}
                    setPhotoStatus('Photo saved!', 'success');
                } else {
                    try { localStorage.setItem('tkn_profile_photo', JSON.stringify({ url: dataUrl, updated: Date.now() })); } catch(e) {}
                    setPhotoStatus('Saved locally.', 'success');
                }
            })
            .catch(function() {
                try { localStorage.setItem('tkn_profile_photo', JSON.stringify({ url: dataUrl, updated: Date.now() })); } catch(e) {}
                setPhotoStatus('Saved locally.', 'success');
            });
        } else {
            try { localStorage.setItem('tkn_profile_photo', JSON.stringify({ url: dataUrl, updated: Date.now() })); } catch(e) {}
            setPhotoStatus('Photo saved locally. Connect wallet to sync across devices.', 'success');
        }
    };
    reader.readAsDataURL(file);
}

function handleAvatarFileSelect(event) {
    var file = event.target.files && event.target.files[0];
    if (file) processAvatarFile(file);
    event.target.value = '';
}

function handleAvatarDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('avatar-drop-zone').classList.add('drag-over');
}

function handleAvatarDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('avatar-drop-zone').classList.remove('drag-over');
}

function handleAvatarDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('avatar-drop-zone').classList.remove('drag-over');
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) processAvatarFile(file);
}

function initAssetsSection() {
    if (typeof TokenomicAssets === 'undefined' || typeof TokenomicWallet === 'undefined') return;
    if (!TokenomicWallet.account) return;

    var role = TokenomicAssets.getRole();
    if (TokenomicAssets.isCreator()) {
        var el = document.getElementById('creator-actions');
        if (el) el.style.display = 'block';
    }
    if (TokenomicAssets.isLearner()) {
        var el2 = document.getElementById('learner-actions');
        if (el2) el2.style.display = 'block';
    }

    if (TokenomicAssets.isOwnershipVerified()) {
        var vs = document.getElementById('verification-status');
        if (vs) {
            vs.innerHTML = '<span style="color:#00C853;"><i class="fas fa-check-circle"></i> Verified</span>';
        }
    }

    var basescanLink = document.getElementById('basescan-link');
    if (basescanLink && TokenomicWallet.account) {
        basescanLink.href = TokenomicAssets.getAddressUrl(TokenomicWallet.account);
        basescanLink.style.display = 'inline';
    }

    loadBalances();
    loadAssetsList();
    renderContractStatus();
}

async function loadBalances() {
    if (typeof TokenomicAssets === 'undefined') return;
    try {
        var usdcEl = document.getElementById('usdc-balance-display');
        var ethEl = document.getElementById('eth-balance-display');

        if (typeof ethers !== 'undefined' && TokenomicWallet.account) {
            var usdc = await TokenomicAssets.getUSDCBalance();
            if (usdcEl) usdcEl.textContent = '$' + parseFloat(usdc).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            var eth = await TokenomicAssets.getETHBalance();
            if (ethEl) ethEl.textContent = eth + ' ETH';
        } else {
            if (usdcEl) usdcEl.textContent = '$0.00';
            if (ethEl) ethEl.textContent = '0.0000 ETH';
        }
    } catch (e) {
        console.warn('Balance load error:', e);
    }
}

async function loadAssetsList() {
    if (typeof TokenomicAssets === 'undefined') return;
    var container = document.getElementById('assets-list');
    if (!container) return;

    try {
    var assets = await TokenomicAssets.loadAssets();
    var totalEl = document.getElementById('total-assets-display');
    var summary = TokenomicAssets.getSummary();
    if (totalEl) totalEl.textContent = summary.totalAssets;

    if (summary.totalAssets === 0) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#5a8299;font-size:0.85rem;">' +
            '<i class="fas fa-box-open" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>' +
            'No assets registered yet. ' +
            (TokenomicAssets.isCreator() ? 'Tokenize a course or register an article to start.' : 'Complete a course to earn a certification NFT.') +
            '</div>';
        return;
    }

    var html = '';

    function renderAssetRow(asset, icon, color) {
        var statusBadge = '';
        if (asset.status === 'on_chain') {
            statusBadge = '<span style="background:rgba(0,200,83,0.1);color:#00C853;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">On-Chain</span>';
        } else if (asset.status === 'tokenized') {
            statusBadge = '<span style="background:rgba(102,126,234,0.1);color:#667eea;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Tokenized</span>';
        } else if (asset.status === 'pending_contract') {
            statusBadge = '<span style="background:rgba(255,152,0,0.1);color:#FF9800;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Pending Contract</span>';
        } else {
            statusBadge = '<span style="background:rgba(90,130,153,0.1);color:#5a8299;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Registered</span>';
        }

        var txLink = '';
        if (asset.tx_hash) {
            txLink = ' <a href="' + TokenomicAssets.getExplorerUrl(asset.tx_hash) + '" target="_blank" rel="noopener" style="color:#ff6000;font-size:0.75rem;text-decoration:none;"><i class="fas fa-external-link-alt"></i> Tx</a>';
        }

        return '<div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e8eef5;border-radius:10px;margin-bottom:8px;">' +
            '<div style="width:36px;height:36px;border-radius:8px;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="fas ' + icon + '" style="color:#fff;font-size:0.85rem;"></i></div>' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:0.88rem;color:#001f29;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (asset.title || 'Untitled') + '</div>' +
            '<div style="font-size:0.75rem;color:#5a8299;">' + new Date(asset.created_at).toLocaleDateString() + txLink + '</div>' +
            '</div>' +
            '<div>' + statusBadge + '</div>' +
            '</div>';
    }

    if (assets.courses && assets.courses.length > 0) {
        html += '<div style="font-size:0.78rem;color:#5a8299;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;margin-top:8px;">Courses (' + assets.courses.length + ')</div>';
        assets.courses.forEach(function(a) { html += renderAssetRow(a, 'fa-book', '#ff6000'); });
    }
    if (assets.certifications && assets.certifications.length > 0) {
        html += '<div style="font-size:0.78rem;color:#5a8299;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;margin-top:8px;">Certifications (' + assets.certifications.length + ')</div>';
        assets.certifications.forEach(function(a) { html += renderAssetRow(a, 'fa-certificate', '#00C853'); });
    }
    if (assets.articles && assets.articles.length > 0) {
        html += '<div style="font-size:0.78rem;color:#5a8299;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;margin-top:8px;">Articles (' + assets.articles.length + ')</div>';
        assets.articles.forEach(function(a) { html += renderAssetRow(a, 'fa-file-alt', '#667eea'); });
    }

    container.innerHTML = html;
    } catch (e) {
        console.warn('Asset list load error:', e);
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#e57373;font-size:0.85rem;">' +
            '<i class="fas fa-exclamation-triangle" style="font-size:1.5rem;margin-bottom:8px;display:block;opacity:0.6;"></i>' +
            'Could not load assets. Please try again later.</div>';
    }
}

function renderContractStatus() {
    if (typeof TokenomicAssets === 'undefined') return;
    var container = document.getElementById('contracts-display');
    if (!container) return;

    var status = TokenomicAssets.getContractStatus();
    var contracts = [
        { key: 'certNFT', label: 'Certification NFT (ERC-721)', data: status.certNFT },
        { key: 'courseNFT', label: 'Course Ownership (ERC-1155)', data: status.courseNFT },
        { key: 'revenueSplitter', label: 'Revenue Splitter', data: status.revenueSplitter },
        { key: 'usdc', label: 'USDC on Base', data: status.usdc }
    ];

    var html = '';
    contracts.forEach(function(c) {
        var statusDot = c.data.deployed
            ? '<span style="width:8px;height:8px;border-radius:50%;background:#00C853;display:inline-block;"></span>'
            : '<span style="width:8px;height:8px;border-radius:50%;background:#FF9800;display:inline-block;"></span>';
        var statusText = c.data.deployed ? 'Deployed' : 'Not Deployed';
        var addrText = c.data.address
            ? '<span style="font-family:monospace;font-size:0.72rem;color:#5a8299;">' + c.data.address.slice(0,6) + '...' + c.data.address.slice(-4) + '</span>'
            : '';
        html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e8eef5;border-radius:8px;">' +
            statusDot +
            '<div style="flex:1;"><div style="font-size:0.85rem;font-weight:500;color:#001f29;">' + c.label + '</div>' +
            '<div style="font-size:0.75rem;color:#5a8299;">' + statusText + ' ' + addrText + '</div></div></div>';
    });
    container.innerHTML = html;
}

async function proveOwnership() {
    if (typeof TokenomicAssets === 'undefined') return;
    if (!TokenomicWallet || !TokenomicWallet.account) {
        alert('Please connect your wallet first.');
        return;
    }
    try {
        var result = await TokenomicAssets.signOwnershipProof();
        if (result.verified) {
            var vs = document.getElementById('verification-status');
            if (vs) vs.innerHTML = '<span style="color:#00C853;"><i class="fas fa-check-circle"></i> Verified</span>';
            alert('Ownership verified! Your wallet is now linked to your Tokenomic account.');
        } else {
            alert('Verification failed: ' + (result.error || 'Unknown error'));
        }
    } catch (e) {
        if (e.code === 4001) {
            alert('Signature request was rejected.');
        } else {
            alert('Error: ' + e.message);
        }
    }
}

async function tokenizeAssetAction() {
    if (typeof TokenomicAssets === 'undefined') return;
    if (!TokenomicWallet || !TokenomicWallet.account) {
        alert('Please connect your wallet first.');
        return;
    }
    var title = prompt('Enter course title to tokenize:');
    if (!title) return;
    try {
        var result = await TokenomicAssets.tokenizeCourse({ title: title, description: '' });
        if (result.success) {
            alert('Course "' + title + '" registered as an owned asset.' + (result.note ? '\n\n' + result.note : '') + (result.txHash ? '\n\nTx: ' + result.txHash : ''));
            loadAssetsList();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function claimRevenueAction() {
    if (typeof TokenomicAssets === 'undefined') return;
    if (!TokenomicWallet || !TokenomicWallet.account) {
        alert('Please connect your wallet first.');
        return;
    }
    try {
        var result = await TokenomicAssets.claimRevenue();
        if (result.success) {
            alert('Revenue claimed!' + (result.txHash ? '\n\nTx: ' + result.txHash : ''));
        } else {
            alert(result.note || 'Could not claim revenue.');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function registerArticleAction() {
    if (typeof TokenomicAssets === 'undefined') return;
    if (!TokenomicWallet || !TokenomicWallet.account) {
        alert('Please connect your wallet first.');
        return;
    }
    var title = prompt('Enter article title to register:');
    if (!title) return;
    try {
        var result = await TokenomicAssets.registerAsset({ type: 'article', title: title });
        alert('Article "' + title + '" registered as an owned asset.');
        loadAssetsList();
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function mintCertAction() {
    if (typeof TokenomicAssets === 'undefined') return;
    if (!TokenomicWallet || !TokenomicWallet.account) {
        alert('Please connect your wallet first.');
        return;
    }
    var courseTitle = prompt('Enter course title for certification:');
    if (!courseTitle) return;
    try {
        var result = await TokenomicAssets.mintCertification({ courseTitle: courseTitle });
        if (result.success) {
            alert('Certification for "' + courseTitle + '" created!' + (result.note ? '\n\n' + result.note : '') + (result.txHash ? '\n\nTx: ' + result.txHash : ''));
            loadAssetsList();
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

var _assetsInitCount = 0;
var _assetsInitInterval = setInterval(function() {
    _assetsInitCount++;
    if (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.account) {
        clearInterval(_assetsInitInterval);
        setTimeout(initAssetsSection, 500);
    } else if (_assetsInitCount > 60) {
        clearInterval(_assetsInitInterval);
    }
}, 1000);

var _origUpdateUI = (typeof TokenomicWallet !== 'undefined') ? TokenomicWallet.updateUI : null;
if (typeof TokenomicWallet !== 'undefined') {
    var _boundOriginal = TokenomicWallet.updateUI.bind(TokenomicWallet);
    TokenomicWallet.updateUI = function() {
        _boundOriginal();
        if (TokenomicWallet.account) {
            setTimeout(initAssetsSection, 300);
        }
    };
}
