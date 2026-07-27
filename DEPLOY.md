# Deploying the Repository Intelligence Platform

**Important:** this app is a **long-running Node HTTP server**, not a static site
or serverless app. It:

- shells out to the **`git`** binary to clone repositories (`src/analyzer/ingest.js`),
- keeps analysis state (indexes, trace models, the "brain") **in memory** across
  requests,
- serves a web UI + JSON API from one persistent process (`src/server/server.js`).

That means **Vercel/Netlify (serverless) will not work** without re-architecting.
Use a host that runs a persistent process with a writable filesystem and `git`.

The server already:
- reads **`process.env.PORT`** and binds **`0.0.0.0`**,
- exposes **`/healthz`** for platform health checks,
- pins Node via **`.node-version`** (22.11.0) and `engines` in `package.json`.

---

## Option A — Render (recommended, free)

This repo ships a blueprint at `render.yaml`.

1. Push to GitHub (already done).
2. Render dashboard -> **New +** -> **Blueprint**.
3. Select the `repo-intel` repo. Render reads `render.yaml`:
   - build: `npm ci`
   - start: `npm start`
   - health check: `/healthz`
   - Node: 22.11.0
4. Click **Apply**. First deploy takes a few minutes.
5. (Optional, only for **private** repo analysis) In the service's
   **Environment** tab, add secrets `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`
   (see `src/github/README.md`). Public repos need nothing.

If you created the service manually instead of via blueprint, set:
- **Build Command:** `npm ci`
- **Start Command:** `npm start`
- **Health Check Path:** `/healthz`
- Environment: `NODE_VERSION=22.11.0`, `REPO_INTEL_CACHE=/tmp/repo-intel-cache`

## Option B — Docker (Render Docker / Fly.io / Railway / Cloud Run)

A `Dockerfile` is included (Node 22 + `git`, health check, binds `0.0.0.0`).

```bash
docker build -t repo-intel .
docker run -p 4477:4477 repo-intel
# -> http://localhost:4477   (health: /healthz)
```

- **Fly.io:** `fly launch --dockerfile Dockerfile` (accept the detected settings).
- **Railway:** New Project -> Deploy from Repo; it auto-detects the Dockerfile.

## Option C — Any VPS

```bash
git clone https://github.com/itsvaradkodgire/repo-intel.git
cd repo-intel && npm ci
PORT=8080 npm start     # put nginx/caddy in front for TLS
```

---

## Verifying a deploy

```bash
curl -s https://<your-app-host>/healthz
# -> {"ok":true,"service":"repo-intel","uptime":<n>}
```

If `/healthz` returns 200 but the UI 404s, the platform isn't routing to the
Node process (typically a serverless host). Move to Option A or B.

## Common failure causes (and fixes)

| Symptom | Cause | Fix |
|---|---|---|
| `NOT_FOUND` on `/` (Vercel) | serverless host, no persistent server | use Render/Docker |
| Build ok, `git clone` fails at analyze time | runtime image has no `git` | use the Dockerfile (installs git) |
| Boot crash in `web-tree-sitter` | wrong Node version | `.node-version` / `NODE_VERSION=22.11.0` |
| Health check timeout | process didn't bind `0.0.0.0`/`PORT` | already fixed in `server.js` |
