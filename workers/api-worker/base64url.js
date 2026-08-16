/**
 * base64url encode/decode helpers shared across the api-worker.
 *
 * These back every HMAC-signed credential in the worker — SIWE session
 * cookies (siwe.js), HS256 JWTs (d1-routes.js, chat-room.js), signed
 * invite/unsubscribe tokens (referrals.js), and the AES-GCM envelope for
 * OAuth refresh tokens at rest (oauth-calendar.js). They previously lived
 * as five copies of the same code, all of which shared a padding bug.
 *
 * Padding note (this is what the copies got wrong):
 * `atob` implements WHATWG "forgiving-base64", which accepts unpadded
 * input but rejects *incorrectly* padded input. For an unpadded string of
 * length L the number of `=` needed is (4 - L % 4) % 4, i.e. 0, n/a, 2, 1
 * for L % 4 of 0, 1, 2, 3. The idiom is `'==='.slice((L + 3) % 4)`, using
 * a THREE-character string:
 *
 *   L%4=0 -> slice(3) -> ''    (0 pad, correct)
 *   L%4=2 -> slice(1) -> '=='  (2 pad, correct)
 *   L%4=3 -> slice(2) -> '='   (1 pad, correct)
 *
 * With a two-character `'=='` the L%4=2 case yields a single `=`, which
 * lands mid-alphabet and makes `atob` throw InvalidCharacterError. A
 * lowercased address + 10-digit exp serialises to exactly 73 bytes, whose
 * base64url form is 98 chars (98 % 4 === 2) — so the bug hit the common
 * session payload every time and silently logged users straight back out.
 */

/** Encode bytes (Uint8Array or ArrayBuffer) as an unpadded base64url string. */
export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decode a base64url string to bytes. Tolerates input that already carries
 * `=` padding. Throws (like `atob`) on genuinely malformed input, so callers
 * that accept untrusted tokens must keep their try/catch.
 */
export function b64urlDecode(str) {
  const raw = String(str || '').replace(/=+$/, '');
  const s = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
