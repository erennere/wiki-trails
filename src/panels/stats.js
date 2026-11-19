// Stats: how much you browsed and how deeply you read, week by week, every two weeks, or month by month.
// The top bar's time period (30 days, 1 year, custom…) limits which weeks or months are shown.
// Click a column to look at that period; click a page or trail to open it on the map.
import { app, on } from '../app.js';
import { visitTime } from '../model.js';
import { $, esc, plural } from '../ui.js';

const d3 = window.d3;
const DAY = 864e5;
const KINDS = [['week', 'Weekly'], ['fortnight', 'Every 2 weeks'], ['month', 'Monthly']];
const NOUN = { week: 'week', fortnight: 'two weeks', month: 'month' };
const ANCHOR = new Date(2024, 0, 1).getTime(); // a Monday; two-week blocks are counted from here

/* ---------- periods ---------- */
function startOf(t, kind) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  if (kind === 'month') { d.setDate(1); return d.getTime(); }
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  if (kind === 'fortnight' && Math.round((d - ANCHOR) / (7 * DAY)) % 2 !== 0) d.setDate(d.getDate() - 7);
  return d.getTime();
}
function nextOf(s, kind) {
  const d = new Date(s);
  if (kind === 'month') d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + (kind === 'week' ? 7 : 14));
  return d.getTime();
}
const fMonthYear = d3.timeFormat('%B %Y'), fDay = d3.timeFormat('%b %-d'), fDayNum = d3.timeFormat('%-d'), fYear = d3.timeFormat('%Y');
function nameOf(p, kind) {
  if (kind === 'month') return fMonthYear(p.s);
  const last = p.e - DAY, a = new Date(p.s), b = new Date(last);
  const range = a.getMonth() === b.getMonth() ? `${fDay(a)} – ${fDayNum(b)}` : `${fDay(a)} – ${fDay(b)}`;
  return `${range}, ${fYear(b)}`;
}
const axisName = (s, kind) => (kind === 'month' ? d3.timeFormat(new Date(s).getMonth() === 0 ? '%b %Y' : '%b')(s) : fDay(s));

/** Everything the page shows, per period. */
function compute(kind) {
  const D = app.D, first = new Map(), visits = [];
  for (const ti of D.trailIndex.values()) {
    const tr = ti.trail;
    for (const v of tr.visits) {
      const t = visitTime(tr, v);
      visits.push({ t, a: v.article, tr, d: ti.depth.get(v.id)?.depth || null, root: v.parent == null });
      if (!(first.get(v.article) <= t)) first.set(v.article, t);
    }
  }
  if (!visits.length) return null;
  let lo = d3.min(visits, (v) => v.t), hi = Math.max(d3.max(visits, (v) => v.t), Date.now());
  if (app.range) { lo = Math.max(lo, app.range[0]); hi = Math.min(hi, app.range[1]); }
  const periods = [];
  for (let s = startOf(lo, kind); s <= hi && periods.length < 2000; s = nextOf(s, kind)) {
    periods.push({ s, e: nextOf(s, kind), pages: 0, read: 0, skim: 0, none: 0, fresh: 0, arts: new Map(), reads: new Map(), skims: new Map(), starts: new Map(), trails: new Set() });
  }
  const at = d3.bisector((p) => p.s).right;
  for (const v of visits) {
    const p = periods[at(periods, v.t) - 1];
    if (!p || v.t >= p.e) continue;
    p.pages++; p[v.d || 'none']++;
    p.arts.set(v.a, (p.arts.get(v.a) || 0) + 1);
    if (v.d === 'read') p.reads.set(v.a, (p.reads.get(v.a) || 0) + 1);
    if (v.d === 'skim') p.skims.set(v.a, (p.skims.get(v.a) || 0) + 1);
    if (first.get(v.a) === v.t) p.fresh++;
    if (v.root) { p.starts.set(v.a, (p.starts.get(v.a) || 0) + 1); p.trails.add(v.tr); }
  }
  for (const p of periods) {
    const known = p.read + p.skim;
    p.share = known ? p.read / known : null;
    p.longest = [...p.trails].sort((x, y) => y.visits.length - x.visits.length)[0] || null;
  }
  return periods;
}

