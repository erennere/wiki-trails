// Force-directed "brain" graph: one connection per pair of articles,
// thicker and brighter the more often you clicked between them.
const d3 = window.d3;

// VGA bright palette
export const TRAIL_COLORS = ['#ffff55', '#55ffff', '#ff55ff', '#ff5555', '#55ff55', '#ffaa00', '#7f7fff', '#ffffff', '#ff9ecf', '#aaff00'];
let HUB = d3.interpolateRgbBasis(['#1d6b36', '#2fd35a', '#a8ff4d', '#ffe14d', '#ffaa00']);

const radius = (n) => Math.round(3 + 1.9 * Math.sqrt(n.visits));
let BEND = 0.12, SHAPE = 'square', HOLLOW = false, LABEL_SIZE = 15, WALKER = false;

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
const width = (l) => Math.min(11, 0.7 + 1.9 * Math.log2(1 + l.total));
const alpha = (l) => Math.min(0.9, 0.2 + 0.16 * Math.log2(1 + l.total));

export function createGraph(svgEl, handlers) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  const defs = svg.append('defs');
  defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    .call((f) => { f.append('feGaussianBlur').attr('stdDeviation', 3.2).attr('result', 'b'); const m = f.append('feMerge'); m.append('feMergeNode').attr('in', 'b'); m.append('feMergeNode').attr('in', 'SourceGraphic'); });
  defs.append('filter').attr('id', 'softglow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    .append('feGaussianBlur').attr('stdDeviation', 5);

  const root = svg.append('g');
  const gLinks = root.append('g').attr('class', 'links');
  const gStrong = root.append('g').attr('class', 'links strong').attr('filter', 'url(#glow)');
  const gOver = root.append('g').attr('class', 'overlay');
  const gNodes = root.append('g').attr('class', 'nodes');
  const gBadges = root.append('g').attr('class', 'badges');

  let k = 1;
  const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => { root.attr('transform', e.transform); k = e.transform.k; updateLabels(); });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (e) => { if (e.target === svgEl) handlers.onBackground?.(); });

  let nodes = [], links = [], nodeBy = new Map(), linkBy = new Map();
  let over = null; // current highlight
  let cursor = null;
  let maxDeg = 1;
  let labelRank = () => 1;

  const sim = d3.forceSimulation()
    .force('link', d3.forceLink().id((d) => d.title)
      .distance((l) => 28 + 110 / (1 + 0.7 * Math.log2(1 + l.total)))
      .strength((l) => Math.min(1, 0.12 + 0.16 * Math.log2(1 + l.total))))
    .force('charge', d3.forceManyBody().strength((n) => -180 - 30 * Math.sqrt(n.visits)).distanceMax(600))
    .force('collide', d3.forceCollide((n) => radius(n) + 7))
    .force('x', d3.forceX().strength(0.035))
    .force('y', d3.forceY().strength(0.045))
    .alphaDecay(0.03)
    .on('tick', tick);

  // Quadratic curve between two nodes with a gentle, consistent bend.
  function ctrl(s, t, extra = 0) {
    const dx = t.x - s.x, dy = t.y - s.y, len = Math.hypot(dx, dy) || 1;
    const bend = len * BEND + extra;
    return { x: (s.x + t.x) / 2 - (dy / len) * bend, y: (s.y + t.y) / 2 + (dx / len) * bend };
  }
  function curve(aTitle, bTitle, fromTitle, extra = 0) {
    const a = nodeBy.get(aTitle), b = nodeBy.get(bTitle);
    if (!a || !b) return { d: '', mid: null };
    const c = ctrl(a, b, extra);
    const [s, t] = fromTitle === aTitle ? [a, b] : [b, a];
    // point and tangent at t=0.58 along from->to
    const u = 0.58, x = (1 - u) ** 2 * s.x + 2 * (1 - u) * u * c.x + u * u * t.x, y = (1 - u) ** 2 * s.y + 2 * (1 - u) * u * c.y + u * u * t.y;
    const tx = 2 * (1 - u) * (c.x - s.x) + 2 * u * (t.x - c.x), ty = 2 * (1 - u) * (c.y - s.y) + 2 * u * (t.y - c.y);
    return { d: `M${s.x},${s.y}Q${c.x},${c.y} ${t.x},${t.y}`, mid: { x, y, ang: Math.atan2(ty, tx) } };
  }

  function tick() {
    gLinks.selectAll('path').attr('d', (l) => curve(l.a, l.b, l.a).d);
    gStrong.selectAll('path').attr('d', (l) => curve(l.a, l.b, l.a).d);
    gNodes.selectAll('g.node').attr('transform', (n) => `translate(${n.x},${n.y})`);
    if (over) drawOverlay(false);
  }

  function update(derived) {
    const old = new Map(nodes.map((n) => [n.title, n]));
    nodes = [...derived.articles.values()].map((a) => {
      const o = old.get(a.title);
      return Object.assign(o || { x: (Math.random() - 0.5) * 80, y: (Math.random() - 0.5) * 80 }, { title: a.title, visits: a.visits, isStart: a.starts.size > 0, deg: 0 });
    });
    nodeBy = new Map(nodes.map((n) => [n.title, n]));
    // New articles appear next to the article they were reached from.
    for (const l of derived.links.values()) {
      const A = nodeBy.get(l.a), B = nodeBy.get(l.b);
      A.deg += l.total; B.deg += l.total;
      if (!old.has(l.a) && old.has(l.b)) { A.x = B.x + (Math.random() - 0.5) * 40; A.y = B.y + (Math.random() - 0.5) * 40; }
      if (!old.has(l.b) && old.has(l.a)) { B.x = A.x + (Math.random() - 0.5) * 40; B.y = A.y + (Math.random() - 0.5) * 40; }
    }
    maxDeg = Math.max(1, ...nodes.map((n) => n.deg));
    links = [...derived.links.values()].map((l) => ({ ...l, source: l.a, target: l.b }));
    linkBy = new Map(links.map((l) => [l.key, l]));

    gLinks.selectAll('path').data(links.filter((l) => l.total < 3), (l) => l.key).join('path')
      .attr('class', 'link').attr('stroke-width', width).attr('stroke-opacity', alpha);
    gStrong.selectAll('path').data(links.filter((l) => l.total >= 3), (l) => l.key).join('path')
      .attr('class', 'link').attr('stroke-width', width).attr('stroke-opacity', alpha);
    const vs = nodes.map((n) => n.visits).sort((a, b) => b - a);
    labelRank = (count) => vs[Math.min(vs.length - 1, Math.max(0, Math.round(count) - 1))] ?? 1;

    const sel = gNodes.selectAll('g.node').data(nodes, (n) => n.title);
    sel.exit().remove();
    const ent = sel.enter().append('g').attr('class', 'node')
      .on('mouseenter', (e, n) => handlers.onHover?.(n.title, n))
      .on('mouseleave', () => handlers.onHover?.(null))
      .on('click', (e, n) => { e.stopPropagation(); handlers.onClick?.(n.title); })
      .call(d3.drag()
        .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.2).restart(); n.fx = n.x; n.fy = n.y; })
        .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y; })
        .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); n.fx = null; n.fy = null; }));
    ent.append('path').attr('class', 'core');
    ent.append('text').attr('class', 'lbl');
    ent.append('title');
    const all = ent.merge(sel);
    paintNodes(all);
    all.select('text').attr('dy', '0.35em').text((n) => n.title);
    all.select('title').text((n) => `${n.title}\n${n.visits} visit${n.visits === 1 ? '' : 's'}${n.isStart ? ' · trail start' : ''}`);
    all.classed('start', (n) => n.isStart).classed('cursor', (n) => n.title === cursor);

    sim.nodes(nodes);
    sim.force('link').links(links);
    sim.alpha(old.size ? 0.5 : 1).restart();
    updateLabels();
    if (over) setHighlight(over);
  }

  function paintNodes(sel = gNodes.selectAll('g.node')) {
    const col = (n) => HUB(Math.log1p(n.deg) / Math.log1p(maxDeg));
    sel.select('path.core')
      .attr('d', (n) => shapePath(SHAPE, radius(n)))
      .attr('shape-rendering', SHAPE === 'square' ? 'crispEdges' : null)
      .attr('fill', col).style('color', col);
  }

  function updateLabels() {
    const lit = over ? over.nodes : null;
    let litRank = () => 1;
    if (lit) { const vs = [...lit].map((t) => nodeBy.get(t)?.visits ?? 0).sort((x, y) => y - x); litRank = (c) => vs[Math.min(vs.length - 1, Math.round(c) - 1)] ?? 1; }
    gNodes.selectAll('g.node').select('text')
      .attr('opacity', (n) => {
        const z = Math.max(1, k * k);
        if (lit) return lit.has(n.title) && (lit.size <= 45 * z || n.visits >= litRank(45 * z) || n.title === over?.focus) ? 1 : 0;
        if (n.title === cursor || nodes.length <= 40) return 1;
        return n.visits >= labelRank(24 * z) ? 1 : 0;
      })
      .style('font-size', `${LABEL_SIZE / k}px`).attr('x', (n) => radius(n) * (SHAPE === 'star' || SHAPE === 'spark' ? 1.5 : 1.2) + 5 / k).style('stroke-width', `${4 / k}px`);
  }

  // spec: { steps:[{trailId, from, to, order}], colorOf(trailId), numbers: Map(title -> n) | null, focus }
  function setHighlight(spec) {
    over = spec ? { ...spec, nodes: new Set(spec.steps.flatMap((s) => [s.from, s.to]).concat(spec.focus ? [spec.focus] : [])) } : null;
    const lit = over?.nodes;
    gNodes.selectAll('g.node').classed('dim', (n) => lit && !lit.has(n.title)).classed('focus', (n) => over?.focus === n.title);
    gLinks.selectAll('path').classed('dim', !!over);
    gStrong.selectAll('path').classed('dim', !!over);
    drawOverlay(true);
    updateLabels();
  }

  function drawOverlay(rebuild) {
    if (!over) { gOver.selectAll('*').remove(); gBadges.selectAll('*').remove(); return; }
    if (rebuild) {
      // one lane per (pair, trail, direction); lanes fan out a little so trails stay distinguishable
      const lanes = new Map();
      for (const s of over.steps) {
        const pk = s.from < s.to ? s.from + '\u0000' + s.to : s.to + '\u0000' + s.from;
        const lk = `${pk}|${s.trailId}|${s.from}`;
        if (!lanes.has(lk)) lanes.set(lk, { pk, trailId: s.trailId, from: s.from, to: s.to, count: 0 });
        lanes.get(lk).count++;
      }
      const perPair = d3.group([...lanes.values()], (l) => l.pk);
      const data = [];
      for (const [, arr] of perPair) arr.forEach((l, i) => data.push({ ...l, extra: (i - (arr.length - 1) / 2) * Math.min(6, 36 / arr.length), id: `${l.pk}|${l.trailId}|${l.from}` }));
      over.lanes = data;
      gOver.selectAll('*').remove();
      const g = gOver.selectAll('g.lane').data(data, (d) => d.id).join('g').attr('class', 'lane');
      g.append('path').attr('class', 'lane-glow').attr('opacity', data.length > 80 ? 0.12 : null).attr('stroke', (d) => over.colorOf(d.trailId)).attr('stroke-width', (d) => 4 + 2 * Math.log2(1 + d.count));
      g.append('path').attr('class', 'lane-flow').attr('stroke', (d) => over.colorOf(d.trailId)).attr('stroke-width', (d) => 1.6 + 1.2 * Math.log2(1 + d.count));
      g.append('path').attr('class', 'lane-arrow').attr('fill', (d) => over.colorOf(d.trailId)).attr('shape-rendering', 'crispEdges').attr('d', 'M-4,-5L-4,5L1,5L1,3L3,3L3,1L5,1L5,-1L3,-1L3,-3L1,-3L1,-5Z');
      gBadges.selectAll('*').remove();
      over.walk = null;
      if (WALKER && over.numbers && over.steps.length) {
        over.walk = [...over.steps].sort((x, y) => x.order - y.order);
        const wk = gBadges.append('g').attr('class', 'walker');
        wk.append('path').attr('d', 'M0,-9L7,2L3,2L3,8L-3,8L-3,2L-7,2Z');
        wk.append('animateMotion').attr('dur', `${Math.max(4, over.walk.length * 1.1)}s`).attr('repeatCount', 'indefinite').attr('rotate', '0');
      }
      if (over.numbers) {
        const b = gBadges.selectAll('g.badge').data([...over.numbers].filter(([t]) => nodeBy.has(t))).join('g').attr('class', 'badge');
        b.append('rect').attr('x', -9).attr('y', -8).attr('width', 18).attr('height', 16);
        b.append('text').attr('dy', '0.35em').text(([, n]) => n);
      }
    }
    gOver.selectAll('g.lane').each(function (d) {
      const [a, b] = d.pk.split('\u0000');
      const c = curve(a, b, d.from, d.extra);
      const g = d3.select(this);
      g.selectAll('path.lane-glow, path.lane-flow').attr('d', c.d);
      if (c.mid) g.select('path.lane-arrow').attr('transform', `translate(${c.mid.x},${c.mid.y}) rotate(${(c.mid.ang * 180) / Math.PI})`);
    });
    if (over.walk) gBadges.select('g.walker animateMotion').attr('path', over.walk.map((st) => { const [a, b] = st.from < st.to ? [st.from, st.to] : [st.to, st.from]; return curve(a, b, st.from).d; }).join(' '));
    gBadges.selectAll('g.badge').attr('transform', ([t]) => { const n = nodeBy.get(t); return `translate(${n.x - radius(n) - 9},${n.y - radius(n) - 9})`; });
  }

  function setCursor(title) {
    cursor = title;
    gNodes.selectAll('g.node').classed('cursor', (n) => n.title === cursor);
    updateLabels();
  }

  function fit(animate = true) {
    if (!nodes.length) return;
    const box = svgEl.getBoundingClientRect();
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 160, y0 = Math.min(...ys) - 50, y1 = Math.max(...ys) + 50;
    const s = Math.min(1.6, 0.92 * Math.min(box.width / (x1 - x0), box.height / (y1 - y0)));
    const t = d3.zoomIdentity.translate(box.width / 2 - s * (x0 + x1) / 2, box.height / 2 - s * (y0 + y1) / 2).scale(s);
    (animate ? svg.transition().duration(600) : svg).call(zoom.transform, t);
  }

  /** Zoom to a set of articles (used when a highlight is pinned). */
  function focusOn(titles, padLeft = 0) {
    const pts = [...titles].map((t) => nodeBy.get(t)).filter(Boolean);
    if (!pts.length) return;
    const full = svgEl.getBoundingClientRect();
    const box = { width: Math.max(200, full.width - padLeft), height: full.height };
    const xs = pts.map((n) => n.x), ys = pts.map((n) => n.y);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 140, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const s = Math.max(0.3, Math.min(2.2, 0.85 * Math.min(box.width / (x1 - x0), box.height / (y1 - y0))));
    const t = d3.zoomIdentity.translate(full.width - box.width + box.width / 2 - s * (x0 + x1) / 2, box.height / 2 - s * (y0 + y1) / 2).scale(s);
    svg.transition().duration(650).call(zoom.transform, t);
  }

  /** Let the layout settle, then fit. */
  function settleAndFit() {
    sim.stop();
    for (let i = 0; i < 220; i++) sim.tick();
    tick(); fit(false); sim.alpha(0.05).restart();
  }

  /** Swap colours for a skin: hub = node gradient, trails = trail colours. */
  function setPalette(skin) {
    HUB = d3.interpolateRgbBasis(skin.hub);
    TRAIL_COLORS.splice(0, TRAIL_COLORS.length, ...skin.trails);
    SHAPE = skin.shape || 'square'; HOLLOW = !!skin.hollow; BEND = skin.bend ?? 0.12; LABEL_SIZE = skin.labelSize || 15; WALKER = !!skin.walker;
    gStrong.attr('filter', skin.glow === false ? null : 'url(#glow)');
    svg.attr('class', `edge-${skin.edge || 'plain'}${HOLLOW ? ' hollow' : ''}`);
    paintNodes(); tick(); updateLabels();
    if (over) drawOverlay(true);
  }

  return { update, setPalette, setHighlight, setCursor, fit, focusOn, settleAndFit, hasNode: (t) => nodeBy.has(t) };
}
