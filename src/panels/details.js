// Details: explains whatever is selected. Nothing selected → an overview of your history.
import { app, on, select, trailOf, commit, snapshot, pinThread, pinned } from '../app.js';
import { trailLabel, trailShape, visitTime, timeSpan } from '../model.js';
import { $, esc, plural, fmtDate, fmtDateTime, fmtAgo, wikiUrl, stepsHTML, confirmClick, toast } from '../ui.js';

/** The colour of the thread drawn for this visit, if it's one of the threads on the map. */
const drawn = (trailId, visitId) => app.threads?.threads.find((x) => x.trailId === trailId && x.visitId === visitId) || null;
function swatch(trailId, visitId) {
  const th = drawn(trailId, visitId);
  return th ? `<span class="sw" style="background:${th.color}" title="Drawn on the map in this colour"></span>` : '<span class="sw none"></span>';
}

export function initDetails({ record, loadTest }) {
  const box = $('details');
  let showAll = false;

  function render() {
    const s = app.sel;
    if (!s) return overview();
    if (pinned()) return thread(pinned());
    if (s.kind === 'article') return article(s.id);
    if (s.kind === 'trail') return trail(s.id);
  }

  /* ---------- nothing selected ---------- */
  function overview() {
    $('dtitle').textContent = 'Overview';
    if (!app.state.trails.length) {
      box.innerHTML = `<h3>Welcome to Wiki Trails</h3>
        <p>Keep a map of how you wander through Wikipedia.</p>
        <section><h4>How it works</h4>
          <p>1. In <b>Record</b>, paste the Wikipedia page you started on.</p>
          <p>2. Each time you click a link, paste the next page. If you went back, click an earlier step first.</p>
          <p>3. Click any article on the map to see every trail that went through it.</p></section>
        <section><h4>Just looking?</h4><div class="actions">
          <button class="btn" data-test="wikispeedia-1000">Try 30 days of example trails</button>
          <button class="btn" data-test="wikispeedia-2years">Try 2 years</button></div>
          <p class="explain">Real reading trails from the Wikispeedia study.</p></section>`;
      box.querySelectorAll('[data-test]').forEach((b) => b.onclick = () => loadTest(b.dataset.test));
      return;
    }
    const DV = app.DV, clicks = [...DV.links.values()].reduce((n, l) => n + l.total, 0);
    const trails = [...app.state.trails].filter((t) => !app.range || DV.articles.has(t.visits[0].article)).reverse();
    const top = [...DV.articles.values()].sort((p, q) => q.visits - p.visits).slice(0, 8);
    const span = timeSpan(app.state);
    box.innerHTML = `<div class="stats"><div><b>${DV.articles.size}</b><span>articles</span></div><div><b>${clicks}</b><span>clicks</span></div><div><b>${app.range ? new Set([...DV.articles.values()].flatMap((a) => [...a.trails])).size : app.state.trails.length}</b><span>trails</span></div></div>
      <p class="explain">${app.range ? `Showing ${fmtDate(app.range[0])} – ${fmtDate(app.range[1])}.` : span ? `From ${fmtDate(span[0])} to ${fmtDate(span[1])}.` : ''} Click any article on the map to see every trail that went through it.</p>
      <section><h4>Most visited</h4>${top.map((a) => `<div class="lrow" data-a="${esc(a.title)}"><span class="l">${esc(a.title)}</span><span class="c">${a.visits}× · ${fmtAgo(a.last)}</span></div>`).join('')}</section>
      <section><h4>Latest trails</h4>${trails.slice(0, 6).map((t) => `<div class="lrow" data-t="${t.id}"><span class="l">${esc(trailLabel(t))}</span><span class="c">${fmtDate(t.created, false)}</span></div>`).join('')}</section>`;
  }

  /* ---------- an article ---------- */
  function article(title) {
    const a = app.DV.articles.get(title) || app.D.articles.get(title);
    $('dtitle').textContent = 'Article';
    if (!a) { box.innerHTML = '<p class="explain">Not in this period.</p>'; return; }
    // every time you were on this page, newest first
    const seen = [];
    for (const id of a.trails) {
      const ti = app.D.trailIndex.get(id); if (!ti) continue;
      for (const v of ti.trail.visits) {
        if (v.article !== title) continue;
        const t = visitTime(ti.trail, v);
        if (app.range && (t < app.range[0] || t > app.range[1])) continue;
        const from = v.parent != null ? ti.byId.get(v.parent).article : null;
        const next = (ti.children.get(v.id) || []).map((cid) => ti.byId.get(cid).article);
        seen.push({ t, trail: ti.trail, vid: v.id, from, next });
      }
    }
    seen.sort((p, q) => q.t - p.t);
    const inc = new Map(), out = new Map();
    for (const l of app.DV.links.values()) {
      if (l.a === title) { if (l.ab) out.set(l.b, l.ab); if (l.ba) inc.set(l.b, l.ba); }
      if (l.b === title) { if (l.ba) out.set(l.a, l.ba); if (l.ab) inc.set(l.a, l.ab); }
    }
    const list = (m) => [...m].sort((p, q) => q[1] - p[1]).slice(0, 8).map(([t, n]) => `<div class="lrow" data-a="${esc(t)}"><span class="l">${esc(t)}</span><span class="c">${n}×</span></div>`).join('') || '<p class="explain">None.</p>';
    const shownSeen = showAll ? seen : seen.slice(0, 12);
    box.innerHTML = `<h3>${esc(title)}</h3>
      <div class="sub">You saw this page ${plural(seen.length, 'time')}${seen.length ? `, last on ${fmtDateTime(seen[0].t)}` : ''}${seen.length > 1 ? `, first on ${fmtDate(seen[seen.length - 1].t)}` : ''}.</div>
      <div class="actions">
        <button class="btn small" id="d-start">Start a trail here</button>
        <a class="btn small" href="${wikiUrl(title)}" target="_blank" rel="noopener">Open on Wikipedia ↗</a>
      </div>
      <section><h4>When you saw it</h4>${shownSeen.map((s) => `<div class="lrow" ${drawn(s.trail.id, s.vid) ? `data-k="${drawn(s.trail.id, s.vid).key}" title="Show this thread"` : `data-t="${s.trail.id}" title="Show this trail"`}>
          <span class="l">${swatch(s.trail.id, s.vid)}<span class="when">${fmtDateTime(s.t)}</span><br><span class="explain">${s.from ? `from ${esc(s.from)}` : 'start of the trail'}${s.next.length ? ` → ${esc(s.next.join(', '))}` : ' · end of the trail'}</span></span></div>`).join('')}
        ${seen.length > shownSeen.length ? `<button class="btn small more" id="d-all">Show all ${seen.length}</button>` : ''}</section>
      <section><h4>You came from</h4>${list(inc)}</section>
      <section><h4>You went on to</h4>${list(out)}</section>`;
    $('d-start').onclick = () => record.startAt(title);
    $('d-all')?.addEventListener('click', () => { showAll = true; render(); });
  }

  /* ---------- one thread you clicked on the map ---------- */
  function thread(th) {
    const ti = app.D.trailIndex.get(th.trailId), tr = ti?.trail;
    $('dtitle').textContent = 'Thread';
    if (!tr) return overview();
    const at = app.threads.anchor, t0 = visitTime(tr, tr.visits[0]), t1 = visitTime(tr, tr.visits[tr.visits.length - 1]);
    const mins = Math.round((t1 - t0) / 6e4), last = th.path.length - 1;
    box.innerHTML = `<h3><span class="sw big" style="background:${th.color}"></span>${esc(th.path[0])} → ${esc(th.path[last])}</h3>
      <div class="sub">${at ? `You were on <b>${esc(at)}</b> on ${fmtDateTime(th.t)}.` : `${fmtDateTime(t0)}.`} The trail started ${fmtDateTime(t0)}${mins > 0 ? ` and took ${mins} min` : ''}.</div>
      <div class="actions">
        <button class="btn small" id="d-unpin">${at ? `← All threads through ${esc(at)}` : '← Back'}</button>
        <button class="btn small" id="d-cont">Continue this trail</button>
      </div>
      <section><h4>The way it went</h4><ol class="steps thread">${th.path.map((t, k) => `<li class="${k === 0 ? 'first' : ''}${k === last ? ' last' : ''}${t === at ? ' here' : ''}" data-a="${esc(t)}" title="Show ${esc(t)}">
          <span class="num">${k + 1}</span><span class="l">${esc(t)}</span>${k === 0 ? '<span class="stag">start</span>' : k === last ? '<span class="stag">end</span>' : t === at ? '<span class="stag">here</span>' : ''}</li>`).join('')}</ol>
        ${th.passes > 1 ? `<p class="explain">This trail was on ${esc(at)} ${th.passes} times; this is its last visit.</p>` : ''}
        ${th.sides.length ? `<p class="explain">It also went off on ${plural(th.sides.length, 'side trip')}.</p>` : ''}</section>
      <div class="actions"><button class="btn small" id="d-trail">Show the whole trail</button></div>`;
    box.querySelector('h3 .sw').style.setProperty('--c', th.color);
    $('d-unpin').onclick = () => pinThread(null);
    $('d-cont').onclick = () => record.continueTrail(tr.id);
    $('d-trail').onclick = () => select({ kind: 'trail', id: tr.id }, { force: true });
  }

  /* ---------- a trail ---------- */
  function trail(id) {
    const tr = trailOf(id);
    $('dtitle').textContent = 'Trail';
    if (!tr) return overview();
    const sh = trailShape(tr);
    const t0 = visitTime(tr, tr.visits[0]), t1 = visitTime(tr, tr.visits[tr.visits.length - 1]);
    const mins = Math.round((t1 - t0) / 6e4);
    box.innerHTML = `<h3 id="d-name">${esc(trailLabel(tr))}</h3>
      <div class="sub">${fmtDateTime(t0)} · ${plural(tr.visits.length, 'page')}${sh.branches.length ? ` · went back ${plural(sh.branches.length, 'time')}` : ''}${mins > 0 ? ` · ${mins} min` : ''}</div>
      <div class="actions">
        <button class="btn small" id="d-cont">Continue this trail</button>
        <button class="btn small" id="d-rename">Rename</button>
        <button class="btn small danger" id="d-del">Delete</button>
      </div>
      <section><h4>Steps</h4><ol class="steps">${stepsHTML(tr, sh, { cursorId: app.cur?.trailId === tr.id ? app.cur.visitId : null })}</ol>
      <p class="explain">Indented steps are pages you opened and then went back from.</p></section>`;
    $('d-cont').onclick = () => record.continueTrail(tr.id);
    $('d-rename').onclick = () => {
      const h = $('d-name');
      h.innerHTML = `<input class="renamer" value="${esc(trailLabel(tr))}">`;
      const inp = h.querySelector('input'); inp.focus(); inp.select();
      let done = false;
      const finish = (save) => { if (done) return; done = true; if (save) { snapshot(); tr.name = inp.value.trim(); commit(); } else render(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
      inp.onblur = () => finish(true);
    };
    confirmClick($('d-del'), 'Click again to delete', () => {
      snapshot();
      app.state.trails = app.state.trails.filter((t) => t.id !== tr.id);
      if (app.cur?.trailId === tr.id) app.cur = null;
      app.sel = null; commit(); toast('Trail deleted. Undo brings it back.');
    });
  }

  box.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]'); if (k) return pinThread(k.dataset.k);
    const a = e.target.closest('[data-a]'); if (a && !e.target.closest('.btn')) return select({ kind: 'article', id: a.dataset.a }, { zoom: true });
    const t = e.target.closest('[data-t]'); if (t) return select({ kind: 'trail', id: t.dataset.t }, { zoom: true });
  });
  on('select', () => { showAll = false; render(); });
  for (const ev of ['data', 'range', 'threads', 'pin', 'cursor']) on(ev, render);
  return { render };
}
