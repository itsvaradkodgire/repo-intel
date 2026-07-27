# Container image for the Repository Intelligence Platform.
# Works on any container host (Render "Docker" runtime, Fly.io, Railway, Cloud
# Run). Includes the `git` binary the analyzer shells out to for cloning repos.
FROM node:22-slim

# git is required at runtime (ingest.js clones repos via `git clone`).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching (deterministic via lockfile).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# The server reads process.env.PORT and binds 0.0.0.0. Expose a sane default.
ENV PORT=4477 \
    REPO_INTEL_CACHE=/tmp/repo-intel-cache
EXPOSE 4477

# Simple healthcheck against the liveness route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4477)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
