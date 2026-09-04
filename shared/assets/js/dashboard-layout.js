/* Dashboard shell behaviour for `layout: dashboard` pages.
 *
 * Three responsibilities:
 *   (1) The navigation drawer below 768px — a real modal dialog.
 *   (2) The rail-expand toggle between 768 and 1119px.
 *   (3) The theme toggle, and the role-aware sidebar gate.
 *
 * What this replaces: the previous version read the sidebar's markup at
 * runtime and synthesised a SECOND navigation tree (a "mobile-dash-bar"
 * plus dropdown) into the content column below 992px. That copy had no
 * aria-expanded, no accessible name beyond the word "Menu", no focus
 * management, and — because it was built from whatever markup the page
 * happened to ship — it drifted per page. The drawer is now the same
 * markup as the desktop sidebar, moved with a transform, so there is one
 * nav tree at every width.
 *
 * External file so the site CSP can stay at script-src 'self'.
 */

(function () {
  'use strict';

  var shell = document.getElementById('tknDashShell');
  if (!shell) return;

  var sidebar = document.getElementById('tknDashSidebar');
  var scrim = document.getElementById('tknDashScrim');
  var drawerToggle = document.getElementById('tknDrawerToggle');
  var railToggle = document.getElementById('tknRailToggle');
  var drawerClose = document.getElementById('tknDrawerClose');

  // ============================================================
  // (1) Drawer — modal dialog semantics
  // ============================================================

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var drawerOpen = false;
  var lastFocus = null;

  function focusableInDrawer() {
    if (!sidebar) return [];
    return Array.prototype.filter.call(
      sidebar.querySelectorAll(FOCUSABLE),
      function (el) {
        // offsetParent is null for display:none, which is how the close
        // button and the labels leave the tab order above 768px.
        return el.offsetParent !== null || el === document.activeElement;
      },
    );
  }

  function openDrawer() {
    if (drawerOpen || !sidebar) return;
    drawerOpen = true;
    lastFocus = document.activeElement;

    shell.classList.add('drawer-open');
    if (scrim) scrim.hidden = false;

    // role/aria-modal are set only while open: between 768 and 1119 the
    // same element is a static rail, and a permanently-modal landmark
    // would be announced as a dialog that can never be dismissed.
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    sidebar.setAttribute('aria-label', 'Dashboard navigation');

    if (drawerToggle) {
      drawerToggle.setAttribute('aria-expanded', 'true');
      drawerToggle.setAttribute('aria-label', 'Close navigation');
    }

    document.body.style.overflow = 'hidden';

    // Focus the close button rather than the first nav link, so the
    // dismiss action is one key away and the nav order is unchanged.
    if (drawerClose) drawerClose.focus();
    else {
      var first = focusableInDrawer()[0];
      if (first) first.focus();
    }
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen || !sidebar) return;
    drawerOpen = false;

    shell.classList.remove('drawer-open');

    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('aria-label');

    if (drawerToggle) {
      drawerToggle.setAttribute('aria-expanded', 'false');
      drawerToggle.setAttribute('aria-label', 'Open navigation');
    }

    document.body.style.overflow = '';

    // Keep the scrim in the DOM until the fade finishes, then hide it
    // so it cannot swallow clicks while transparent.
    if (scrim) {
      window.setTimeout(function () {
        if (!drawerOpen) scrim.hidden = true;
      }, 200);
    }

    if (returnFocus !== false && lastFocus && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  if (drawerToggle) {
    drawerToggle.addEventListener('click', function () {
      if (drawerOpen) closeDrawer();
      else openDrawer();
    });
  }

  if (drawerClose) drawerClose.addEventListener('click', function () { closeDrawer(); });
  if (scrim) scrim.addEventListener('click', function () { closeDrawer(); });

  document.addEventListener('keydown', function (e) {
    if (!drawerOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeDrawer();
      return;
    }

    if (e.key !== 'Tab') return;

    // Focus trap. Without it, tabbing past the last nav link lands on
    // page content behind the scrim, which is inert to the mouse but
    // still reachable by keyboard.
    var items = focusableInDrawer();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!sidebar.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  });

  // Navigating away with the drawer open would otherwise leave the back
  // gesture returning to a page whose body still has overflow:hidden.
  if (sidebar) {
    sidebar.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('a.dash-nav-item') : null;
      if (link && drawerOpen) closeDrawer(false);
    });
  }

  // Above 768 the drawer state is meaningless — the sidebar is a static
  // rail — so drop it rather than leaving body scroll locked.
  var mqRail = window.matchMedia('(min-width: 768px)');
  function onBreakpoint(e) {
    if (e.matches && drawerOpen) closeDrawer(false);
    if (!e.matches) collapseRail();
  }
  if (mqRail.addEventListener) mqRail.addEventListener('change', onBreakpoint);
  else if (mqRail.addListener) mqRail.addListener(onBreakpoint);

  // ============================================================
  // (2) Rail expand (768–1119)
  // ============================================================

  function collapseRail() {
    shell.classList.remove('rail-expanded');
    if (railToggle) {
      railToggle.setAttribute('aria-expanded', 'false');
      railToggle.setAttribute('aria-label', 'Expand navigation labels');
    }
  }

  if (railToggle) {
    railToggle.addEventListener('click', function () {
      var expanded = shell.classList.toggle('rail-expanded');
      railToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      railToggle.setAttribute(
        'aria-label',
        expanded ? 'Collapse navigation labels' : 'Expand navigation labels',
      );
    });
  }

  // ============================================================
  // (3) Theme toggle
  // ============================================================

  var themeToggle = document.getElementById('tknThemeToggle');

  function syncThemeButton() {
    if (!themeToggle) return;
    var light = document.documentElement.classList.contains('theme-light');
    themeToggle.setAttribute('aria-pressed', light ? 'true' : 'false');
    themeToggle.setAttribute(
      'aria-label',
      light ? 'Switch to dark theme' : 'Switch to light theme',
    );
  }

  if (themeToggle) {
    syncThemeButton();
    themeToggle.addEventListener('click', function () {
      var root = document.documentElement;
      var toLight = !root.classList.contains('theme-light');
      if (toLight) { root.classList.add('theme-light'); root.classList.remove('dark'); }
      else { root.classList.remove('theme-light'); root.classList.add('dark'); }
      try { localStorage.setItem('tkn-theme', toLight ? 'light' : 'dark'); } catch (err) { /* private mode */ }
      syncThemeButton();
    });
  }

  // ============================================================
  // (4) Role-aware sidebar gating
  //
  // Hides nav entries the signed-in wallet has no role for. Keys match
  // `data-dash` in _includes/dashboard-nav.html — keep the two in sync.
  // Failure is deliberately silent and leaves the sidebar fully
  // visible: the worker authorises every route regardless, so a hidden
  // link is a convenience, never the access control.
  // ============================================================

  var GATES = {
    communities: ['learner', 'educator', 'consultant', 'admin'],
    courses: ['learner', 'educator', 'consultant', 'admin'],
    events: ['learner', 'educator', 'consultant', 'admin'],
    revenue: ['educator', 'consultant', 'admin'],
    bookings: ['consultant', 'admin'],
    chat: ['learner', 'educator', 'consultant', 'admin'],
    articles: ['educator', 'admin'],
    social: ['educator', 'admin'],
    leaderboard: ['learner', 'educator', 'consultant', 'admin'],
    profile: ['learner', 'educator', 'consultant', 'admin'],
    admin: ['admin'],
  };

  function applyGates(roles) {
    var rs = Array.isArray(roles) && roles.length ? roles : ['learner'];
    document.querySelectorAll('.dash-nav-item').forEach(function (el) {
      var k = el.getAttribute('data-dash');
      if (!k || !GATES[k]) return;
      var ok = GATES[k].some(function (r) { return rs.indexOf(r) !== -1; });
      if (!ok) el.hidden = true;
    });

    // Drop a group heading once every item under it is hidden.
    var sec = null;
    var anyVisible = false;
    document.querySelectorAll('.dashboard-nav > *').forEach(function (el) {
      if (el.classList.contains('sidebar-section-label')) {
        if (sec && !anyVisible) sec.hidden = true;
        sec = el;
        anyVisible = false;
      } else if (el.classList.contains('dash-nav-item') && !el.hidden) {
        anyVisible = true;
      }
    });
    if (sec && !anyVisible) sec.hidden = true;
  }

  function rewriteCommunitiesLink() {
    document.querySelectorAll('.dash-nav-item[data-dash="communities"]').forEach(function (a) {
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
        ? window.TokenomicWallet.getAddress()
        : null;
      if (!w || !window.TokenomicAPI.isSignedIn(w)) return;
      var me = await window.TokenomicAPI.getMe();
      if (me && me.roles) applyGates(me.roles);
    } catch (err) { /* leave the sidebar fully visible */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(initRoles, 400); });
  } else {
    setTimeout(initRoles, 400);
  }
  window.addEventListener('tokenomic:wallet-connected', function () { setTimeout(initRoles, 600); });
})();
