/**
 * oauth.js — GitHub OAuth "web application flow" (server-side).
 *
 * This powers the "Sign in with GitHub" button so a user can browse and analyze
 * THEIR OWN repositories (including private ones) without pasting a token. It is
 * distinct from the GitHub App flow in app-auth.js:
 *   - OAuth (this file): acts AS THE USER. Good for "show me my repos".
 *   - GitHub App (app-auth.js): acts as an installation. Good for org-wide,
 *     least-privilege, repo-scoped automation.
 *
 * Security model:
 *   - The `client_secret` and the user's access token live ONLY on the server.
 *   - The browser only ever holds an opaque, httpOnly session id (see
 *     sessions.js). The access token is never sent to the client.
 *   - CSRF is prevented with a random `state` bound to the pre-session cookie.
 *   - We request the `repo` scope only so private repos can be listed/cloned;
 *     `read:user` for the profile. (GitHub OAuth scopes are coarse; the App flow
 *     is the fine-grained option and is documented in src/github/README.md.)
 */

const GITHUB = 'https://github.com';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function oauthConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET || '';
  // Optional explicit callback base (e.g. https://app.onrender.com). If unset we
  // derive it per-request from the incoming host so localhost + prod both work.
  const callbackBase = process.env.GITHUB_OAUTH_CALLBACK_BASE || '';
  const scope = process.env.GITHUB_OAUTH_SCOPE || 'repo read:user';
  return { clientId, clientSecret, callbackBase, scope, configured: !!(clientId && clientSecret) };
}

/** Build the GitHub authorize URL to redirect the user to. */
export function authorizeUrl({ clientId, redirectUri, scope, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || 'repo read:user',
    state,
    allow_signup: 'true',
  });
  return `${GITHUB}/login/oauth/authorize?${q.toString()}`;
}

/** Exchange an authorization `code` for a user access token. */
export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch(`${GITHUB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'repo-intel' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.error) {
    throw new Error('GitHub token exchange failed: ' + ((json && (json.error_description || json.error)) || res.status));
  }
  return { accessToken: json.access_token, scope: json.scope, tokenType: json.token_type };
}

async function apiGet(pathOrUrl, token) {
  const res = await fetch(pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'repo-intel',
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}: ${(json && json.message) || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  // surface pagination for callers that need it
  return { json, link: res.headers.get('link') };
}

/** Fetch the authenticated user's profile (login, name, avatar). */
export async function getUser(token) {
  const { json } = await apiGet('/user', token);
  return { login: json.login, name: json.name, avatarUrl: json.avatar_url, htmlUrl: json.html_url, id: json.id };
}

/**
 * List the authenticated user's repositories (owner + collaborator + org member),
 * most-recently-pushed first. Paginates up to `max` repos.
 */
export async function listRepos(token, { max = 200 } = {}) {
  const out = [];
  let url = '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member';
  while (url && out.length < max) {
    const { json, link } = await apiGet(url, token);
    for (const r of (json || [])) {
      out.push({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner && r.owner.login,
        private: r.private,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        defaultBranch: r.default_branch,
        description: r.description,
        language: r.language,
        pushedAt: r.pushed_at,
        stars: r.stargazers_count,
        archived: r.archived,
      });
    }
    // follow rel="next"
    const next = link && /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return out.slice(0, max);
}

export { API as GITHUB_API_BASE };
