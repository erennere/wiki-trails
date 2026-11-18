// Time: the "30 days · 1 year · All" switch in the top bar, and the timeline under the map
// (bars = clicks per day/week; drag across it to pick any period).
import { app, on, setRange } from '../app.js';
import { timeSpan, visitTime } from '../model.js';
import { $, fmtDate } from '../ui.js';

const d3 = window.d3;

export function initTimeline() {
  let brush = null, x = null, silent = false;

  function markSeg() {
    document.querySelectorAll('#rangeseg button').forEach((b) => b.classList.toggle('on', b.dataset.range === app.rangeName));
    $('tllabel').textContent = app.range ? `${fmtDate(app.range[0])} – ${fmtDate(app.range[1])}` : 'All time';
  }

  function render() {
    const svg = d3.select('#tlsvg'), node = svg.node(), w = node.clientWidth || 600, h = node.clientHeight || 38;
    svg.selectAll('*').remove();
    const span = timeSpan(app.state);
    $('timeline').hidden = !span;
    if (!span) return;
    const days = (span[1] - span[0]) / 864e5;
    const binMs = days > 400 ? 7 * 864e5 : days > 3 ? 864e5 : 36e5; // weeks, days, or hours in the first days
    const t0 = span[0] - binMs / 2, t1 = Math.max(span[1], span[0] + 12 * binMs);
    const bins = new Map();
    for (const tr of app.state.trails) for (const v of tr.visits) {
      if (v.parent == null) continue;
      const b = Math.floor((visitTime(tr, v) - t0) / binMs);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    x = d3.scaleTime().domain([t0, t1 + binMs]).range([4, w - 4]);
    const mx = Math.max(1, ...bins.values()), y = d3.scaleSqrt().domain([0, mx]).range([0, h - 15]);
    const bw = Math.max(1, x(t0 + binMs) - x(t0) - 0.5);
    svg.append('g').selectAll('rect').data([...bins]).join('rect').attr('class', 'bar')
      .attr('x', ([b]) => x(t0 + b * binMs)).attr('width', bw).attr('y', ([, c]) => h - 13 - y(c)).attr('height', ([, c]) => Math.max(1, y(c)));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 13})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 110))).tickSize(3));
    brush = d3.brushX().extent([[0, 0], [w, h - 13]]).on('end', (e) => {
      if (silent) return;
      if (!e.selection) return setRange(null, 'all');
      setRange(e.selection.map((px) => +x.invert(px)), 'custom');
    });
    const g = svg.append('g').attr('class', 'brush').call(brush);
    if (app.range) { silent = true; g.call(brush.move, [Math.max(4, x(app.range[0])), Math.min(w - 4, x(app.range[1]))]); silent = false; }
    markSeg();
  }

  function preset(name) {
    const span = timeSpan(app.state);
    if (name === 'all' || !span) setRange(null, 'all');
    else setRange([Math.max(span[0], span[1] - (+name) * 864e5), span[1] + 1], name);
    render();
  }

  document.querySelectorAll('#rangeseg button').forEach((b) => b.onclick = () => preset(b.dataset.range));
  new ResizeObserver(() => { clearTimeout(window.__tlT); window.__tlT = setTimeout(render, 150); }).observe($('tlsvg'));
  on('data', render);
  on('range', markSeg);
  return { render };
}
