/* Dashboard layout bootstrap — extracted from _layouts/dashboard.html
 * for strict CSP. Two responsibilities:
 *   (1) Mobile dashboard nav synth (collapses sidebar into a dropdown
 *       on <992px viewports).
 *   (2) Role-aware sidebar gating (hides Teaching / Finance / etc.
 *       sections until /api/auth/me reports the matching role).
 *
 * Both IIFEs preserve the exact behavior of the previous inline code.
 */

// ============================================================
// (1) Mobile dashboard navigation
// ============================================================
(function () {
  var flatIconMap = {"flaticon-home-1":"fas fa-home","flaticon-user-3":"fas fa-users","flaticon-notebook":"fas fa-book","flaticon-calendar":"fas fa-calendar","flaticon-money":"fas fa-chart-line","flaticon-speech-bubble":"fas fa-comments","flaticon-edit":"fas fa-pen-to-square","flaticon-share":"fas fa-share-nodes","flaticon-trophy":"fas fa-trophy","flaticon-suitcase":"fas fa-calendar-check","flaticon-user":"fas fa-user"};
  function initMobileDashNav() {
    if (window.innerWidth > 991) return;
    var sidebar = document.querySelector('.dashboard-sidebar');
    if (!sidebar) return;
    var sidebarCol = sidebar.parentElement;
    var contentCol = sidebarCol ? sidebarCol.nextElementSibling : null;
    if (sidebarCol) sidebarCol.classList.add('dashboard-sidebar-col');
    if (contentCol) contentCol.classList.add('dashboard-content-col');
    function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    var profileData = {};
    try { profileData = JSON.parse(localStorage.getItem('tkn_profile_data') || '{}'); } catch(e) {}
    var userName = esc(profileData.displayName || profileData.name || 'Tokenomic');
    var photo = esc(localStorage.getItem('tkn_profile_photo') || '');
    var initials = (userName || 'T').trim().charAt(0).toUpperCase();
    var avatarHtml = photo
        ? '<img src="' + photo + '" alt="' + userName + '" />'
        : initials;
    var navItemsHtml = '';
    var children = sidebar.querySelectorAll('.sidebar-section-label, .dash-nav-item');
    for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el.classList.contains('sidebar-section-label')) {
            navItemsHtml += '<div class="mob-section-label">' + esc(el.textContent.trim()) + '</div>';
        } else {
            var href = el.getAttribute('href') || '#';
            var iconEl = el.querySelector('i');
            var iconHtml = '';
            if (iconEl) { iconHtml = iconEl.outerHTML; }
            else {
                var spanIcon = el.querySelector('span[class*=flaticon]');
                if (spanIcon) {
                    var cls = spanIcon.className.split(' ').filter(function(c){return c.indexOf('flaticon')===0;})[0] || '';
                    var faClass = flatIconMap[cls] || 'fas fa-circle';
                    iconHtml = '<i class="' + faClass + '"></i>';
                }
            }
            var label = el.textContent.trim();
            var isActive = el.classList.contains('active') ? ' active' : '';
            navItemsHtml += '<a href="' + esc(href) + '" class="mob-nav-item' + isActive + '">' + iconHtml + ' ' + esc(label) + '</a>';
        }
    }
    var barHtml = '<div class="mobile-dash-bar" id="mobileDashBar">' +
        '<div class="mobile-dash-bar-user">' +
        '<div class="mobile-dash-bar-avatar">' + avatarHtml + '</div>' +
        '<div class="mobile-dash-bar-info">' +
        '<span class="mobile-dash-bar-name">' + userName + '</span>' +
        '<span class="mobile-dash-bar-label">Dashboard</span>' +
        '</div></div>' +
        '<button class="mobile-dash-bar-toggle" aria-label="Toggle navigation">' +
        'Menu <i class="fas fa-chevron-down mob-chevron"></i>' +
        '</button></div>';
    var dropdownHtml = '<div class="mobile-dash-dropdown" id="mobileDashDropdown">' + navItemsHtml + '</div>';
    if (contentCol) {
        // Sanitize via TKNSanitize when available; the source strings include
        // localStorage-derived values (display name, photo URL) that have
        // already been HTML-escaped above, but routing through the sanitizer
        // gives us defense-in-depth against future regressions.
        var sanitize = (window.TKNSanitize && window.TKNSanitize.html) ? window.TKNSanitize.html : function(s){return s;};
        contentCol.insertAdjacentHTML('afterbegin', sanitize(dropdownHtml));
        contentCol.insertAdjacentHTML('afterbegin', sanitize(barHtml));
    }
    var bar = document.getElementById('mobileDashBar');
    var dropdown = document.getElementById('mobileDashDropdown');
    if (bar && dropdown) {
        bar.addEventListener('click', function() {
            bar.classList.toggle('open');
            dropdown.classList.toggle('open');
        });
        var links = dropdown.querySelectorAll('.mob-nav-item');
        for (var j = 0; j < links.length; j++) {
            links[j].addEventListener('click', function() {
                bar.classList.remove('open');
                dropdown.classList.remove('open');
            });
        }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileDashNav);
  } else {
    initMobileDashNav();
  }
})();

// ============================================================
// (2) Role-aware sidebar gating
// ============================================================
(function () {
  var GATES = {
    'communities': ['learner','educator','consultant','admin'],
    'courses':     ['learner','educator','consultant','admin'],
    'events':      ['learner','educator','consultant','admin'],
    'revenue':     ['educator','consultant','admin'],
    'bookings':    ['consultant','admin'],
    'chat':        ['learner','educator','consultant','admin'],
    'articles':    ['educator','admin'],
    'social':      ['educator','admin'],
    'leaderboard': ['learner','educator','consultant','admin'],
    'profile':     ['learner','educator','consultant','admin']
  };
  function applyGates(roles) {
    var rs = Array.isArray(roles) && roles.length ? roles : ['learner'];
    document.querySelectorAll('.dash-nav-item').forEach(function(el) {
        var k = el.getAttribute('data-dash');
        if (!k || !GATES[k]) return;
        var ok = GATES[k].some(function(r){ return rs.indexOf(r) !== -1; });
        if (!ok) el.style.display = 'none';
    });
    var sec = null, anyVisible = false;
    document.querySelectorAll('.dashboard-nav > *').forEach(function(el) {
        if (el.classList.contains('sidebar-section-label')) {
            if (sec && !anyVisible) sec.style.display = 'none';
            sec = el; anyVisible = false;
        } else if (el.classList.contains('dash-nav-item') && el.style.display !== 'none') {
            anyVisible = true;
        }
    });
    if (sec && !anyVisible) sec.style.display = 'none';
  }
  function rewriteCommunitiesLink() {
    document.querySelectorAll('.dash-nav-item[data-dash="communities"]').forEach(function(a) {
        if (a.getAttribute('href') === '/communities/') {
            a.setAttribute('href', '/dashboard-communities/');
        }
    });
  }
  async function initRoles() {
    rewriteCommunitiesLink();
    if (!window.TokenomicAPI) return;
    try {
        var w = (window.TokenomicWallet && window.TokenomicWallet.getAddress)
                  ? window.TokenomicWallet.getAddress() : null;
        if (!w || !window.TokenomicAPI.isSignedIn(w)) return;
        var me = await window.TokenomicAPI.getMe();
        if (me && me.roles) applyGates(me.roles);
    } catch (e) { /* leave sidebar fully visible */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(initRoles, 400); });
  } else {
    setTimeout(initRoles, 400);
  }
  window.addEventListener('tokenomic:wallet-connected', function(){ setTimeout(initRoles, 600); });
})();
