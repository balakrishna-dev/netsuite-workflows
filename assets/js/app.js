/**
 * NetSuite Workflow Studio
 * --------------------------------------------------------------
 * Interactive visualizer & simulator for SuiteFlow workflows.
 * Zero dependencies — vanilla JS, SVG and CSS.
 *
 * Author: Balakrishna Undela
 */
(function () {
  'use strict';

  const WORKFLOWS = window.NS_WORKFLOWS;
  const TYPES = window.NS_NODE_TYPES;

  /* ── Layout constants ─────────────────────────────────────── */
  const COL = 236;
  const ROW = 150;
  const NODE_W = 192;
  const NODE_H = 80;
  const PAD = 90;

  /* ── State ────────────────────────────────────────────────── */
  const state = {
    wf: null,
    scenario: {},
    selected: null,
    tab: 'details',
    view: { x: 0, y: 0, k: 1 },
    positions: {},
    running: false,
    runToken: 0,
    speed: 1,
    flow: true
  };

  /* ── DOM helpers ──────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const h = (tag, attrs = {}, html = '') => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v);
    }
    if (html) el.innerHTML = html;
    return el;
  };
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const icon = (d, size = 16) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true"><path d="' + d + '"/></svg>';

  const store = {
    get(k) { try { return localStorage.getItem('bu-wfs:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('bu-wfs:' + k, v); } catch (e) { /* storage unavailable */ } }
  };

  const fmt = {
    currency: (v) => '$' + Number(v).toLocaleString('en-US'),
    percent: (v) => Number(v).toFixed(1) + '%',
    number: (v) => String(v),
    hours: (v) => (v < 1 ? Math.round(v * 60) + 'm' : (v >= 24 ? (v / 24).toFixed(1) + 'd' : v.toFixed(1) + 'h'))
  };

  const dom = {
    library: $('#library-list'),
    search: $('#library-search'),
    canvas: $('#canvas'),
    world: $('#world'),
    edges: $('#edges'),
    nodes: $('#nodes'),
    labels: $('#labels'),
    token: $('#token'),
    zoomLabel: $('#zoom-level'),
    title: $('#wf-title'),
    crumb: $('#wf-crumb'),
    summary: $('#wf-summary'),
    stats: $('#wf-stats'),
    controls: $('#scenario-controls'),
    prediction: $('#prediction'),
    log: $('#log'),
    runBtn: $('#run-btn'),
    inspector: $('#inspector-body'),
    tabs: $$('.tabs__btn')
  };

  /* ═════════════════════════════════════════════════════════
   * Simulation engine
   * ═════════════════════════════════════════════════════════ */

  /** Walks the graph for a scenario and returns the visited path. */
  function simulate(wf, scenario) {
    const byId = Object.fromEntries(wf.nodes.map((n) => [n.id, n]));
    const visits = Object.fromEntries(wf.nodes.map((n) => [n.id, 0]));
    const steps = [];
    let node = wf.nodes.find((n) => n.type === 'start');
    let hours = 0;

    for (let guard = 0; node && guard < 40; guard++) {
      visits[node.id]++;
      hours += node.sla || 0;
      const outs = wf.edges.filter((e) => e.from === node.id);
      const edge = outs.find((e) => !e.when || e.when(scenario, { visits })) || null;
      steps.push({ node, edge, hours });
      if (!edge || node.type === 'end' || node.type === 'reject') break;
      node = byId[edge.to];
    }
    const last = steps[steps.length - 1].node;
    return { steps, hours, outcome: last.type === 'reject' ? 'rejected' : 'completed', last };
  }

  /* ═════════════════════════════════════════════════════════
   * Library
   * ═════════════════════════════════════════════════════════ */
  function renderLibrary(filter = '') {
    const q = filter.trim().toLowerCase();
    dom.library.innerHTML = '';
    const list = WORKFLOWS.filter((w) => !q || (w.name + w.category + w.record).toLowerCase().includes(q));

    if (!list.length) {
      dom.library.innerHTML = '<p class="library__empty">No workflows match “' + esc(filter) + '”.</p>';
      return;
    }

    list.forEach((w, i) => {
      const decisions = w.nodes.filter((n) => n.type === 'decision').length;
      const card = h('button', {
        class: 'wf-card' + (state.wf && state.wf.id === w.id ? ' is-active' : ''),
        style: '--c:' + w.color + ';--i:' + i,
        'data-id': w.id,
        type: 'button'
      },
        '<span class="wf-card__glow"></span>' +
        '<span class="wf-card__top"><span class="wf-card__cat">' + esc(w.category) + '</span><span class="wf-card__ver">v' + esc(w.version) + '</span></span>' +
        '<span class="wf-card__name">' + esc(w.name) + '</span>' +
        '<span class="wf-card__meta">' +
          '<span>' + w.nodes.length + ' states</span><span class="dot"></span>' +
          '<span>' + decisions + ' decisions</span><span class="dot"></span>' +
          '<span>' + esc(w.record) + '</span>' +
        '</span>' +
        '<span class="wf-card__bar"><span style="width:' + Math.min(100, w.edges.length * 7) + '%"></span></span>'
      );
      card.addEventListener('click', () => selectWorkflow(w.id));
      dom.library.appendChild(card);
    });
  }

  /* ═════════════════════════════════════════════════════════
   * Workflow selection & header
   * ═════════════════════════════════════════════════════════ */
  function selectWorkflow(id, opts = {}) {
    const wf = WORKFLOWS.find((w) => w.id === id) || WORKFLOWS[0];
    stopRun();
    state.wf = wf;
    state.selected = null;
    state.scenario = Object.fromEntries(wf.inputs.map((i) => [i.key, i.value]));
    state.positions = Object.fromEntries(wf.nodes.map((n) => [n.id, { x: PAD + n.x * COL, y: PAD + n.y * ROW }]));

    document.documentElement.style.setProperty('--wf', wf.color);
    if (!opts.silent) history.replaceState(null, '', '#' + wf.id);

    $$('.wf-card').forEach((c) => c.classList.toggle('is-active', c.dataset.id === wf.id));
    renderHeader();
    renderControls();
    renderGraph();
    clearLog();
    updatePrediction();
    renderInspector();
    requestAnimationFrame(() => fitView(false));
  }

  function renderHeader() {
    const wf = state.wf;
    dom.title.textContent = wf.name;
    dom.crumb.innerHTML = '<span>' + esc(wf.category) + '</span>' + icon('M9 6l6 6-6 6', 12) + '<span>' + esc(wf.record) + '</span>';
    dom.summary.textContent = wf.summary;

    const counts = {
      States: wf.nodes.length,
      Transitions: wf.edges.length,
      Decisions: wf.nodes.filter((n) => n.type === 'decision').length,
      Scripts: Object.keys(wf.scripts).length + wf.nodes.filter((n) => n.type === 'script' && !n.script).length
    };
    dom.stats.innerHTML = Object.entries(counts)
      .map(([k, v]) => '<div class="stat"><span class="stat__v" data-count="' + v + '">0</span><span class="stat__k">' + k + '</span></div>')
      .join('');
    $$('.stat__v', dom.stats).forEach(countUp);
  }

  function countUp(el) {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ═════════════════════════════════════════════════════════
   * Graph rendering
   * ═════════════════════════════════════════════════════════ */
  function renderGraph() {
    const wf = state.wf;
    dom.nodes.innerHTML = '';
    dom.labels.innerHTML = '';

    wf.nodes.forEach((n, i) => {
      const t = TYPES[n.type];
      const p = state.positions[n.id];
      const el = h('div', {
        class: 'node node--' + n.type,
        'data-id': n.id,
        tabindex: '0',
        role: 'button',
        'aria-label': t.label + ': ' + n.label,
        style: 'left:' + p.x + 'px;top:' + p.y + 'px;--c:' + t.color + ';--i:' + i
      },
        '<span class="node__port node__port--in"></span>' +
        '<span class="node__icon">' + icon(t.icon, 18) + '</span>' +
        '<span class="node__body">' +
          '<span class="node__kind">' + t.label + '</span>' +
          '<span class="node__title">' + esc(n.label) + '</span>' +
          '<span class="node__sub">' + esc(n.sub) + '</span>' +
        '</span>' +
        '<span class="node__sla">' + (n.sla ? fmt.hours(n.sla) : '') + '</span>' +
        '<span class="node__port node__port--out"></span>'
      );
      bindNode(el, n);
      dom.nodes.appendChild(el);
    });

    renderEdges();
  }

  /** Computes a smooth cubic Bézier between two nodes. */
  function edgePath(e) {
    const a = state.positions[e.from];
    const b = state.positions[e.to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const twin = state.wf.edges.some((o) => o.from === e.to && o.to === e.from);
    let sx, sy, ex, ey, c1x, c1y, c2x, c2y;

    if (dx > 40) {
      sx = a.x + NODE_W; sy = a.y + NODE_H / 2;
      ex = b.x; ey = b.y + NODE_H / 2;
      const k = Math.max(50, dx * 0.45);
      c1x = sx + k; c1y = sy; c2x = ex - k; c2y = ey;
    } else if (dx < -40) {
      sx = a.x + NODE_W / 2; sy = a.y + NODE_H;
      ex = b.x + NODE_W / 2; ey = b.y + NODE_H;
      const drop = Math.max(sy, ey) + 90;
      c1x = sx; c1y = drop; c2x = ex; c2y = drop;
    } else {
      const off = twin ? (dy > 0 ? -26 : 26) : 0;
      sx = a.x + NODE_W / 2 + off; ex = b.x + NODE_W / 2 + off;
      if (dy > 0) { sy = a.y + NODE_H; ey = b.y; } else { sy = a.y; ey = b.y + NODE_H; }
      const k = Math.abs(ey - sy) * 0.4;
      c1x = sx; c1y = sy + (dy > 0 ? k : -k); c2x = ex; c2y = ey + (dy > 0 ? -k : k);
    }
    return 'M' + sx + ',' + sy + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + ex + ',' + ey;
  }

  function renderEdges() {
    const wf = state.wf;
    const bounds = graphBounds();
    dom.edges.setAttribute('width', bounds.maxX + PAD * 2);
    dom.edges.setAttribute('height', bounds.maxY + PAD * 2);
    $$('.edge-group', dom.edges).forEach((g) => g.remove());
    dom.labels.innerHTML = '';

    wf.edges.forEach((e, i) => {
      const d = edgePath(e);
      const g = svg('g', { class: 'edge-group', 'data-i': i, 'data-from': e.from, 'data-to': e.to });
      g.appendChild(svg('path', { d, class: 'edge-hit' }));
      g.appendChild(svg('path', { d, class: 'edge', 'marker-end': 'url(#arrow)' }));
      g.appendChild(svg('path', { d, class: 'edge-flow' }));
      dom.edges.appendChild(g);

      if (e.label) {
        const path = g.querySelector('.edge');
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(len * 0.5);
        // Short connectors: lift the label above the line so it doesn't cover the ports.
        const y = len < 115 ? pt.y - 17 : pt.y;
        const lbl = h('span', { class: 'edge-label', 'data-i': i, style: 'left:' + pt.x + 'px;top:' + y + 'px' }, esc(e.label));
        dom.labels.appendChild(lbl);
      }
    });
    applyPredictionClasses();
  }

  function graphBounds() {
    const ps = Object.values(state.positions);
    return {
      minX: Math.min(...ps.map((p) => p.x)),
      minY: Math.min(...ps.map((p) => p.y)),
      maxX: Math.max(...ps.map((p) => p.x)) + NODE_W,
      maxY: Math.max(...ps.map((p) => p.y)) + NODE_H
    };
  }

  /* ── Node interaction: click to inspect, drag to rearrange ── */
  function bindNode(el, n) {
    let start = null;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const p = state.positions[n.id];
      start = { mx: ev.clientX, my: ev.clientY, x: p.x, y: p.y, moved: false };
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const dx = (ev.clientX - start.mx) / state.view.k;
      const dy = (ev.clientY - start.my) / state.view.k;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      el.classList.add('is-dragging');
      const p = state.positions[n.id];
      p.x = Math.round((start.x + dx) / 10) * 10;
      p.y = Math.round((start.y + dy) / 10) * 10;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      renderEdges();
    });
    const end = () => {
      if (!start) return;
      el.classList.remove('is-dragging');
      if (!start.moved) selectNode(n.id);
      start = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectNode(n.id); }
    });
  }

  function selectNode(id) {
    state.selected = id;
    $$('.node', dom.nodes).forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
    $$('.edge-group', dom.edges).forEach((g) => g.classList.toggle('is-linked', !!id && (g.dataset.from === id || g.dataset.to === id)));
    if (id && state.tab === 'json') state.tab = 'details';
    renderInspector();
    // Inspector sits below the canvas on smaller screens — bring it into view.
    if (id && matchMedia('(max-width: 1280px)').matches) {
      $('.inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ═════════════════════════════════════════════════════════
   * Pan & zoom
   * ═════════════════════════════════════════════════════════ */
  function applyView(animate) {
    const { x, y, k } = state.view;
    dom.world.classList.toggle('is-animating', !!animate);
    dom.world.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
    dom.canvas.style.setProperty('--grid', 24 * k + 'px');
    dom.canvas.style.setProperty('--gx', x + 'px');
    dom.canvas.style.setProperty('--gy', y + 'px');
    dom.zoomLabel.textContent = Math.round(k * 100) + '%';
  }

  function zoomAt(factor, cx, cy) {
    const v = state.view;
    const k = Math.min(2.2, Math.max(0.3, v.k * factor));
    const r = dom.canvas.getBoundingClientRect();
    const px = (cx ?? r.width / 2);
    const py = (cy ?? r.height / 2);
    v.x = px - ((px - v.x) * k) / v.k;
    v.y = py - ((py - v.y) * k) / v.k;
    v.k = k;
    applyView(cx == null);
  }

  function fitView(animate = true) {
    const r = dom.canvas.getBoundingClientRect();
    if (!r.width) return;
    const b = graphBounds();
    const w = b.maxX - b.minX + 120;
    const hgt = b.maxY - b.minY + 140;
    const fit = Math.min(r.width / w, r.height / hgt);
    // Never shrink below a readable zoom; on small screens start at the trigger and let the user pan.
    const minK = r.width < 600 ? 0.62 : 0.55;
    const k = Math.min(1.1, Math.max(minK, fit));
    state.view.k = k;
    state.view.x = fit < minK ? 28 - b.minX * k : (r.width - (b.maxX - b.minX) * k) / 2 - b.minX * k;
    state.view.y = (r.height - (b.maxY - b.minY) * k) / 2 - b.minY * k;
    applyView(animate);
  }

  function bindCanvas() {
    let pan = null;
    dom.canvas.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.canvas__tools, .legend')) return;
      pan = { mx: ev.clientX, my: ev.clientY, x: state.view.x, y: state.view.y, moved: false };
      dom.canvas.classList.add('is-panning');
      dom.canvas.setPointerCapture(ev.pointerId);
    });
    dom.canvas.addEventListener('pointermove', (ev) => {
      if (!pan) return;
      const dx = ev.clientX - pan.mx;
      const dy = ev.clientY - pan.my;
      if (Math.hypot(dx, dy) > 3) pan.moved = true;
      state.view.x = pan.x + dx;
      state.view.y = pan.y + dy;
      applyView(false);
    });
    const end = () => {
      if (pan && !pan.moved) selectNode(null);
      pan = null;
      dom.canvas.classList.remove('is-panning');
    };
    dom.canvas.addEventListener('pointerup', end);
    dom.canvas.addEventListener('pointercancel', end);
    dom.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = dom.canvas.getBoundingClientRect();
      zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    $('#zoom-in').addEventListener('click', () => zoomAt(1.2));
    $('#zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));
    $('#zoom-fit').addEventListener('click', () => fitView(true));
    $('#flow-toggle').addEventListener('click', (ev) => {
      state.flow = !state.flow;
      dom.canvas.classList.toggle('no-flow', !state.flow);
      ev.currentTarget.classList.toggle('is-on', state.flow);
      ev.currentTarget.setAttribute('aria-pressed', String(state.flow));
    });
    window.addEventListener('resize', () => fitView(false));
  }

  /* ═════════════════════════════════════════════════════════
   * Scenario controls & prediction
   * ═════════════════════════════════════════════════════════ */
  function renderControls() {
    dom.controls.innerHTML = '';
    state.wf.inputs.forEach((inp) => {
      const row = h('div', { class: 'ctrl ctrl--' + inp.type });
      const id = 'in-' + inp.key;

      if (inp.type === 'range') {
        row.innerHTML =
          '<label class="ctrl__label" for="' + id + '">' + esc(inp.label) + '<output>' + fmt[inp.format](inp.value) + '</output></label>' +
          '<input type="range" id="' + id + '" min="' + inp.min + '" max="' + inp.max + '" step="' + inp.step + '" value="' + inp.value + '">';
        const input = $('input', row);
        const out = $('output', row);
        const paint = () => {
          const p = ((input.value - inp.min) / (inp.max - inp.min)) * 100;
          input.style.setProperty('--p', p + '%');
          out.textContent = fmt[inp.format](input.value);
        };
        input.addEventListener('input', () => { state.scenario[inp.key] = Number(input.value); paint(); updatePrediction(); });
        paint();
      } else if (inp.type === 'toggle') {
        row.innerHTML =
          '<span class="ctrl__label">' + esc(inp.label) + '</span>' +
          '<button type="button" class="switch' + (inp.value ? ' is-on' : '') + '" role="switch" aria-checked="' + inp.value + '" aria-label="' + esc(inp.label) + '"><span></span></button>';
        const sw = $('.switch', row);
        sw.addEventListener('click', () => {
          const v = !state.scenario[inp.key];
          state.scenario[inp.key] = v;
          sw.classList.toggle('is-on', v);
          sw.setAttribute('aria-checked', String(v));
          updatePrediction();
        });
      } else if (inp.type === 'select') {
        row.innerHTML =
          '<span class="ctrl__label">' + esc(inp.label) + '</span>' +
          '<div class="segmented" role="radiogroup" aria-label="' + esc(inp.label) + '">' +
          inp.options.map(([v, l]) => '<button type="button" role="radio" data-v="' + v + '" aria-checked="' + (v === inp.value) + '" class="' + (v === inp.value ? 'is-on' : '') + '">' + esc(l) + '</button>').join('') +
          '</div>';
        $$('.segmented button', row).forEach((b) => b.addEventListener('click', () => {
          state.scenario[inp.key] = b.dataset.v;
          $$('.segmented button', row).forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
          updatePrediction();
        }));
      }
      dom.controls.appendChild(row);
    });
  }

  let predicted = null;
  function updatePrediction() {
    predicted = simulate(state.wf, state.scenario);
    const ok = predicted.outcome === 'completed';
    dom.prediction.className = 'prediction ' + (ok ? 'is-ok' : 'is-bad');
    dom.prediction.innerHTML =
      '<span class="prediction__k">Predicted outcome</span>' +
      '<span class="prediction__v">' + icon(TYPES[predicted.last.type].icon, 14) + esc(predicted.last.label) + '</span>' +
      '<span class="prediction__meta"><b>' + predicted.steps.length + '</b> steps · <b>' + fmt.hours(predicted.hours || 0.01) + '</b> cycle time</span>';
    if (!state.running) applyPredictionClasses();
  }

  function applyPredictionClasses() {
    if (!predicted || state.running) return;
    const nodeIds = new Set(predicted.steps.map((s) => s.node.id));
    const edgeSet = new Set(predicted.steps.filter((s) => s.edge).map((s) => state.wf.edges.indexOf(s.edge)));
    $$('.node', dom.nodes).forEach((el) => el.classList.toggle('is-predicted', nodeIds.has(el.dataset.id)));
    $$('.edge-group', dom.edges).forEach((g) => g.classList.toggle('is-predicted', edgeSet.has(Number(g.dataset.i))));
    $$('.edge-label', dom.labels).forEach((l) => l.classList.toggle('is-predicted', edgeSet.has(Number(l.dataset.i))));
  }

  /* ═════════════════════════════════════════════════════════
   * Animated run
   * ═════════════════════════════════════════════════════════ */
  function clearLog() {
    dom.log.innerHTML =
      '<li class="log__empty">' + icon('M8 5v14l11-7z', 14) +
      'Press <kbd>Run</kbd> to execute this workflow with the scenario on the left.</li>';
  }

  function logLine(type, title, detail, hours) {
    const empty = $('.log__empty', dom.log);
    if (empty) empty.remove();
    const li = h('li', { class: 'log__item', style: '--c:' + (TYPES[type] ? TYPES[type].color : 'var(--muted)') },
      '<span class="log__time">T+' + fmt.hours(hours || 0).padStart(5, ' ') + '</span>' +
      '<span class="log__dot"></span>' +
      '<span class="log__msg"><b>' + esc(title) + '</b>' + (detail ? '<span>' + esc(detail) + '</span>' : '') + '</span>');
    dom.log.appendChild(li);
    dom.log.scrollTop = dom.log.scrollHeight;
  }

  function stopRun() {
    state.running = false;
    state.runToken++;
    document.body.classList.remove('is-running');
    dom.world.classList.remove('is-running');
    dom.token.classList.remove('is-visible');
    $$('.node', dom.nodes).forEach((n) => n.classList.remove('is-active', 'is-done'));
    $$('.edge-group', dom.edges).forEach((g) => g.classList.remove('is-taken'));
    $$('.edge-label', dom.labels).forEach((l) => l.classList.remove('is-taken'));
    dom.runBtn.classList.remove('is-running');
    dom.runBtn.querySelector('span').textContent = 'Run';
    applyPredictionClasses();
  }

  function moveToken(path, duration, token) {
    return new Promise((resolve) => {
      const len = path.getTotalLength();
      const t0 = performance.now();
      const frame = (t) => {
        if (token !== state.runToken) return resolve(false);
        const p = Math.min(1, (t - t0) / duration);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const pt = path.getPointAtLength(len * e);
        dom.token.style.transform = 'translate(' + pt.x + 'px,' + pt.y + 'px)';
        if (p < 1) requestAnimationFrame(frame); else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  async function run() {
    if (state.running) { stopRun(); return; }
    stopRun();
    const token = ++state.runToken;
    state.running = true;
    document.body.classList.add('is-running');
    dom.world.classList.add('is-running');
    $$('.is-predicted').forEach((el) => el.classList.remove('is-predicted'));
    dom.runBtn.classList.add('is-running');
    dom.runBtn.querySelector('span').textContent = 'Stop';
    dom.log.innerHTML = '';

    const result = simulate(state.wf, state.scenario);
    const base = 900 / state.speed;
    logLine('start', 'Workflow instance started', state.wf.name + ' · ' + state.wf.record + ' #SO' + Math.floor(10000 + Math.random() * 89999), 0);

    for (const step of result.steps) {
      if (token !== state.runToken) return;
      const el = $('.node[data-id="' + step.node.id + '"]', dom.nodes);
      el.classList.add('is-active');
      const action = step.node.actions && step.node.actions[0];
      logLine(step.node.type, 'Entered “' + step.node.label + '”', action ? action[0] + ': ' + action[1] : step.node.sub, step.hours);
      await wait(base * (step.node.type === 'state' ? 0.9 : 0.55));
      if (token !== state.runToken) return;
      el.classList.remove('is-active');
      el.classList.add('is-done');

      if (step.edge && step.node.type !== 'end' && step.node.type !== 'reject') {
        const i = state.wf.edges.indexOf(step.edge);
        const g = $('.edge-group[data-i="' + i + '"]', dom.edges);
        const lbl = $('.edge-label[data-i="' + i + '"]', dom.labels);
        g.classList.add('is-taken');
        if (lbl) lbl.classList.add('is-taken');
        if (step.edge.label) logLine('decision', 'Transition → ' + step.edge.label, null, step.hours);
        dom.token.classList.add('is-visible');
        const ok = await moveToken(g.querySelector('.edge'), base * 0.8, token);
        if (!ok) return;
      }
    }

    dom.token.classList.remove('is-visible');
    const done = result.outcome === 'completed';
    logLine(done ? 'end' : 'reject', done ? 'Workflow completed successfully' : 'Workflow ended — ' + result.last.label,
      result.steps.length + ' steps · total cycle ' + fmt.hours(result.hours || 0.01), result.hours);
    toast(done ? 'Completed in ' + fmt.hours(result.hours || 0.01) : 'Ended at “' + result.last.label + '”', done ? 'ok' : 'bad');

    state.running = false;
    document.body.classList.remove('is-running');
    dom.runBtn.classList.remove('is-running');
    dom.runBtn.querySelector('span').textContent = 'Replay';
  }

  /* ═════════════════════════════════════════════════════════
   * Inspector
   * ═════════════════════════════════════════════════════════ */
  function renderInspector() {
    dom.tabs.forEach((t) => {
      const on = t.dataset.tab === state.tab;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
    });
    const wf = state.wf;
    const node = state.selected ? wf.nodes.find((n) => n.id === state.selected) : null;

    if (state.tab === 'details') dom.inspector.innerHTML = node ? nodeDetails(node) : workflowOverview();
    else if (state.tab === 'script') dom.inspector.innerHTML = scriptView(node);
    else dom.inspector.innerHTML = jsonView();

    dom.inspector.scrollTop = 0;
    $$('[data-goto]', dom.inspector).forEach((b) => b.addEventListener('click', () => selectNode(b.dataset.goto)));
    $$('[data-copy]', dom.inspector).forEach((b) => b.addEventListener('click', () => copyCode(b)));
  }

  function workflowOverview() {
    const wf = state.wf;
    const byType = {};
    wf.nodes.forEach((n) => { byType[n.type] = (byType[n.type] || 0) + 1; });
    const total = wf.nodes.length;
    const bar = Object.entries(byType).map(([t, c]) =>
      '<span style="flex:' + c + ';background:' + TYPES[t].color + '" title="' + TYPES[t].label + ': ' + c + '"></span>').join('');
    const legend = Object.entries(byType).map(([t, c]) =>
      '<li><span class="sw" style="background:' + TYPES[t].color + '"></span>' + TYPES[t].label + '<b>' + c + '</b></li>').join('');

    return (
      '<div class="insp-hero" style="--c:' + wf.color + '">' +
        '<span class="chip">' + esc(wf.category) + '</span>' +
        '<h3>' + esc(wf.name) + '</h3>' +
        '<p>' + esc(wf.summary) + '</p>' +
      '</div>' +
      '<dl class="kv">' +
        '<div><dt>Base record</dt><dd>' + esc(wf.record) + '</dd></div>' +
        '<div><dt>Version</dt><dd>v' + esc(wf.version) + '</dd></div>' +
        '<div><dt>Script ID</dt><dd><code>customworkflow_bu_' + wf.id.replace(/-/g, '_') + '</code></dd></div>' +
        '<div><dt>Release status</dt><dd><span class="pill pill--ok">Released</span></dd></div>' +
      '</dl>' +
      '<h4 class="insp-h">Composition</h4>' +
      '<div class="composition">' + bar + '</div>' +
      '<ul class="legend-list">' + legend + '</ul>' +
      '<h4 class="insp-h">States <span>' + total + '</span></h4>' +
      '<ol class="state-list">' + wf.nodes.map((n) =>
        '<li><button type="button" data-goto="' + n.id + '" style="--c:' + TYPES[n.type].color + '">' +
        icon(TYPES[n.type].icon, 14) + '<span>' + esc(n.label) + '</span><small>' + TYPES[n.type].label + '</small></button></li>').join('') +
      '</ol>' +
      '<p class="hint">' + icon('M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z', 14) +
      'Click any state on the canvas to inspect it. Drag states to re-arrange the diagram.</p>'
    );
  }

  function nodeDetails(n) {
    const t = TYPES[n.type];
    const wf = state.wf;
    const ins = wf.edges.filter((e) => e.to === n.id);
    const outs = wf.edges.filter((e) => e.from === n.id);
    const name = (id) => esc(wf.nodes.find((x) => x.id === id).label);
    const trans = (list, key) => list.length
      ? list.map((e) => '<li><button type="button" data-goto="' + e[key] + '">' + icon(key === 'to' ? 'M5 12h14M13 6l6 6-6 6' : 'M19 12H5M11 6l-6 6 6 6', 14) +
          '<span>' + name(e[key]) + '</span>' + (e.label ? '<small>' + esc(e.label) + '</small>' : '') + '</button></li>').join('')
      : '<li class="muted">None</li>';

    return (
      '<div class="insp-hero insp-hero--node" style="--c:' + t.color + '">' +
        '<span class="insp-hero__icon">' + icon(t.icon, 22) + '</span>' +
        '<span class="chip">' + t.label + '</span>' +
        '<h3>' + esc(n.label) + '</h3>' +
        '<p>' + esc(n.description) + '</p>' +
      '</div>' +
      '<dl class="kv">' +
        '<div><dt>Trigger</dt><dd>' + esc(n.trigger) + '</dd></div>' +
        '<div><dt>Target SLA</dt><dd>' + (n.sla ? fmt.hours(n.sla) : 'Instant') + '</dd></div>' +
        '<div><dt>State ID</dt><dd><code>workflowstate_' + n.id + '</code></dd></div>' +
      '</dl>' +
      '<h4 class="insp-h">Actions <span>' + n.actions.length + '</span></h4>' +
      '<ul class="actions">' + n.actions.map(([k, v], i) =>
        '<li style="--i:' + i + '"><span class="actions__k">' + esc(k) + '</span><span class="actions__v">' + esc(v) + '</span></li>').join('') +
      '</ul>' +
      (n.script ? '<button type="button" class="btn btn--ghost btn--block" id="open-script">' + icon(TYPES.script.icon, 15) + 'View SuiteScript</button>' : '') +
      '<div class="trans">' +
        '<div><h4 class="insp-h">Incoming</h4><ul>' + trans(ins, 'from') + '</ul></div>' +
        '<div><h4 class="insp-h">Outgoing</h4><ul>' + trans(outs, 'to') + '</ul></div>' +
      '</div>'
    );
  }

  function scriptView(node) {
    const wf = state.wf;
    const key = (node && node.script) || Object.keys(wf.scripts)[0];
    const s = key && wf.scripts[key];
    if (!s) {
      return '<div class="empty">' + icon(TYPES.action.icon, 28) +
        '<h3>No custom code needed</h3><p>This workflow is built entirely with native SuiteFlow actions — Set Field Value, Send Email, Add Button and Create Record.</p></div>';
    }
    return (
      '<div class="code-head"><div><span class="chip">' + esc(s.type) + '</span><h3>' + esc(s.file) + '</h3></div>' +
      '<button type="button" class="btn btn--ghost" data-copy>' + icon('M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z', 14) + '<span>Copy</span></button></div>' +
      '<pre class="code"><code>' + highlightJS(s.code) + '</code></pre>'
    );
  }

  function serializable(wf) {
    return {
      scriptid: 'customworkflow_bu_' + wf.id.replace(/-/g, '_'),
      name: wf.name,
      recordtype: wf.record,
      version: wf.version,
      states: wf.nodes.map((n) => ({ id: n.id, type: n.type, name: n.label, sla_hours: n.sla, trigger: n.trigger, actions: n.actions.map(([type, value]) => ({ type, value })) })),
      transitions: wf.edges.map((e) => {
        const o = { from: e.from, to: e.to };
        if (e.label) o.label = e.label;
        if (e.when) o.condition = e.when.toString();
        return o;
      })
    };
  }

  function jsonView() {
    const json = JSON.stringify(serializable(state.wf), null, 2);
    return (
      '<div class="code-head"><div><span class="chip">Definition</span><h3>' + esc(state.wf.id) + '.json</h3></div>' +
      '<div class="code-head__btns"><button type="button" class="btn btn--ghost" data-copy>' + icon('M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z', 14) + '<span>Copy</span></button>' +
      '<button type="button" class="btn btn--ghost" id="download-json">' + icon('M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z', 14) + '<span>Export</span></button></div></div>' +
      '<pre class="code"><code>' + highlightJSON(json) + '</code></pre>'
    );
  }

  function copyCode(btn) {
    const text = btn.closest('.insp-body, #inspector-body').querySelector('.code code').innerText;
    const done = () => { const s = btn.querySelector('span'); s.textContent = 'Copied'; setTimeout(() => (s.textContent = 'Copy'), 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
  }

  /* ── Tiny syntax highlighters ───────────────────────────── */
  function tokenize(code, re, cls) {
    let out = '';
    let last = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const group = m.slice(1).findIndex((g) => g !== undefined);
      out += '<span class="tk-' + cls[group] + '">' + esc(m[0]) + '</span>';
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function highlightJS(code) {
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(const|let|var|return|if|else|for|function|throw|new|of|in|typeof)\b|(=>)|\b(define|log|search|record|query|runtime|https|error)\b|\b(\d+(?:\.\d+)?)\b|\b([a-zA-Z_]\w*)(?=\s*\()/g;
    return tokenize(code, re, ['com', 'str', 'kw', 'kw', 'mod', 'num', 'fn']);
  }

  function highlightJSON(code) {
    const re = /("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
    return tokenize(code, re, ['key', 'str', 'kw', 'num']);
  }

  /* ═════════════════════════════════════════════════════════
   * Misc UI: theme, toast, shortcuts, tabs
   * ═════════════════════════════════════════════════════════ */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    store.set('theme', t);
    $('#theme-toggle').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  let toastTimer;
  function toast(msg, kind) {
    const el = $('#toast');
    el.className = 'toast is-visible toast--' + kind;
    el.innerHTML = icon(kind === 'ok' ? TYPES.end.icon : TYPES.reject.icon, 16) + '<span>' + esc(msg) + '</span>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  function bindUI() {
    dom.search.addEventListener('input', () => renderLibrary(dom.search.value));
    dom.runBtn.addEventListener('click', run);

    $$('.speed button').forEach((b) => b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      $$('.speed button').forEach((x) => x.classList.toggle('is-on', x === b));
    }));

    dom.tabs.forEach((t) => t.addEventListener('click', () => { state.tab = t.dataset.tab; renderInspector(); }));

    dom.inspector.addEventListener('click', (ev) => {
      if (ev.target.closest('#open-script')) { state.tab = 'script'; renderInspector(); }
      if (ev.target.closest('#download-json')) {
        const blob = new Blob([JSON.stringify(serializable(state.wf), null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: state.wf.id + '.json' });
        document.body.appendChild(a); a.click(); a.remove();
      }
    });

    $('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

    document.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, textarea')) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'r') { ev.preventDefault(); run(); }
      else if (k === 'f') fitView(true);
      else if (k === 't') $('#theme-toggle').click();
      else if (k === '/') { ev.preventDefault(); dom.search.focus(); }
      else if (k === 'escape') selectNode(null);
      else if (k === '+' || k === '=') zoomAt(1.2);
      else if (k === '-') zoomAt(1 / 1.2);
      else if (/^[1-9]$/.test(k) && WORKFLOWS[Number(k) - 1]) selectWorkflow(WORKFLOWS[Number(k) - 1].id);
    });

    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (id && (!state.wf || id !== state.wf.id)) selectWorkflow(id, { silent: true });
    });
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  function init() {
    const saved = store.get('theme');
    setTheme(saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    $('#total-workflows').textContent = WORKFLOWS.length;
    $('#total-states').textContent = WORKFLOWS.reduce((t, w) => t + w.nodes.length, 0);
    renderLibrary();
    bindCanvas();
    bindUI();
    const fromHash = location.hash.slice(1);
    selectWorkflow(WORKFLOWS.some((w) => w.id === fromHash) ? fromHash : WORKFLOWS[0].id, { silent: !fromHash });
    requestAnimationFrame(() => document.body.classList.add('is-ready'));
  }

  init();
})();
