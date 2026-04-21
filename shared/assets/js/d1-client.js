/**
 * d1-client.js — Tokenomic D1 backend client.
 *
 * Replaces the old Supabase client. Exposes the same surface
 * (window.TokenomicSupabase) so existing pages keep working without changes.
 *
 * Reads are unauthenticated. Writes require an EIP-191 wallet signature
 * exchanged once via /api/auth/login for a 24h JWT (stored in localStorage).
 */

(function () {
  var API_BASE = (window.TOKENOMIC_API_BASE || 'https://tokenomic-api.guillaumelauzier.workers.dev').replace(/\/+$/, '');
  var TOKEN_KEY = 'tokenomic_jwt';
  var WALLET_KEY = 'tokenomic_jwt_wallet';
  var EXP_KEY = 'tokenomic_jwt_exp';

  function lc(s) { return (s || '').toString().toLowerCase(); }
  function getToken() {
    try {
      var t = localStorage.getItem(TOKEN_KEY);
      var exp = parseInt(localStorage.getItem(EXP_KEY) || '0', 10);
      if (!t || !exp) return null;
      if (Math.floor(Date.now() / 1000) >= exp) { clearToken(); return null; }
      return t;
    } catch { return null; }
  }
  function getTokenWallet() { try { return localStorage.getItem(WALLET_KEY); } catch { return null; } }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(WALLET_KEY); localStorage.removeItem(EXP_KEY); } catch {}
  }

  async function api(method, path, body, requireAuth) {
    var headers = { 'Content-Type': 'application/json' };
    if (requireAuth) {
      var t = getToken();
      if (!t) throw new Error('Not signed in. Call TokenomicSupabase.signIn(wallet) first.');
      headers['Authorization'] = 'Bearer ' + t;
    }
    var res = await fetch(API_BASE + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      var msg = (data && data.error) || ('HTTP ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  var TokenomicSupabase = {
    client: { d1: true, base: API_BASE }, // truthy so legacy `if (!this.client)` checks pass

    init() {
      // No-op; kept for compatibility with old call sites.
    },

    /**
     * Sign in with a wallet. Requires window.ethereum (or any EIP-1193 provider)
     * and TokenomicWeb3.signMessage to be available.
     *
     * Returns { token, wallet, expiresInSec } on success.
     */
    async signIn(wallet) {
      // Auto-detect from the page's connected wallet when called without args.
      if (!wallet && typeof window !== 'undefined' && window.TokenomicWallet && window.TokenomicWallet.account) {
        wallet = window.TokenomicWallet.account;
      }
      if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error('Valid wallet address required');
      var w = lc(wallet);
      var nonce = await api('POST', '/api/auth/nonce', { wallet: w }, false);
      var message = nonce.message;

      // Sign via the page's wallet integration if present, else fall back to window.ethereum.
      var signature;
      if (window.TokenomicWeb3 && typeof window.TokenomicWeb3.signMessage === 'function') {
        signature = await window.TokenomicWeb3.signMessage(message);
      } else if (window.ethereum && window.ethereum.request) {
        signature = await window.ethereum.request({ method: 'personal_sign', params: [message, w] });
      } else {
        throw new Error('No Web3 wallet available to sign');
      }

      var login = await api('POST', '/api/auth/login', { wallet: w, signature: signature }, false);
      try {
        localStorage.setItem(TOKEN_KEY, login.token);
        localStorage.setItem(WALLET_KEY, w);
        localStorage.setItem(EXP_KEY, String(Math.floor(Date.now() / 1000) + (login.expiresInSec || 86400)));
      } catch {}
      return login;
    },

    signOut() { clearToken(); },
    isSignedIn(wallet) {
      var t = getToken(); if (!t) return false;
      if (!wallet) return true;
      return lc(wallet) === lc(getTokenWallet());
    },

    // ---------- profiles ----------

    async getProfile(walletAddress) {
      try { return await api('GET', '/api/profile/' + encodeURIComponent(lc(walletAddress)), null, false); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async upsertProfile(profileData) {
      var d = await api('POST', '/api/profile', profileData, true);
      return d.profile;
    },

    // Returns { wallet, roles[], profile } for the currently signed-in user.
    // Powers role-aware sidebar + role-specific dashboard homepage.
    async getMe() {
      try { return await api('GET', '/api/auth/me', null, true); }
      catch (e) { if (e.status === 401) return null; throw e; }
    },

    // ---------- applications (role progression) ----------

    async getMyApplications() {
      try { var d = await api('GET', '/api/applications/me', null, true); return d.items || []; }
      catch (e) { if (e.status === 401) return []; throw e; }
    },
    async submitApplication(payload) {
      // payload: { role_requested, bio, expertise[], sample_url?, portfolio_url?,
      //            hourly_rate_usdc?, availability?, credentials?, stake_tx_hash? }
      return await api('POST', '/api/applications', payload, true);
    },

    // ---------- admin (queue read; mutating endpoints land next session) ----------

    async getAdminQueue(type, status) {
      var qs = [];
      if (type)   qs.push('type=' + encodeURIComponent(type));
      if (status) qs.push('status=' + encodeURIComponent(status));
      return await api('GET', '/api/admin/queue' + (qs.length ? '?' + qs.join('&') : ''), null, true);
    },

    // Admin approve/reject mutations. All require admin JWT — server enforces.
    async approveApplication(id) {
      return await api('POST', '/api/admin/applications/' + encodeURIComponent(id) + '/approve', {}, true);
    },
    async rejectApplication(id, feedback) {
      return await api('POST', '/api/admin/applications/' + encodeURIComponent(id) + '/reject',
                       { admin_feedback: feedback }, true);
    },
    async approveContent(type, id) {
      // type ∈ {'courses','communities','articles'}
      return await api('POST', '/api/admin/' + type + '/' + encodeURIComponent(id) + '/approve', {}, true);
    },
    async rejectContent(type, id, feedback) {
      return await api('POST', '/api/admin/' + type + '/' + encodeURIComponent(id) + '/reject',
                       { admin_feedback: feedback }, true);
    },

    // Creator submits a draft for admin review (status -> pending_review).
    async submitForReview(type, id) {
      return await api('POST', '/api/' + type + '/' + encodeURIComponent(id) + '/submit', {}, true);
    },

    // ---------- communities ----------

    async getCommunities(educatorWallet) {
      var qs = educatorWallet ? '?educator=' + encodeURIComponent(lc(educatorWallet)) : '';
      var d = await api('GET', '/api/communities' + qs, null, false);
      return d.items || [];
    },
    async getCommunity(idOrSlug) {
      try { return await api('GET', '/api/communities/' + encodeURIComponent(idOrSlug), null, false); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async createCommunity(communityData) {
      var d = await api('POST', '/api/communities', communityData, true);
      return d.community;
    },

    // ---------- courses ----------

    async getCourses(communityId) {
      var qs = communityId ? '?community_id=' + encodeURIComponent(communityId) : '';
      var d = await api('GET', '/api/courses' + qs, null, false);
      return d.items || [];
    },
    async getCourse(idOrSlug) {
      try { return await api('GET', '/api/courses/' + encodeURIComponent(idOrSlug), null, false); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async createCourse(courseData) {
      var d = await api('POST', '/api/courses', courseData, true);
      return d.course;
    },
    async updateCourse(id, patch) {
      var d = await api('PATCH', '/api/courses/' + encodeURIComponent(id), patch, true);
      return d.course;
    },

    // ---------- modules ----------

    async getCourseModules(courseId) {
      var d = await api('GET', '/api/courses/' + encodeURIComponent(courseId) + '/modules', null, false);
      return d.items || [];
    },
    async createModule(courseId, data) {
      var d = await api('POST', '/api/courses/' + encodeURIComponent(courseId) + '/modules', data, true);
      return d.module;
    },
    async updateModule(moduleId, patch) {
      var d = await api('PATCH', '/api/modules/' + encodeURIComponent(moduleId), patch, true);
      return d.module;
    },
    async deleteModule(moduleId) {
      return await api('DELETE', '/api/modules/' + encodeURIComponent(moduleId), null, true);
    },
    async reorderModules(courseId, ids) {
      return await api('POST', '/api/courses/' + encodeURIComponent(courseId) + '/modules/reorder', { ids: ids }, true);
    },

    // ---------- enrollments ----------

    async getEnrollments(courseId) {
      // Course-level list isn't exposed publicly (privacy); educator dashboard can
      // filter their own enrollments client-side. Returning [] keeps callers happy.
      return [];
    },
    async getMyEnrollments(walletAddress) {
      var d = await api('GET', '/api/enrollments/' + encodeURIComponent(lc(walletAddress)), null, false);
      return d.items || [];
    },
    async enroll(courseId, progress) {
      var d = await api('POST', '/api/enrollments', { course_id: courseId, progress: progress || 0 }, true);
      return d;
    },

    // ---------- bookings ----------

    async getBookings(consultantWallet) {
      // Consultant view: requires auth + caller must equal :wallet.
      var d = await api('GET', '/api/bookings/' + encodeURIComponent(lc(consultantWallet)), null, true);
      return d.items || [];
    },
    async getMyClientBookings() {
      // Client view: bookings I (the buyer) made. Auth-required.
      try { var d = await api('GET', '/api/bookings/me/as-client', null, true); return d.items || []; }
      catch (e) { if (e.status === 401) return []; throw e; }
    },
    async createBooking(bookingData) {
      var d = await api('POST', '/api/bookings', bookingData, true);
      return d.booking;
    },

    // ---------- revenue ----------

    async getRevenue(walletAddress) {
      var d = await api('GET', '/api/revenue/' + encodeURIComponent(lc(walletAddress)), null, false);
      return d.items || [];
    },
    async recordTransaction(txHash, amountUsdc, senderWallet, recipientWallet, description) {
      try {
        await api('POST', '/api/revenue', {
          tx_hash: txHash,
          amount_usdc: amountUsdc,
          sender_wallet: senderWallet,
          recipient_wallet: recipientWallet,
          description: description
        }, true);
        return true;
      } catch (e) {
        console.warn('recordTransaction failed:', e.message);
        return null;
      }
    },

    // ---------- messages ----------

    async getMessages(communityId) {
      var d = await api('GET', '/api/messages/' + encodeURIComponent(communityId), null, false);
      return d.items || [];
    },
    async sendMessage(messageData) {
      var d = await api('POST', '/api/messages', messageData, true);
      return d.message;
    },
    subscribeToMessages(communityId, callback) {
      // D1 has no realtime. Poll every 5s; caller is responsible for unsubscribing.
      var lastSeen = 0;
      var stopped = false;
      var poll = async () => {
        if (stopped) return;
        try {
          var items = await this.getMessages(communityId);
          for (var i = 0; i < items.length; i++) {
            var ts = Date.parse(items[i].created_at) || 0;
            if (ts > lastSeen) { lastSeen = ts; callback(items[i]); }
          }
        } catch (e) { /* ignore transient */ }
        setTimeout(poll, 5000);
      };
      poll();
      return { unsubscribe: function () { stopped = true; } };
    },

    /**
     * Open a real-time WebSocket to a community chat (Durable Object backed).
     * Two-step handshake: POST /api/chat/ticket (auth) → ticket; then open
     * wss://…/api/chat/:cid/ws?ticket=… (browser cannot set Authorization on WS).
     *
     * Returns { send(text), close(), isOpen() }.
     * Callbacks: { onOpen, onMessage(payload), onClose(code,reason), onError(err) }
     */
    async openChatSocket(communityId, handlers) {
      handlers = handlers || {};
      var t = await api('POST', '/api/chat/ticket', {}, true);
      if (!t || !t.ticket) throw new Error('Failed to obtain chat ticket');
      var wsBase = API_BASE.replace(/^http/, 'ws');
      var url = wsBase + '/api/chat/' + encodeURIComponent(communityId) + '/ws?ticket=' + encodeURIComponent(t.ticket);
      var ws = new WebSocket(url);
      ws.addEventListener('open',  function ()  { if (handlers.onOpen)  handlers.onOpen(); });
      ws.addEventListener('error', function (e) { if (handlers.onError) handlers.onError(e); });
      ws.addEventListener('close', function (e) { if (handlers.onClose) handlers.onClose(e.code, e.reason); });
      ws.addEventListener('message', function (ev) {
        var payload = null;
        try { payload = JSON.parse(ev.data); } catch { return; }
        if (handlers.onMessage) handlers.onMessage(payload);
      });
      return {
        isOpen: function () { return ws.readyState === 1; },
        send: function (text) {
          var s = (text || '').toString().trim();
          if (!s) return false;
          if (ws.readyState !== 1) return false;
          ws.send(JSON.stringify({ body: s }));
          return true;
        },
        close: function () { try { ws.close(1000, 'client'); } catch {} }
      };
    },

    // ---------- bookings (consultant mutations) ----------

    async acceptBooking(id) {
      var d = await api('POST', '/api/bookings/' + encodeURIComponent(id) + '/accept', {}, true);
      return d.booking;
    },
    async declineBooking(id, reason) {
      var d = await api('POST', '/api/bookings/' + encodeURIComponent(id) + '/decline', { reason: reason }, true);
      return d.booking;
    },

    // ---------- experts ----------

    async getEducators() {
      var d = await api('GET', '/api/experts?role=educator', null, false);
      return d.items || [];
    },
    async getConsultants() {
      var d = await api('GET', '/api/experts?role=consultant', null, false);
      return d.items || [];
    },
    async getExpert(walletAddress) {
      try { return await api('GET', '/api/experts/' + encodeURIComponent(lc(walletAddress)), null, false); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },

    // ---------- articles ----------

    async getArticles(category) {
      var qs = category ? '?category=' + encodeURIComponent(category) : '';
      var d = await api('GET', '/api/articles' + qs, null, false);
      // Re-shape to match old Supabase response (legacy code reads .profiles.{display_name,avatar_url})
      return (d.items || []).map(function (a) {
        return Object.assign({}, a, {
          profiles: {
            display_name: a.author_name,
            avatar_url: a.author_avatar,
            wallet_address: a.author_wallet
          }
        });
      });
    },
    async getArticle(slug) {
      try {
        var a = await api('GET', '/api/articles/' + encodeURIComponent(slug), null, false);
        a.profiles = { display_name: a.author_name, avatar_url: a.author_avatar, wallet_address: a.author_wallet };
        return a;
      } catch (e) { if (e.status === 404) return null; throw e; }
    },
    async createArticle(articleData) {
      var d = await api('POST', '/api/articles', articleData, true);
      return d.article;
    },
    async getAuthors() {
      var d = await api('GET', '/api/experts', null, false);
      return (d.items || []).slice(0, 6);
    },

    // ---------- events ----------

    async listEvents(filters) {
      var qs = '';
      if (filters && typeof filters === 'object') {
        var parts = [];
        Object.keys(filters).forEach(function (k) {
          if (filters[k] !== undefined && filters[k] !== null && filters[k] !== '') {
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(filters[k]));
          }
        });
        if (parts.length) qs = '?' + parts.join('&');
      }
      var d = await api('GET', '/api/events' + qs, null, false);
      return d.items || [];
    },
    async getEvent(idOrSlug) {
      // Pass auth so the server can include my_rsvp when the user is signed in.
      try { return await api('GET', '/api/events/' + encodeURIComponent(idOrSlug), null, this.isSignedIn()); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async createEvent(data) {
      var d = await api('POST', '/api/events', data, true);
      return d.event;
    },
    async updateEvent(id, patch) {
      var d = await api('PATCH', '/api/events/' + encodeURIComponent(id), patch, true);
      return d.event;
    },
    async deleteEvent(id) {
      return await api('DELETE', '/api/events/' + encodeURIComponent(id), null, true);
    },
    async rsvpEvent(idOrSlug, info) {
      var d = await api('POST', '/api/events/' + encodeURIComponent(idOrSlug) + '/rsvp', info || {}, true);
      return d; // { ok, rsvp, event }
    },
    async cancelRsvp(idOrSlug) {
      return await api('DELETE', '/api/events/' + encodeURIComponent(idOrSlug) + '/rsvp', null, true);
    },
    async listEventRsvps(id, status) {
      var qs = status ? '?status=' + encodeURIComponent(status) : '';
      var d = await api('GET', '/api/events/' + encodeURIComponent(id) + '/rsvps' + qs, null, true);
      return d.items || [];
    },
    async myRsvps() {
      var d = await api('GET', '/api/events/me/rsvps', null, true);
      return d.items || [];
    },

    /**
     * Legacy stub: the old Supabase client had a demoData() fallback used by
     * a few pages (expert-profile, community-profile, site-search). The D1
     * backend renders true empty state instead, so this just returns [].
     */
    demoData(_type) { return []; }
  };

  window.TokenomicSupabase = TokenomicSupabase;
  window.TokenomicAPI = TokenomicSupabase; // friendlier alias
})();
