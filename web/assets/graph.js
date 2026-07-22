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
    };

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

      let sim;
      if (data.layered) {
        layoutLayered(nodes, data.layerOrder, W, H);
        sim = { nodes, byId: idMap(nodes) };
      } else {
        sim = simulate(nodes, links, { width: W, height: H, iters: data.iters || 300, k: data.k });
      }
      const byId = sim.byId;
      state = { nodes, links, byId };

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

      const edgeEls = [];
      for (const l of links) {
        const s = byId[l.source],
          t = byId[l.target];
        if (!s || !t) continue;
        const line = el('line', {
          x1: s.x, y1: s.y, x2: t.x, y2: t.y,
          stroke: '#33415580',
          'stroke-width': Math.min(1 + Math.log2((l.weight || 1) + 1) * 0.6, 4),
          'marker-end': data.directed ? 'url(#arrow)' : '',
        });
        line.dataset.s = l.source;
        line.dataset.t = l.target;
        edgeLayer.appendChild(line);
        edgeEls.push(line);
      }

      const nodeEls = {};
      for (const n of nodes) {
        const g = el('g', { class: 'gnode', transform: `translate(${n.x},${n.y})` });
        g.style.cursor = 'pointer';
        const r = n.r || 8;
        const circ = el('circle', {
          r: r,
          fill: n.color || '#3b82f6',
          stroke: '#0b1220',
          'stroke-width': 1.5,
        });
        g.appendChild(circ);
        const label = el('text', {
          x: 0, y: r + 12,
          'text-anchor': 'middle',
          fill: '#c9d4e5',
          'font-size': Math.max(9, Math.min(13, 11)),
          'font-family': 'ui-monospace, monospace',
        });
        label.textContent = n.label || n.id;
        g.appendChild(label);
        nodeLayer.appendChild(g);
        nodeEls[n.id] = { g, circ, node: n };

        // drag
        let dragging = false,
          moved = false,
          start = null;
        g.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          dragging = true;
          moved = false;
          start = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y };
        });
        window.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          moved = true;
          n.x = start.nx + (e.clientX - start.x) / transform.s;
          n.y = start.ny + (e.clientY - start.y) / transform.s;
          g.setAttribute('transform', `translate(${n.x},${n.y})`);
          for (const line of edgeEls) {
            if (line.dataset.s === n.id) { line.setAttribute('x1', n.x); line.setAttribute('y1', n.y); }
            if (line.dataset.t === n.id) { line.setAttribute('x2', n.x); line.setAttribute('y2', n.y); }
          }
        });
        window.addEventListener('mouseup', () => {
          if (dragging && !moved && config.onClick) config.onClick(n);
          dragging = false;
        });
        g.addEventListener('mouseenter', () => highlight(n.id));
        g.addEventListener('mouseleave', () => highlight(null));
      }

      function highlight(id) {
        const neighbors = new Set();
        if (id) {
          neighbors.add(id);
          for (const l of links) {
            if (l.source === id) neighbors.add(l.target);
            if (l.target === id) neighbors.add(l.source);
          }
        }
        for (const nid in nodeEls) {
          const dim = id && !neighbors.has(nid);
          nodeEls[nid].g.style.opacity = dim ? 0.15 : 1;
        }
        for (const line of edgeEls) {
          if (!id) { line.style.opacity = 1; line.setAttribute('stroke', '#33415580'); continue; }
          const on = line.dataset.s === id || line.dataset.t === id;
          line.style.opacity = on ? 1 : 0.05;
          line.setAttribute('stroke', on ? '#60a5fa' : '#33415580');
        }
      }

      fit();
    }

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
