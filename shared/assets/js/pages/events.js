/* Extracted from dashboard/events.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function eventsPage() {
    return {
        loading: true,
        creating: false,
        saving: false,
        hosted: [],
        myRsvps: [],
        showCreate: false,
        editId: null,
        attendeesId: null,
        attendees: [],
        errorMsg: '',
        okMsg: '',
        nf: {
            title: '', description: '', starts_at_local: '', ends_at_local: '',
            location: '', meeting_url: '', cover_url: '', capacity: '',
            visibility: 'public', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        },
        ef: { title:'', description:'', starts_at_local:'', capacity:'', status:'scheduled', visibility:'public' },

        get upcomingCount() {
            var now = Date.now();
            return this.hosted.filter(function(e){ return e.status === 'scheduled' && Date.parse(e.starts_at) >= now; }).length;
        },
        get totalGoing() {
            return this.hosted.reduce(function(s,e){ return s + (e.rsvp_count||0); }, 0);
        },

        isPast(ev) { return ev.starts_at && Date.parse(ev.starts_at) < Date.now(); },

        fmtDate(s) {
            if (!s) return '';
            try {
                var d = new Date(s);
                return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
                       + ' · ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
            } catch (e) { return s; }
        },

        // Convert ISO string → value compatible with <input type="datetime-local">.
        isoToLocalInput(iso) {
            if (!iso) return '';
            var d = new Date(iso);
            if (isNaN(d)) return '';
            var pad = function(n){ return String(n).padStart(2,'0'); };
            return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
        },
        // Convert <input type="datetime-local"> value → ISO string in caller's TZ.
        localInputToIso(v) {
            if (!v) return null;
            var d = new Date(v);
            return isNaN(d) ? null : d.toISOString();
        },

        async init() {
            this.loading = true;
            try {
                var walletAddr = (typeof TokenomicWallet !== 'undefined' && TokenomicWallet.account)
                                 ? String(TokenomicWallet.account).toLowerCase()
                                 : '';
                if (walletAddr) {
                    this.hosted = await TokenomicSupabase.listEvents({ host: walletAddr, status: 'any', visibility: 'any', limit: 200 });
                }
                if (TokenomicSupabase.isSignedIn()) {
                    var my = await TokenomicSupabase.myRsvps();
                    // myRsvps() may return { items, count } or a plain array depending on helper.
                    this.myRsvps = Array.isArray(my) ? my : (my && my.items ? my.items : []);
                }
            } catch (e) {
                this.errorMsg = 'Failed to load events: ' + (e.message || e);
            }
            this.loading = false;
        },
        async reload() { await this.init(); },

        async submitNew() {
            this.errorMsg = ''; this.okMsg = '';
            if (!this.nf.title || this.nf.title.trim().length < 2) { this.errorMsg = 'Title is required.'; return; }
            if (!this.nf.starts_at_local) { this.errorMsg = 'Start date is required.'; return; }
            if (!TokenomicSupabase.isSignedIn()) {
                try { await TokenomicSupabase.signIn(); } catch (e) { this.errorMsg = 'Sign in required to create events.'; return; }
            }
            this.creating = true;
            try {
                var payload = {
                    title: this.nf.title.trim(),
                    description: this.nf.description || '',
                    starts_at: this.localInputToIso(this.nf.starts_at_local),
                    ends_at: this.nf.ends_at_local ? this.localInputToIso(this.nf.ends_at_local) : null,
                    timezone: this.nf.timezone || 'UTC',
                    location: this.nf.location || '',
                    meeting_url: this.nf.meeting_url || '',
                    cover_url: this.nf.cover_url || '',
                    capacity: this.nf.capacity || null,
                    visibility: this.nf.visibility || 'public'
                };
                var ev = await TokenomicSupabase.createEvent(payload);
                this.hosted.unshift(ev);
                this.okMsg = 'Event created.';
                this.showCreate = false;
                this.nf = { title:'', description:'', starts_at_local:'', ends_at_local:'', location:'', meeting_url:'', cover_url:'', capacity:'', visibility:'public', timezone: this.nf.timezone };
            } catch (e) {
                this.errorMsg = e.body && e.body.error ? e.body.error : (e.message || 'Failed to create event');
            }
            this.creating = false;
        },

        openEdit(ev) {
            this.attendeesId = null;
            this.editId = ev.id;
            this.ef = {
                title: ev.title,
                description: ev.description || '',
                starts_at_local: this.isoToLocalInput(ev.starts_at),
                capacity: ev.capacity || '',
                status: ev.status,
                visibility: ev.visibility
            };
        },
        async saveEdit(ev) {
            this.saving = true; this.errorMsg = '';
            try {
                var patch = {
                    title: this.ef.title,
                    description: this.ef.description,
                    starts_at: this.localInputToIso(this.ef.starts_at_local),
                    capacity: this.ef.capacity === '' ? null : Number(this.ef.capacity),
                    status: this.ef.status,
                    visibility: this.ef.visibility
                };
                var updated = await TokenomicSupabase.updateEvent(ev.id, patch);
                var i = this.hosted.findIndex(function(x){ return x.id === ev.id; });
                if (i >= 0) this.hosted.splice(i, 1, updated);
                this.editId = null;
                this.okMsg = 'Event updated.';
            } catch (e) {
                this.errorMsg = e.body && e.body.error ? e.body.error : (e.message || 'Failed to save');
            }
            this.saving = false;
        },

        async openAttendees(ev) {
            this.editId = null;
            if (this.attendeesId === ev.id) { this.attendeesId = null; return; }
            this.attendeesId = ev.id;
            this.attendees = [];
            try {
                this.attendees = await TokenomicSupabase.listEventRsvps(ev.id);
            } catch (e) {
                this.errorMsg = e.body && e.body.error ? e.body.error : (e.message || 'Failed to load attendees');
            }
        },

        async removeEvent(ev) {
            if (!confirm('Delete event "' + ev.title + '"? This cancels all RSVPs and cannot be undone.')) return;
            try {
                await TokenomicSupabase.deleteEvent(ev.id);
                this.hosted = this.hosted.filter(function(x){ return x.id !== ev.id; });
                this.okMsg = 'Event deleted.';
            } catch (e) {
                this.errorMsg = e.body && e.body.error ? e.body.error : (e.message || 'Failed to delete');
            }
        },

        async cancelMyRsvp(r) {
            if (!confirm('Cancel your RSVP for "' + r.title + '"?')) return;
            try {
                await TokenomicSupabase.cancelRsvp(r.id);
                this.myRsvps = this.myRsvps.filter(function(x){ return x.id !== r.id; });
                this.okMsg = 'RSVP cancelled.';
            } catch (e) {
                this.errorMsg = e.body && e.body.error ? e.body.error : (e.message || 'Failed to cancel RSVP');
            }
        }
    };
}
