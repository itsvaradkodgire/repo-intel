/**
 * sessions.js — minimal, dependency-free server-side session store for the
 * GitHub OAuth flow.
 *
 * The browser only ever receives an opaque, random session id in an **httpOnly**
 * cookie. The GitHub access token and user profile are held here, in server
 * memory, keyed by that id. The token is NEVER serialized to the client.
 *
 * Two cookie roles:
 *   - `ri_oauth` : a short-lived PRE-session set before redirecting to GitHub. It
 *     stores the CSRF `state` (and where to return to). Consumed at callback.
 *   - `ri_sess`  : the authenticated session after a successful token exchange.
 *
 * This is in-memory (single-instance). For multi-instance deploys, swap the Map
 * for a shared store (Redis) behind the same interface.
 */
import crypto from 'crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const OAUTH_TTL_MS = 10 * 60 * 1000;        // 10m for the in-flight handshake
export const SESSION_COOKIE = 'ri_sess';
export const OAUTH_COOKIE = 'ri_oauth';

const sessions = new Map(); // sid -> { user, token, scope, createdAt, expiresAt }
const pending = new Map();  // oauthId -> { state, returnTo, createdAt, expiresAt }

function newId() { return crypto.randomBytes(32).toString('base64url'); }
function now() { return Date.now(); }

function sweep() {
  const t = now();
  for (const [k, v] of sessions) if (v.expiresAt <= t) sessions.delete(k);
  for (const [k, v] of pending) if (v.expiresAt <= t) pending.delete(k);
}
setInterval(sweep, 5 * 60 * 1000).unref?.();

// ---- pre-session (CSRF state) ----
export function startOAuth(returnTo) {
  const oauthId = newId();
  const state = crypto.randomBytes(16).toString('base64url');
  pending.set(oauthId, { state, returnTo: returnTo || '/', createdAt: now(), expiresAt: now() + OAUTH_TTL_MS });
  return { oauthId, state };
}
export function consumeOAuth(oauthId, state) {
  if (!oauthId) return null;
  const p = pending.get(oauthId);
  if (!p) return null;
  pending.delete(oauthId); // one-time use
  if (p.expiresAt <= now()) return null;
  if (!state || !safeEqual(p.state, state)) return null;
  return { returnTo: p.returnTo };
}

// ---- authenticated session ----
export function createSession({ user, token, scope }) {
  const sid = newId();
  sessions.set(sid, { user, token, scope, createdAt: now(), expiresAt: now() + SESSION_TTL_MS });
  return sid;
}
export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt <= now()) { sessions.delete(sid); return null; }
  return s;
}
export function destroySession(sid) { if (sid) sessions.delete(sid); }

// ---- cookie helpers ----
export function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Build a Set-Cookie value. `secure` should be true behind HTTPS (prod). We keep
 * SameSite=Lax so the cookie survives the top-level redirect back from GitHub.
 */
export function cookie(name, value, { maxAgeMs, secure = false, httpOnly = true, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAgeMs === 0) parts.push('Max-Age=0');
  else if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join('; ');
}
export const OAUTH_MAX_AGE = OAUTH_TTL_MS;
export const SESSION_MAX_AGE = SESSION_TTL_MS;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
