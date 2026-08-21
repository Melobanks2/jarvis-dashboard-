/**
 * session.ts — signed session cookies, Edge-runtime safe.
 *
 * Replaces HTTP basic auth, which re-prompted for a password on essentially
 * every visit and cannot be satisfied by Touch ID. A signed cookie lets the
 * browser (and a passkey) do the remembering.
 *
 * The token is `payload.signature`, both base64url:
 *   payload   {u: user, exp: unix seconds, v: 1}
 *   signature HMAC-SHA256 over the payload, keyed on DASHBOARD_PASS
 *
 * Keying on the password means changing the password invalidates every
 * outstanding session — which is what you want the day a laptop goes missing,
 * and it avoids a second secret to lose.
 *
 * Web Crypto only: middleware runs on the Edge runtime, where node:crypto and
 * Buffer do not exist.
 */

export const SESSION_COOKIE = 'jarvis_session';
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function signSession(user: string, secret: string, days = SESSION_DAYS): Promise<string> {
  const payload = { u: user, exp: Math.floor(Date.now() / 1000) + days * 86400, v: 1 };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify and return the username, or null. Never throws — a malformed cookie
 * is just an unauthenticated request, not a 500 on every page load.
 */
export async function verifySession(token: string | undefined, secret: string): Promise<string | null> {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      'HMAC', await key(secret), b64urlDecode(sig), enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (payload.v !== 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return typeof payload.u === 'string' ? payload.u : null;
  } catch {
    return null;
  }
}

/** Constant-time compare so a wrong password cannot be found a character at a time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
