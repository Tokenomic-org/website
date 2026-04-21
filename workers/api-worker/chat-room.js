/**
 * ChatRoom Durable Object — one instance per community.
 *
 * Uses the Cloudflare WebSocket Hibernation API so the DO can sleep
 * between messages without paying for idle compute. Each connected
 * client is a WebSocket the DO has called `state.acceptWebSocket(ws)`
 * on; metadata (wallet) is attached via `ws.serializeAttachment(...)`
 * so it survives hibernation.
 *
 * Messages are persisted to D1 (`messages` table) via the parent
 * worker's binding so the existing GET /api/messages/:communityId
 * history endpoint keeps working.
 *
 * Routing:
 *   POST /api/chat/ticket                       (auth)  -> { ticket, expiresInSec }
 *   GET  /api/chat/:communityId/ws?ticket=...           -> WS upgrade, forwarded to the DO
 */

function lc(s) { return (s || '').toString().toLowerCase(); }
function isHexAddress(s) { return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s); }

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.communityId = null; // populated on first connect
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/connect')) {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }
      const wallet = lc(url.searchParams.get('wallet') || '');
      const cid    = Number(url.searchParams.get('community_id') || 0);
      if (!isHexAddress(wallet)) return new Response('Bad wallet', { status: 400 });
      if (!Number.isFinite(cid) || cid <= 0) return new Response('Bad community_id', { status: 400 });
      this.communityId = cid;

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Hibernation API: the runtime delivers messages to this DO via
      // webSocketMessage(...) below even after the isolate is evicted.
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ wallet, community_id: cid, joined_at: Date.now() });

      // Tell everyone (including the new socket) that someone joined.
      this.broadcast({ type: 'presence', event: 'join', wallet, community_id: cid, ts: Date.now() });

      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  // ----- Hibernation event handlers -----

  async webSocketMessage(ws, raw) {
    let attachment = {};
    try { attachment = ws.deserializeAttachment() || {}; } catch {}
    const wallet = lc(attachment.wallet || '');
    const cid    = Number(attachment.community_id || 0);
    if (!isHexAddress(wallet) || !cid) {
      try { ws.close(1008, 'No identity'); } catch {}
      return;
    }

    let body = '';
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
      body = (parsed && typeof parsed.body === 'string') ? parsed.body : '';
    } catch { return; }
    body = body.trim().slice(0, 2000);
    if (body.length < 1) return;

    // Persist to D1 so GET /api/messages/:communityId backfill keeps working.
    let saved = null;
    try {
      const ins = await this.env.DB.prepare(
        'INSERT INTO messages (community_id, author_wallet, body) VALUES (?, ?, ?)'
      ).bind(cid, wallet, body).run();
      const id = ins.meta && ins.meta.last_row_id;
      if (id) {
        saved = await this.env.DB.prepare(`
          SELECT m.id, m.community_id, m.author_wallet, m.body, m.created_at,
                 p.display_name, p.avatar_url
          FROM messages m LEFT JOIN profiles p ON p.wallet_address = m.author_wallet
          WHERE m.id = ?
        `).bind(id).first();
      }
    } catch (e) {
      try { ws.send(JSON.stringify({ type: 'error', error: 'DB write failed' })); } catch {}
      return;
    }
    if (!saved) return;

    this.broadcast({ type: 'message', message: saved });
  }

  webSocketClose(ws /* , code, reason, wasClean */) {
    let attachment = {};
    try { attachment = ws.deserializeAttachment() || {}; } catch {}
    if (attachment.wallet) {
      this.broadcast({ type: 'presence', event: 'leave', wallet: attachment.wallet, ts: Date.now() }, ws);
    }
  }

  webSocketError(ws /* , err */) {
    try { ws.close(1011, 'error'); } catch {}
  }

  // Send to every connected socket in this DO. `except` skips one socket.
  broadcast(payload, except) {
    const text = JSON.stringify(payload);
    const sockets = this.state.getWebSockets();
    for (let i = 0; i < sockets.length; i++) {
      const s = sockets[i];
      if (except && s === except) continue;
      try { s.send(text); } catch {}
    }
  }
}

