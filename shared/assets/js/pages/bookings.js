/* Extracted from dashboard/bookings.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function bookingsPage() {
    return {
        wallet: '',
        roles: ['learner'],
        view: 'consultants',
        showForm: false,
        loadingConsultants: true,
        loadingBookings: true,
        busy: false,
        bookErr: '',
        consultants: [],
        bookings: [],
        busyId: null,
        nb: { consultant_wallet: '', topic: '', booking_date: '', time_slot: '10:00', duration: 30, price: 0 },

        get isConsultant() { return this.roles.indexOf('consultant') !== -1; },

        async init() {
            const w = (window.TokenomicWallet && window.TokenomicWallet.getAddress) ? window.TokenomicWallet.getAddress() : null;
            if (!w) return;
            this.wallet = w;

            // Pre-select a consultant from ?to=0x... (deep link from /experts/)
            try {
                const q = new URLSearchParams(window.location.search);
                const to = q.get('to');
                if (to && /^0x[0-9a-fA-F]{40}$/.test(to)) {
                    this.nb.consultant_wallet = to.toLowerCase();
                    this.showForm = true;
                }
            } catch (_) {}

            try {
                if (window.TokenomicAPI && !window.TokenomicAPI.isSignedIn(w)) {
                    await window.TokenomicAPI.signIn(w);
                }
                const me = await window.TokenomicAPI.getMe();
                if (me && Array.isArray(me.roles)) this.roles = me.roles;
                if (this.isConsultant) this.view = 'list';
            } catch (e) { console.warn('bookings me:', e.message); }

            // Load consultants & bookings in parallel.
            try {
                this.consultants = await window.TokenomicAPI.getConsultants();
            } catch (e) {
                console.warn('consultants load:', e.message);
            } finally {
                this.loadingConsultants = false;
            }
            await this.loadBookings();
        },

        async loadBookings() {
            this.loadingBookings = true;
            try {
                if (this.isConsultant) {
                    // Consultant view: bookings made TO me.
                    this.bookings = await window.TokenomicAPI.getBookings(this.wallet);
                } else {
                    // Client view: bookings I made (as the buyer). Server-filtered.
                    this.bookings = await window.TokenomicAPI.getMyClientBookings();
                }
            } catch (e) {
                console.warn('bookings load:', e.message);
                this.bookings = [];
            } finally {
                this.loadingBookings = false;
            }
        },

        async acceptBooking(b) {
            if (this.busyId) return;
            this.busyId = b.id;
            try {
                const updated = await window.TokenomicAPI.acceptBooking(b.id);
                if (updated) Object.assign(b, updated);
            } catch (e) {
                alert('Could not accept: ' + e.message);
            } finally { this.busyId = null; }
        },

        async declineBooking(b) {
            if (this.busyId) return;
            const reason = window.prompt('Reason for declining (min 5 chars, shared in audit log):');
            if (!reason || reason.trim().length < 5) return;
            this.busyId = b.id;
            try {
                const updated = await window.TokenomicAPI.declineBooking(b.id, reason.trim());
                if (updated) Object.assign(b, updated);
            } catch (e) {
                alert('Could not decline: ' + e.message);
            } finally { this.busyId = null; }
        },

        startBooking(c) {
            this.nb.consultant_wallet = c.wallet_address;
            this.showForm = true;
            this.updatePrice();
        },

        updatePrice() {
            const c = this.consultants.find(x => x.wallet_address === this.nb.consultant_wallet);
            if (!c) { this.nb.price = 0; return; }
            const d = parseInt(this.nb.duration, 10);
            if (d === 30 && c.rate_30) { this.nb.price = c.rate_30; }
            else if (d === 60 && c.rate_60) { this.nb.price = c.rate_60; }
            else if (c.rate_60) { this.nb.price = Math.round(c.rate_60 * (d / 60)); }
            else { this.nb.price = 0; }
        },

        async book() {
            this.bookErr = '';
            if (!this.nb.consultant_wallet) { this.bookErr = 'Pick a consultant.'; return; }
            if (!this.nb.topic) { this.bookErr = 'Add a topic for the session.'; return; }
            if (!this.nb.booking_date) { this.bookErr = 'Pick a date.'; return; }
            this.busy = true;
            try {
                if (!window.TokenomicAPI.isSignedIn(this.wallet)) await window.TokenomicAPI.signIn(this.wallet);
                await window.TokenomicAPI.createBooking({
                    consultant_wallet: this.nb.consultant_wallet,
                    topic: this.nb.topic,
                    booking_date: this.nb.booking_date,
                    time_slot: this.nb.time_slot,
                    duration: parseInt(this.nb.duration, 10),
                    price_usdc: this.nb.price,
                    status: 'pending'
                });
                this.showForm = false;
                this.nb = { consultant_wallet: '', topic: '', booking_date: '', time_slot: '10:00', duration: 30, price: 0 };
                this.view = 'list';
                await this.loadBookings();
            } catch (e) {
                this.bookErr = e.message || 'Booking failed';
            } finally {
                this.busy = false;
            }
        },

        shortAddr(a) { if (!a) return ''; return a.slice(0, 6) + '…' + a.slice(-4); }
    };
}
