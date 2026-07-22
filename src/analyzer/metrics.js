/**
 * metrics.js — code-quality + graph metrics from the extracted model.
 *
 * All computed mechanically: circular imports (Tarjan SCC over file import
 * graph), dead files (no importer, not an entrypoint), large files/functions,
 * high-complexity functions, duplicate function names, files with parse errors,
 * and layer-violation heuristics. Facts only.
 */
import { layerOf } from './graph.js';

export function computeMetrics({ files, functions, classes, graph }) {
  const byPath = new Map(files.map((f) => [f.path, f]));

  // ---- circular imports (Tarjan SCC) ----
  const adj = new Map();
  for (const f of files) {
    const outs = [];
    for (const imp of f.imports || []) if (imp.resolved && byPath.has(imp.resolved) && imp.resolved !== f.path) outs.push(imp.resolved);
    adj.set(f.path, outs);
  }
  const cycles = tarjan([...adj.keys()], adj);

  // ---- dead files ----
  const deadFiles = files
    .filter((f) => (f.importedBy?.length || 0) === 0 && !isEntrypoint(f) && f.functions && (f.functions.length || f.classes.length))
    .map((f) => f.path);

  // ---- large / complex ----
  const largeFiles = files.filter((f) => f.loc >= 400).map((f) => ({ path: f.path, loc: f.loc }))
    .sort((a, b) => b.loc - a.loc);
  const largeFunctions = functions.filter((f) => f.loc >= 60).map((f) => ({ id: f.id, name: f.name, file: f.file, loc: f.loc }))
    .sort((a, b) => b.loc - a.loc);
  const complexFunctions = functions.filter((f) => f.complexity >= 12).map((f) => ({ id: f.id, name: f.name, file: f.file, complexity: f.complexity }))
    .sort((a, b) => b.complexity - a.complexity);

  // ---- duplicate function names ----
  const nameMap = new Map();
  for (const f of functions) {
    if (f.name === '(anonymous)' || f.name.length < 3) continue;
    if (!nameMap.has(f.name)) nameMap.set(f.name, new Set());
    nameMap.get(f.name).add(f.file);
  }
  const duplicateNames = [...nameMap.entries()].filter(([, s]) => s.size > 2)
    .map(([name, s]) => ({ name, files: [...s], count: s.size }))
    .sort((a, b) => b.count - a.count).slice(0, 100);

  // ---- possible code duplication: functions with identical (name, loc, complexity) signature-ish ----
  const dupSig = new Map();
  for (const f of functions) {
    if (f.loc < 6) continue;
    const key = `${f.name}|${f.loc}|${f.complexity}|${(f.calls || []).slice().sort().join(',')}`;
    if (!dupSig.has(key)) dupSig.set(key, []);
    dupSig.get(key).push(f);
  }
  const duplicateBlocks = [...dupSig.values()].filter((g) => g.length > 1 && g[0].loc >= 8)
    .map((g) => ({ name: g[0].name, loc: g[0].loc, occurrences: g.map((x) => ({ file: x.file, line: x.line })) }))
    .slice(0, 60);

  // ---- parse errors ----
  const parseErrors = files.filter((f) => f.hasParseError).map((f) => f.path);

  // ---- undocumented public functions (heuristic) ----
  const undocumented = functions.filter((f) => !f.doc && f.loc >= 15).length;

  // ---- layer violations: data/ui importing api, ui importing data directly, etc. ----
  const layerViolations = [];
  for (const f of files) {
    const fl = layerOf(f.path);
    for (const imp of f.imports || []) {
      if (!imp.resolved) continue;
      const tl = layerOf(imp.resolved);
      // ui importing data-access or api layer directly is a common smell
      if (fl === 'ui' && (tl === 'data' || tl === 'api')) layerViolations.push({ from: f.path, to: imp.resolved, rule: `ui imports ${tl}` });
      if (fl === 'data' && tl === 'ui') layerViolations.push({ from: f.path, to: imp.resolved, rule: 'data imports ui' });
    }
  }

  // layer + language distribution
  const layerCounts = {}; const langCounts = {};
  for (const f of files) {
    const l = layerOf(f.path); layerCounts[l] = (layerCounts[l] || 0) + 1;
    if (f.lang) langCounts[f.lang] = (langCounts[f.lang] || 0) + 1;
  }

  return {
    circularDependencies: cycles,
    deadFiles,
    largeFiles,
    largeFunctions,
    complexFunctions,
    duplicateNames,
    duplicateBlocks,
    parseErrors,
    undocumentedFunctions: undocumented,
    layerViolations: layerViolations.slice(0, 200),
    layerCounts,
    langCounts,
    summary: {
      circular: cycles.length,
      dead: deadFiles.length,
      largeFiles: largeFiles.length,
      largeFunctions: largeFunctions.length,
      complexFunctions: complexFunctions.length,
      duplicateNames: duplicateNames.length,
      duplicateBlocks: duplicateBlocks.length,
      parseErrors: parseErrors.length,
      layerViolations: layerViolations.length,
    },
  };
}

function isEntrypoint(f) {
  const p = f.path.toLowerCase();
  const base = p.split('/').pop();
  return (
    /(^|\/)(main|index|app|server|cli|__main__|program|mod)\.[a-z]+$/.test(p) ||
    /(^|\/)(route|page|layout|middleware)\.[a-z]+$/.test(base) ||
    /\.(test|spec)\.[a-z]+$/.test(base) ||
    /(^|\/)(test|tests|spec|examples?|scripts?|bin|cmd)(\/|$)/.test(p) ||
    /migrations?\//.test(p) ||
    base === 'setup.py' || base === 'conftest.py' ||
    p.endsWith('.d.ts')
  );
}

// Tarjan strongly-connected components
function tarjan(nodes, adj) {
  let index = 0; const stack = []; const onStack = new Set();
  const idx = new Map(); const low = new Map(); const out = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp);
      else if (comp.length === 1 && (adj.get(comp[0]) || []).includes(comp[0])) out.push(comp);
    }
  };
  // iterative guard for large graphs via try/catch on recursion depth
  for (const n of nodes) {
    if (!idx.has(n)) {
      try { strong(n); }
      catch (e) { if (e instanceof RangeError) { /* skip deep component */ } else throw e; }
    }
  }
  return out;
}
