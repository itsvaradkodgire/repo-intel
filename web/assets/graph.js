/* graph.js — self-contained SVG graph renderer (no dependencies).
 * Supports: force-directed OR fixed layered layout, zoom/pan (wheel + drag),
 * node drag, click callback, neighbor highlighting, and expand/collapse hooks.
 * Everything runs offline. */
(function () {
  'use strict';

  function el(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Simple force simulation (Fruchterman-Reingold-ish), deterministic seed.
  function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function simulate(nodes, links, opts) {
    opts = opts || {};
    const W = opts.width || 1000;
    const H = opts.height || 700;
    const rand = seededRandom(1234);
    const byId = {};
    nodes.forEach((n, i) => {
      if (n.x == null) n.x = W / 2 + (rand() - 0.5) * W * 0.8;
      if (n.y == null) n.y = H / 2 + (rand() - 0.5) * H * 0.8;
      n.vx = 0;
      n.vy = 0;
      byId[n.id] = n;
    });
    const edges = links
      .map((l) => ({ s: byId[l.source], t: byId[l.target], w: l.weight || 1 }))
      .filter((e) => e.s && e.t);

    const k = opts.k || Math.sqrt((W * H) / Math.max(nodes.length, 1)) * 0.75;
    const iters = opts.iters || 300;
    for (let it = 0; it < iters; it++) {
      const temp = 0.1 * (1 - it / iters) + 0.005;
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        let fx = 0,
          fy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const b = nodes[j];
          let dx = a.x - b.x,
            dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = rand() - 0.5;
            dy = rand() - 0.5;
            d2 = 0.01;
          }
          const d = Math.sqrt(d2);
          const rep = (k * k) / d;
          fx += (dx / d) * rep;
          fy += (dy / d) * rep;
        }
        a.vx = (a.vx + fx) * 0.9;
        a.vy = (a.vy + fy) * 0.9;
      }
      // attraction
      for (const e of edges) {
        let dx = e.s.x - e.t.x,
          dy = e.s.y - e.t.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const att = (d * d) / k * Math.min(e.w, 4) * 0.4;
        const fx = (dx / d) * att,
          fy = (dy / d) * att;
        e.s.vx -= fx;
        e.s.vy -= fy;
        e.t.vx += fx;
        e.t.vy += fy;
      }
      // integrate
      for (const n of nodes) {
        if (n.fixed) continue;
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 0.01;
        const lim = Math.min(speed, temp * 1000) / speed;
        n.x += n.vx * lim;
        n.y += n.vy * lim;
        n.x = Math.max(40, Math.min(W - 40, n.x));
        n.y = Math.max(40, Math.min(H - 40, n.y));
      }
    }
    return { nodes, edges: links, byId };
  }

  function Graph(container, config) {
    const W = container.clientWidth || 1000;
    const H = container.clientHeight || 700;
    const svg = el('svg', { width: '100%', height: '100%', viewBox: `0 0 ${W} ${H}` });
    svg.style.display = 'block';
    svg.style.cursor = 'grab';
    container.innerHTML = '';
    container.appendChild(svg);

    const defs = el('defs');
    const marker = el('marker', {
      id: 'arrow',
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '7',
      markerHeight: '7',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#6b7a90' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const root = el('g');
    svg.appendChild(root);
    const edgeLayer = el('g');
    const nodeLayer = el('g');
    root.appendChild(edgeLayer);
    root.appendChild(nodeLayer);

    let transform = { x: 0, y: 0, s: 1 };
    function applyTransform() {
      root.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.s})`);
      if (typeof scheduleLOD === 'function') scheduleLOD();
    }

    // pan
    let panning = false,
      panStart = null;
    svg.addEventListener('mousedown', (e) => {
      if (e.target.closest('.gnode')) return;
      panning = true;
      panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
      svg.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (panning) {
        transform.x = e.clientX - panStart.x;
        transform.y = e.clientY - panStart.y;
        applyTransform();
      }
    });
    window.addEventListener('mouseup', () => {
      panning = false;
      svg.style.cursor = 'grab';
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left,
        my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.max(0.1, Math.min(6, transform.s * delta));
      transform.x = mx - ((mx - transform.x) * ns) / transform.s;
      transform.y = my - ((my - transform.y) * ns) / transform.s;
      transform.s = ns;
      applyTransform();
    }, { passive: false });

    const api = {
      svg,
      render,
      fit,
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
      reset: () => { transform = { x: 0, y: 0, s: 1 }; applyTransform(); },
      // Phase 7 interaction API
      focus: (id) => { if (state && state.highlight) state.highlight(id); if (id) fitSelection([id], 2.2); },
      highlight: (id) => { if (state && state.highlight) state.highlight(id); },
      fitSelection: fitSelection,
      relayout: () => { if (state) render({ nodes: state.nodes, links: state.links, directed: state.directed }); },
    };

    // fit the viewport to a subset of nodes (focus mode), animated
    function fitSelection(ids, maxScale) {
      if (!state || !state.nodes.length) return;
      const set = new Set(ids || []);
      const ns = state.nodes.filter((n) => set.has(n.id));
      const use = ns.length ? ns : state.nodes;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of use) { const r = n.r || 8; minX = Math.min(minX, n.x - r); minY = Math.min(minY, n.y - r); maxX = Math.max(maxX, n.x + r); maxY = Math.max(maxY, n.y + r); }
      const pad = 90; const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
      const s = Math.min(W / bw, H / bh, maxScale || 2);
      animateTo({ s, x: (W - (minX + maxX) * s) / 2, y: (H - (minY + maxY) * s) / 2 });
    }

    // smooth transform animation (avoids sudden jumps)
    let animRAF = null;
    function animateTo(target) {
      if (animRAF) cancelAnimationFrame(animRAF);
      const from = { x: transform.x, y: transform.y, s: transform.s };
      const t0 = performance.now(), dur = 480;
      const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      function step(now) {
        const p = Math.min((now - t0) / dur, 1), e = ease(p);
        transform.x = from.x + (target.x - from.x) * e;
        transform.y = from.y + (target.y - from.y) * e;
        transform.s = from.s + (target.s - from.s) * e;
        root.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.s})`);
        if (p < 1) animRAF = requestAnimationFrame(step); else { animRAF = null; scheduleLOD(); }
      }
      animRAF = requestAnimationFrame(step);
    }

    function zoomBy(f) {
      transform.s = Math.max(0.1, Math.min(6, transform.s * f));
      applyTransform();
    }

    let state = null;

    function render(data) {
      // data: { nodes:[{id,label,color,r,layer,x?,y?,fixed?}], links:[{source,target,weight}], layered? }
      edgeLayer.innerHTML = '';
      nodeLayer.innerHTML = '';
      const nodes = data.nodes.map((n) => Object.assign({}, n));
      const links = data.links;
      const prevPos = state && state.byId ? state.byId : null; // for animated transitions

      if (data.layered) {
        // Preserve the hand-tuned layered (architecture) layout.
        layoutLayered(nodes, data.layerOrder, W, H);
      } else if (window.GraphLayout) {
        // Phase 7: intelligent multi-stage layout pipeline.
        const res = window.GraphLayout.layout(
          nodes.map((n) => ({ id: n.id, r: n.r || 8 })), links,
          { width: W, height: H, hint: data.hint, strategy: data.strategy, direction: data.direction }
        );
        const pm = {}; res.positions.forEach((p) => pm[p.id] = p);
        nodes.forEach((n) => { const p = pm[n.id]; if (p) { n.x = p.x + W / 2; n.y = p.y + H / 2; } });
        // expose importance so the renderer can size labels / prioritize
        state = state || {};
        state.meta = res.meta;
      } else {
        // Fallback: legacy single-pass force (should not happen; layout engine always loaded).
        simulate(nodes, links, { width: W, height: H, iters: data.iters || 300, k: data.k });
      }
      const byId = idMap(nodes);
      state = { nodes, links, byId, meta: (state && state.meta) || null, directed: data.directed };

      // tier band labels for layered layout
      if (data.layered && layoutLayered._tiers) {
        for (const t of layoutLayered._tiers) {
          const tl = el('text', {
            x: 8, y: t.y + 4, fill: '#5f739a', 'font-size': 12,
            'font-family': 'ui-monospace, monospace', 'font-weight': 700,
          });
          tl.textContent = t.label;
          edgeLayer.appendChild(tl);
        }
      }

      // ----- edges (curved for readability; straight for layered) -----
      const edgeEls = [];
      const curved = !data.layered;
      for (const l of links) {
        const s = byId[l.source], t = byId[l.target];
        if (!s || !t) continue;
        const sw = Math.min(1 + Math.log2((l.weight || 1) + 1) * 0.6, 4);
        let e;
        if (curved) {
          e = el('path', { d: edgePath(s, t), fill: 'none', stroke: '#33415577', 'stroke-width': sw, 'marker-end': data.directed ? 'url(#arrow)' : '' });
        } else {
          e = el('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, stroke: '#33415577', 'stroke-width': sw, 'marker-end': data.directed ? 'url(#arrow)' : '' });
        }
        e.dataset.s = l.source; e.dataset.t = l.target; e.dataset.curved = curved ? '1' : '';
        edgeLayer.appendChild(e);
        edgeEls.push(e);
      }

      const nodeEls = {};
      const labelEls = [];
      const meta = state.meta;
      for (let ni = 0; ni < nodes.length; ni++) {
        const n = nodes[ni];
        // animate from previous position if it existed (smooth perspective/filter change)
        const from = prevPos && prevPos[n.id] ? prevPos[n.id] : null;
        const startX = from ? from.x : n.x, startY = from ? from.y : n.y;
        const g = el('g', { class: 'gnode', transform: `translate(${startX},${startY})` });
        g.style.cursor = 'pointer';
        const r = n.r || 8;
        const circ = el('circle', { r: r, fill: n.color || '#3b82f6', stroke: '#0b1220', 'stroke-width': 1.5 });
        g.appendChild(circ);
        const label = el('text', {
          x: 0, y: r + 12, 'text-anchor': 'middle', fill: '#c9d4e5',
          'font-size': 11, 'font-family': 'ui-monospace, monospace',
          'pointer-events': 'none',
        });
        label.textContent = n.label || n.id;
        label.style.transition = 'opacity .2s';
        g.appendChild(label);
        nodeLayer.appendChild(g);
        nodeEls[n.id] = { g, circ, node: n, label };
        labelEls.push({ node: n, el: label, g });

        // animate to final position
        if (from) { requestAnimationFrame(() => { g.style.transition = 'transform .55s cubic-bezier(.4,0,.2,1)'; g.setAttribute('transform', `translate(${n.x},${n.y})`); }); }

        bindNodeInteraction(g, n, edgeEls);
      }

      state.nodeEls = nodeEls; state.edgeEls = edgeEls; state.labelEls = labelEls;

      function bindNodeInteraction(g, n, edgeEls) {
        let dragging = false, moved = false, start = null;
        g.addEventListener('mousedown', (e) => { e.stopPropagation(); dragging = true; moved = false; start = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y }; });
        window.addEventListener('mousemove', (e) => {
          if (!dragging) return; moved = true; g.style.transition = 'none';
          n.x = start.nx + (e.clientX - start.x) / transform.s;
          n.y = start.ny + (e.clientY - start.y) / transform.s;
          g.setAttribute('transform', `translate(${n.x},${n.y})`);
          updateEdgesFor(n.id);
        });
        window.addEventListener('mouseup', () => { if (dragging && !moved && config.onClick) config.onClick(n); dragging = false; });
        g.addEventListener('mouseenter', () => highlight(n.id));
        g.addEventListener('mouseleave', () => highlight(null));
      }

      function updateEdgesFor(id) {
        for (const e of edgeEls) {
          if (e.dataset.s !== id && e.dataset.t !== id) continue;
          const s = byId[e.dataset.s], t = byId[e.dataset.t];
          if (e.dataset.curved) e.setAttribute('d', edgePath(s, t));
          else { e.setAttribute('x1', s.x); e.setAttribute('y1', s.y); e.setAttribute('x2', t.x); e.setAttribute('y2', t.y); }
        }
      }
      state.updateEdgesFor = updateEdgesFor;

      function highlight(id) {
        const neighbors = new Set();
        if (id) { neighbors.add(id); for (const l of links) { if (l.source === id) neighbors.add(l.target); if (l.target === id) neighbors.add(l.source); } }
        for (const nid in nodeEls) { const dim = id && !neighbors.has(nid); nodeEls[nid].g.style.opacity = dim ? 0.12 : 1; }
        for (const e of edgeEls) {
          if (!id) { e.style.opacity = 1; e.setAttribute('stroke', '#33415577'); continue; }
          const on = e.dataset.s === id || e.dataset.t === id;
          e.style.opacity = on ? 1 : 0.04; e.setAttribute('stroke', on ? '#60a5fa' : '#33415577');
        }
        // when focusing a node, reveal its + neighbors' labels regardless of density
        if (id) { for (const nid in nodeEls) nodeEls[nid].label.style.opacity = neighbors.has(nid) ? 1 : ''; }
        else applyLabelLOD();
      }
      state.highlight = highlight;

      fit();
      applyLabelLOD();
    }

    // ----- curved edge path (quadratic Bezier, gentle arc) -----
    function edgePath(s, t) {
      const dx = t.x - s.x, dy = t.y - s.y;
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      const dist = Math.hypot(dx, dy) || 1;
      // perpendicular offset scaled to distance (subtle arc reduces overlap of parallel edges)
      const off = Math.min(dist * 0.12, 26);
      const cx = mx - (dy / dist) * off, cy = my + (dx / dist) * off;
      return `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
    }

    // ----- smart labels: level-of-detail + collision-based hiding -----
    // Show labels for the most important nodes and hide labels that would collide
    // at the current zoom. Prioritizes larger nodes (importance) and, when zoomed
    // in, reveals more. Never renders unreadable overlapping text.
    function applyLabelLOD() {
      if (!state || !state.labelEls) return;
      const s = transform.s;
      const labels = state.labelEls;
      // priority: bigger radius = more important; keep those first
      const ordered = labels.slice().sort((a, b) => (b.node.r || 8) - (a.node.r || 8));
      // approximate label boxes in screen space, place greedily, hide on collision
      const placed = [];
      const maxLabels = s < 0.4 ? 8 : s < 0.7 ? 18 : s < 1.1 ? 40 : 120;
      let shown = 0;
      for (const L of ordered) {
        if (L.g.style.opacity !== '' && L.g.style.opacity !== '1' && +L.g.style.opacity < 0.5) { L.el.style.opacity = 0; continue; }
        if (shown >= maxLabels) { L.el.style.opacity = 0; continue; }
        const n = L.node;
        const text = (n.label || n.id || '');
        const w = text.length * 6.2 * s, h = 12 * s;
        const cx = (n.x * s + transform.x), cy = ((n.y + (n.r || 8) + 12) * s + transform.y);
        const box = { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
        let collide = false;
        for (const p of placed) { if (!(box.x2 < p.x1 || box.x1 > p.x2 || box.y2 < p.y1 || box.y1 > p.y2)) { collide = true; break; } }
        if (collide) { L.el.style.opacity = 0; }
        else { L.el.style.opacity = 1; placed.push(box); shown++; }
      }
    }
    // recompute label visibility after zoom/pan settles
    let lodTimer = null;
    function scheduleLOD() { if (lodTimer) clearTimeout(lodTimer); lodTimer = setTimeout(applyLabelLOD, 90); }


    function idMap(nodes) {
      const m = {};
      nodes.forEach((n) => (m[n.id] = n));
      return m;
    }

    function layoutLayered(nodes, order, W, H) {
      const layers = {};
      const orderList = order || [...new Set(nodes.map((n) => n.layer))];
      nodes.forEach((n) => {
        const key = n.layer || 'other';
        (layers[key] = layers[key] || []).push(n);
      });
      const present = orderList.filter((l) => layers[l] && layers[l].length);
      // Use a generous virtual canvas so rows never crowd; fit() scales to view.
      const rowH = 130;
      const vW = Math.max(W, 1100);
      present.forEach((layer, li) => {
        const row = layers[layer];
        const colW = (vW - 160) / Math.max(row.length, 1);
        row.forEach((n, ci) => {
          n.x = 120 + colW * ci + colW / 2;
          n.y = 70 + rowH * li;
          n.fixed = true;
          n.tier = layer;
          n.tierFirst = ci === 0;
        });
      });
      // stash tier labels for the renderer
      state && (state.tiers = present.map((l, i) => ({ label: l, y: 70 + rowH * i, x: 24 })));
      layoutLayered._tiers = present.map((l, i) => ({ label: l, y: 70 + rowH * i }));
    }

    function fit() {
      if (!state || !state.nodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of state.nodes) {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
      }
      const pad = 70;
      const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
      const s = Math.min(W / bw, H / bh, 2);
      transform.s = s;
      transform.x = (W - (minX + maxX) * s) / 2;
      transform.y = (H - (minY + maxY) * s) / 2;
      applyTransform();
    }

    return api;
  }

  window.Graph = Graph;
})();
