/* Extracted from dashboard/index.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function dashboardHome() {
    return {
        roles: ['learner'],
        wallet: '',
        walletShort: '',
        displayName: '',
        roleStats: [],
        quickActions: [],
        recentTx: [],
        enrollments: [],
        learnerStats: { xp: 0, streak: 0, certs: 0, enrolled: 0 },
        adminCounts: { applications: 0, courses: 0, communities: 0, articles: 0, total: 0 },
        adminLoaded: false,
        hasRole(r) { return this.roles.indexOf(r) !== -1; },
        roleBadge(r) {
            return r === 'admin'      ? 'dash-badge-warning'
                 : r === 'educator'   ? 'dash-badge-success'
                 : r === 'consultant' ? 'dash-badge-info'
                 : 'dash-badge-info';
        },
        shortAddr(a) { if (!a) return '—'; return a.slice(0,6) + '…' + a.slice(-4); },
        get adminCountsView() {
            // Strip the .total field for display.
            var c = this.adminCounts; return { applications: c.applications, courses: c.courses, communities: c.communities, articles: c.articles };
        },
        async init() {
            // 1. Identity + roles
            var w = (window.TokenomicWallet && window.TokenomicWallet.getAddress) ? window.TokenomicWallet.getAddress() : null;
            if (!w) return; // login gate keeps the page hidden anyway
            this.wallet = w;
            this.walletShort = this.shortAddr(w);

            try {
                if (window.TokenomicAPI && !window.TokenomicAPI.isSignedIn(w)) {
                    await window.TokenomicAPI.signIn(w);
                }
                var me = window.TokenomicAPI ? await window.TokenomicAPI.getMe() : null;
                if (me) {
                    if (Array.isArray(me.roles) && me.roles.length) this.roles = me.roles;
                    if (me.profile && me.profile.display_name) this.displayName = me.profile.display_name;
                }
            } catch (e) { console.warn('getMe failed:', e.message); }

            // 2. Role-driven stats + quick actions
            this.computeRoleSurface();

            // 3. Real data fetches (in parallel)
            await Promise.all([
                this.loadRevenue(),
                this.loadEnrollments(),
                this.hasRole('admin') ? this.loadAdminQueue() : Promise.resolve()
            ]);

            // 4. Recompute headline stats with the data we just loaded
            this.computeRoleSurface();
        },
        async loadRevenue() {
            if (!this.hasRole('educator') && !this.hasRole('consultant') && !this.hasRole('admin')) return;
            try {
                var rows = window.TokenomicAPI ? await window.TokenomicAPI.getRevenue(this.wallet) : [];
                this.recentTx = (rows || []).slice(0, 6);
            } catch (e) { /* keep empty state */ }
        },
        async loadEnrollments() {
            try {
                var rows = window.TokenomicAPI ? await window.TokenomicAPI.getMyEnrollments(this.wallet) : [];
                this.enrollments = rows || [];
                this.learnerStats.enrolled = this.enrollments.length;
                this.learnerStats.certs = this.enrollments.filter(function(e){ return (e.progress||0) >= 100; }).length;
                this.learnerStats.xp = this.enrollments.reduce(function(s,e){ return s + (e.progress||0) * 5; }, 0);
            } catch (e) { /* keep zeros */ }
        },
        async loadAdminQueue() {
            try {
                var d = window.TokenomicAPI ? await window.TokenomicAPI.getAdminQueue('all', 'pending_review') : null;
                if (d && d.counts) this.adminCounts = d.counts;
                this.adminLoaded = true;
            } catch (e) { this.adminLoaded = true; }
        },
        computeRoleSurface() {
            var totalRevenue = this.recentTx.reduce(function(s, t){ return s + (Number(t.amount_usdc) || 0); }, 0);

            if (this.hasRole('admin')) {
                this.roleStats = [
                    { label: 'Pending applications', value: this.adminCounts.applications || 0, color: '#ff6000' },
                    { label: 'Courses to review',    value: this.adminCounts.courses      || 0, color: '#00C853' },
                    { label: 'Communities to review',value: this.adminCounts.communities  || 0, color: '#2196F3' },
                    { label: 'Articles to review',   value: this.adminCounts.articles     || 0, color: '#0A0F1A' }
                ];
            } else if (this.hasRole('educator')) {
                this.roleStats = [
                    { label: 'Recent revenue',  value: '$' + totalRevenue.toFixed(2), color: '#00C853' },
                    { label: 'Enrolled courses',value: this.learnerStats.enrolled,    color: '#0A0F1A' },
                    { label: 'Certificates',    value: this.learnerStats.certs,        color: '#2196F3' },
                    { label: 'Streak',          value: this.learnerStats.streak + 'd', color: '#ff6000' }
                ];
            } else if (this.hasRole('consultant')) {
                this.roleStats = [
                    { label: 'Recent revenue',  value: '$' + totalRevenue.toFixed(2), color: '#00C853' },
                    { label: 'Sessions booked', value: '0',                            color: '#F7931A' },
                    { label: 'Certificates',    value: this.learnerStats.certs,        color: '#2196F3' },
                    { label: 'Streak',          value: this.learnerStats.streak + 'd', color: '#ff6000' }
                ];
            } else {
                this.roleStats = [
                    { label: 'XP',              value: this.learnerStats.xp,           color: '#ff6000' },
                    { label: 'Enrolled courses',value: this.learnerStats.enrolled,    color: '#0A0F1A' },
                    { label: 'Certificates',    value: this.learnerStats.certs,        color: '#00C853' },
                    { label: 'Streak',          value: this.learnerStats.streak + 'd', color: '#2196F3' }
                ];
            }

            // Role-specific quick actions (educator/admin sidebar)
            if (this.hasRole('admin')) {
                this.quickActions = [
                    { label: 'Review queue',  desc: 'Approve content',     url: '/dashboard/admin-queue/', icon: 'flaticon-user-3', iconBg: 'rgba(247,147,26,0.1)', iconColor: '#F7931A' },
                    { label: 'Revenue',       desc: 'Platform totals',     url: '/revenue/',                icon: 'flaticon-money',  iconBg: 'rgba(0,200,83,0.1)',   iconColor: '#00C853' },
                    { label: 'Communities',   desc: 'Moderate groups',     url: '/dashboard-communities/',  icon: 'flaticon-user-3', iconBg: 'rgba(33,150,243,0.1)', iconColor: '#2196F3' },
                    { label: 'Articles',      desc: 'Editorial review',    url: '/articles/',               icon: 'flaticon-edit',   iconBg: 'rgba(156,39,176,0.1)', iconColor: '#9C27B0' }
                ];
            } else if (this.hasRole('educator')) {
                this.quickActions = [
                    { label: 'New course',    desc: 'Submit for review',   url: '/my-courses/',             icon: 'flaticon-notebook', iconBg: 'rgba(247,147,26,0.1)', iconColor: '#F7931A' },
                    { label: 'Write article', desc: 'Publish to learn',    url: '/articles/',               icon: 'flaticon-edit',     iconBg: 'rgba(33,150,243,0.1)', iconColor: '#2196F3' },
                    { label: 'Revenue',       desc: 'View earnings',       url: '/revenue/',                icon: 'flaticon-money',    iconBg: 'rgba(0,200,83,0.1)',   iconColor: '#00C853' },
                    { label: 'Chat',          desc: 'Community messages',  url: '/chat/',                   icon: 'flaticon-speech-bubble', iconBg: 'rgba(255,143,0,0.1)', iconColor: '#FF8F00' }
                ];
            } else if (this.hasRole('consultant')) {
                this.quickActions = [
                    { label: 'Bookings',      desc: 'Manage sessions',     url: '/bookings/', icon: 'flaticon-calendar',      iconBg: 'rgba(247,147,26,0.1)', iconColor: '#F7931A' },
                    { label: 'Withdraw',      desc: 'Claim funds',         url: '/revenue/',  icon: 'flaticon-money',         iconBg: 'rgba(0,200,83,0.1)',   iconColor: '#00C853' },
                    { label: 'Messages',      desc: 'Client chat',         url: '/chat/',     icon: 'flaticon-speech-bubble', iconBg: 'rgba(33,150,243,0.1)', iconColor: '#2196F3' },
                    { label: 'Profile',       desc: 'Edit settings',       url: '/profile/',  icon: 'flaticon-user-3',        iconBg: 'rgba(156,39,176,0.1)', iconColor: '#9C27B0' }
                ];
            }
        }
    };
}
