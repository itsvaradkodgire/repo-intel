/**
 * app-auth.js — GitHub App authentication (server-side only).
 *
 * A GitHub App proves itself in two steps, and this module implements both with
 * zero external dependencies (Node's built-in crypto for RS256):
 *
 *   1. App JWT      — sign a short-lived (<=10 min) JWT with the App's PRIVATE
 *                     KEY. Identifies the *app*, not any repo. Used to call the
 *                     App-level GitHub API (list installations, mint tokens).
 *   2. Installation — POST /app/installations/{id}/access_tokens with the JWT to
 *      token          exchange it for an *installation access token*: a ~1 hour
 *                     credential scoped to exactly the repos + permissions the
 *                     installer granted. This is what clones a private repo.
 *
 * Security posture (see src/github/README.md):
 *   - The private key and any minted tokens live ONLY in server memory.
 *   - Installation tokens are cached until ~5 min before expiry, then rotated.
 *     They are never persisted to disk and never sent to the browser.
 *   - We request the minimum permissions: contents:read, metadata:read.
 */
import crypto from 'crypto';

const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Mint an App JWT (RS256) valid for `ttlSeconds` (GitHub caps at 10 min).
 * @param {{appId:string|number, privateKey:string}} app
 */
export function createAppJwt(app, ttlSeconds = 540) {
  if (!app || !app.appId || !app.privateKey) throw new Error('createAppJwt: appId and privateKey required');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  // iat backdated 30s to tolerate minor clock skew between us and GitHub.
  const payload = { iat: now - 30, exp: now + ttlSeconds, iss: String(app.appId) };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(app.privateKey);
  return signingInput + '.' + b64url(signature);
}

async function ghFetch(url, { token, tokenType = 'Bearer', method = 'GET', body } = {}) {
  const res = await fetch(url.startsWith('http') ? url : GITHUB_API + url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'repo-intel',
      ...(token ? { Authorization: `${tokenType} ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json && json.message) || text || res.statusText;
    const err = new Error(`GitHub API ${res.status}: ${msg}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

/** List all installations of this App (needs an App JWT). */
export async function listInstallations(app) {
  const jwt = createAppJwt(app);
  return ghFetch('/app/installations', { token: jwt });
}

/** Find the installation id for a given owner (org or user), or null. */
export async function installationForOwner(app, owner) {
  const jwt = createAppJwt(app);
  try {
    // Direct lookup endpoints (cheaper than listing everything).
    const org = await ghFetch(`/orgs/${owner}/installation`, { token: jwt }).catch(() => null);
    if (org && org.id) return org;
    const user = await ghFetch(`/users/${owner}/installation`, { token: jwt }).catch(() => null);
    if (user && user.id) return user;
  } catch { /* fall through */ }
  const all = await listInstallations(app);
  return (all || []).find((i) => i.account && i.account.login && i.account.login.toLowerCase() === String(owner).toLowerCase()) || null;
}

/**
 * Exchange the App JWT for an installation access token. Optionally scope it to
 * specific repositories and a subset of the granted permissions.
 * @returns {{token, expires_at, permissions, repository_selection}}
 */
export async function createInstallationToken(app, installationId, opts = {}) {
  const jwt = createAppJwt(app);
  const body = {};
  if (opts.repositories) body.repositories = opts.repositories;
  if (opts.repositoryIds) body.repository_ids = opts.repositoryIds;
  // default to the least privilege this product needs
  body.permissions = opts.permissions || { contents: 'read', metadata: 'read' };
  return ghFetch(`/app/installations/${installationId}/access_tokens`, { token: jwt, method: 'POST', body });
}

export { ghFetch, GITHUB_API };
