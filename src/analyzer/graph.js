/**
 * graph.js — the unified knowledge graph.
 *
 * Nodes: files, functions, classes, routes, tables, dependencies (external),
 * env vars, infra. Edges: imports (file->file), calls (function->function, best
 * effort by name within the repo), contains (file->function/class),
 * reads/writes (file->table), exposes (file->route), depends_on (file->external).
 *
 * Call-graph resolution: a call name is linked to a function node if exactly one
 * repo function has that name (unambiguous) OR one such function is defined in a
 * file the caller imports (scoped). Ambiguous calls are left unlinked but kept as
 * `callNames` on the function for display.
 */
export function buildGraph({ files, functions, classes, routes, dbHits, deps, envVars, infra, jobs }) {
  const nodes = [];
  const edges = [];
  const addNode = (n) => { nodes.push(n); return n.id; };
  const addEdge = (source, target, type, meta) => { if (source && target) edges.push({ source, target, type, ...(meta || {}) }); };

  // file nodes
  const fileById = new Map();
  for (const f of files) {
    const id = 'file:' + f.path;
    fileById.set(f.path, id);
    addNode({ id, type: 'file', label: baseName(f.path), path: f.path, lang: f.lang, loc: f.loc, layer: layerOf(f.path) });
  }

  // import edges (file -> file)
  for (const f of files) {
    for (const imp of f.imports || []) {
      if (imp.resolved && fileById.has(imp.resolved)) addEdge('file:' + f.path, 'file:' + imp.resolved, 'imports');
    }
  }

  // function nodes + contains edges + name index
  const fnByName = new Map(); // name -> [fnNode]
  for (const fn of functions) {
    const id = 'fn:' + fn.id;
    fn.nodeId = id;
    addNode({ id, type: 'function', label: fn.name, file: fn.file, line: fn.line, loc: fn.loc, complexity: fn.complexity, lang: fn.lang });
    addEdge('file:' + fn.file, id, 'contains');
    if (!fnByName.has(fn.name)) fnByName.set(fn.name, []);
    fnByName.get(fn.name).push(fn);
  }

  // class nodes
  for (const c of classes) {
    const id = 'class:' + c.id;
    c.nodeId = id;
    addNode({ id, type: 'class', label: c.name, file: c.file, kind: c.kind, line: c.line, loc: c.loc });
    addEdge('file:' + c.file, id, 'contains');
  }

  // call edges (function -> function), resolved by name + import scope
  const importsOf = new Map(); // file -> Set(resolved files)
  for (const f of files) {
    const set = new Set();
    for (const imp of f.imports || []) if (imp.resolved) set.add(imp.resolved);
    importsOf.set(f.path, set);
  }
  const calledBy = {}; // fnId -> [callerFnId]
  for (const fn of functions) {
    fn.resolvedCalls = [];
    const importScope = importsOf.get(fn.file) || new Set();
    for (const name of fn.calls || []) {
      const candidates = fnByName.get(name);
      if (!candidates || !candidates.length) continue;
      let target = null;
      if (candidates.length === 1) target = candidates[0];
      else {
        // prefer a candidate in the same file, then in an imported file
        target = candidates.find((c) => c.file === fn.file)
          || candidates.find((c) => importScope.has(c.file))
          || null;
      }
      if (target && target.id !== fn.id) {
        fn.resolvedCalls.push(target.id);
        addEdge('fn:' + fn.id, 'fn:' + target.id, 'calls');
        (calledBy[target.id] = calledBy[target.id] || []).push(fn.id);
      }
    }
    fn.resolvedCalls = [...new Set(fn.resolvedCalls)];
  }
  for (const fn of functions) fn.calledBy = calledBy[fn.id] || [];

  // table nodes + read/write edges
  const tableSet = new Set();
  for (const h of dbHits) {
    if (!h.table) continue;
    const id = 'table:' + h.table;
    if (!tableSet.has(h.table)) { tableSet.add(h.table); addNode({ id, type: 'table', label: h.table }); }
    const write = /write|insert|update|delete|create|save|upsert|ddl/i.test(h.kind + ' ' + (h.op || ''));
    addEdge('file:' + h.file, id, write ? 'writes' : 'reads');
  }

  // route nodes + exposes edges
  for (const r of routes) {
    const id = 'route:' + r.method + ' ' + r.path + ' @' + r.file;
    addNode({ id, type: 'route', label: r.method + ' ' + r.path, method: r.method, path: r.path, file: r.file, framework: r.framework });
    addEdge('file:' + r.file, id, 'exposes');
  }

  // external dependency nodes (aggregate) + depends_on
  const depSet = new Set();
  for (const d of deps) {
    const id = 'dep:' + d.name;
    if (!depSet.has(d.name)) { depSet.add(d.name); addNode({ id, type: 'dependency', label: d.name, ecosystem: d.ecosystem, scope: d.scope }); }
  }

  // env nodes
  const envSet = new Set();
  for (const e of envVars) {
    if (envSet.has(e.name)) continue; envSet.add(e.name);
    addNode({ id: 'env:' + e.name, type: 'env', label: e.name });
    addEdge('file:' + e.file, 'env:' + e.name, 'uses');
  }

  return {
    nodes, edges,
    stats: { nodes: nodes.length, edges: edges.length },
    // adjacency for fast lookups on the client
    calledBy,
  };
}

export function baseName(p) { return p.split('/').pop(); }

export function layerOf(p) {
  const s = p.toLowerCase();
  if (/(^|\/)(test|tests|spec|__tests__|__test__)(\/|$)|\.(test|spec)\./.test(s)) return 'test';
  if (/(^|\/)(controller|controllers|routes|route|api|handler|handlers|endpoints)(\/|\.)/.test(s)) return 'api';
  if (/(^|\/)(service|services|usecase|usecases|domain|business|logic)(\/|\.)/.test(s)) return 'service';
  if (/(^|\/)(model|models|entity|entities|schema|schemas|repository|repositories|dao|dto|orm)(\/|\.)/.test(s)) return 'data';
  if (/(^|\/)(component|components|view|views|pages|page|ui|widgets|screens)(\/|\.)/.test(s)) return 'ui';
  if (/(^|\/)(util|utils|helper|helpers|lib|libs|common|shared|core)(\/|\.)/.test(s)) return 'lib';
  if (/(^|\/)(config|configs|settings|env)(\/|\.)/.test(s)) return 'config';
  if (/\.(json|ya?ml|toml|xml|ini|env)$|dockerfile|makefile/.test(s)) return 'config';
  return 'other';
}
