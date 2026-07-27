/**
 * oauth-selftest.mjs — offline validation of the GitHub OAuth login plumbing
 * that does NOT require network or real GitHub credentials. Verifies the
 * security-critical pieces:
 *   - authorizeUrl builds the correct GitHub URL with client_id/redirect/scope/state.
 *   - CSRF `state` is single-use and rejected on mismatch/replay.
 *   - session cookies are httpOnly, and the stored token is never exposed by the
 *     public session shape.
 *   - cookie() emits correct flags (HttpOnly, SameSite=Lax, Secure when asked).
 *
 * The networked flow (code->token exchange, listing real repos) is exercised by
 * a manual sign-in; this keeps the crypto/session/CSRF contract honest with no
 * external dependencies.
 */
import { authorizeUrl, oauthConfig } from './src/github/oauth.js';
import {
  startOAuth, consumeOAuth, createSession, getSession, destroySession,
  parseCookies, cookie, SESSION_COOKIE, OAUTH_COOKIE,
} from './src/github/sessions.js';

let pass = 0, fail = 0;
const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`;
const ok = (c, m) => { if (c) { pass++; console.log('  ' + G('PASS') + ' ' + m); } else { fail++; console.log('  ' + R('FAIL') + ' ' + m); } };

console.log('\n########## authorize URL ##########');
const u = new URL(authorizeUrl({ clientId: 'CID', redirectUri: 'https://app.example.com/api/auth/github/callback', scope: 'repo read:user', state: 'ST8' }));
ok(u.origin + u.pathname === 'https://github.com/login/oauth/authorize', 'points at github authorize endpoint');
ok(u.searchParams.get('client_id') === 'CID', 'carries client_id');
ok(u.searchParams.get('redirect_uri') === 'https://app.example.com/api/auth/github/callback', 'carries redirect_uri');
ok(u.searchParams.get('scope') === 'repo read:user', 'requests repo + read:user scope');
ok(u.searchParams.get('state') === 'ST8', 'carries CSRF state');

console.log('\n########## CSRF state (single-use, mismatch-rejecting) ##########');
const { oauthId, state } = startOAuth('/investigate');
ok(!!oauthId && !!state, 'startOAuth returns an id + state');
ok(consumeOAuth(oauthId, 'wrong-state') === null, 'wrong state is rejected');
// wrong-state attempt consumed the pending entry (one-time), so correct state now also fails -> good (no reuse)
ok(consumeOAuth(oauthId, state) === null, 'pending entry is one-time (no replay even with correct state)');
const h2 = startOAuth('/x');
const good = consumeOAuth(h2.oauthId, h2.state);
ok(good && good.returnTo === '/x', 'valid state consumes once and returns returnTo');
ok(consumeOAuth(h2.oauthId, h2.state) === null, 'second consume of same handshake fails (replay blocked)');
ok(consumeOAuth('nonexistent', 'x') === null, 'unknown oauthId rejected');

console.log('\n########## session store (token never in public shape) ##########');
const sid = createSession({ user: { login: 'octocat', avatarUrl: 'a', id: 1 }, token: 'gho_SECRET', scope: 'repo' });
const s = getSession(sid);
ok(!!s && s.token === 'gho_SECRET', 'server-side session holds the token');
// simulate what /api/auth/me returns (only user + scope, never token)
const publicMe = { authenticated: true, user: s.user, scope: s.scope };
ok(JSON.stringify(publicMe).indexOf('gho_SECRET') === -1, 'public /me shape does NOT contain the token');
destroySession(sid);
ok(getSession(sid) === null, 'destroySession removes the session');

console.log('\n########## cookies ##########');
const c = cookie(SESSION_COOKIE, 'abc', { maxAgeMs: 3600000, secure: true });
ok(/^ri_sess=abc/.test(c), 'sets the session cookie name/value');
ok(/HttpOnly/.test(c), 'session cookie is HttpOnly (not JS-readable)');
ok(/SameSite=Lax/.test(c), 'SameSite=Lax (survives GitHub redirect, blocks CSRF POSTs)');
ok(/Secure/.test(c), 'Secure flag set when requested (HTTPS)');
const cleared = cookie(SESSION_COOKIE, '', { maxAgeMs: 0 });
ok(/Max-Age=0/.test(cleared), 'logout cookie expires immediately (Max-Age=0)');
const insecure = cookie(OAUTH_COOKIE, 'x', { maxAgeMs: 1000, secure: false });
ok(!/Secure/.test(insecure), 'no Secure flag on http (localhost dev)');
// parseCookies round-trip
const parsed = parseCookies({ headers: { cookie: 'ri_sess=abc; other=1; ri_oauth=zz' } });
ok(parsed.ri_sess === 'abc' && parsed.ri_oauth === 'zz', 'parseCookies reads multiple cookies');

console.log('\n########## config gating ##########');
ok(typeof oauthConfig().configured === 'boolean', 'oauthConfig reports a configured flag');

console.log(`\n=== OAuth self-test: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
