/**
 * detectors.js — framework / infra signal detection across languages.
 *
 * These are pattern detectors that run over each file's raw source + extracted
 * symbols to surface: HTTP API routes, database/ORM access, environment
 * variables, package/config metadata, CI/CD, and security signals (secrets,
 * dangerous calls). Detectors are conservative and annotate evidence (file:line)
 * so nothing is asserted without a source location.
 */
import path from 'path';

// ---------------------------------------------------------------------------
// API ROUTE DETECTION (multi-framework)
// ---------------------------------------------------------------------------
const ROUTE_PATTERNS = [
  // Express / Koa / Fastify / Nest-ish: app.get('/path', ...)
  { re: /\b(?:app|router|route|api|server|fastify)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi, method: 1, path: 2, fw: 'express' },
  // Flask / FastAPI decorators: @app.route('/x', methods=['GET']) or @app.get('/x')
  { re: /@(?:app|router|blueprint|bp)\.(get|post|put|patch|delete|route)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi, method: 1, path: 2, fw: 'python-web' },
  // Spring: @GetMapping("/x") @RequestMapping(...)
  { re: /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?[`'"]([^`'"]+)[`'"]/g, method: 1, path: 2, fw: 'spring' },
  // Go: mux.HandleFunc("/x", ...) / r.Get("/x", ...) / http.HandleFunc
  { re: /\.(HandleFunc|Handle|Get|Post|Put|Patch|Delete)\s*\(\s*[`'"]([^`'"]+)[`'"]/g, method: 1, path: 2, fw: 'go-http' },
  // Rails routes.rb: get '/x' => ... ; resources :things
  { re: /^\s*(get|post|put|patch|delete)\s+[`'"]([^`'"]+)[`'"]/gim, method: 1, path: 2, fw: 'rails' },
  // Laravel: Route::get('/x', ...)
  { re: /Route::(get|post|put|patch|delete|any|match)\s*\(\s*[`'"]([^`'"]+)[`'"]/g, method: 1, path: 2, fw: 'laravel' },
  // ASP.NET: [HttpGet("x")]
  { re: /\[Http(Get|Post|Put|Patch|Delete)\s*\(\s*[`'"]([^`'"]+)[`'"]/g, method: 1, path: 2, fw: 'aspnet' },
  // Django urls.py: path('x/', view)
  { re: /\b(?:path|re_path|url)\s*\(\s*[`'"]([^`'"]*)[`'"]\s*,/g, method: null, path: 1, fw: 'django' },
];

// Next.js / file-based routing: a route.ts / page.tsx under app/ or pages/
function fileBasedRoute(filePath) {
  const p = filePath.replace(/\\/g, '/');
  // Next app router
  let m = p.match(/(?:^|\/)(?:src\/)?app\/(.*)\/route\.(ts|js|tsx|jsx)$/);
  if (m) return { path: '/' + m[1].replace(/\([^)]*\)\//g, '').replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1'), fw: 'nextjs-app' };
  m = p.match(/(?:^|\/)(?:src\/)?pages\/(.*)\.(ts|js|tsx|jsx)$/);
  if (m && !/^_/.test(path.basename(m[1]))) {
    let r = m[1].replace(/\/index$/, '').replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1');
    return { path: '/' + r, fw: 'nextjs-pages' };
  }
  // SvelteKit
  m = p.match(/(?:^|\/)src\/routes\/(.*)\/\+(server|page)\.(ts|js)$/);
  if (m) return { path: '/' + m[1].replace(/\[([^\]]+)\]/g, ':$1'), fw: 'sveltekit' };
  return null;
}

export function detectRoutes(file, src, lines) {
  const routes = [];
  const fb = fileBasedRoute(file.path);
  if (fb) {
    // methods = exported HTTP verb handlers in the file, if any
    const verbs = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
    const methods = verbs.length ? verbs : ['GET'];
    for (const method of methods) routes.push({ method, path: fb.path, framework: fb.fw, file: file.path, line: 1 });
  }
  for (const pat of ROUTE_PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(src)) !== null) {
      const method = pat.method ? (m[pat.method] || 'GET').toUpperCase() : 'ANY';
      const routePath = m[pat.path];
      if (!routePath || routePath.length > 200) continue;
      const line = src.slice(0, m.index).split('\n').length;
      routes.push({ method: method === 'ROUTE' || method === 'REQUEST' ? 'ANY' : method, path: routePath, framework: pat.fw, file: file.path, line });
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// DATABASE / ORM ACCESS DETECTION
// ---------------------------------------------------------------------------
const DB_PATTERNS = [
  { re: /\.from\s*\(\s*[`'"]([a-zA-Z_][\w.]*)[`'"]\s*\)/g, kind: 'supabase/query', table: 1, needs: /supabase|createClient|\.select\(|\.insert\(|\.upsert\(/ },
  { re: /\bprisma\.([a-zA-Z_]\w*)\.(findMany|findFirst|findUnique|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate)/g, kind: 'prisma', table: 1, op: 2 },
  { re: /\bdb\.(?:select|insert|update|delete)\([\s\S]{0,40}?\.from\(\s*([a-zA-Z_]\w*)/g, kind: 'drizzle', table: 1 },
  { re: /\b([A-Z]\w*)\.objects\.(all|filter|get|create|update|delete|exclude|values)\b/g, kind: 'django-orm', table: 1, op: 2, needs: /models|django/ },
  { re: /\bawait\s+([A-Z]\w*)\.(find|findOne|findById|findByIdAndUpdate|updateOne|updateMany|deleteOne|deleteMany|aggregate)\s*\(/g, kind: 'mongoose', table: 1, op: 2, needs: /mongoose|Schema|model\(/ },
];

// Raw SQL string literals: detect table names inside SQL statements found in code
// (only when the surrounding literal really looks like SQL).
const SQL_IN_STRING = /[`'"]\s*(?:SELECT\s+[\s\S]{0,200}?\bFROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`']?([a-zA-Z_][\w.]*)/gi;

// SQL DDL: create table (works on .sql files)
const DDL_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`']?([a-zA-Z_][\w.]*)["`']?\s*\(/gi;

export function detectDbAccess(file, src) {
  const hits = [];
  const isSqlFile = file.ext === '.sql';
  if (isSqlFile) {
    let m;
    DDL_TABLE.lastIndex = 0;
    while ((m = DDL_TABLE.exec(src)) !== null) {
      hits.push({ kind: 'ddl-table', table: m[1].replace(/["`']/g, ''), file: file.path, line: src.slice(0, m.index).split('\n').length });
    }
    // in a .sql file, also capture DML table refs directly
    SQL_IN_STRING.lastIndex = 0;
    // reuse a bare SQL scan for .sql files
    const dml = /\b(?:from|into|update|join)\s+["`']?([a-zA-Z_][\w.]*)/gi;
    let d; let guard = 0;
    while ((d = dml.exec(src)) !== null && guard++ < 5000) {
      const t = d[1];
      if (/^(select|where|the|dual)$/i.test(t)) continue;
      hits.push({ kind: 'sql', table: t, file: file.path, line: src.slice(0, d.index).split('\n').length });
    }
  }
  for (const pat of DB_PATTERNS) {
    if (pat.needs && !pat.needs.test(src)) continue; // ORM must actually be present in the file
    pat.re.lastIndex = 0;
    let m; let guard = 0;
    while ((m = pat.re.exec(src)) !== null && guard++ < 2000) {
      const table = pat.table ? m[pat.table] : null;
      if (table && (table.length > 64 || /^(the|a|an|select|where|await|if|for|this|self|result|res|data|item|value|Object|Array|Promise|Math|JSON|String|Number|Boolean|Error)$/i.test(table))) continue;
      hits.push({ kind: pat.kind, table: table || null, op: pat.op ? m[pat.op] : null, file: file.path, line: src.slice(0, m.index).split('\n').length });
    }
  }
  // raw SQL embedded in code strings (any language)
  if (!isSqlFile && /select|insert|update|delete/i.test(src)) {
    SQL_IN_STRING.lastIndex = 0;
    let s; let guard = 0;
    while ((s = SQL_IN_STRING.exec(src)) !== null && guard++ < 500) {
      const t = s[1];
      if (/^(select|where|dual)$/i.test(t)) continue;
      const write = /insert|update|delete/i.test(s[0]);
      hits.push({ kind: write ? 'sql-write' : 'sql', table: t, file: file.path, line: src.slice(0, s.index).split('\n').length });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// ENV VARS
// ---------------------------------------------------------------------------
const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[[`'"]([A-Z_][A-Z0-9_]*)[`'"]\]/g,
  /os\.environ(?:\.get)?\[?[`'"(]\s*[`'"]?([A-Z_][A-Z0-9_]*)/g,
  /os\.getenv\(\s*[`'"]([A-Z_][A-Z0-9_]*)/g,
  /System\.getenv\(\s*[`'"]([A-Z_][A-Z0-9_]*)/g,
  /ENV\[[`'"]([A-Z_][A-Z0-9_]*)[`'"]\]/g,
  /os\.Getenv\(\s*[`'"]([A-Z_][A-Z0-9_]*)/g,
  /std::env::var\(\s*[`'"]([A-Z_][A-Z0-9_]*)/g,
  /getenv\(\s*[`'"]([A-Z_][A-Z0-9_]*)/g,
];
export function detectEnvVars(file, src) {
  const vars = new Map();
  for (const re of ENV_PATTERNS) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!vars.has(name)) vars.set(name, { name, file: file.path, line: src.slice(0, m.index).split('\n').length });
    }
  }
  return [...vars.values()];
}

// ---------------------------------------------------------------------------
// SECURITY SIGNALS
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, kind: 'AWS access key id', sev: 'high' },
  { re: /\bASIA[0-9A-Z]{16}\b/g, kind: 'AWS temp key id', sev: 'high' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, kind: 'GitHub token', sev: 'high' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, kind: 'Slack token', sev: 'high' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, kind: 'Private key', sev: 'high' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, kind: 'OpenAI-style secret key', sev: 'high' },
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, kind: 'Google API key', sev: 'medium' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, kind: 'JWT (hardcoded)', sev: 'medium' },
  { re: /(?:password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key)\s*[:=]\s*[`'"][^`'"\s]{8,}[`'"]/gi, kind: 'Hardcoded credential', sev: 'medium' },
];
const DANGEROUS_PATTERNS = [
  { re: /\beval\s*\(/g, kind: 'eval() use', sev: 'medium', cat: 'code-exec' },
  { re: /\bexec\s*\(|child_process|subprocess\.(call|run|Popen)|os\.system\(/g, kind: 'shell/command execution', sev: 'medium', cat: 'command-exec' },
  { re: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html|document\.write\(/g, kind: 'Potential XSS sink', sev: 'medium', cat: 'xss' },
  { re: /(?:query|execute)\s*\(\s*[`'"][^`'"]*(?:\$\{|\+\s*\w+|%s|%d)/g, kind: 'Possible SQL string interpolation (injection)', sev: 'medium', cat: 'sql-injection' },
  { re: /verify\s*:\s*false|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|verify=False/g, kind: 'TLS verification disabled', sev: 'high', cat: 'tls' },
  { re: /md5\(|sha1\(|hashlib\.md5|MessageDigest\.getInstance\(\s*[`'"]MD5/gi, kind: 'Weak hash (MD5/SHA1)', sev: 'low', cat: 'crypto' },
];
export function detectSecurity(file, src) {
  const findings = [];
  // don't flag example/sample env files as leaked secrets, but do flag real .env
  const isExample = /\.example$|\.sample$|\.template$/.test(file.path);
  for (const pat of SECRET_PATTERNS) {
    pat.re.lastIndex = 0; let m; let guard = 0;
    while ((m = pat.re.exec(src)) !== null && guard++ < 50) {
      findings.push({ type: 'secret', kind: pat.kind + (isExample ? ' (example file)' : ''), severity: isExample ? 'low' : pat.sev, file: file.path, line: src.slice(0, m.index).split('\n').length, snippet: redact(m[0]) });
    }
  }
  for (const pat of DANGEROUS_PATTERNS) {
    pat.re.lastIndex = 0; let m; let guard = 0;
    while ((m = pat.re.exec(src)) !== null && guard++ < 200) {
      findings.push({ type: pat.cat, kind: pat.kind, severity: pat.sev, file: file.path, line: src.slice(0, m.index).split('\n').length });
    }
  }
  return findings;
}
function redact(s) {
  if (s.length <= 10) return s.slice(0, 3) + '***';
  return s.slice(0, 6) + '***' + s.slice(-3);
}
