/**
 * token-manager.js — in-memory cache + rotation for installation access tokens.
 *
 * Installation tokens live ~1 hour. We cache per installation id and hand back a
 * cached token until it is within `SKEW_MS` of expiry, then transparently mint a
 * fresh one. Nothing is written to disk; the process holding these tokens is the
 * only place they exist. This is the ONLY place ingest should get a token from.
 */
import { createInstallationToken, installationForOwner } from './app-auth.js';

const SKEW_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export class TokenManager {
  /** @param {{appId:string, privateKey:string}} app */
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // installationId -> { token, expiresAt, permissions, scope }
    this.ownerToInstall = new Map(); // owner(lowercase) -> installationId
  }

  configured() { return !!(this.app && this.app.appId && this.app.privateKey); }

  async installationIdForOwner(owner) {
    const key = String(owner).toLowerCase();
    if (this.ownerToInstall.has(key)) return this.ownerToInstall.get(key);
    const inst = await installationForOwner(this.app, owner);
    if (!inst) throw new Error(`GitHub App is not installed on '${owner}'. Install it and grant Contents:Read.`);
    this.ownerToInstall.set(key, inst.id);
    return inst.id;
  }

  /**
   * Get a valid installation token for an installation id, minting/rotating as
   * needed. `scope` optionally restricts to specific repositories.
   */
  async tokenForInstallation(installationId, scope = {}) {
    const cached = this.cache.get(installationId);
    const now = Date.now();
    if (cached && now < cached.expiresAt - SKEW_MS && sameScope(cached.scope, scope)) return cached.token;
    const minted = await createInstallationToken(this.app, installationId, scope);
    const entry = {
      token: minted.token,
      expiresAt: new Date(minted.expires_at).getTime(),
      permissions: minted.permissions,
      scope,
    };
    this.cache.set(installationId, entry);
    return entry.token;
  }

  /** Convenience: token for cloning a specific owner/repo (least privilege). */
  async tokenForRepo(owner, repo) {
    const installationId = await this.installationIdForOwner(owner);
    return this.tokenForInstallation(installationId, { repositories: [repo] });
  }

  /** Drop a cached token (e.g. on a 401 during clone) to force a refresh. */
  invalidate(installationId) { this.cache.delete(installationId); }
}

function sameScope(a = {}, b = {}) {
  const ra = (a.repositories || []).slice().sort().join(',');
  const rb = (b.repositories || []).slice().sort().join(',');
  return ra === rb;
}

// A process-wide singleton wired from env, so the server can share one manager.
let _default = null;
export function defaultTokenManager() {
  if (_default) return _default;
  const appId = process.env.GITHUB_APP_ID;
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY || '';
  // allow \n-escaped keys in env
  if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
  _default = new TokenManager({ appId, privateKey });
  return _default;
}
