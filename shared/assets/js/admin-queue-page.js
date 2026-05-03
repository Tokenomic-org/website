function adminQueue() {
    return {
        loaded: false,
        isAdmin: false,
        active: 'applications',
        tabs: [
            { key: 'applications', label: 'Applications' },
            { key: 'courses',      label: 'Courses' },
            { key: 'communities',  label: 'Communities' },
            { key: 'articles',     label: 'Articles' }
        ],
        items: { applications: [], courses: [], communities: [], articles: [] },
        counts: {},
        rejecting: { open: false, kind: '', id: null, feedback: '', busy: false, error: '' },

        async init() {
            const w = (window.TokenomicWallet && window.TokenomicWallet.getAddress) ? window.TokenomicWallet.getAddress() : null;
            if (!w) { this.loaded = true; return; }
            try {
                if (window.TokenomicAPI && !window.TokenomicAPI.isSignedIn(w)) {
                    await window.TokenomicAPI.signIn(w);
                }
                const me = await window.TokenomicAPI.getMe();
                this.isAdmin = !!(me && Array.isArray(me.roles) && me.roles.indexOf('admin') !== -1);
                if (this.isAdmin) await this.refresh();
            } catch (e) {
                console.warn('admin queue init:', e.message);
            } finally {
                this.loaded = true;
            }
        },
        async refresh() {
            try {
                const q = await window.TokenomicAPI.getAdminQueue('all', 'pending_review');
                this.items = q.items || { applications: [], courses: [], communities: [], articles: [] };
                this.counts = q.counts || {};
            } catch (e) {
                if (e.status === 403) this.isAdmin = false;
                else console.warn('queue refresh:', e.message);
            }
        },
        shortAddr(a) { if (!a) return ''; return a.slice(0,6) + '…' + a.slice(-4); },
        // Block javascript:/data:/etc URLs in clickable links — XSS guard.
        safeUrl(u) {
            if (!u || typeof u !== 'string') return '';
            try { var p = new URL(u, window.location.origin); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
            catch { return ''; }
        },
        prettyJson(s) {
            try { const v = JSON.parse(s); return Array.isArray(v) ? v.join(', ') : String(s); }
            catch { return String(s || ''); }
        },
        formatDate(s) {
            if (!s) return '';
            const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
            return isNaN(d) ? s : d.toLocaleDateString();
        },

        async approve(kind, id) {
            try {
                if (kind === 'application') {
                    const r = await window.TokenomicAPI.approveApplication(id);
                    this.items.applications = this.items.applications.filter(x => x.id !== id);
                    this.counts.applications = (this.counts.applications || 1) - 1;
                    alert('Approved. Granted role: ' + (r.granted_role || ''));
                }
            } catch (e) { alert('Approve failed: ' + e.message); }
        },
        async approveContent(kind, id) {
            try {
                await window.TokenomicAPI.approveContent(kind, id);
                this.items[kind] = this.items[kind].filter(x => x.id !== id);
                this.counts[kind] = (this.counts[kind] || 1) - 1;
            } catch (e) { alert('Approve failed: ' + e.message); }
        },
        openReject(kind, id) {
            this.rejecting = { open: true, kind: kind, id: id, feedback: '', busy: false, error: '' };
        },
        openRejectContent(kind, id) {
            this.rejecting = { open: true, kind: kind, id: id, feedback: '', busy: false, error: '' };
        },
        closeReject() { this.rejecting.open = false; },
        async confirmReject() {
            const fb = (this.rejecting.feedback || '').trim();
            if (fb.length < 10) { this.rejecting.error = 'Feedback must be ≥ 10 characters.'; return; }
            this.rejecting.busy = true; this.rejecting.error = '';
            try {
                if (this.rejecting.kind === 'application') {
                    await window.TokenomicAPI.rejectApplication(this.rejecting.id, fb);
                    this.items.applications = this.items.applications.filter(x => x.id !== this.rejecting.id);
                    this.counts.applications = (this.counts.applications || 1) - 1;
                } else {
                    await window.TokenomicAPI.rejectContent(this.rejecting.kind, this.rejecting.id, fb);
                    const k = this.rejecting.kind;
                    this.items[k] = this.items[k].filter(x => x.id !== this.rejecting.id);
                    this.counts[k] = (this.counts[k] || 1) - 1;
                }
                this.rejecting.open = false;
            } catch (e) {
                this.rejecting.error = e.message;
            } finally {
                this.rejecting.busy = false;
            }
        }
    };
}

