/**
 * config.js — package metadata, dependencies, CI/CD, and container detection.
 *
 * Parses well-known manifest files to extract declared dependencies and project
 * metadata, and recognizes CI/CD + container configuration. Used to build the
 * "external dependencies" and "infrastructure" facets of the knowledge graph.
 */
import path from 'path';

export function parseManifest(file, src) {
  const name = path.basename(file.path);
  try {
    if (name === 'package.json') {
      const j = JSON.parse(src);
      const deps = objToDeps(j.dependencies, 'runtime')
        .concat(objToDeps(j.devDependencies, 'dev'))
        .concat(objToDeps(j.peerDependencies, 'peer'));
      return { ecosystem: 'npm', file: file.path, name: j.name, version: j.version, scripts: Object.keys(j.scripts || {}), deps };
    }
    if (name === 'requirements.txt') {
      const deps = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
        .map((l) => { const m = l.match(/^([A-Za-z0-9._-]+)\s*([<>=!~].*)?/); return m ? { name: m[1], version: (m[2] || '').trim() || '*', scope: 'runtime' } : null; })
        .filter(Boolean);
      return { ecosystem: 'pip', file: file.path, deps };
    }
    if (name === 'pyproject.toml' || name === 'Cargo.toml' || name === 'go.mod' || name === 'composer.json' || name === 'pom.xml' || name === 'build.gradle' || name === 'Gemfile' || name === 'pubspec.yaml') {
      return parseSimpleManifest(name, file, src);
    }
  } catch { /* ignore malformed */ }
  return null;
}

function objToDeps(obj, scope) {
  if (!obj) return [];
  return Object.entries(obj).map(([name, version]) => ({ name, version, scope }));
}

function parseSimpleManifest(name, file, src) {
  const deps = [];
  let ecosystem = 'unknown';
  if (name === 'go.mod') {
    ecosystem = 'go';
    for (const m of src.matchAll(/^\s*([\w.\-/]+)\s+v[\w.\-+]+/gm)) {
      if (m[1] !== 'module' && m[1] !== 'go' && m[1].includes('/')) deps.push({ name: m[1], version: '', scope: 'runtime' });
    }
  } else if (name === 'Cargo.toml') {
    ecosystem = 'cargo';
    const depSection = src.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
    if (depSection) for (const m of depSection[1].matchAll(/^([\w-]+)\s*=/gm)) deps.push({ name: m[1], version: '', scope: 'runtime' });
  } else if (name === 'composer.json') {
    try { const j = JSON.parse(src); ecosystem = 'composer';
      for (const [n, v] of Object.entries(j.require || {})) deps.push({ name: n, version: v, scope: 'runtime' });
    } catch {}
  } else if (name === 'pom.xml') {
    ecosystem = 'maven';
    for (const m of src.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) deps.push({ name: m[1], version: '', scope: 'runtime' });
  } else if (name === 'build.gradle') {
    ecosystem = 'gradle';
    for (const m of src.matchAll(/(?:implementation|api|compile|testImplementation)\s+[`'"]([^`'"]+)[`'"]/g)) deps.push({ name: m[1].split(':').slice(0, 2).join(':'), version: '', scope: 'runtime' });
  } else if (name === 'Gemfile') {
    ecosystem = 'bundler';
    for (const m of src.matchAll(/^\s*gem\s+[`'"]([^`'"]+)[`'"]/gm)) deps.push({ name: m[1], version: '', scope: 'runtime' });
  } else if (name === 'pubspec.yaml') {
    ecosystem = 'pub';
    const depSection = src.match(/^dependencies:\s*\n([\s\S]*?)(?=^\w|$)/m);
    if (depSection) for (const m of depSection[1].matchAll(/^\s{2}([\w-]+):/gm)) deps.push({ name: m[1], version: '', scope: 'runtime' });
  } else if (name === 'pyproject.toml') {
    ecosystem = 'python';
    for (const m of src.matchAll(/^\s*([\w.-]+)\s*=\s*[`'"][^`'"]+[`'"]/gm)) deps.push({ name: m[1], version: '', scope: 'runtime' });
  }
  return { ecosystem, file: file.path, deps: dedupeDeps(deps) };
}

function dedupeDeps(deps) {
  const seen = new Set(); const out = [];
  for (const d of deps) { if (!seen.has(d.name)) { seen.add(d.name); out.push(d); } }
  return out;
}

export function detectInfra(file) {
  const p = file.path.replace(/\\/g, '/');
  const base = path.basename(p);
  if (/\.github\/workflows\/.*\.ya?ml$/.test(p)) return { type: 'ci', system: 'github-actions', file: p };
  if (base === '.gitlab-ci.yml') return { type: 'ci', system: 'gitlab-ci', file: p };
  if (/\.circleci\/config\.yml$/.test(p)) return { type: 'ci', system: 'circleci', file: p };
  if (base === '.travis.yml') return { type: 'ci', system: 'travis', file: p };
  if (/azure-pipelines\.ya?ml$/.test(base)) return { type: 'ci', system: 'azure-pipelines', file: p };
  if (base === 'Jenkinsfile') return { type: 'ci', system: 'jenkins', file: p };
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return { type: 'container', system: 'docker', file: p };
  if (/docker-compose\.ya?ml$/.test(base)) return { type: 'container', system: 'docker-compose', file: p };
  if (base === 'Makefile') return { type: 'build', system: 'make', file: p };
  if (/\.tf$/.test(base)) return { type: 'iac', system: 'terraform', file: p };
  if (base === 'vercel.json') return { type: 'deploy', system: 'vercel', file: p };
  if (base === 'netlify.toml') return { type: 'deploy', system: 'netlify', file: p };
  if (base === 'serverless.yml') return { type: 'deploy', system: 'serverless', file: p };
  if (/\.k8s\.ya?ml$|kubernetes|deployment\.ya?ml$/.test(p)) return { type: 'container', system: 'kubernetes', file: p };
  return null;
}

// background jobs / workers / cron
export function detectJobs(file, src) {
  const jobs = [];
  const patterns = [
    { re: /cron\.schedule\s*\(\s*[`'"]([^`'"]+)/g, kind: 'cron', schedule: 1 },
    { re: /@(Scheduled|Cron)\s*\(/g, kind: 'scheduled', schedule: null },
    { re: /new\s+(Worker|Queue|Bull|Bee)\s*\(\s*[`'"]?([\w-]*)/g, kind: 'queue-worker', name: 2 },
    { re: /celery\.task|@(?:app\.)?task\b|@shared_task/g, kind: 'celery-task', name: null },
    { re: /@(?:repeatable_)?(?:job|task)\b|sidekiq|ActiveJob/gi, kind: 'job', name: null },
    { re: /setInterval\s*\(|setTimeout\s*\([^,]+,\s*\d{4,}/g, kind: 'timer', name: null },
    { re: /schedule\s*\.\s*every\s*\(/g, kind: 'schedule', name: null },
  ];
  for (const pat of patterns) {
    pat.re.lastIndex = 0; let m; let guard = 0;
    while ((m = pat.re.exec(src)) !== null && guard++ < 100) {
      jobs.push({ kind: pat.kind, detail: pat.schedule ? m[pat.schedule] : (pat.name ? m[pat.name] : null), file: file.path, line: src.slice(0, m.index).split('\n').length });
    }
  }
  return jobs;
}
