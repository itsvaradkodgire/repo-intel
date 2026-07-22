/**
 * flows.js — infer business workflows from the knowledge graph.
 *
 * Strategy (fully mechanical): seed candidate flows from (a) recognized API
 * routes and (b) files whose name matches a business-domain keyword. For each
 * seed, walk the call graph from the entry function(s) to collect the chain of
 * functions and the database tables written along the way. Name the flow from
 * the route/keyword. No hardcoded per-repo assumptions.
 */
const DOMAIN_KEYWORDS = [
  'auth', 'login', 'logout', 'register', 'signup', 'signin', 'password', 'session', 'oauth', 'token',
  'user', 'account', 'profile', 'order', 'checkout', 'cart', 'payment', 'invoice', 'billing',
  'subscription', 'notification', 'email', 'message', 'chat', 'upload', 'download', 'file',
  'search', 'report', 'export', 'import', 'schedule', 'booking', 'reservation', 'inventory',
  'product', 'catalog', 'review', 'comment', 'like', 'follow', 'admin', 'permission', 'role',
  'payroll', 'attendance', 'leave', 'onboarding', 'employee', 'webhook', 'sync', 'job', 'queue',
];

export function inferFlows({ files, functions, routes, dbHits, graph }) {
  const fnById = new Map(functions.map((f) => [f.id, f]));
  const fnByFile = new Map();
  for (const f of functions) {
    if (!fnByFile.has(f.file)) fnByFile.set(f.file, []);
    fnByFile.get(f.file).push(f);
  }
  const dbByFile = new Map();
  for (const h of dbHits) {
    if (!h.table) continue;
    if (!dbByFile.has(h.file)) dbByFile.set(h.file, []);
    const write = /write|insert|update|delete|create|save|upsert|ddl/i.test(h.kind + ' ' + (h.op || ''));
    dbByFile.get(h.file).push({ table: h.table, write });
  }

  // transitive closure of a function through the resolved call graph
  const closureCache = new Map();
  function closure(startId) {
    if (closureCache.has(startId)) return closureCache.get(startId);
    const fns = new Set(); const stack = [startId];
    let guard = 0;
    while (stack.length && guard++ < 4000) {
      const id = stack.pop();
      if (fns.has(id)) continue;
      fns.add(id);
      const fn = fnById.get(id);
      if (fn) for (const c of fn.resolvedCalls || []) if (!fns.has(c)) stack.push(c);
    }
    closureCache.set(startId, fns);
    return fns;
  }

  const flows = [];
  const seen = new Set();

  // (a) route-seeded flows
  const routeGroups = groupRoutes(routes);
  for (const g of routeGroups) {
    const entryFns = fnByFile.get(g.file) || [];
    const chain = new Set();
    const tables = new Set();
    for (const fn of entryFns) {
      const cl = closure(fn.id);
      for (const cid of cl) {
        chain.add(cid);
        const cfn = fnById.get(cid);
        if (cfn) for (const w of (dbByFile.get(cfn.file) || [])) if (w.write) tables.add(w.table);
      }
    }
    for (const w of (dbByFile.get(g.file) || [])) if (w.write) tables.add(w.table);
    const id = 'route:' + g.name;
    if (seen.has(id)) continue; seen.add(id);
    flows.push({
      id, name: g.name, kind: 'api',
      trigger: `HTTP ${g.routes.map((r) => r.method + ' ' + r.path).slice(0, 3).join(', ')}`,
      entry: g.file,
      routes: g.routes,
      steps: buildSteps(g.file, entryFns, chain, fnById, dbByFile),
      tablesWritten: [...tables],
      functionCount: chain.size,
    });
  }

  // (b) keyword-seeded flows (for repos without recognized routes)
  if (flows.length < 8) {
    const byKeyword = new Map();
    for (const f of files) {
      const base = f.path.toLowerCase();
      for (const kw of DOMAIN_KEYWORDS) {
        if (new RegExp(`(^|[/_.-])${kw}s?([/_.-]|$)`).test(base) && (f.functions?.length)) {
          if (!byKeyword.has(kw)) byKeyword.set(kw, []);
          byKeyword.get(kw).push(f);
        }
      }
    }
    for (const [kw, kwFiles] of byKeyword) {
      const id = 'kw:' + kw;
      if (seen.has(id)) continue;
      const entryFns = [];
      for (const f of kwFiles) for (const fn of (fnByFile.get(f.path) || [])) entryFns.push(fn);
      if (!entryFns.length) continue;
      const chain = new Set(); const tables = new Set();
      for (const fn of entryFns.slice(0, 40)) {
        for (const cid of closure(fn.id)) {
          chain.add(cid);
          const cfn = fnById.get(cid);
          if (cfn) for (const w of (dbByFile.get(cfn.file) || [])) if (w.write) tables.add(w.table);
        }
      }
      seen.add(id);
      flows.push({
        id, name: titleCase(kw), kind: 'domain',
        trigger: `${kwFiles.length} ${kw}-related file(s)`,
        entry: kwFiles[0].path,
        routes: [],
        steps: buildSteps(kwFiles[0].path, entryFns.slice(0, 6), chain, fnById, dbByFile),
        tablesWritten: [...tables],
        functionCount: chain.size,
      });
      if (flows.length >= 24) break;
    }
  }

  return flows.sort((a, b) => b.functionCount - a.functionCount).slice(0, 30);
}

function groupRoutes(routes) {
  // group routes by their file (a controller/route module = one flow surface)
  const byFile = new Map();
  for (const r of routes) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }
  const groups = [];
  for (const [file, rs] of byFile) {
    const name = flowNameFromFile(file, rs);
    groups.push({ file, name, routes: rs });
  }
  return groups;
}

function flowNameFromFile(file, routes) {
  // derive a human name from the route path or file
  const p = routes[0]?.path || file;
  const seg = p.split('/').filter((s) => s && !s.startsWith(':') && !s.startsWith('[') && s !== 'api').slice(0, 2).join(' ');
  if (seg) return titleCase(seg.replace(/[-_]/g, ' '));
  const base = file.split('/').pop().replace(/\.(ts|js|py|go|rb|java|php|rs|cs)$/, '');
  return titleCase(base.replace(/[-_]/g, ' '));
}

function buildSteps(entryFile, entryFns, chainIds, fnById, dbByFile) {
  const steps = [];
  steps.push({ kind: 'entry', label: entryFile.split('/').pop(), ref: entryFile });
  // list up to 8 distinct files traversed in the chain, in call order-ish
  const filesSeen = new Set([entryFile]);
  const orderedFiles = [];
  for (const id of chainIds) {
    const fn = fnById.get(id);
    if (fn && !filesSeen.has(fn.file)) { filesSeen.add(fn.file); orderedFiles.push(fn.file); }
  }
  for (const f of orderedFiles.slice(0, 8)) {
    const writes = (dbByFile.get(f) || []).filter((w) => w.write).map((w) => w.table);
    steps.push({ kind: 'function', label: f.split('/').pop(), ref: f, writes: [...new Set(writes)] });
  }
  return steps;
}

function titleCase(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }
