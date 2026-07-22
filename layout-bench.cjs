/* layout-bench.cjs — Phase 7 layout quality harness (Node, CommonJS).
 * Loads the browser graph-layout.js via vm, builds real graphs from analyzed
 * repo indexes, and scores the new pipeline vs the old single-pass force layout
 * on objective metrics (edge crossings, node overlaps, edge-length consistency).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

// ---- load graph-layout.js into a sandbox that provides module.exports ----
function loadLayout() {
  const code = fs.readFileSync(path.join(__dirname, 'web/assets/graph-layout.js'), 'utf8');
  const sandbox = { module: { exports: {} }, window: undefined, self: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.self.GraphLayout || sandbox.module.exports;
}
const GL = loadLayout();

// ---- old single-pass force layout (copied from the pre-Phase-7 graph.js) ----
function seededRandom(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function oldForce(nodes, links, W, H, iters) {
  const rand = seededRandom(1234); const byId = {};
  nodes = nodes.map((n) => ({ id: n.id, r: n.r || 8, x: W / 2 + (rand() - 0.5) * W * 0.8, y: H / 2 + (rand() - 0.5) * H * 0.8, vx: 0, vy: 0 }));
  nodes.forEach((n) => byId[n.id] = n);
  const edges = links.map((l) => ({ s: byId[l.source], t: byId[l.target], w: l.weight || 1 })).filter((e) => e.s && e.t);
  const k = Math.sqrt((W * H) / Math.max(nodes.length, 1)) * 0.75;
  iters = iters || 300;
  for (let it = 0; it < iters; it++) {
    const temp = 0.1 * (1 - it / iters) + 0.005;
    for (let i = 0; i < nodes.length; i++) { const a = nodes[i]; let fx = 0, fy = 0; for (let j = 0; j < nodes.length; j++) { if (i === j) continue; const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy; if (d2 < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 0.01; } const d = Math.sqrt(d2); const rep = (k * k) / d; fx += (dx / d) * rep; fy += (dy / d) * rep; } a.vx = (a.vx + fx) * 0.9; a.vy = (a.vy + fy) * 0.9; }
    for (const e of edges) { let dx = e.s.x - e.t.x, dy = e.s.y - e.t.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01; const att = (d * d) / k * Math.min(e.w, 4) * 0.4; const fx = (dx / d) * att, fy = (dy / d) * att; e.s.vx -= fx; e.s.vy -= fy; e.t.vx += fx; e.t.vy += fy; }
    for (const n of nodes) { const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 0.01; const lim = Math.min(speed, temp * 1000) / speed; n.x += n.vx * lim; n.y += n.vy * lim; n.x = Math.max(40, Math.min(W - 40, n.x)); n.y = Math.max(40, Math.min(H - 40, n.y)); }
  }
  return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
}

// ---- build graph payloads from an index (mirror of the page builders) ----
function layerGraph(d) {
  const lk = d.metrics.layerCounts; const fileLayer = {};
  d.graph.nodes.forEach((n) => { if (n.type === 'file') fileLayer[n.path] = n.layer; });
  const nodes = Object.keys(lk).map((l) => ({ id: l, r: 8 + Math.min(Math.sqrt(lk[l]) * 2.2, 20) }));
  const em = new Map();
  d.files.forEach((f) => { const fl = fileLayer[f.path]; (f.imports || []).forEach((imp) => { if (imp.resolved && fileLayer[imp.resolved]) { const tl = fileLayer[imp.resolved]; if (tl !== fl) { const k = fl + '->' + tl; em.set(k, (em.get(k) || 0) + 1); } } }); });
  const links = [...em.entries()].map((e) => { const p = e[0].split('->'); return { source: p[0], target: p[1], weight: e[1] }; });
  return { nodes, links };
}
function moduleGraph(d) {
  const keyOf = {}, counts = {};
  d.files.forEach((f) => { if (f.meta && !f.functions) return; const segs = f.path.split('/'); const key = segs.length > 1 ? segs.slice(0, Math.min(2, segs.length - 1)).join('/') : '(root)'; keyOf[f.path] = key; counts[key] = (counts[key] || 0) + 1; });
  const nodes = Object.keys(counts).map((k) => ({ id: k, r: 5 + Math.min(Math.sqrt(counts[k]) * 2, 16) }));
  const em = new Map();
  d.files.forEach((f) => { const from = keyOf[f.path]; if (!from) return; (f.imports || []).forEach((imp) => { if (imp.resolved && keyOf[imp.resolved]) { const to = keyOf[imp.resolved]; if (to !== from) { const k = from + '->' + to; em.set(k, (em.get(k) || 0) + 1); } } }); });
  const links = [...em.entries()].map((e) => { const p = e[0].split('->'); return { source: p[0], target: p[1], weight: e[1] }; });
  return { nodes, links };
}
function fileDepGraph(d, cap) {
  const nodes = d.files.filter((f) => f.functions).slice(0, cap || 400).map((f) => ({ id: f.path, r: 6 }));
  const ids = new Set(nodes.map((n) => n.id)); const links = [];
  d.files.forEach((f) => { if (!ids.has(f.path)) return; (f.imports || []).forEach((imp) => { if (imp.resolved && ids.has(imp.resolved) && imp.resolved !== f.path) links.push({ source: f.path, target: imp.resolved, weight: 1 }); }); });
  return { nodes, links };
}
function systemGraph(d) {
  if (!d.intel || !d.intel.systemMap) return null;
  const sm = d.intel.systemMap;
  const nodes = sm.nodes.map((n) => ({ id: n.id, r: Math.min(22, 9 + Math.sqrt(n.files || 1) * 1.7) }));
  const nid = new Set(nodes.map((n) => n.id));
  const links = sm.edges.filter((e) => nid.has(e.source) && nid.has(e.target)).map((e) => ({ source: e.source, target: e.target, weight: e.strength }));
  return { nodes, links };
}

function radii(nodes) { const r = {}; nodes.forEach((n) => r[n.id] = n.r || 8); return r; }
function score(m) { // lower is better; combine crossings + overlaps + edge-length CV
  const cr = m.crossings < 0 ? 9999 : m.crossings;
  const ov = m.nodeOverlaps < 0 ? 9999 : m.nodeOverlaps;
  return { crossings: cr, overlaps: ov, cv: +m.edgeLengthCV.toFixed(2), edges: m.edges };
}

function bench(name, g) {
  if (!g || !g.nodes.length) { console.log(`\n[${name}] (empty, skipped)`); return; }
  const W = 900, H = 600;
  const rr = radii(g.nodes);
  const oldPos = oldForce(g.nodes, g.links, W, H, 300);
  const oldM = score(GL.metrics(oldPos, g.links, rr));
  const t0 = Date.now();
  const res = GL.layout(g.nodes, g.links, { width: W, height: H });
  const ms = Date.now() - t0;
  const newM = score(GL.metrics(res.positions, g.links, rr));
  const impCross = oldM.crossings ? Math.round((1 - newM.crossings / oldM.crossings) * 100) : 0;
  console.log(`\n[${name}] ${g.nodes.length} nodes, ${g.links.length} edges  (${ms}ms, ${res.meta.components} comp, ${res.meta.communities} comm, strat=${res.meta.primaryStrategy})`);
  console.log(`   OLD force : crossings=${oldM.crossings}  overlaps=${oldM.overlaps}  edgeLenCV=${oldM.cv}`);
  console.log(`   NEW pipe  : crossings=${newM.crossings}  overlaps=${newM.overlaps}  edgeLenCV=${newM.cv}   (crossings ${impCross >= 0 ? '-' : '+'}${Math.abs(impCross)}%)`);
}

// ---- run across all cached indexes ----
const dir = path.join(os.homedir(), '.repo-intel-cache/indexes');
const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
console.log('=== Phase 7 layout quality benchmark ===');
for (const f of ids) {
  let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  const label = ((d.source && d.source.input) || d.manifest.root || f).replace(/^.*\//, '').replace(/\.git$/, '');
  console.log(`\n########## ${label} (${f.replace('.json','')}) ##########`);
  bench('Architecture: layers', layerGraph(d));
  bench('Architecture: modules', moduleGraph(d));
  bench('Dependency graph (files)', fileDepGraph(d, 400));
  const sg = systemGraph(d); if (sg) bench('Repository Map: systems', sg);
}
console.log('\n=== done ===');