/* ---------- the view ---------- */
export function initStats({ openArticle, openTrail }) {
  const box = $('statsview');
  // the chosen period is remembered by its start date, so it survives a change of time range
  let kind = app.settings.statsKind || 'week', periods = null, sel = null, selS = null, showTable = false;
  const tip = document.createElement('div'); tip.className = 'tip stip'; tip.hidden = true;

  function colours() {
    const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    const ok = (c) => c && d3.color(c);
    const surface = ok(v('--win-bg')) ? v('--win-bg') : '#ffffff';
    const read = ok(v('--read')) ? v('--read') : ok(v('--accent')) ? v('--accent') : '#1c5cab';
    return {
      read, surface,
      skim: ok(v('--skim')) ? v('--skim') : d3.interpolateRgb(read, surface)(0.5),
      none: ok(v('--unread')) ? v('--unread') : d3.interpolateRgb(ok(v('--muted')) ? v('--muted') : '#888', surface)(0.65),
    };
  }

  function render() {
    if (document.documentElement.dataset.view !== 'stats') return;
    periods = compute(kind);
    if (!periods || !periods.length) {
      box.innerHTML = `<div class="stats-empty"><h2>No stats yet</h2><p>Record a few trails, or load an example from the File menu, and your weeks will show up here.</p></div>`;
      return;
    }
    sel = selS == null ? -1 : periods.findIndex((x) => x.s <= selS && selS < x.e);
    if (sel < 0) { // the latest period with anything in it
      sel = periods.length - 1;
      while (sel > 0 && !periods[sel].pages) sel--;
    }
    selS = periods[sel].s;
    const p = periods[sel], q = periods[sel - 1] || null, C = colours();
    box.innerHTML = `
      <div class="stats-bar">
        <div class="seg" id="skind" role="group" aria-label="Period length">${KINDS.map(([k, n]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="snav">
          <button class="btn small" id="sprev" aria-label="Previous ${NOUN[kind]}"${sel > 0 ? '' : ' disabled'}>‹</button>
          <span class="sname">${esc(nameOf(p, kind))}</span>
          <button class="btn small" id="snext" aria-label="Next ${NOUN[kind]}"${sel < periods.length - 1 ? '' : ' disabled'}>›</button>
        </div>
        <span class="hint">${app.range ? 'Limited to the period chosen in the top bar.' : ''}</span>
      </div>
      <div class="tiles">
        ${tile('Pages opened', p.pages, q && q.pages, (n) => n.toLocaleString())}
        ${tile('Read thoroughly', p.share == null ? null : p.share, q && q.share, (x) => `${Math.round(x * 100)}%`, 'pts', p.share == null ? 'nothing marked' : `${p.read.toLocaleString()} read · ${p.skim.toLocaleString()} skimmed`)}
        ${tile('Different pages', p.arts.size, q && q.arts.size, (n) => n.toLocaleString())}
        ${tile('New to you', p.fresh, q && q.fresh, (n) => n.toLocaleString(), null, 'first time ever')}
        ${tile('Trails started', p.trails.size, q && q.trails.size, (n) => n.toLocaleString())}
        ${tile('Longest trail', p.longest ? p.longest.visits.length : null, null, (n) => plural(n, 'page'), null, p.longest ? `<button class="linkish" data-trail="${p.longest.id}" title="Show this trail on the map">${esc(trailName(p.longest))}</button>` : '')}
      </div>
      <section class="chart-card">
        <div class="chart-head"><h3>Pages per ${NOUN[kind]}</h3>
          <div class="legend"><span><i style="background:${C.read}"></i>Read</span><span><i style="background:${C.skim}"></i>Skimmed</span><span><i style="background:${C.none}"></i>Not known</span></div></div>
        <div class="chart" id="cpages"></div>
      </section>
      <section class="chart-card">
        <div class="chart-head"><h3>Share of pages you read thoroughly</h3><span class="hint">of the pages marked read or skimmed</span></div>
        <div class="chart" id="cshare"></div>
      </section>
      <div class="slists">
        ${list('Most visited', p.arts, p, 'pages')}
        ${list('Read most', p.reads, p, 'read')}
        ${list('Skimmed most', p.skims, p, 'skimmed')}
        ${list('Where your trails started', p.starts, p, 'trails')}
      </div>
      <section class="chart-card">
        <button class="btn small" id="stable">${showTable ? 'Hide the table' : 'Show every ' + NOUN[kind] + ' as a table'}</button>
        ${showTable ? tableHTML() : ''}
      </section>`;
    box.appendChild(tip);
    drawPages($('cpages'), C);
    drawShare($('cshare'), C);
  }
  const trailName = (tr) => tr.name || `${tr.visits[0].article} → ${tr.visits[tr.visits.length - 1].article}`;

  function tile(label, value, prev, fmt, unit = null, sub = '') {
    let delta = '';
    if (value != null && prev != null) {
      const dv = unit === 'pts' ? Math.round((value - prev) * 100) : value - prev;
      const pct = unit !== 'pts' && prev ? Math.round(((value - prev) / prev) * 100) : null;
      delta = dv === 0 ? `<span class="delta">same as the ${NOUN[kind]} before</span>`
        : `<span class="delta">${dv > 0 ? '▲' : '▼'} ${Math.abs(dv).toLocaleString()}${unit === 'pts' ? (Math.abs(dv) === 1 ? ' point' : ' points') : ''}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} vs the ${NOUN[kind]} before</span>`;
    }
    return `<div class="tile"><div class="tl">${label}</div><div class="tv">${value == null ? '–' : fmt(value)}</div>${sub ? `<div class="ts">${sub}</div>` : ''}${delta}</div>`;
  }

  function list(title, m, p, what) {
    const rows = [...m].sort((x, y) => y[1] - x[1]).slice(0, 8);
    const body = rows.length ? rows.map(([a, n]) => {
      const r = p.reads.get(a) || 0, s = p.skims.get(a) || 0, tot = p.arts.get(a) || n;
      return `<li data-a="${esc(a)}" title="Show ${esc(a)} on the map"><span class="l">${esc(a)}</span>
        <span class="mini" aria-hidden="true"><i class="r" style="flex:${r}"></i><i class="s" style="flex:${s}"></i><i class="u" style="flex:${Math.max(0, tot - r - s)}"></i></span>
        <span class="c">${n.toLocaleString()}</span></li>`;
    }).join('') : `<li class="none">Nothing ${what} in this ${NOUN[kind]}.</li>`;
    return `<section class="slist"><h4>${title}</h4><ol>${body}</ol></section>`;
  }

  function tableHTML() {
    const rows = [...periods].reverse().map((p) => `<tr${p === periods[sel] ? ' class="on"' : ''}><td>${esc(nameOf(p, kind))}</td><td>${p.pages.toLocaleString()}</td><td>${p.read.toLocaleString()}</td><td>${p.skim.toLocaleString()}</td><td>${p.none.toLocaleString()}</td><td>${p.share == null ? '–' : Math.round(p.share * 100) + '%'}</td><td>${p.fresh.toLocaleString()}</td><td>${p.trails.size.toLocaleString()}</td></tr>`).join('');
    return `<div class="stable-wrap"><table class="stable"><thead><tr><th>${kind === 'month' ? 'Month' : 'Period'}</th><th>Pages</th><th>Read</th><th>Skimmed</th><th>Not known</th><th>Read share</th><th>New</th><th>Trails</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* ---------- charts ---------- */
  const M = { top: 10, right: 12, bottom: 30, left: 40 };
  function frame(el, h) {
    const w = Math.max(320, el.clientWidth);
    const svg = d3.select(el).append('svg').attr('width', w).attr('height', h).attr('role', 'img');
    const x = d3.scaleBand().domain(periods.map((p, i) => i)).range([M.left, w - M.right]).paddingInner(periods.length > 60 ? 0.12 : 0.3).paddingOuter(0.1);
    return { svg, w, h, x };
  }
  function xAxis(svg, x, h) {
    const step = Math.max(1, Math.ceil(periods.length / Math.max(1, Math.floor((x.range()[1] - x.range()[0]) / 64))));
    const g = svg.append('g').attr('class', 'xaxis').attr('transform', `translate(0,${h - M.bottom + 22})`);
    periods.forEach((p, i) => {
      if (i % step && i !== sel) return;
      if (i !== sel && Math.abs(i - sel) < step / 1.5) return; // keep the selected label readable
      g.append('text').attr('x', x(i) + x.bandwidth() / 2).attr('class', i === sel ? 'on' : '').attr('text-anchor', 'middle').text(axisName(p.s, kind));
    });
  }
  function grid(svg, y, w, fmt) {
    const g = svg.append('g').attr('class', 'grid');
    for (const t of y.ticks(4)) {
      g.append('line').attr('x1', M.left).attr('x2', w - M.right).attr('y1', y(t)).attr('y2', y(t));
      g.append('text').attr('x', M.left - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(fmt(t));
    }
  }
  // a column whose top corners are rounded and whose base stays square
  const topRounded = (x, y, w, h, r) => { r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };

  function drawPages(el, C) {
    const h = 220, { svg, w, x } = frame(el, h);
    svg.attr('aria-label', `Pages per ${NOUN[kind]}, read, skimmed and not known`);
    const max = d3.max(periods, (p) => p.pages) || 1;
    const y = d3.scaleLinear().domain([0, max]).nice(4).range([h - M.bottom, M.top]);
    grid(svg, y, w, (t) => (t >= 10000 ? d3.format('.2~s')(t) : t.toLocaleString()));
    const bw = Math.min(24, x.bandwidth());
    periods.forEach((p, i) => {
      const cx = x(i) + (x.bandwidth() - bw) / 2;
      let base = y(0);
      const parts = [['read', C.read], ['skim', C.skim], ['none', C.none]].filter(([k]) => p[k] > 0);
      parts.forEach(([k, col], j) => {
        const top = y(y.invert(base) + p[k]), hgt = base - top - (j < parts.length - 1 && base - top > 3 ? 2 : 0); // 2px surface gap between segments
        if (hgt <= 0) return;
        const last = j === parts.length - 1;
        svg.append('path').attr('d', last ? topRounded(cx, base - hgt - (j ? 0 : 0), bw, hgt, 4) : `M${cx},${base}V${base - hgt}H${cx + bw}V${base}Z`).attr('fill', col).attr('class', 'seg-mark');
        base = top;
      });
      // the whole column is the hover and click target
      svg.append('rect').attr('class', 'hit').attr('x', x(i)).attr('width', x.bandwidth()).attr('y', M.top).attr('height', h - M.bottom - M.top)
        .attr('tabindex', 0).attr('aria-label', `${nameOf(p, kind)}: ${p.pages} pages, ${p.read} read, ${p.skim} skimmed, ${p.none} not known`)
        .on('pointermove focus', (ev) => showTip(ev, p, el))
        .on('pointerleave blur', () => { tip.hidden = true; })
        .on('click', () => { selS = p.s; render(); })
        .on('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selS = p.s; render(); } });
    });
    svg.append('line').attr('class', 'baseline').attr('x1', M.left).attr('x2', w - M.right).attr('y1', y(0)).attr('y2', y(0));
    mark(svg, x, y(0));
    xAxis(svg, x, h);
  }
  // a small marker under the chosen period
  function mark(svg, x, y0) {
    const c = x(sel) + x.bandwidth() / 2;
    svg.append('path').attr('class', 'selmark').attr('d', `M${c},${y0 + 2}l5,6h-10z`);
  }

  function drawShare(el, C) {
    const h = 150, { svg, w, x } = frame(el, h);
    svg.attr('aria-label', `Share of pages read thoroughly per ${NOUN[kind]}`);
    const y = d3.scaleLinear().domain([0, 1]).range([h - M.bottom, M.top]);
    grid(svg, y, w, d3.format('.0%'));
    const cx = (i) => x(i) + x.bandwidth() / 2;
    const pts = periods.map((p, i) => [i, p.share]);
    const defined = (d) => d[1] != null;
    svg.append('path').attr('class', 'area').attr('fill', C.read).attr('d', d3.area().defined(defined).x((d) => cx(d[0])).y0(y(0)).y1((d) => y(d[1])).curve(d3.curveMonotoneX)(pts));
    svg.append('path').attr('class', 'line').attr('stroke', C.read).attr('d', d3.line().defined(defined).x((d) => cx(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX)(pts));
    const p = periods[sel];
    mark(svg, x, y(0));
    if (p.share != null) svg.append('circle').attr('class', 'dot').attr('cx', cx(sel)).attr('cy', y(p.share)).attr('r', 5).attr('fill', C.read).attr('stroke', C.surface);
    svg.append('line').attr('class', 'baseline').attr('x1', M.left).attr('x2', w - M.right).attr('y1', y(0)).attr('y2', y(0));
    // crosshair: snaps to the nearest period
    const cross = svg.append('line').attr('class', 'cross').attr('y1', M.top).attr('y2', h - M.bottom).style('display', 'none');
    svg.append('rect').attr('class', 'hit').attr('x', M.left).attr('width', w - M.left - M.right).attr('y', M.top).attr('height', h - M.top - M.bottom)
      .on('pointermove', (ev) => {
        const [mx] = d3.pointer(ev), i = Math.max(0, Math.min(periods.length - 1, Math.round((mx - x(0) - x.bandwidth() / 2) / x.step())));
        cross.attr('x1', cx(i)).attr('x2', cx(i)).style('display', null);
        showTip(ev, periods[i], el, true);
      })
      .on('pointerleave', () => { cross.style('display', 'none'); tip.hidden = true; })
      .on('click', (ev) => { const [mx] = d3.pointer(ev); selS = periods[Math.max(0, Math.min(periods.length - 1, Math.round((mx - x(0) - x.bandwidth() / 2) / x.step())))].s; render(); });
    xAxis(svg, x, h);
  }

  function showTip(ev, p, el, share = false) {
    const C = colours(), key = (c) => `<i class="k" style="background:${c}"></i>`;
    tip.innerHTML = '';
    const head = document.createElement('div'); head.className = 'th'; head.textContent = nameOf(p, kind); tip.appendChild(head);
    const rows = share
      ? [[C.read, p.share == null ? 'nothing marked' : `${Math.round(p.share * 100)}%`, 'read thoroughly']]
      : [[C.read, p.read, 'read'], [C.skim, p.skim, 'skimmed'], [C.none, p.none, 'not known']];
    tip.insertAdjacentHTML('beforeend', rows.map(([c, v, n]) => `<div class="tr">${key(c)}<b>${typeof v === 'number' ? v.toLocaleString() : v}</b> ${n}</div>`).join('') + (share ? '' : `<div class="tr tot"><b>${p.pages.toLocaleString()}</b> pages in all</div>`));
    tip.hidden = false;
    const r = box.getBoundingClientRect(), tw = tip.offsetWidth;
    let left = ev.clientX - r.left + box.scrollLeft + 14;
    if (left + tw > box.clientWidth - 8) left = ev.clientX - r.left + box.scrollLeft - tw - 14;
    tip.style.left = left + 'px';
    tip.style.top = (ev.clientY - r.top + box.scrollTop + 12) + 'px';
  }

  box.addEventListener('click', (e) => {
    const k = e.target.closest('#skind [data-k]');
    if (k) { kind = k.dataset.k; app.settings.statsKind = kind; return render(); } // stays on the period around the same date
    if (e.target.closest('#sprev')) { selS = periods[Math.max(0, sel - 1)].s; return render(); }
    if (e.target.closest('#snext')) { selS = periods[Math.min(periods.length - 1, sel + 1)].s; return render(); }
    if (e.target.closest('#stable')) { showTable = !showTable; return render(); }
    const a = e.target.closest('li[data-a]'); if (a) return openArticle(a.dataset.a);
    const t = e.target.closest('[data-trail]'); if (t) return openTrail(t.dataset.trail);
  });
  let rz;
  new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(render, 120); }).observe(box);
  for (const ev of ['data', 'range', 'skin']) on(ev, render);
  return { render };
}
