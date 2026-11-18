// Force-directed "brain" graph: one connection per pair of articles,
// thicker and brighter the more often you clicked between them.
const d3 = window.d3;

export const TRAIL_COLORS = ['#f2b45a', '#4fc3c7', '#ef7f6b', '#9d8cff', '#7ed37a', '#ff8fc6', '#58a6ff', '#e6d45c', '#c77dff', '#5ce0b8'];
const HUB = d3.interpolateRgbBasis(['#5b6fd8', '#8f6de0', '#d4709f', '#ef8a5f', '#f2b45a']);

const radius = (n) => 4 + 2.4 * Math.sqrt(n.visits);
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
    const bend = len * 0.12 + extra;
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

    gLinks.selectAll('path').data(links, (l) => l.key).join('path')
      .attr('class', 'link')
      .attr('stroke-width', width)
      .attr('stroke-opacity', alpha)
      .attr('filter', (l) => (l.total >= 3 ? 'url(#glow)' : null));

    const sel = gNodes.selectAll('g.node').data(nodes, (n) => n.title);
    sel.exit().remove();
    const ent = sel.enter().append('g').attr('class', 'node')
      .on('mouseenter', (e, n) => handlers.onHover?.(n.title))
      .on('mouseleave', () => handlers.onHover?.(null))
      .on('click', (e, n) => { e.stopPropagation(); handlers.onClick?.(n.title); })
      .call(d3.drag()
        .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.2).restart(); n.fx = n.x; n.fy = n.y; })
        .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y; })
        .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); n.fx = null; n.fy = null; }));
    ent.append('circle').attr('class', 'halo');
    ent.append('circle').attr('class', 'core');
    ent.append('text').attr('class', 'lbl');
    ent.append('title');
    const all = ent.merge(sel);
    all.select('circle.halo').attr('r', (n) => radius(n) + 5).attr('fill', (n) => HUB(Math.log1p(n.deg) / Math.log1p(maxDeg)));
    all.select('circle.core').attr('r', radius)
      .attr('fill', (n) => HUB(Math.log1p(n.deg) / Math.log1p(maxDeg)))
      .attr('stroke', (n) => (n.isStart ? '#fff' : 'rgba(255,255,255,.25)'))
      .attr('stroke-width', (n) => (n.isStart ? 2 : 1));
    all.select('text').attr('x', (n) => radius(n) + 6).attr('dy', '0.35em').text((n) => n.title);
    all.select('title').text((n) => `${n.title}\n${n.visits} visit${n.visits === 1 ? '' : 's'}${n.isStart ? ' · trail start' : ''}`);
    all.classed('start', (n) => n.isStart).classed('cursor', (n) => n.title === cursor);

    sim.nodes(nodes);
    sim.force('link').links(links);
    sim.alpha(old.size ? 0.5 : 1).restart();
    updateLabels();
    if (over) setHighlight(over);
  }

  function updateLabels() {
    const lit = over ? over.nodes : null;
    gNodes.selectAll('g.node').select('text')
      .attr('opacity', (n) => (lit ? (lit.has(n.title) ? 1 : 0) : n.visits >= 2 || n.isStart || n.title === cursor || k >= 1.15 || nodes.length <= 40 ? 1 : 0))
      .style('font-size', `${Math.max(10, 12.5 / Math.sqrt(k))}px`);
  }

  // spec: { steps:[{trailId, from, to, order}], colorOf(trailId), numbers: Map(title -> n) | null, focus }
  function setHighlight(spec) {
    over = spec ? { ...spec, nodes: new Set(spec.steps.flatMap((s) => [s.from, s.to]).concat(spec.focus ? [spec.focus] : [])) } : null;
    const lit = over?.nodes;
    gNodes.selectAll('g.node').classed('dim', (n) => lit && !lit.has(n.title)).classed('focus', (n) => over?.focus === n.title);
    gLinks.selectAll('path').classed('dim', !!over);
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
      for (const [, arr] of perPair) arr.forEach((l, i) => data.push({ ...l, extra: (i - (arr.length - 1) / 2) * 7, id: `${l.pk}|${l.trailId}|${l.from}` }));
      over.lanes = data;
      gOver.selectAll('*').remove();
      const g = gOver.selectAll('g.lane').data(data, (d) => d.id).join('g').attr('class', 'lane');
      g.append('path').attr('class', 'lane-glow').attr('stroke', (d) => over.colorOf(d.trailId)).attr('stroke-width', (d) => 4 + 2 * Math.log2(1 + d.count));
      g.append('path').attr('class', 'lane-flow').attr('stroke', (d) => over.colorOf(d.trailId)).attr('stroke-width', (d) => 1.6 + 1.2 * Math.log2(1 + d.count));
      g.append('path').attr('class', 'lane-arrow').attr('fill', (d) => over.colorOf(d.trailId)).attr('d', 'M-5,-4.5L6,0L-5,4.5Z');
      gBadges.selectAll('*').remove();
      if (over.numbers) {
        const b = gBadges.selectAll('g.badge').data([...over.numbers].filter(([t]) => nodeBy.has(t))).join('g').attr('class', 'badge');
        b.append('circle').attr('r', 8.5);
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
    gBadges.selectAll('g.badge').attr('transform', ([t]) => { const n = nodeBy.get(t); return `translate(${n.x - radius(n) - 6},${n.y - radius(n) - 6})`; });
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

  /** Let the layout settle, then fit. */
  function settleAndFit() {
    sim.stop();
    for (let i = 0; i < 220; i++) sim.tick();
    tick(); fit(false); sim.alpha(0.05).restart();
  }

  return { update, setHighlight, setCursor, fit, settleAndFit, hasNode: (t) => nodeBy.has(t) };
}