// ---------- Worker-side route mount (called from index.js) ----------

const TICKET_TTL_SEC = 60;

async function requireAuthRaw(c) {
  // Lightweight inline JWT check — same algo as d1-routes but kept local
  // so chat-room.js doesn't import d1-routes.
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { error: c.json({ error: 'Missing Bearer token' }, 401) };
  const secret = c.env.JWT_SECRET;
  if (!secret) return { error: c.json({ error: 'JWT_SECRET not configured' }, 503) };
  const parts = token.split('.');
  if (parts.length !== 3) return { error: c.json({ error: 'Invalid token' }, 401) };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = b64urlDecode(parts[2]);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return { error: c.json({ error: 'Invalid token' }, 401) };
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))); }
  catch { return { error: c.json({ error: 'Invalid token' }, 401) }; }
  if (!payload || typeof payload.exp !== 'number' || Math.floor(Date.now()/1000) >= payload.exp) {
    return { error: c.json({ error: 'Token expired' }, 401) };
  }
  if (!isHexAddress(payload.wallet)) return { error: c.json({ error: 'Invalid token' }, 401) };
  return { wallet: lc(payload.wallet) };
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function mountChatRoutes(app) {
  // 1. Issue a one-time ticket the browser uses to open the WebSocket.
  //    Browsers cannot set Authorization on WS, so we trade JWT -> ticket.
  app.post('/api/chat/ticket', async (c) => {
    const auth = await requireAuthRaw(c);
    if (auth.error) return auth.error;
    if (!c.env.RATE_LIMIT_KV) return c.json({ error: 'KV not configured' }, 503);
    const ticket = crypto.randomUUID();
    await c.env.RATE_LIMIT_KV.put(`chat-ticket:${ticket}`, auth.wallet, { expirationTtl: TICKET_TTL_SEC });
    return c.json({ ticket, expiresInSec: TICKET_TTL_SEC });
  });

  // 2. WebSocket upgrade. ?ticket=<uuid> is consumed once.
  app.get('/api/chat/:communityId/ws', async (c) => {
    const up = (c.req.header('Upgrade') || '').toLowerCase();
    if (up !== 'websocket') {
      return c.json({ error: 'Expected websocket upgrade' }, 426);
    }
    const cid = Number(c.req.param('communityId'));
    if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'Invalid communityId' }, 400);

    const ticket = c.req.query('ticket') || '';
    if (!ticket || !c.env.RATE_LIMIT_KV) return c.json({ error: 'Missing ticket' }, 401);
    const key = `chat-ticket:${ticket}`;
    const wallet = await c.env.RATE_LIMIT_KV.get(key);
    if (!wallet || !isHexAddress(wallet)) return c.json({ error: 'Invalid or expired ticket' }, 401);
    // Best-effort single-use: delete BEFORE forwarding the upgrade.
    // KV is eventually consistent, so a true atomic CAS is not possible here;
    // the 60s TTL caps any replay window and the ticket is bound to one wallet
    // (one POST /api/chat/ticket call) so practical replay surface is small.
    try { await c.env.RATE_LIMIT_KV.delete(key); } catch {}

    if (!c.env.CHAT_ROOMS) return c.json({ error: 'Chat not configured (CHAT_ROOMS binding missing)' }, 503);

    // Optional: ensure the community exists, so we don't spawn DOs for junk ids.
    if (c.env.DB) {
      const exists = await c.env.DB.prepare('SELECT id FROM communities WHERE id = ?').bind(cid).first();
      if (!exists) return c.json({ error: 'Community not found' }, 404);
    }

    const id = c.env.CHAT_ROOMS.idFromName('community:' + cid);
    const stub = c.env.CHAT_ROOMS.get(id);

    // Forward as a same-origin upgrade with the resolved wallet baked into the URL.
    const fwdUrl = new URL('https://chatroom.internal/connect');
    fwdUrl.searchParams.set('wallet', wallet);
    fwdUrl.searchParams.set('community_id', String(cid));

    return stub.fetch(fwdUrl.toString(), {
      method: 'GET',
      headers: { Upgrade: 'websocket' }
    });
  });
}
