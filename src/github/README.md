# GitHub Integration (private-repo analysis via a GitHub App)

This module lets the platform analyze **private** GitHub repositories without
ever pasting a Personal Access Token, storing long-lived credentials, or sending
repo source to the browser. It uses a **GitHub App** with read-only, least-
privilege access.

## Why a GitHub App (not a PAT)

| | Personal Access Token | **GitHub App (this module)** |
|---|---|---|
| Scope | whole account, broad | exactly the repos the owner installs it on |
| Permissions | coarse | `Contents: Read`, `Metadata: Read` only |
| Credential lifetime | long-lived, user-managed | **~1h installation token, auto-rotated** |
| Who authorizes | the person pasting it | the repo/org owner, via a GitHub install screen |
| Revocation | manual | uninstall the app |
| Audit | tied to a human | tied to the app installation |

The app-login (who *you* are) is deliberately **separate** from the repo-
installation (which *repos* the app may read). A user signing in does not grant
repo access; an org owner installing the app on selected repos does.

## The two-step auth flow

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant S as Repo-Intel server
    participant GH as GitHub API
    U->>S: Analyze https://github.com/org/private-repo
    S->>GH: GET /repos/org/private-repo (anonymous)
    GH-->>S: 404 (private) or 200 (public)
    Note over S: public -> clone anonymously, done
    S->>S: createAppJwt(appId, privateKey)  (RS256, <=10 min)
    S->>GH: GET /orgs/org/installation  (App JWT)
    GH-->>S: installation id
    S->>GH: POST /app/installations/{id}/access_tokens<br/>{permissions:{contents:read,metadata:read}, repositories:[repo]}
    GH-->>S: installation token (~1h, scoped)
    S->>GH: git clone via ephemeral http.extraHeader (x-access-token)
    Note over S: token used in-memory only; never written to disk/logs/URL
    S->>U: SSE progress + analysis result (no source leaves the server)
```

## Files

- **`app-auth.js`** — `createAppJwt()` (RS256 via Node `crypto`, no deps),
  `listInstallations()`, `installationForOwner()`, `createInstallationToken()`.
- **`token-manager.js`** — `TokenManager` caches installation tokens per
  installation id and rotates them ~5 min before expiry. `defaultTokenManager()`
  wires it from env. Nothing is persisted.
- **`source.js`** — `resolveSource(input)` is the seam used by the server: it
  probes visibility anonymously, returns `{visibility, needsAuth, authToken?}`,
  and mints a scoped token only for private repos. `parseGithubRepo()` extracts
  `owner/repo` from https/scp URLs.
- **`../analyzer/ingest.js`** — accepts `options.authToken` and passes it to git
  as an **ephemeral `-c http.extraHeader`** (Basic `x-access-token:<token>`), so
  the credential never lands in `.git/config`, reflogs, process listings, or the
  remote URL. Errors are redacted. The header config is unset after cloning.
- **`../server/server.js`** — `handleAnalyze` calls `resolveSource` before
  `ingest`; a missing App config on a private repo returns an actionable error.

## Configuration

Set these on the **server** only (never client-side):

```bash
export GITHUB_APP_ID=123456
# PEM private key; \n-escaped is also accepted
export GITHUB_APP_PRIVATE_KEY="$(cat your-app.private-key.pem)"
```

Create the App at **Settings -> Developer settings -> GitHub Apps** with:
- Repository permissions: **Contents: Read-only**, **Metadata: Read-only**.
- No webhook required for on-demand analysis.
- Install it on the org/user and select the repositories to expose.

If unset, public-repo analysis works unchanged; private repos return a clear
"configure and install the GitHub App" message.

## Security invariants (enforced/observable)

1. **Server-side only.** Tokens and the private key never reach the browser; the
   client only receives derived analysis, never raw private source.
2. **Least privilege.** Tokens request `contents:read` + `metadata:read` and are
   scoped to the specific repository being analyzed.
3. **Ephemeral.** Installation tokens live ~1h, are cached in memory, rotated
   before expiry, and never written to disk.
4. **No credential leakage.** The clone token is passed via `http.extraHeader`,
   redacted from logs/errors, and the header config is unset post-clone.

## Tests

- `github-selftest.mjs` (offline, no network): JWT well-formedness + RS256
  signature verification, URL parsing, and the ephemeral-credential contract
  (token via `http.extraHeader`, never in argv/URL, redacted from errors).
  Run: `node github-selftest.mjs`
- Networked flows (installation lookup, token minting, private clone) are
  covered by acceptance tests 5-6 against a real installation.
