// Canvas graph engine.
//
// Built to stay calm after years of use:
//  * a draw budget: only the strongest connections in view are drawn (more appear as you zoom in)
//  * labels never overlap; the most important ones win
//  * connections fade with age (optional), so what you use now stands out
//  * positions are cached and reused, so the map stays put from day to day
//  * the layout is stretched to fill the window's shape
const d3 = window.d3;

export const TRAIL_COLORS = ['#ffff55', '#55ffff', '#ff55ff', '#ff5555', '#55ff55', '#ffaa00', '#7f7fff', '#ffffff', '#ff9ecf', '#aaff00'];
let HUB = d3.interpolateRgbBasis(['#1d6b36', '#2fd35a', '#a8ff4d', '#ffe14d', '#ffaa00']);

// Sizes are relative to the busiest article / connection, so year two looks like day one.
let MAXV = 30, MAXT = 20;
const radius = (v) => 2.3 + Math.min(1.7 * Math.sqrt(v), 8.5 * Math.sqrt(v / MAXV));
const relT = (t) => Math.log1p(t) / Math.log1p(Math.max(MAXT, 8));
const widthOf = (total) => 0.6 + 5 * relT(total) ** 1.4;
const alphaOf = (total) => 0.16 + 0.7 * relT(total);
const DAY = 864e5;

