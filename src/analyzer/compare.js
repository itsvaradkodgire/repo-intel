/**
 * compare.js — compare two analyzed snapshots (commits/branches/tags).
 *
 * Given two full indexes A (base) and B (head), computes a structured diff:
 * changed/added/removed files, functions, classes, routes, tables, dependencies,
 * plus complexity/LOC deltas and a coarse risk score. Purely set-difference over
 * the two indexes; nothing is inferred beyond what analysis produced.
 */
export function compareIndexes(a, b) {
  const fileSetA = new Map(a.files.map((f) => [f.path, f]));
  const fileSetB = new Map(b.files.map((f) => [f.path, f]));
  const addedFiles = [...fileSetB.keys()].filter((p) => !fileSetA.has(p));
  const removedFiles = [...fileSetA.keys()].filter((p) => !fileSetB.has(p));
  const changedFiles = [...fileSetB.keys()].filter((p) => {
    const fa = fileSetA.get(p); const fb = fileSetB.get(p);
    if (!fa) return false;
    return fa.loc !== fb.loc || (fa.functions?.length || 0) !== (fb.functions?.length || 0) || (fa.complexity || 0) !== (fb.complexity || 0);
  });

  const fnKey = (f) => f.file + '::' + f.name;
  const fnA = new Map(a.functions.map((f) => [fnKey(f), f]));
  const fnB = new Map(b.functions.map((f) => [fnKey(f), f]));
  const addedFns = [...fnB.keys()].filter((k) => !fnA.has(k)).map((k) => fnB.get(k));
  const removedFns = [...fnA.keys()].filter((k) => !fnB.has(k)).map((k) => fnA.get(k));
  const changedFns = [...fnB.keys()].filter((k) => {
    const x = fnA.get(k); const y = fnB.get(k);
    return x && (x.complexity !== y.complexity || x.loc !== y.loc);
  }).map((k) => ({ name: fnB.get(k).name, file: fnB.get(k).file, complexityDelta: fnB.get(k).complexity - fnA.get(k).complexity, locDelta: fnB.get(k).loc - fnA.get(k).loc }));

  const routeKey = (r) => r.method + ' ' + r.path;
  const routesA = new Set(a.routes.map(routeKey));
  const routesB = new Set(b.routes.map(routeKey));
  const addedRoutes = [...routesB].filter((r) => !routesA.has(r));
  const removedRoutes = [...routesA].filter((r) => !routesB.has(r));

  const tablesA = new Set(a.tables.map((t) => t.name));
  const tablesB = new Set(b.tables.map((t) => t.name));
  const addedTables = [...tablesB].filter((t) => !tablesA.has(t));
  const removedTables = [...tablesA].filter((t) => !tablesB.has(t));

  const depsA = new Map(a.dependencies.map((d) => [d.name, d.version]));
  const depsB = new Map(b.dependencies.map((d) => [d.name, d.version]));
  const addedDeps = [...depsB.keys()].filter((d) => !depsA.has(d));
  const removedDeps = [...depsA.keys()].filter((d) => !depsB.has(d));
  const changedDeps = [...depsB.keys()].filter((d) => depsA.has(d) && depsA.get(d) !== depsB.get(d))
    .map((d) => ({ name: d, from: depsA.get(d), to: depsB.get(d) }));

  const risk =
    addedRoutes.length * 2 + removedRoutes.length * 3 +
    removedFns.length * 1 + removedTables.length * 4 +
    changedDeps.length * 1 + removedFiles.length * 2;

  return {
    base: a.source?.git || null,
    head: b.source?.git || null,
    files: { added: addedFiles, removed: removedFiles, changed: changedFiles },
    functions: { added: addedFns.map(slimFn), removed: removedFns.map(slimFn), changed: changedFns },
    routes: { added: addedRoutes, removed: removedRoutes },
    tables: { added: addedTables, removed: removedTables },
    dependencies: { added: addedDeps, removed: removedDeps, changed: changedDeps },
    deltas: {
      loc: b.manifest.counts.loc - a.manifest.counts.loc,
      files: b.manifest.counts.files - a.manifest.counts.files,
      functions: b.manifest.counts.functions - a.manifest.counts.functions,
      routes: b.manifest.counts.routes - a.manifest.counts.routes,
    },
    risk,
    riskLabel: risk >= 20 ? 'high' : risk >= 8 ? 'medium' : 'low',
  };
}

function slimFn(f) { return { name: f.name, file: f.file, line: f.line, complexity: f.complexity }; }
