/* Extracted from dashboard/communities.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function communitiesPage() {
    return {
        communities: [],
        filtered: [],
        loading: true,
        showCreate: false,
        creating: false,
        createError: '',
        searchQuery: '',
        filterType: '',
        filterAccess: '',
        nc: { name: '', slug: '', type: 'general', access: 'open', description: '', visibility: 'public' },
        activeCommunity: null,
        activeTab: 'discussions',
        discussions: [],
        loadingDiscussions: false,
        expandedDiscussion: null,
        discussionReplies: [],
        loadingReplies: false,
        replyText: '',
        postingReply: false,
        newDiscussion: { title: '', body: '' },
        postingDiscussion: false,
        discussionError: '',
        members: [],
        loadingMembers: false,
        inviteWallet: '',
        inviteRole: 'member',
        inviting: false,
        inviteError: '',
        inviteSuccess: '',

        init() {
            this.loadCommunities();
        },

        slugify(text) {
            return text.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0,80);
        },

        initials(name) {
            return (name || 'C').split(/[\s-]+/).map(function(w){return w[0]||'';}).join('').substring(0,2).toUpperCase();
        },

        typeColor(type) {
            var colors = { 'institution':'#f97316','defi-cohort':'#8b5cf6','dao':'#06b6d4','trading-group':'#10b981','general':'#64748b' };
            return colors[type] || '#f97316';
        },

        typeLabel(type) {
            var labels = { 'institution':'Institution','defi-cohort':'DeFi Cohort','dao':'DAO','trading-group':'Trading Group','general':'General','study-group':'Study Group','project':'Project' };
            return labels[type] || type || 'General';
        },

        accessColor(access) {
            var colors = { 'open':'#10b981','invite':'#3b82f6','token-gated':'#f59e0b' };
            return colors[access] || '#64748b';
        },

        accessLabel(access) {
            var labels = { 'open':'Open','invite':'Invite-Only','token-gated':'Token-Gated' };
            return labels[access] || access || 'Open';
        },

        timeAgo(dateStr) {
            var now = Date.now();
            var then = new Date(dateStr).getTime();
            var diff = Math.floor((now - then) / 1000);
            if (diff < 60) return 'just now';
            if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
            if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
            if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
            return new Date(dateStr).toLocaleDateString('en-US',{month:'short',day:'numeric'});
        },

        getWallet() {
            var el = document.querySelector('.wallet-status-text');
            return (el && el.textContent && el.textContent.indexOf('0x') !== -1) ? el.textContent.trim() : '';
        },

        showToast(message, type) {
            var container = document.getElementById('toast-container');
            if (!container) return;
            var toast = document.createElement('div');
            toast.className = 'toast toast-' + (type || 'success');
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(function() { toast.remove(); }, 4000);
        },

        loadCommunities() {
            var self = this;
            self.loading = true;
            // D1 API returns { items: [...], count: N } — see workers/api-worker/d1-routes.js
            (window.TokenomicAPI ? window.TokenomicAPI.getCommunities() : Promise.resolve([]))
                .then(function(items) {
                    self.communities = items || [];
                    self.filterCommunities();
                    self.loading = false;
                })
                .catch(function(err) {
                    console.error('Failed to load communities:', err);
                    self.communities = [];
                    self.filtered = [];
                    self.loading = false;
                });
        },

        filterCommunities() {
            var self = this;
            var q = self.searchQuery.toLowerCase();
            self.filtered = self.communities.filter(function(c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1 && (c.description||'').toLowerCase().indexOf(q) === -1) return false;
                if (self.filterType && c.type !== self.filterType) return false;
                if (self.filterAccess && c.access !== self.filterAccess) return false;
                return true;
            });
        },

        async create() {
            if (!this.nc.name) return;
            var self = this;
            self.creating = true;
            self.createError = '';
            try {
                var wallet = self.getWallet();
                if (!wallet) throw new Error('Connect your wallet first.');

                // SIWE → JWT: only sign once per 24h (token cached in localStorage).
                // Skip the wallet prompt entirely when a valid token is already present.
                var alreadySigned = window.TokenomicAPI && typeof window.TokenomicAPI.isSignedIn === 'function'
                    ? window.TokenomicAPI.isSignedIn(wallet)
                    : false;
                if (!alreadySigned && window.TokenomicAPI && typeof window.TokenomicAPI.signIn === 'function') {
                    try { await window.TokenomicAPI.signIn(wallet); }
                    catch (e) { throw new Error('Wallet signature failed: ' + (e.message || e)); }
                }

                var community = await window.TokenomicAPI.createCommunity({
                    name: self.nc.name,
                    slug: self.nc.slug || self.slugify(self.nc.name),
                    type: self.nc.type,
                    access: self.nc.access,
                    description: self.nc.description,
                    visibility: self.nc.visibility,
                    educator_wallet: wallet
                });

                self.communities.unshift(community);
                self.filterCommunities();
                self.nc = { name: '', slug: '', type: 'general', access: 'open', description: '', visibility: 'public' };
                self.showCreate = false;
                self.showToast('Community published to D1: ' + community.name, 'success');
            } catch (err) {
                self.createError = err.message || 'Failed to create community.';
            } finally {
                self.creating = false;
            }
        },

        viewCommunity(c) {
            this.activeCommunity = c;
            this.activeTab = 'discussions';
            this.discussions = [];
            this.members = [];
            this.loadDiscussions();
        },

        manageCommunity(c) {
            this.activeCommunity = c;
            this.activeTab = 'members';
            this.loadMembers();
        },

        loadDiscussions() {
            var self = this;
            if (!self.activeCommunity) return;
            self.loadingDiscussions = true;
            self.expandedDiscussion = null;
            self.discussionReplies = [];
            fetch('/api/communities/' + self.activeCommunity.id + '/discussions')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.discussions = data.discussions || [];
                    self.loadingDiscussions = false;
                })
                .catch(function() {
                    self.discussions = [];
                    self.loadingDiscussions = false;
                });
        },

        toggleDiscussion(d) {
            if (this.expandedDiscussion === d.id) {
                this.expandedDiscussion = null;
                this.discussionReplies = [];
                return;
            }
            this.expandedDiscussion = d.id;
            this.replyText = '';
            this.loadReplies(d);
        },

        loadReplies(d) {
            var self = this;
            self.loadingReplies = true;
            self.discussionReplies = [];
            fetch('/api/communities/' + self.activeCommunity.id + '/discussions/' + d.id + '/comments')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.discussionReplies = data.comments || [];
                    self.loadingReplies = false;
                })
                .catch(function() {
                    self.loadingReplies = false;
                });
        },

        createDiscussion() {
            if (!this.newDiscussion.title.trim()) return;
            var self = this;
            self.postingDiscussion = true;
            self.discussionError = '';
            fetch('/api/communities/' + self.activeCommunity.id + '/discussions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: self.newDiscussion.title,
                    body: self.newDiscussion.body,
                    wallet: self.getWallet()
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                self.postingDiscussion = false;
                if (data.error) {
                    self.discussionError = data.error;
                    return;
                }
                self.discussions.unshift(data.discussion);
                self.newDiscussion = { title: '', body: '' };
                self.showToast('Discussion posted!', 'success');
            })
            .catch(function() {
                self.postingDiscussion = false;
                self.discussionError = 'Failed to post discussion';
            });
        },

        postReply(d) {
            if (!this.replyText.trim()) return;
            var self = this;
            self.postingReply = true;
            fetch('/api/communities/' + self.activeCommunity.id + '/discussions/' + d.id + '/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    body: self.replyText,
                    wallet: self.getWallet()
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                self.postingReply = false;
                if (data.error) return;
                self.discussionReplies.push(data.comment);
                d.comments_count = (d.comments_count || 0) + 1;
                self.replyText = '';
            })
            .catch(function() {
                self.postingReply = false;
            });
        },

        loadMembers() {
            var self = this;
            if (!self.activeCommunity) return;
            self.loadingMembers = true;
            fetch('/api/communities/' + self.activeCommunity.id + '/members')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.members = data.members || [];
                    self.loadingMembers = false;
                })
                .catch(function() {
                    self.members = [];
                    self.loadingMembers = false;
                });
        },

        inviteMember() {
            if (!this.inviteWallet.trim()) return;
            var self = this;
            self.inviting = true;
            self.inviteError = '';
            self.inviteSuccess = '';
            fetch('/api/communities/' + self.activeCommunity.id + '/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: self.inviteWallet,
                    role: self.inviteRole
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                self.inviting = false;
                if (data.error) {
                    self.inviteError = data.error;
                    return;
                }
                self.inviteSuccess = 'Member added! Total: ' + data.total;
                self.members.push({ wallet: self.inviteWallet, role: self.inviteRole, joinedAt: new Date().toISOString() });
                self.activeCommunity.members_count = data.total;
                self.inviteWallet = '';
                self.showToast('Member added successfully', 'success');
            })
            .catch(function() {
                self.inviting = false;
                self.inviteError = 'Failed to add member';
            });
        }
    };
}