/* ---------- node shapes ---------- */
function poly(pts) { return 'M' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z'; }
function radial(n, rOut, rIn, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * (rIn ? 2 : 1); i++) {
    const r = rIn && i % 2 ? rIn : rOut, a = rot + (i * Math.PI) / (rIn ? n : n / 2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return poly(pts);
}
export function shapePath(shape, r) {
  switch (shape) {
    case 'circle': return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
    case 'diamond': return poly([[0, -r * 1.35], [r * 1.35, 0], [0, r * 1.35], [-r * 1.35, 0]]);
    case 'tri': return poly([[0, -r * 1.45], [r * 1.3, r * .85], [-r * 1.3, r * .85]]);
    case 'hex': return radial(6, r * 1.2, 0, 0);
    case 'star': return radial(5, r * 1.6, r * .7);
    case 'spark': return radial(4, r * 1.9, r * .45);
    default: return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}Z`;
  }
}
const p2dCache = new Map();
function shapeP2D(shape, r) {
  const k = shape + '|' + r.toFixed(1);
  let p = p2dCache.get(k);
  if (!p) { p = new Path2D(shapePath(shape, Math.max(.8, r))); if (p2dCache.size > 4000) p2dCache.clear(); p2dCache.set(k, p); }
  return p;
}

export function createGraph(canvas, handlers) {
  const ctx = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1;
  let T = d3.zoomIdentity, ax = 1, ay = 1, kFit = 1;
  const zr = () => T.k / kFit; // zoom relative to the fitted overview
  const style = { link: '#39ff88', label: '#c6ffd8', labelBg: '#010a04', labelStart: '#fff', cursor: '#ffaa00', font: 'monospace', weight: '400', upper: false };
  let skin = { shape: 'square', hollow: false, glow: true, edge: 'plain', bend: 0.12, labelSize: 15, walker: false };
  const view = { density: 1, fade: true, focus: null };

  // layout graph (all time) and the visible slice (time range / focus)
  let nodes = [], nodeBy = new Map(), adj = new Map();
  let visArticles = new Map(), visNodes = [], sorted = [], visMaxDeg = 1, spanMs = 30 * DAY, nowMs = Date.now();
  const posCache = new Map();
  let quad = null, drawn = [];
  let over = null, cursor = null, hoverNode = null, hoverEdge = null;
  let drawMs = 0, simLeft = 0, pinnedFresh = false, lastInteract = 0, dirty = true, raf = 0, lastFrame = 0;

  /* ---------- simulation (run in small slices so the UI never freezes) ---------- */
  const sim = d3.forceSimulation().stop()
    .force('link', d3.forceLink().id((d) => d.title)
      .distance((l) => 22 + 90 / (1 + 0.7 * Math.log2(1 + l.total)))
      .strength((l) => Math.min(1, 0.1 + 0.15 * Math.log2(1 + l.total))))
    .force('charge', d3.forceManyBody().theta(0.9).distanceMax(520))
    .force('collide', d3.forceCollide((n) => radius(n.visits) + 4).iterations(1))
    .force('x', d3.forceX().strength(0.03))
    .force('y', d3.forceY().strength(0.03));

  function runSim(alpha, ticks) { sim.alpha(alpha); simLeft = Math.max(simLeft, ticks); kick(); }
  function simSlice(budget = 12) {
    if (simLeft <= 0) return;
    const t0 = performance.now();
    while (simLeft > 0 && performance.now() - t0 < budget) { sim.tick(); simLeft--; }
    rebuildQuad();
    if (simLeft <= 0) {
      if (pinnedFresh) { for (const n of nodes) { n.fx = null; n.fy = null; } pinnedFresh = false; }
      for (const n of nodes) n.fresh = false;
      for (const n of nodes) posCache.set(n.title, { x: n.x, y: n.y });
      handlers.onSettled?.();
    }
    dirty = true;
  }

  /**
   * full: derived over all time (drives the layout); visible: derived for the current time range.
   * saved: { title: [x, y] } from a previous session.
   */
  function update(full, visible = full, saved = null) {
    nowMs = Date.now();
    if (saved) for (const [t, p] of Object.entries(saved)) if (!posCache.has(t) && Array.isArray(p)) posCache.set(t, { x: +p[0], y: +p[1] });
    const old = nodeBy;
    adj = new Map();
    for (const l of full.links.values()) {
      if (!adj.has(l.a)) adj.set(l.a, []); if (!adj.has(l.b)) adj.set(l.b, []);
      adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
    }
    let fresh = 0;
    nodes = [...full.articles.values()].map((a) => {
      let n = old.get(a.title);
      if (!n) {
        const p = posCache.get(a.title);
        n = { title: a.title, x: p?.x, y: p?.y, fresh: !p };
      }
      n.visitsAll = a.visits; n.visits = a.visits; n.isStart = a.starts.size > 0;
      return n;
    });
    nodeBy = new Map(nodes.map((n) => [n.title, n]));
    // new articles appear next to an article they're connected to
    for (const n of nodes) {
      if (n.x != null && !Number.isNaN(n.x)) continue;
      fresh++;
      const nb = (adj.get(n.title) || []).map((t) => nodeBy.get(t)).find((m) => m && m.x != null && !Number.isNaN(m.x));
      n.x = (nb ? nb.x : 0) + (Math.random() - 0.5) * 40; n.y = (nb ? nb.y : 0) + (Math.random() - 0.5) * 40;
      n.fresh = true;
    }
    const big = nodes.length > 400;
    sim.force('charge').strength((n) => -(big ? 70 : 170) - (big ? 18 : 30) * Math.sqrt(n.visitsAll));
    sim.nodes(nodes);
    sim.force('link').links([...full.links.values()].map((l) => ({ source: l.a, target: l.b, total: l.total })));
    const first = fresh > nodes.length * 0.5;
    if (first) { pinnedFresh = false; runSim(1, Math.min(300, 140 + nodes.length / 10)); }
    else if (fresh) {
      for (const n of nodes) if (!n.fresh) { n.fx = n.x; n.fy = n.y; }   // the known map stays put
      pinnedFresh = true; runSim(0.5, 90);
    }
    setVisible(visible);
    return first;
  }

  function setVisible(visible) {
    visArticles = visible.articles;
    const focusSet = view.focus;
    visNodes = nodes.filter((n) => visArticles.has(n.title) && (!focusSet || focusSet.has(n.title)));
    const deg = new Map();
    const ls = [];
    let tMin = Infinity, tMax = -Infinity;
    for (const l of visible.links.values()) {
      if (focusSet && !(focusSet.has(l.a) && focusSet.has(l.b))) continue;
      ls.push(l);
      deg.set(l.a, (deg.get(l.a) || 0) + l.total); deg.set(l.b, (deg.get(l.b) || 0) + l.total);
      if (l.last < tMin) tMin = l.last; if (l.last > tMax) tMax = l.last;
    }
    spanMs = Math.max(30 * DAY, tMax - tMin);
    for (const n of visNodes) { const a = visArticles.get(n.title); n.visits = a ? a.visits : 0; n.deg = deg.get(n.title) || 0; n.last = a?.last || 0; }
    visMaxDeg = Math.max(1, ...visNodes.map((n) => n.deg));
    MAXV = Math.max(10, ...visNodes.map((n) => n.visits)); MAXT = Math.max(4, ...ls.map((l) => l.total));
    rescore(ls);
    rebuildQuad();
    dirty = true; kick();
  }

  function recency(last) {
    if (!view.fade || !last) return 1;
    const tau = Math.max(30 * DAY, spanMs / 5);
    return 0.28 + 0.72 * Math.exp(-Math.max(0, nowMs - last) / tau);
  }
  function rescore(ls = sorted) {
    for (const l of ls) { l.rec = recency(l.last); l.score = l.total * (0.25 + 0.75 * l.rec); }
    sorted = [...ls].sort((p, q) => q.score - p.score);
    const strongCut = sorted[Math.floor(sorted.length * 0.08)]?.score ?? Infinity;
    for (const l of sorted) l.strong = l.total >= 3 && l.score >= strongCut;
  }

  function rebuildQuad() { quad = d3.quadtree(visNodes, (n) => n.x, (n) => n.y); }

  /* ---------- coordinates ---------- */
  const sx = (x) => T.x + T.k * ax * x;
  const sy = (y) => T.y + T.k * ay * y;
  const lx = (px) => (px - T.x) / (T.k * ax);
  const ly = (py) => (py - T.y) / (T.k * ay);
  function ctrlPt(x1, y1, x2, y2, extra = 0) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, bend = len * skin.bend + extra;
    return [(x1 + x2) / 2 - (dy / len) * bend, (y1 + y2) / 2 + (dx / len) * bend];
  }

  /* ---------- drawing ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    dirty = true; kick();
  }
  new ResizeObserver(() => { resize(); handlers.onResize?.(); }).observe(canvas);

  const textW = new Map();
  function measure(t, font) { const k = font + '|' + t; let w = textW.get(k); if (w == null) { ctx.font = font; w = ctx.measureText(t).width; if (textW.size > 20000) textW.clear(); textW.set(k, w); } return w; }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawn = [];
    if (!visNodes.length) return;
    const k = zr(), rs = Math.max(0.7, Math.min(2.2, Math.sqrt(k)));
    const lit = over?.nodes || null;
    const dimF = over ? 0.13 : 1;
    const M = 60;
    const inView = (x, y) => x > -M && x < W + M && y > -M && y < H + M;

    // 1. connections, strongest first, within the budget
    const budget = Math.round(380 * view.density * Math.min(10, Math.max(1, Math.pow(k, 1.25))));
    const wsc = Math.max(0.7, Math.min(1.6, Math.pow(k, 0.35)));
    const major = new Set();
    const dash = skin.edge === 'dotted' ? [1, 7] : skin.edge === 'blocks' ? [4, 4] : null;
    ctx.lineCap = skin.edge === 'blocks' ? 'butt' : 'round';
    ctx.strokeStyle = style.link;
    let count = 0;
    for (const l of sorted) {
      if (count >= budget) break;
      const A = nodeBy.get(l.a), B = nodeBy.get(l.b);
      if (!A || !B) continue;
      const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y);
      if (!inView(x1, y1) && !inView(x2, y2)) continue;
      count++;
      const [cx, cy] = ctrlPt(x1, y1, x2, y2);
      const w = widthOf(l.total) * wsc, a = alphaOf(l.total) * l.rec * dimF;
      drawn.push({ l, x1, y1, cx, cy, x2, y2, w });
      major.add(l.a); major.add(l.b);
      if (l.strong && skin.glow !== false && !over) {
        ctx.globalAlpha = a * 0.16; ctx.lineWidth = w * 3 + 5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = a; ctx.lineWidth = w;
      if (dash) ctx.setLineDash(dash.map((d) => d * Math.max(1, w / 2)));
      else if (skin.edge === 'pulse' && l.strong) { ctx.setLineDash([2, 12]); ctx.lineDashOffset = -(now / 60) % 14; }
      else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;

    // hovered connection
    if (hoverEdge && !over) {
      const d = drawn.find((e) => e.l.key === hoverEdge);
      if (d) { ctx.globalAlpha = 0.95; ctx.strokeStyle = style.labelStart; ctx.lineWidth = d.w + 2.5; ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.quadraticCurveTo(d.cx, d.cy, d.x2, d.y2); ctx.stroke(); major.add(d.l.a); major.add(d.l.b); }
    }

    // 2. highlight lanes
    if (over) drawLanes(now, rs);

    // 3. articles: important ones as shapes, the rest as faint dots
    const nodeBudget = Math.round(160 * view.density * Math.min(12, Math.max(1, k * k)));
    const inViewNodes = [];
    for (const n of visNodes) { const x = sx(n.x), y = sy(n.y); if (inView(x, y)) inViewNodes.push([n, x, y]); }
    inViewNodes.sort((p, q) => q[0].visits - p[0].visits);
    const shown = [];
    ctx.fillStyle = style.link;
    for (let i = 0; i < inViewNodes.length; i++) {
      const [n, x, y] = inViewNodes[i];
      const important = major.has(n.title) || i < nodeBudget || (lit && lit.has(n.title)) || n.title === cursor || n.title === hoverNode;
      if (important) { shown.push(inViewNodes[i]); continue; }
      ctx.globalAlpha = over ? 0.05 : 0.22; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    const hollow = !!skin.hollow;
    for (const [n, x, y] of shown) {
      const isLit = !lit || lit.has(n.title);
      const col = HUB(Math.log1p(n.deg) / Math.log1p(visMaxDeg));
      const r = radius(n.visits) * rs;
      ctx.globalAlpha = isLit ? 1 : 0.16;
      ctx.save(); ctx.translate(x, y);
      const p = shapeP2D(skin.shape, r);
      if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = n.isStart ? 3 : 1.6; ctx.stroke(p); }
      else {
        ctx.fillStyle = col; ctx.fill(p);
        ctx.strokeStyle = n.isStart ? style.labelStart : style.labelBg; ctx.lineWidth = n.isStart ? 2 : 1; ctx.stroke(p);
      }
      if (n.title === hoverNode || n.title === over?.focus) { ctx.globalAlpha = 1; ctx.strokeStyle = style.labelStart; ctx.lineWidth = 2.5; ctx.stroke(shapeP2D(skin.shape, r + 3)); }
      if (n.title === cursor && Math.floor(now / 500) % 2 === 0) { ctx.globalAlpha = 1; ctx.strokeStyle = style.cursor; ctx.lineWidth = 3; ctx.setLineDash([4, 3]); ctx.stroke(shapeP2D(skin.shape, r + 5)); ctx.setLineDash([]); }
      ctx.restore();
    }

    // 4. badges (step numbers of a single highlighted trail) + walker
    if (over?.numbers) {
      ctx.font = `600 12px ${style.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [t, num] of over.numbers) {
        const n = nodeBy.get(t); if (!n || !visArticles.has(t)) continue;
        const x = sx(n.x), y = sy(n.y), r = radius(n.visits) * rs, bx = x - r - 9, by = y - r - 9;
        ctx.globalAlpha = 1; ctx.fillStyle = style.labelBg; ctx.strokeStyle = style.cursor; ctx.lineWidth = 1.5;
        ctx.fillRect(bx - 9, by - 8, 18, 16); ctx.strokeRect(bx - 9, by - 8, 18, 16);
        ctx.fillStyle = style.cursor; ctx.fillText(String(num), bx, by + 1);
      }
      ctx.textAlign = 'start';
      if (skin.walker && over.walk?.length) drawWalker(now);
    }

    // 5. labels: important first, never overlapping
    drawLabels(shown, lit);
    ctx.globalAlpha = 1;
  }

  function lanePath(lane, extra) {
    const A = nodeBy.get(lane.from), B = nodeBy.get(lane.to);
    if (!A || !B) return null;
    // same curve as the base connection (control point computed in a→b order), with a sideways offset per lane
    const [pa, pb] = lane.from < lane.to ? [A, B] : [B, A];
    const x1 = sx(pa.x), y1 = sy(pa.y), x2 = sx(pb.x), y2 = sy(pb.y);
    const [cx, cy] = ctrlPt(x1, y1, x2, y2, extra);
    return lane.from < lane.to ? [x1, y1, cx, cy, x2, y2] : [x2, y2, cx, cy, x1, y1];
  }
  function drawLanes(now, rs) {
    const off = -(now / 35) % 12;
    for (const lane of over.lanes) {
      const p = lanePath(lane, lane.extra);
      if (!p) continue;
      const [x1, y1, cx, cy, x2, y2] = p, col = lane.color, w = (1.4 + 1.1 * Math.log2(1 + lane.count)) * Math.min(1.4, rs);
      ctx.strokeStyle = col;
      if (over.lanes.length < 400) { ctx.globalAlpha = 0.22; ctx.lineWidth = w * 3.5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke(); }
      ctx.globalAlpha = 0.95; ctx.lineWidth = w; ctx.setLineDash(style.laneDash ? [6, 6] : []); ctx.lineDashOffset = off;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
      // arrow head along the curve
      const u = 0.58, mx = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, my = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2;
      const tx = 2 * (1 - u) * (cx - x1) + 2 * u * (x2 - cx), ty = 2 * (1 - u) * (cy - y1) + 2 * u * (y2 - cy), an = Math.atan2(ty, tx);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(an); ctx.fillStyle = col; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (over.edgeKey) {
      const d = drawn.find((e) => e.l.key === over.edgeKey) || (() => {
        const [a, b] = over.edgeKey.split('\u0000'); const A = nodeBy.get(a), B = nodeBy.get(b); if (!A || !B) return null;
        const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y), [cx, cy] = ctrlPt(x1, y1, x2, y2); return { x1, y1, cx, cy, x2, y2, w: 3 };
      })();
      if (d) {
        ctx.strokeStyle = style.cursor; ctx.globalAlpha = 0.35; ctx.lineWidth = d.w + 12; ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.quadraticCurveTo(d.cx, d.cy, d.x2, d.y2); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = d.w + 3; ctx.stroke();
      }
    }
  }
  function drawWalker(now) {
    const steps = over.walk, dur = Math.max(4000, steps.length * 1100), ph = (now % dur) / dur * steps.length;
    const i = Math.floor(ph), u = ph - i, st = steps[i];
    const p = lanePath({ from: st.from, to: st.to }, 0); if (!p) return;
    const [x1, y1, cx, cy, x2, y2] = p;
    const x = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, y = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2;
    ctx.save(); ctx.translate(x, y - 4); ctx.globalAlpha = 1; ctx.fillStyle = style.cursor; ctx.strokeStyle = style.labelBg; ctx.lineWidth = 1.5;
    const pth = new Path2D('M0,-9L7,2L3,2L3,8L-3,8L-3,2L-7,2Z'); ctx.fill(pth); ctx.stroke(pth); ctx.restore();
  }
  function drawLabels(shown, lit) {
    const k = zr();
    const size = skin.labelSize || 14;
    const font = `${style.weight} ${size}px ${style.font}`;
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const limit = Math.round(26 * view.density * Math.min(8, Math.max(1, Math.pow(k, 1.15)))) + (lit ? 30 : 0);
    const cands = shown
      .filter(([n]) => !lit || lit.has(n.title))
      .map(([n, x, y]) => [n, x, y, (n.title === cursor || n.title === hoverNode || n.title === over?.focus ? 1e9 : 0) + n.visits * (1 + 0.5 * (n.isStart ? 1 : 0))])
      .sort((p, q) => q[3] - p[3]);
    const placed = [];
    let count = 0;
    for (const [n, x, y] of cands) {
      if (count >= limit) break;
      const txt = style.upper ? n.title.toUpperCase() : n.title;
      const w = measure(txt, font), r = radius(n.visits) * Math.max(0.7, Math.min(2.2, Math.sqrt(k)));
      const box = [x + r + 4, y - size * 0.6, x + r + 6 + w, y + size * 0.6];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box); count++;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 4; ctx.strokeStyle = style.labelBg; ctx.strokeText(txt, box[0], y);
      ctx.fillStyle = n.isStart ? style.labelStart : style.label; ctx.fillText(txt, box[0], y);
    }
  }

  /* ---------- frame loop ---------- */
  function animating() { return simLeft > 0 || !!over || !!cursor || skin.edge === 'pulse'; }
  function frame(now) {
    raf = 0;
    simSlice();
    const interactive = now - lastInteract < 400 || simLeft > 0;
    if (dirty || (animating() && (interactive || now - lastFrame > 33))) { const t0 = performance.now(); draw(now); drawMs = drawMs * 0.8 + (performance.now() - t0) * 0.2; dirty = false; lastFrame = now; }
    if (animating() || dirty) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---------- interaction ---------- */
  function nodeAt(px, py) {
    if (!quad) return null;
    const x = lx(px), y = ly(py), rad = 16 / (T.k * Math.min(ax, ay));
    const n = quad.find(x, y, rad);
    if (!n || !visArticles.has(n.title)) return null;
    const r = radius(n.visits) * Math.max(0.7, Math.min(2.2, Math.sqrt(zr())));
    return Math.hypot(sx(n.x) - px, sy(n.y) - py) <= Math.max(7, r + 4) ? n : null; // true on-screen distance
  }
  function edgeAt(px, py) {
    let best = null, bd = 7;
    for (const d of drawn) {
      const minx = Math.min(d.x1, d.x2, d.cx) - 8, maxx = Math.max(d.x1, d.x2, d.cx) + 8, miny = Math.min(d.y1, d.y2, d.cy) - 8, maxy = Math.max(d.y1, d.y2, d.cy) + 8;
      if (px < minx || px > maxx || py < miny || py > maxy) continue;
      let px0 = d.x1, py0 = d.y1;
      for (let i = 1; i <= 14; i++) {
        const u = i / 14, x = (1 - u) ** 2 * d.x1 + 2 * (1 - u) * u * d.cx + u * u * d.x2, y = (1 - u) ** 2 * d.y1 + 2 * (1 - u) * u * d.cy + u * u * d.y2;
        const dist = segDist(px, py, px0, py0, x, y) - d.w / 2;
        if (dist < bd) { bd = dist; best = d.l; }
        px0 = x; py0 = y;
      }
    }
    return best;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  const zoom = d3.zoom().scaleExtent([0.08, 24])
    .filter((e) => {
      if (e.type === 'wheel') return true;
      if (e.button || e.ctrlKey) return false;
      if (e.type === 'mousedown' || e.type === 'touchstart') return !nodeAt(...pos(e.touches?.[0] || e)); // dragging a node, not the map
      return true;
    })
    .on('zoom', (e) => { T = e.transform; lastInteract = performance.now(); dirty = true; kick(); });
  const sel = d3.select(canvas).call(zoom).on('dblclick.zoom', null);

  let drag = null, suppressClick = false, hoverRaf = 0, lastMove = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const [px, py] = pos(e), n = nodeAt(px, py);
    if (!n) return;
    drag = { n, px, py, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = pos(e);
    if (drag) {
      if (Math.hypot(px - drag.px, py - drag.py) > 3) drag.moved = true;
      if (drag.moved) { drag.n.x = lx(px); drag.n.y = ly(py); drag.n.fx = drag.n.x; drag.n.fy = drag.n.y; lastInteract = performance.now(); dirty = true; kick(); }
      return;
    }
    lastMove = [px, py];
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; if (!lastMove) return;
      const n = nodeAt(...lastMove);
      const t = n ? n.title : null;
      const ed = t ? null : edgeAt(...lastMove);
      const ek = ed ? ed.key : null;
      if (t !== hoverNode) { hoverNode = t; handlers.onHover?.(t); dirty = true; }
      if (ek !== hoverEdge) { hoverEdge = ek; handlers.onEdgeHover?.(ed); dirty = true; }
      canvas.style.cursor = t || ek ? 'pointer' : '';
      kick();
    });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) { suppressClick = true; d.n.fx = null; d.n.fy = null; posCache.set(d.n.title, { x: d.n.x, y: d.n.y }); rebuildQuad(); handlers.onSettled?.(); }
  });
  canvas.addEventListener('pointerleave', () => {
    lastMove = null;
    if (hoverNode) { hoverNode = null; handlers.onHover?.(null); }
    if (hoverEdge) { hoverEdge = null; handlers.onEdgeHover?.(null); }
    dirty = true; kick();
  });
  canvas.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const [px, py] = pos(e), n = nodeAt(px, py);
    if (n) return handlers.onClick?.(n.title);
    const ed = edgeAt(px, py);
    if (ed) return handlers.onEdgeClick?.(ed);
    handlers.onBackground?.();
  });
  canvas.addEventListener('dblclick', (e) => { const n = nodeAt(...pos(e)); if (n) handlers.onDblClick?.(n.title); });

  /* ---------- highlight ---------- */
  // spec: { steps:[{trailId, from, to, order}], colorOf(trailId), numbers?: Map, focus?: title, edgeKey?: key }
  function setHighlight(spec) {
    if (!spec) { over = null; dirty = true; kick(); return; }
    const trails = new Set(spec.steps.map((s) => s.trailId));
    const mono = trails.size > 24;   // too many trails to colour individually: show one calm colour, width = how often
    const lanes = new Map();
    for (const s of spec.steps) {
      const pk = s.from < s.to ? s.from + '\u0000' + s.to : s.to + '\u0000' + s.from;
      const key = mono ? `${pk}|${s.from}` : `${pk}|${s.trailId}|${s.from}`;
      if (!lanes.has(key)) lanes.set(key, { pk, trailId: s.trailId, from: s.from, to: s.to, count: 0 });
      lanes.get(key).count++;
    }
    const byPair = d3.group([...lanes.values()], (l) => l.pk);
    const list = [];
    for (const [, arr] of byPair) arr.forEach((l, i) => list.push({ ...l, extra: (i - (arr.length - 1) / 2) * Math.min(6, 30 / arr.length), color: mono ? style.cursor : spec.colorOf(l.trailId) }));
    list.sort((p, q) => q.count - p.count);
    const capped = list.slice(0, 900);
    const ns = new Set(capped.flatMap((l) => [l.from, l.to]));
    if (spec.focus) ns.add(spec.focus);
    if (spec.edgeKey) for (const t of spec.edgeKey.split('\u0000')) ns.add(t);
    over = { ...spec, lanes: capped, nodes: ns, walk: spec.numbers ? [...spec.steps].sort((p, q) => p.order - q.order) : null };
    dirty = true; kick();
  }
  function setCursor(t) { cursor = t; dirty = true; kick(); }

  /* ---------- skins ---------- */
  function readStyle() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    style.link = v('--link', style.link); style.label = v('--label', style.label); style.labelBg = v('--label-bg', style.labelBg);
    style.labelStart = v('--label-start', style.labelStart); style.cursor = v('--cursor', style.cursor);
    style.font = v('--font-label', 'monospace'); style.weight = v('--label-weight', '400'); style.upper = v('--label-case', 'none') === 'uppercase';
    style.laneDash = v('--lane-dash', '6 6') !== 'none';
  }
  function setPalette(s) {
    skin = { shape: 'square', hollow: false, glow: true, edge: 'plain', bend: 0.12, labelSize: 14, walker: false, ...s };
    HUB = d3.interpolateRgbBasis(s.hub);
    TRAIL_COLORS.splice(0, TRAIL_COLORS.length, ...s.trails);
    readStyle();
    if (over) setHighlight(over);
    dirty = true; kick();
    // web fonts may arrive later: re-measure once they do
    document.fonts?.ready.then(() => { textW.clear(); dirty = true; kick(); });
  }
  function setView(v) {
    Object.assign(view, v);
    if ('fade' in v) rescore();
    dirty = true; kick();
  }

  /* ---------- camera ---------- */
  function bbox(list) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of list) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; }
    return x0 <= x1 ? [x0, y0, x1, y1] : null;
  }
  /** Fit the visible graph to the window, stretching it (up to 2.4×) to match the window's shape. */
  /** Box around the main body of the map: ignores the few far-flung one-off articles in big graphs. */
  function coreBox(list) {
    if (list.length < 150) return bbox(list);
    // fit to the articles that matter (the busiest quarter); faint one-off dots may sit at the edges
    const top = [...list].sort((p, q) => q.visits - p.visits).slice(0, Math.max(120, Math.round(list.length * 0.25)));
    list = top;
    const xs = list.map((n) => n.x).sort((p, q) => p - q), ys = list.map((n) => n.y).sort((p, q) => p - q);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
    return [q(xs, 0.01), q(ys, 0.01), q(xs, 0.99), q(ys, 0.99)];
  }
  function fit(animate = true) {
    const b = coreBox(visNodes.length ? visNodes : nodes); if (!b) return;
    const padX = 70, padY = 40, vw = Math.max(50, W - padX * 2 - 60), vh = Math.max(50, H - padY * 2);
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    const want = (vw / vh) / (bw / bh);
    if (want >= 1) { ax = Math.min(2.4, want); ay = 1; } else { ax = 1; ay = Math.min(2.4, 1 / want); }
    const k = Math.min(vw / (bw * ax), vh / (bh * ay));
    kFit = k;
    const t = d3.zoomIdentity.translate(W / 2 - 30 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
    (animate ? sel.transition().duration(550) : sel).call(zoom.transform, t);
  }
  function focusOn(titles, padLeft = 0) {
    const list = [...titles].map((t) => nodeBy.get(t)).filter(Boolean); if (!list.length) return;
    const b = bbox(list), vw = Math.max(150, W - padLeft - 220), vh = Math.max(100, H - 120);
    const bw = Math.max(40, b[2] - b[0]), bh = Math.max(40, b[3] - b[1]);
    const k = Math.max(0.15, Math.min(6, Math.min(vw / (bw * ax), vh / (bh * ay))));
    const t = d3.zoomIdentity.translate(padLeft + (W - padLeft) / 2 - 40 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
    sel.transition().duration(600).call(zoom.transform, t);
  }
  function settleAndFit() {
    // small graphs settle instantly; big ones settle in slices and fit when done
    if (simLeft > 0 && nodes.length < 400) { while (simLeft > 0) { sim.tick(); simLeft--; } simSlice(0); }
    fit(false);
  }
  function getPositions() {
    const out = {};
    for (const n of nodes) if (Number.isFinite(n.x)) out[n.title] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
    return out;
  }
  /** Forget all positions (a different history was loaded). */
  function reset() { posCache.clear(); nodeBy = new Map(); nodes = []; }
  function relayout() { posCache.clear(); for (const n of nodes) { n.fx = n.fy = null; n.x += (Math.random() - .5) * 2; } pinnedFresh = false; runSim(1, Math.min(300, 140 + nodes.length / 10)); }
  function neighbourhood(title, hops = 1) {
    const s = new Set([title]); let frontier = [title];
    for (let h = 0; h < hops; h++) { const next = []; for (const t of frontier) for (const m of adj.get(t) || []) if (!s.has(m)) { s.add(m); next.push(m); } frontier = next; }
    return s;
  }

  resize();
  return {
    update, reset, setVisible, setPalette, setHighlight, setCursor, setView, fit, focusOn, settleAndFit, getPositions, relayout, neighbourhood,
    screenOf: (t) => { const n = nodeBy.get(t); return n ? [sx(n.x), sy(n.y)] : null; },
    edgeMid: (i = 0) => { const d = drawn[i]; if (!d) return null; const u = 0.5; return [(1 - u) ** 2 * d.x1 + 2 * (1 - u) * u * d.cx + u * u * d.x2, (1 - u) ** 2 * d.y1 + 2 * (1 - u) * u * d.cy + u * u * d.y2]; },
    hasNode: (t) => nodeBy.has(t), isSettling: () => simLeft > 0, drawMs: () => Math.round(drawMs * 10) / 10, stats: () => ({ nodes: visNodes.length, links: sorted.length, drawn: drawn.length }),
  };
}
