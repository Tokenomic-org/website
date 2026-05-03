/* Extracted from dashboard/chat.html for strict CSP. Functions are
 * exposed on `window` for Alpine.js x-data attributes that
 * reference them by name. */
function chatPage() {
    return {
        loading: true,
        loadingHistory: false,
        channels: [],
        activeChannel: null,
        messages: [],
        socket: null,
        connState: 'idle', // idle | connecting | open | closed | error
        message: '',
        search: '',
        selectionToken: 0, // monotonic — guards against rapid channel switching

        get filteredChannels() {
            if (!this.search) return this.channels;
            const q = this.search.toLowerCase();
            return this.channels.filter(c => (c.name || '').toLowerCase().includes(q));
        },
        get connStateLabel() {
            return ({ idle:'Idle', connecting:'Connecting…', open:'Live', closed:'Disconnected', error:'Connection error' })[this.connState] || this.connState;
        },

        async init() {
            try {
                this.channels = await window.TokenomicAPI.getCommunities();
            } catch (e) {
                console.warn('communities load:', e.message);
                this.channels = [];
            }
            this.loading = false;
            if (this.channels.length > 0) this.selectChannel(this.channels[0]);

            // Tear down on navigation away.
            window.addEventListener('beforeunload', () => { if (this.socket) this.socket.close(); });
        },

        async selectChannel(ch) {
            if (this.activeChannel && this.activeChannel.id === ch.id) return;
            const myToken = ++this.selectionToken;
            if (this.socket) { try { this.socket.close(); } catch {} this.socket = null; }
            this.activeChannel = ch;
            this.messages = [];
            this.loadingHistory = true;
            this.connState = 'connecting';

            // 1. Backfill history from D1.
            try {
                const items = await window.TokenomicAPI.getMessages(ch.id);
                if (myToken !== this.selectionToken) return; // stale — newer channel selected
                this.messages = items;
            } catch (e) {
                console.warn('history load:', e.message);
            } finally {
                if (myToken === this.selectionToken) {
                    this.loadingHistory = false;
                    this.scrollToBottom();
                }
            }

            // 2. Open the live WebSocket.
            let sock = null;
            try {
                sock = await window.TokenomicAPI.openChatSocket(ch.id, {
                    onOpen:    () => { if (myToken === this.selectionToken) this.connState = 'open'; },
                    onClose:   () => { if (myToken === this.selectionToken) this.connState = 'closed'; },
                    onError:   () => { if (myToken === this.selectionToken) this.connState = 'error'; },
                    onMessage: (payload) => {
                        if (myToken !== this.selectionToken) return; // ignore stale-channel messages
                        if (!payload) return;
                        if (payload.type === 'error') {
                            console.warn('chat error:', payload.error);
                            return;
                        }
                        if (payload.type === 'message' && payload.message) {
                            const m = payload.message;
                            // Dedupe by id (history backfill + live can overlap on first message).
                            if (!this.messages.some(x => x.id === m.id)) {
                                this.messages.push(m);
                                this.scrollToBottom();
                            }
                        }
                    }
                });
            } catch (e) {
                console.warn('socket open:', e.message);
                if (myToken === this.selectionToken) this.connState = 'error';
                return;
            }
            // If user clicked away during the await, drop the freshly-opened socket.
            if (myToken !== this.selectionToken) { try { sock.close(); } catch {}; return; }
            this.socket = sock;
        },

        sendMessage() {
            const text = this.message.trim();
            if (!text || !this.socket) return;
            if (!this.socket.send(text)) return;
            this.message = '';
        },

        scrollToBottom() {
            this.$nextTick(() => {
                const el = document.getElementById('chatMessages');
                if (el) el.scrollTop = el.scrollHeight;
            });
        },

        shortAddr(a) { if (!a) return 'anon'; return a.slice(0,6) + '…' + a.slice(-4); },
        formatTime(ts) {
            if (!ts) return '';
            try { const d = new Date(ts.toString().includes('T') ? ts : ts + 'Z'); return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
            catch { return ''; }
        }
    };
}
