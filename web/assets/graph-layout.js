/* graph-layout.js — Phase 7 Intelligent Graph Layout Engine.
 *
 * A dependency-free, deterministic, multi-stage layout pipeline that turns a
 * node/link graph into positions that read like an architect's diagram instead
 * of scattered circles. Pure computation: no DOM. Works in the browser
 * (window.GraphLayout) and in Node (module.exports) so it can be unit-tested and
 * scored with objective quality metrics.
 *
 * Pipeline (each stage is an independent function):
 *   1. build adjacency
 *   2. detect connected components
 *   3. detect communities (label propagation)  [used as layout hints]
 *   4. choose a layout strategy per component from its characteristics
 *   5. compute a local layout for each component
 *   6. remove node overlaps (respecting node radius)
 *   7. pack components (bounding-box shelf packing)
 *   8. center the whole graph
 * The renderer then routes edges + animates the transition.
 *
 * Everything is seeded so the same graph yields a near-identical layout across
 * runs (layout stability), and small changes cause only local rearrangement.
 */
(function () {
  'use strict';
  var GraphLayoutModule = (function () {

  // ---------- deterministic RNG (mulberry32) ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Stable string hash -> int seed (so a given node-id set always seeds the same)
  function hashSeed(strs) {
    let h = 2166136261;
    for (const s of strs) {
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
    return h >>> 0;
  }

  // ---------- adjacency ----------
  function buildAdj(nodes, links) {
    const idx = new Map();
    nodes.forEach((n, i) => idx.set(n.id, i));
    const adj = nodes.map(() => []);
    const undirAdj = nodes.map(() => new Set());
    const indeg = nodes.map(() => 0), outdeg = nodes.map(() => 0);
    const edges = [];
    for (const l of links) {
      const s = idx.get(l.source), t = idx.get(l.target);
      if (s == null || t == null || s === t) continue;
      adj[s].push(t);
      undirAdj[s].add(t); undirAdj[t].add(s);
      outdeg[s]++; indeg[t]++;
      edges.push({ s, t, w: l.weight || 1 });
    }
    return { idx, adj, undirAdj, indeg, outdeg, edges };
  }

  // ---------- 1. connected components (undirected) ----------
  function components(nodes, undirAdj) {
    const comp = new Array(nodes.length).fill(-1);
    const groups = [];
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i] !== -1) continue;
      const g = [], stack = [i]; comp[i] = groups.length;
      while (stack.length) {
        const v = stack.pop(); g.push(v);
        for (const u of undirAdj[v]) if (comp[u] === -1) { comp[u] = groups.length; stack.push(u); }
      }
      groups.push(g);
    }
    return { comp, groups };
  }

  // ---------- 2. community detection (label propagation, seeded + deterministic) ----------
  function communities(nodes, undirAdj, seed) {
    const n = nodes.length;
    const label = new Array(n);
    for (let i = 0; i < n; i++) label[i] = i;
    const order = [...Array(n).keys()];
    const rand = rng(seed);
    // shuffle deterministically
    for (let i = n - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    let changed = true, iter = 0;
    while (changed && iter < 12) {
      changed = false; iter++;
      for (const v of order) {
        const neigh = undirAdj[v]; if (!neigh.size) continue;
        const count = new Map();
        for (const u of neigh) count.set(label[u], (count.get(label[u]) || 0) + 1);
        // pick the most frequent label; ties broken by smallest label (deterministic)
        let best = label[v], bestC = -1;
        for (const [lab, c] of count) { if (c > bestC || (c === bestC && lab < best)) { best = lab; bestC = c; } }
        if (best !== label[v]) { label[v] = best; changed = true; }
      }
    }
    // renumber compactly
    const remap = new Map(); let k = 0;
    for (let i = 0; i < n; i++) { if (!remap.has(label[i])) remap.set(label[i], k++); label[i] = remap.get(label[i]); }
    return { label, count: k };
  }

  // ---------- degree / pagerank importance ----------
  function pagerank(n, adj, indeg, iters) {
    let pr = new Array(n).fill(1 / Math.max(n, 1));
    const d = 0.85;
    for (let it = 0; it < (iters || 24); it++) {
      const next = new Array(n).fill((1 - d) / Math.max(n, 1));
      for (let v = 0; v < n; v++) {
        const out = adj[v];
        if (out.length) { const share = (d * pr[v]) / out.length; for (const u of out) next[u] += share; }
        else { const share = (d * pr[v]) / Math.max(n, 1); for (let u = 0; u < n; u++) next[u] += share; }
      }
      pr = next;
    }
    return pr;
  }

  // ---------- graph classification for a component ----------
  function classify(sub) {
    // sub: {nodes(local ids), localEdges:[{s,t}], indeg,outdeg (global maps via array), degree}
    const n = sub.n, m = sub.m;
    if (n <= 1) return 'point';
    if (n <= 4 && m <= n) return 'circle';
    // tree: connected with exactly n-1 edges (undirected, no cycles)
    if (m === n - 1) return 'tree';
    // dominant hub -> radial
    const maxDeg = Math.max(...sub.degree);
    if (maxDeg >= n * 0.55 && n >= 5) return 'radial';
    // DAG-ish + not too dense -> hierarchical (layered)
    if (sub.isDAG && m <= n * 3) return 'hierarchical';
    // small/medium sparse -> hierarchical gives cleaner reading than force
    if (n <= 40 && m <= n * 2 && sub.isDAG) return 'hierarchical';
    return 'force';
  }

  // detect DAG via Kahn's algorithm on the component's directed edges
  function isDAG(n, localAdj) {
    const indeg = new Array(n).fill(0);
    for (let v = 0; v < n; v++) for (const u of localAdj[v]) indeg[u]++;
    const q = []; for (let v = 0; v < n; v++) if (indeg[v] === 0) q.push(v);
    let seen = 0;
    while (q.length) { const v = q.shift(); seen++; for (const u of localAdj[v]) if (--indeg[u] === 0) q.push(u); }
    return seen === n;
  }

  // ---------- local layouts (return {x,y} in local coords, radius-aware spacing) ----------
  function layoutPoint(sub) { sub.pos = [[0, 0]]; }

  function layoutCircle(sub, seed) {
    const n = sub.n;
    // Order nodes so graph-adjacent nodes sit next to each other on the ring
    // (a cheap crossing-reduction: BFS order from the highest-degree node).
    let start = 0; for (let v = 1; v < n; v++) if (sub.degree[v] > sub.degree[start]) start = v;
    const seen = new Array(n).fill(false); const order = []; const q = [start]; seen[start] = true;
    while (q.length) { const v = q.shift(); order.push(v); const nb = [...sub.undir[v]].sort((a, b) => sub.degree[b] - sub.degree[a]); for (const u of nb) if (!seen[u]) { seen[u] = true; q.push(u); } }
    for (let v = 0; v < n; v++) if (!seen[v]) order.push(v);
    const R = Math.max(70, (n * sub.avgR * 1.5) / Math.PI);
    sub.pos = new Array(n);
    order.forEach((v, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; sub.pos[v] = [Math.cos(a) * R, Math.sin(a) * R]; });
  }

  // rooted tree / BFS layering, ordered to reduce crossings
  function layoutTree(sub, dir) {
    const n = sub.n, adj = sub.undir;
    // root = max-degree node (usually the hub of the tree)
    let root = 0; for (let v = 1; v < n; v++) if (sub.degree[v] > sub.degree[root]) root = v;
    const depth = new Array(n).fill(-1), parent = new Array(n).fill(-1), order = [];
    depth[root] = 0; const q = [root];
    while (q.length) { const v = q.shift(); order.push(v); for (const u of adj[v]) if (depth[u] === -1) { depth[u] = depth[v] + 1; parent[u] = v; q.push(u); } }
    return layerAssign(sub, depth, parent, dir);
  }

  // hierarchical (Sugiyama-lite): longest-path layering + barycenter ordering
  function layoutHierarchical(sub, dir) {
    const n = sub.n, ladj = sub.ladj;
    // longest-path layering on the DAG (fallback: BFS if cyclic remnants)
    const layer = new Array(n).fill(0);
    const indeg = new Array(n).fill(0);
    for (let v = 0; v < n; v++) for (const u of ladj[v]) indeg[u]++;
    const q = []; for (let v = 0; v < n; v++) if (indeg[v] === 0) q.push(v);
    const ind2 = indeg.slice();
    let processed = 0;
    while (q.length) {
      const v = q.shift(); processed++;
      for (const u of ladj[v]) { layer[u] = Math.max(layer[u], layer[v] + 1); if (--ind2[u] === 0) q.push(u); }
    }
    if (processed < n) { // had cycles: fall back to BFS depth from min-indeg node
      const depth = bfsDepth(sub);
      for (let v = 0; v < n; v++) layer[v] = depth[v];
    }
    const parent = new Array(n).fill(-1);
    for (let v = 0; v < n; v++) for (const u of ladj[v]) if (parent[u] === -1 && layer[u] === layer[v] + 1) parent[u] = v;
    return layerAssign(sub, layer, parent, dir);
  }

  function bfsDepth(sub) {
    const n = sub.n, adj = sub.undir;
    let root = 0; for (let v = 1; v < n; v++) if (sub.degree[v] > sub.degree[root]) root = v;
    const depth = new Array(n).fill(0), seen = new Array(n).fill(false); seen[root] = true;
    const q = [root]; while (q.length) { const v = q.shift(); for (const u of adj[v]) if (!seen[u]) { seen[u] = true; depth[u] = depth[v] + 1; q.push(u); } }
    return depth;
  }

  // shared: place nodes in layers, order each layer by barycenter of parents to cut crossings
  function layerAssign(sub, layerOf, parent, dir) {
    const n = sub.n;
    const layers = {};
    for (let v = 0; v < n; v++) (layers[layerOf[v]] = layers[layerOf[v]] || []).push(v);
    const keys = Object.keys(layers).map(Number).sort((a, b) => a - b);
    const gapY = Math.max(90, sub.avgR * 4.2);
    const gapX = Math.max(80, sub.avgR * 3.4);
    // barycenter ordering: 2 sweeps
    const posInLayer = new Array(n).fill(0);
    keys.forEach((k) => layers[k].forEach((v, i) => posInLayer[v] = i));
    for (let sweep = 0; sweep < 4; sweep++) {
      for (const k of keys) {
        const arr = layers[k];
        arr.sort((a, b) => bary(a) - bary(b));
        arr.forEach((v, i) => posInLayer[v] = i);
      }
    }
    function bary(v) {
      // average index of neighbors in adjacent layers
      let sum = 0, c = 0;
      for (const u of sub.undir[v]) { if (Math.abs(layerOf[u] - layerOf[v]) === 1) { sum += posInLayer[u]; c++; } }
      return c ? sum / c : posInLayer[v];
    }
    sub.pos = new Array(n);
    keys.forEach((k) => {
      const arr = layers[k];
      const width = (arr.length - 1) * gapX;
      arr.forEach((v, i) => {
        const across = i * gapX - width / 2;
        const along = k * gapY;
        // dir: 'TB' top-to-bottom (default) or 'LR' left-to-right
        if (dir === 'LR') sub.pos[v] = [along, across];
        else sub.pos[v] = [across, along];
      });
    });
    sub.layers = keys.map((k) => ({ layer: k, members: layers[k].slice() }));
  }

  // radial / concentric: hub in center, others on rings by distance
  function layoutRadial(sub) {
    const n = sub.n;
    let hub = 0; for (let v = 1; v < n; v++) if (sub.degree[v] > sub.degree[hub]) hub = v;
    const dist = new Array(n).fill(-1); dist[hub] = 0;
    const q = [hub]; while (q.length) { const v = q.shift(); for (const u of sub.undir[v]) if (dist[u] === -1) { dist[u] = dist[v] + 1; q.push(u); } }
    for (let v = 0; v < n; v++) if (dist[v] === -1) dist[v] = 1; // disconnected-within (shouldn't happen post-component)
    const rings = {};
    for (let v = 0; v < n; v++) (rings[dist[v]] = rings[dist[v]] || []).push(v);
    sub.pos = new Array(n);
    const ringGap = Math.max(90, sub.avgR * 4);
    Object.keys(rings).map(Number).sort((a, b) => a - b).forEach((d) => {
      const arr = rings[d];
      if (d === 0) { sub.pos[arr[0]] = [0, 0]; return; }
      const R = d * ringGap;
      arr.forEach((v, i) => { const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2; sub.pos[v] = [Math.cos(a) * R, Math.sin(a) * R]; });
    });
  }

  // force-directed (Fruchterman-Reingold) with community attraction, seeded
  function layoutForce(sub, seed, communityOf, salt) {
    const n = sub.n, edges = sub.localEdges;
    const rand = rng(seed);
    const area = n * 9000;
    const k = Math.sqrt(area / n) * 0.9;
    const pos = sub.pos = new Array(n);
    const vel = new Array(n);
    // Seed each node from its OWN id hash (+ a restart salt), NOT the global graph
    // seed. So a node starts in the same place regardless of what other nodes
    // exist -> layout STABILITY: adding/removing nodes elsewhere doesn't
    // re-randomize the rest. The salt lets multi-restart still explore variants.
    const ids = sub.ids || null;
    const saltStr = salt != null ? String(salt) : '';
    for (let i = 0; i < n; i++) {
      const c = communityOf ? communityOf[i] : 0;
      const ca = (c * 2.399963); // golden-angle spread per community
      const nodeRand = ids ? rng(hashSeed([ids[i], saltStr])) : rand;
      const rr = 40 + nodeRand() * Math.sqrt(area) * 0.4;
      const a1 = nodeRand() * 6.28318;
      pos[i] = [Math.cos(ca) * 120 + Math.cos(a1) * rr, Math.sin(ca) * 120 + Math.sin(a1) * rr];
      vel[i] = [0, 0];
    }
    const iters = n > 400 ? 200 : n > 120 ? 300 : 420;
    for (let it = 0; it < iters; it++) {
      const t = (1 - it / iters);
      const temp = k * (0.1 + 0.9 * t * t);
      // repulsion (grid-bucketed for large n)
      if (n > 180) repulseGrid(pos, vel, n, k);
      else {
        for (let i = 0; i < n; i++) {
          let fx = 0, fy = 0;
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            let dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1];
            let d2 = dx * dx + dy * dy; if (d2 < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 0.01; }
            const d = Math.sqrt(d2); const rep = (k * k) / d;
            fx += (dx / d) * rep; fy += (dy / d) * rep;
          }
          vel[i][0] += fx; vel[i][1] += fy;
        }
      }
      // attraction along edges
      for (const e of edges) {
        let dx = pos[e.s][0] - pos[e.t][0], dy = pos[e.s][1] - pos[e.t][1];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const att = (d * d) / k * Math.min(e.w, 4) * 0.02;
        const fx = (dx / d) * att, fy = (dy / d) * att;
        vel[e.s][0] -= fx; vel[e.s][1] -= fy; vel[e.t][0] += fx; vel[e.t][1] += fy;
      }
      // mild community cohesion
      if (communityOf) {
        for (let i = 0; i < n; i++) {
          // pull toward community centroid computed cheaply every few iters
        }
      }
      // integrate w/ cooling
      for (let i = 0; i < n; i++) {
        let vx = vel[i][0], vy = vel[i][1];
        const sp = Math.sqrt(vx * vx + vy * vy) || 0.01;
        const lim = Math.min(sp, temp) / sp;
        pos[i][0] += vx * lim; pos[i][1] += vy * lim;
        vel[i][0] *= 0.85; vel[i][1] *= 0.85;
      }
    }
  }

  // grid-bucketed repulsion for large graphs (approximate, O(n) per iter)
  function repulseGrid(pos, vel, n, k) {
    const cell = k * 1.6;
    const buckets = new Map();
    const key = (cx, cy) => cx + ',' + cy;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i][0] / cell), cy = Math.floor(pos[i][1] / cell);
      const kk = key(cx, cy); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(i);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i][0] / cell), cy = Math.floor(pos[i][1] / cell);
      let fx = 0, fy = 0;
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
        const arr = buckets.get(key(cx + gx, cy + gy)); if (!arr) continue;
        for (const j of arr) {
          if (i === j) continue;
          let dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1];
          let d2 = dx * dx + dy * dy; if (d2 < 0.01) { dx = 0.1; dy = 0.1; d2 = 0.02; }
          if (d2 > cell * cell * 4) continue;
          const d = Math.sqrt(d2); const rep = (k * k) / d;
          fx += (dx / d) * rep; fy += (dy / d) * rep;
        }
      }
      vel[i][0] += fx; vel[i][1] += fy;
    }
  }

  // run a force layout with an explicit restart salt (multi-restart on small graphs)
  function runForceSeed(sub, seed, communityOf, salt) {
    const s2 = Object.assign({}, sub);
    layoutForce(s2, seed, communityOf, salt);
    return s2.pos;
  }

  // ---------- 6. overlap removal (iterative, radius-aware) ----------
  function removeOverlaps(pos, radii, iters) {
    const n = pos.length;
    for (let it = 0; it < (iters || 40); it++) {
      let moved = false;
      // spatial hash
      const cell = 80; const buckets = new Map();
      for (let i = 0; i < n; i++) { const cx = Math.floor(pos[i][0] / cell), cy = Math.floor(pos[i][1] / cell); const k = cx + ',' + cy; (buckets.get(k) || buckets.set(k, []).get(k)).push(i); }
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(pos[i][0] / cell), cy = Math.floor(pos[i][1] / cell);
        for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
          const arr = buckets.get((cx + gx) + ',' + (cy + gy)); if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            let dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
            let d = Math.sqrt(dx * dx + dy * dy);
            const min = radii[i] + radii[j] + 14;
            if (d < min) {
              if (d < 0.01) { dx = (i % 2 ? 1 : -1); dy = 1; d = 1; }
              const push = (min - d) / 2;
              const ux = dx / d, uy = dy / d;
              pos[i][0] -= ux * push; pos[i][1] -= uy * push;
              pos[j][0] += ux * push; pos[j][1] += uy * push;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
  }

  function bbox(pos, radii) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.length; i++) {
      minX = Math.min(minX, pos[i][0] - radii[i]); minY = Math.min(minY, pos[i][1] - radii[i]);
      maxX = Math.max(maxX, pos[i][0] + radii[i]); maxY = Math.max(maxY, pos[i][1] + radii[i]);
    }
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // ---------- 7. shelf packing of component bounding boxes ----------
  function packComponents(boxes, targetAspect) {
    // sort by height desc, place on shelves; target roughly targetAspect (w/h)
    const gap = 60;
    const order = boxes.map((b, i) => i).sort((a, b) => boxes[b].h - boxes[a].h);
    const totalArea = boxes.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
    const maxW = Math.max(Math.sqrt(totalArea * (targetAspect || 1.3)), ...boxes.map((b) => b.w)) + gap;
    let x = 0, y = 0, shelfH = 0;
    const place = {};
    for (const i of order) {
      const b = boxes[i];
      if (x > 0 && x + b.w > maxW) { x = 0; y += shelfH + gap; shelfH = 0; }
      place[i] = { dx: x - b.minX, dy: y - b.minY };
      x += b.w + gap; shelfH = Math.max(shelfH, b.h);
    }
    return place;
  }

  // ---------- local layout quality (crossings + edge-length consistency) ----------
  // Operates on local [x,y] arrays + local edges {s,t}. Used to pick the best
  // candidate strategy per component. Crossing count is capped for speed.
  function localQuality(pos, edges, radii) {
    const m = edges.length;
    let crossings = 0;
    if (m <= 400) {
      for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
        const e1 = edges[i], e2 = edges[j];
        if (e1.s === e2.s || e1.s === e2.t || e1.t === e2.s || e1.t === e2.t) continue;
        if (segX(pos[e1.s], pos[e1.t], pos[e2.s], pos[e2.t])) crossings++;
      }
    } else {
      // sample for large components
      const step = Math.ceil(m / 60);
      for (let i = 0; i < m; i += step) for (let j = i + step; j < m; j += step) {
        const e1 = edges[i], e2 = edges[j];
        if (e1.s === e2.s || e1.s === e2.t || e1.t === e2.s || e1.t === e2.t) continue;
        if (segX(pos[e1.s], pos[e1.t], pos[e2.s], pos[e2.t])) crossings++;
      }
    }
    // edge-length CV (consistency = symmetry proxy)
    let sum = 0; const lens = [];
    for (const e of edges) { const d = Math.hypot(pos[e.s][0] - pos[e.t][0], pos[e.s][1] - pos[e.t][1]); lens.push(d); sum += d; }
    const avg = m ? sum / m : 1;
    const cv = avg ? Math.sqrt(lens.reduce((a, d) => a + (d - avg) ** 2, 0) / m) / avg : 0;
    // combined score: crossings dominate, edge-length inconsistency is a tie-breaker
    const score = crossings * 10 + cv * 5;
    return { crossings, cv, score };
  }
  function segX(p1, p2, p3, p4) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  // ---------- MAIN ----------
  function layout(nodesIn, linksIn, opts) {
    opts = opts || {};
    const nodes = nodesIn.map((n) => ({ id: n.id, r: n.r || 8 }));
    const A = buildAdj(nodes, linksIn || []);
    const seed = opts.seed != null ? opts.seed : hashSeed(nodes.map((n) => n.id));
    const { comp, groups } = components(nodes, A.undirAdj);
    const community = communities(nodes, A.undirAdj, seed);
    const degree = nodes.map((_, i) => A.undirAdj[i].size);
    const pr = pagerank(nodes.length, A.adj, A.indeg, 20);

    // per-component layout
    const compBoxes = [], compData = [];
    groups.forEach((g, gi) => {
      const localIndex = new Map(); g.forEach((globalI, li) => localIndex.set(globalI, li));
      const nLocal = g.length;
      const undir = Array.from({ length: nLocal }, () => []);
      const ladj = Array.from({ length: nLocal }, () => []);
      const localEdges = [];
      for (const e of A.edges) {
        if (comp[e.s] !== gi) continue;
        const ls = localIndex.get(e.s), lt = localIndex.get(e.t);
        ladj[ls].push(lt);
        undir[ls].push(lt); undir[lt].push(ls);
        localEdges.push({ s: ls, t: lt, w: e.w });
      }
      const degLocal = undir.map((a) => a.length);
      const radii = g.map((gI) => nodes[gI].r);
      const avgR = radii.reduce((s, r) => s + r, 0) / Math.max(radii.length, 1);
      const commLocal = g.map((gI) => community.label[gI]);
      const sub = {
        n: nLocal, m: localEdges.length, undir, ladj, localEdges, degree: degLocal,
        avgR, isDAG: isDAG(nLocal, ladj), ids: g.map((gI) => nodes[gI].id),
      };
      const forcedStrategy = opts.strategy && opts.strategy !== 'auto' ? opts.strategy : null;
      const dir = opts.direction || (opts.hint === 'flow' ? 'LR' : 'TB');
      const run = (strat) => {
        const s2 = Object.assign({}, sub);
        switch (strat) {
          case 'point': layoutPoint(s2); break;
          case 'circle': layoutCircle(s2, seed + gi); break;
          case 'tree': layoutTree(s2, dir); break;
          case 'radial': layoutRadial(s2); break;
          case 'hierarchical': layoutHierarchical(s2, dir); break;
          default: layoutForce(s2, seed + gi, commLocal); break;
        }
        return s2.pos;
      };
      // Metric-driven auto-selection: run the plausible candidate strategies for
      // this component's size/shape, then keep the one with the best quality
      // (fewest crossings, then most consistent edge lengths). This is what makes
      // the engine "choose the best layout" instead of a fixed heuristic.
      let strat, pos;
      if (forcedStrategy) { strat = forcedStrategy; pos = run(forcedStrategy); }
      else if (nLocal <= 1) { strat = 'point'; pos = run('point'); }
      else {
        let candidates;
        if (nLocal <= 2) candidates = ['circle'];
        else if (nLocal > 260) candidates = ['force']; // too big to try many; force is fine + fast
        else {
          candidates = ['circle', 'force'];
          if (sub.m === nLocal - 1) candidates.push('tree');           // it's a tree
          if (sub.isDAG) candidates.push('hierarchical');              // clean layering possible
          const maxDeg = Math.max.apply(null, sub.degree);
          if (maxDeg >= nLocal * 0.5) candidates.push('radial');       // hub-and-spoke
          // small graphs: cheap to explore extra force restarts for a better minimum
          if (nLocal <= 24) candidates.push('force2', 'force3', 'radial');
        }
        let best = null;
        for (const c of candidates) {
          const p = c === 'force2' ? runForceSeed(sub, seed + gi, commLocal, 'r2')
                  : c === 'force3' ? runForceSeed(sub, seed + gi, commLocal, 'r3')
                  : run(c);
          const q = localQuality(p, sub.localEdges, radii);
          if (!best || q.score < best.q.score) best = { strat: (c === 'force2' || c === 'force3') ? 'force' : c, pos: p, q };
        }
        strat = best.strat; pos = best.pos;
      }
      sub.pos = pos;
      // overlap removal within component
      removeOverlaps(sub.pos, radii, strat === 'force' ? 60 : 30);
      const box = bbox(sub.pos, radii);
      compBoxes.push(box);
      compData.push({ g, sub, radii, strat, box });
    });

    // pack components
    const place = packComponents(compBoxes, opts.aspect || (opts.width && opts.height ? opts.width / opts.height : 1.4));

    // assemble final positions
    const out = new Array(nodes.length);
    compData.forEach((cd, gi) => {
      const p = place[gi];
      cd.g.forEach((globalI, li) => {
        out[globalI] = { x: cd.sub.pos[li][0] + p.dx, y: cd.sub.pos[li][1] + p.dy };
      });
    });

    // center around origin
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < out.length; i++) {
      const r = nodes[i].r;
      minX = Math.min(minX, out[i].x - r); minY = Math.min(minY, out[i].y - r);
      maxX = Math.max(maxX, out[i].x + r); maxY = Math.max(maxY, out[i].y + r);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (let i = 0; i < out.length; i++) { out[i].x -= cx; out[i].y -= cy; }

    return {
      positions: nodesIn.map((n, i) => ({ id: n.id, x: out[i].x, y: out[i].y })),
      meta: {
        components: groups.length,
        communities: community.count,
        communityOf: nodesIn.map((n, i) => community.label[i]),
        pagerank: nodesIn.map((n, i) => pr[i]),
        degree: nodesIn.map((n, i) => degree[i]),
        strategies: compData.map((c) => c.strat),
        primaryStrategy: compData.length ? compData.sort((a, b) => b.g.length - a.g.length)[0].strat : 'none',
        bbox: { w: maxX - minX, h: maxY - minY },
        seed,
      },
    };
  }

  // ---------- quality metrics (for auto-selection + tests) ----------
  function metrics(positions, links, radii) {
    const pos = new Map(positions.map((p) => [p.id, p]));
    const R = radii || {};
    // edge crossings (segment intersection count, sampled/capped for large graphs)
    let crossings = 0;
    const segs = links.map((l) => ({ a: pos.get(l.source), b: pos.get(l.target) })).filter((s) => s.a && s.b);
    const cap = 1200; // avoid O(E^2) blowup on huge graphs
    if (segs.length <= cap) {
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++)
          if (segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) crossings++;
    } else crossings = -1;
    // average edge length + stdev (symmetry proxy)
    let sum = 0; const lens = [];
    for (const s of segs) { const d = Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y); lens.push(d); sum += d; }
    const avgLen = segs.length ? sum / segs.length : 0;
    const varLen = segs.length ? lens.reduce((a, d) => a + (d - avgLen) ** 2, 0) / segs.length : 0;
    // node overlaps
    let overlaps = 0; const ps = positions;
    if (ps.length <= 2000) {
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const ri = R[ps[i].id] || 8, rj = R[ps[j].id] || 8;
        if (Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) < ri + rj - 1) overlaps++;
      }
    } else overlaps = -1;
    return { crossings, avgEdgeLength: Math.round(avgLen), edgeLengthCV: avgLen ? Math.sqrt(varLen) / avgLen : 0, nodeOverlaps: overlaps, edges: segs.length };
  }

  function segIntersect(p1, p2, p3, p4) {
    // ignore edges that share an endpoint
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  return { layout, metrics, _internal: { components, communities, classify, pagerank } };
  })();
  if (typeof module !== 'undefined' && module.exports) module.exports = GraphLayoutModule;
  if (typeof window !== 'undefined') window.GraphLayout = GraphLayoutModule;
  if (typeof self !== 'undefined') self.GraphLayout = GraphLayoutModule;
})();
