/**
 * auth-routes.js — HTTP handlers for the GitHub OAuth login + repo browsing.
 *
 * Routes (wired in server.js):
 *   GET  /api/auth/github/login    -> 302 redirect to GitHub authorize
 *   GET  /api/auth/github/callback -> exchange code, create session, redirect home
 *   GET  /api/auth/me              -> { authenticated, user? }  (no token exposed)
 *   POST /api/auth/logout          -> destroy session
 *   GET  /api/github/repos         -> the logged-in user's repositories
 *
 * The access token never leaves the server: the browser holds only an httpOnly
 * session cookie. `tokenForSession()` lets the analyze handler clone the user's
 * private repos server-side.
 */
import { oauthConfig, authorizeUrl, exchangeCodeForToken, getUser, listRepos } from './oauth.js';
import {
  startOAuth, consumeOAuth, createSession, getSession, destroySession,
  parseCookies, cookie, SESSION_COOKIE, OAUTH_COOKIE, OAUTH_MAX_AGE, SESSION_MAX_AGE,
} from './sessions.js';

// Derive the externally-visible origin for building the OAuth redirect_uri.
// Honors an explicit override, else reconstructs from proxy headers (Render sets
// x-forwarded-proto/host) or the Host header.
function originFor(req) {
  const cfg = oauthConfig();
  if (cfg.callbackBase) return cfg.callbackBase.replace(/\/+$/, '');
  const xfProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const proto = xfProto || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
function isSecure(req) { return originFor(req).startsWith('https://'); }
function redirectTo(res, location, setCookies = []) {
  const headers = { Location: location };
  if (setCookies.length) headers['Set-Cookie'] = setCookies;
  res.writeHead(302, headers);
  res.end();
}
function json(res, code, body, setCookies = []) {
  const headers = { 'Content-Type': 'application/json' };
  if (setCookies.length) headers['Set-Cookie'] = setCookies;
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

export function authEnabled() { return oauthConfig().configured; }

// GET /api/auth/github/login
export function handleLogin(req, res, url) {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    return json(res, 501, { error: 'GitHub sign-in is not configured on this server. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.' });
  }
  const returnTo = url.searchParams.get('returnTo') || '/';
  const { oauthId, state } = startOAuth(returnTo);
  const redirectUri = originFor(req) + '/api/auth/github/callback';
  const dest = authorizeUrl({ clientId: cfg.clientId, redirectUri, scope: cfg.scope, state });
  const setCookie = cookie(OAUTH_COOKIE, oauthId, { maxAgeMs: OAUTH_MAX_AGE, secure: isSecure(req), httpOnly: true });
  return redirectTo(res, dest, [setCookie]);
}

// GET /api/auth/github/callback?code=...&state=...
export async function handleCallback(req, res, url) {
  const cfg = oauthConfig();
  if (!cfg.configured) return json(res, 501, { error: 'GitHub sign-in not configured.' });
  const err = url.searchParams.get('error');
  if (err) return redirectTo(res, '/?login_error=' + encodeURIComponent(err));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req);
  const pre = consumeOAuth(cookies[OAUTH_COOKIE], state);
  // clear the pre-session cookie no matter what
  const clearPre = cookie(OAUTH_COOKIE, '', { maxAgeMs: 0, secure: isSecure(req) });
  if (!pre || !code) return redirectTo(res, '/?login_error=state_mismatch', [clearPre]);
  try {
    const redirectUri = originFor(req) + '/api/auth/github/callback';
    const { accessToken, scope } = await exchangeCodeForToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, code, redirectUri });
    const user = await getUser(accessToken);
    const sid = createSession({ user, token: accessToken, scope });
    const setSess = cookie(SESSION_COOKIE, sid, { maxAgeMs: SESSION_MAX_AGE, secure: isSecure(req), httpOnly: true });
    const dest = pre.returnTo && pre.returnTo.startsWith('/') ? pre.returnTo : '/';
    return redirectTo(res, dest + (dest.includes('?') ? '&' : '?') + 'login=ok', [clearPre, setSess]);
  } catch (e) {
    return redirectTo(res, '/?login_error=' + encodeURIComponent(e.message.slice(0, 120)), [clearPre]);
  }
}

// GET /api/auth/me
export function handleMe(req, res) {
  const cfg = oauthConfig();
  const s = getSession(parseCookies(req)[SESSION_COOKIE]);
  if (!s) return json(res, 200, { authenticated: false, configured: cfg.configured });
  // never expose the token; only the public profile
  return json(res, 200, { authenticated: true, configured: true, user: s.user, scope: s.scope });
}

// POST /api/auth/logout
export function handleLogout(req, res) {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE]);
  const clear = cookie(SESSION_COOKIE, '', { maxAgeMs: 0, secure: isSecure(req) });
  return json(res, 200, { ok: true }, [clear]);
}

// GET /api/github/repos
export async function handleRepos(req, res) {
  const s = getSession(parseCookies(req)[SESSION_COOKIE]);
  if (!s) return json(res, 401, { error: 'not signed in' });
  try {
    const repos = await listRepos(s.token, { max: 300 });
    return json(res, 200, { user: s.user, repos });
  } catch (e) {
    return json(res, e.status === 401 ? 401 : 502, { error: e.message });
  }
}

/**
 * Look up the session token for the analyze handler so it can clone the user's
 * private repos server-side. Returns null when not signed in. Only hand this to
 * trusted server-side callers; never to the client.
 */
export function tokenForSession(req) {
  const s = getSession(parseCookies(req)[SESSION_COOKIE]);
  return s ? { token: s.token, user: s.user } : null;
}
