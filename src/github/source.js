/**
 * source.js — resolves a user-supplied repo reference into an ingestible target,
 * transparently attaching a private-access token when the repo needs one.
 *
 * This is the seam between "a URL the user typed" and ingest(). It keeps all
 * GitHub-App logic out of the analyzer: the analyzer just receives a normalized
 * { input, authToken?, visibility } and clones as usual.
 *
 * Public repos: no token, unchanged behavior.
 * Private repos: the server mints a least-privilege installation token via the
 * TokenManager and passes it to ingest as an ephemeral credential (never stored).
 */
import { ghFetch } from './app-auth.js';
import { defaultTokenManager } from './token-manager.js';

const GH_URL = /(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)(?:\.git)?/i;

/** Parse owner/repo from a GitHub URL, or null if not a GitHub repo URL. */
export function parseGithubRepo(input) {
  const m = GH_URL.exec(String(input || '').trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Resolve a repo reference for analysis. Returns:
 *   { input, authToken?, owner, repo, visibility, needsAuth }
 *
 * @param {string} input           github url (or any git url / local path)
 * @param {object} opts            { tokenManager? }
 */
export async function resolveSource(input, opts = {}) {
  const gh = parseGithubRepo(input);
  if (!gh) return { input, owner: null, repo: null, visibility: 'unknown', needsAuth: false };

  const tm = opts.tokenManager || defaultTokenManager();
  const { owner, repo } = gh;

  // Probe visibility anonymously first. Public -> no token needed.
  let visibility = 'unknown';
  try {
    const info = await ghFetch(`/repos/${owner}/${repo}`);
    visibility = info.private ? 'private' : 'public';
  } catch (e) {
    // 404 for an anonymous caller usually means the repo is private (or absent).
    if (e.status === 404) visibility = 'private';
    else throw e;
  }

  if (visibility === 'public') {
    return { input, owner, repo, visibility, needsAuth: false };
  }

  // Private: require a configured App, then mint a scoped, short-lived token.
  if (!tm.configured()) {
    const err = new Error(`'${owner}/${repo}' is private. Configure the GitHub App (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) and install it on '${owner}' to analyze private repos.`);
    err.code = 'GITHUB_APP_NOT_CONFIGURED';
    throw err;
  }
  const authToken = await tm.tokenForRepo(owner, repo);
  return { input, owner, repo, visibility, needsAuth: true, authToken };
}
