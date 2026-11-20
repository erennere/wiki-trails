// Wiki Trails: wiring. The map and the panels only talk through the shared state in app.js.
import { app, on, commit, select, setHover, setPeriod, refreshThreads, pinThread, setSetting, cursorVisit, saveSettings, undo, trailOf, snapshot, markReading, ownHistory } from './app.js';
import { loadLocal, loadPublished, saveLocal, isExample } from './storage.js';
import { emptyState, uid } from './model.js';
import { createGraph } from './views/map3d.js';
import { createEffects } from './views/effects.js';
import { initAppearance } from './appearance.js';
import { initRecord } from './panels/record.js';
import { initTrails } from './panels/trails.js';
import { initDetails } from './panels/details.js';
import { initSearch } from './panels/search.js';
import { initTimeline } from './panels/timeline.js';
import { initStats } from './panels/stats.js';
import { initSync, syncNow, sync } from './sync.js';
import { initSyncUI } from './panels/syncui.js';
import { initMenus } from './panels/menus.js';
import { $, esc, plural, fmtDate, fmtDateTime, toast } from './ui.js';

const html = document.documentElement;

/* ---------- someone's published history, shown until you start your own ---------- */
function renderPublished() {
  const who = app.published;
  let min = false; try { min = localStorage.getItem('wiki-trails.pubnote') === 'min'; } catch { /* storage unavailable */ }
  $('pubnote').hidden = !who || min;
  $('pubchip').hidden = !who || !min;
  if (who) {
    $('pubnote-text').innerHTML = `You're looking at <b>${esc(who)}</b>'s Wikipedia trails. Record a page or open a history file and the map is yours.`;
    $('pubchip').textContent = `${who}'s trails`;
  }
}
const minimizeNote = (min) => { try { localStorage.setItem('wiki-trails.pubnote', min ? 'min' : 'open'); } catch { /* storage unavailable */ } renderPublished(); };
on('published', renderPublished);

/* ---------- side panels: open / closed ---------- */
function setPanel(side, open) {
  app.settings[side] = open; saveSettings();
  html.dataset[side] = open ? 'open' : 'closed';
}
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => setPanel(b.dataset.close, false));
document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => setPanel(b.dataset.open, true));
// the map gets the room when the page opens; the side panels open from their rails
setPanel('left', false);
setPanel('right', false);

/* ---------- the map ---------- */
let rz;
const graph = createGraph($('graph'), {
  onHover: (t) => { setHover(t ? { kind: 'article', id: t } : null); showTip(); },
  onClick: (t) => select({ kind: 'article', id: t }, { force: true }),
  // a click on a thread focuses it and explains it in the side panel; click it again (or empty space) to let go
  onThreadClick: (key) => { pinThread(app.pin === key ? null : key); if (app.pin) setPanel('right', true); },
  onThreadHover: (h) => { threadHover = h; showTip(); },
  onBackground: () => (app.pin ? pinThread(null) : select(null)),
  onZoomedOut: () => select(null),
  onSettled: () => { app.state.layout = graph.getPositions(); if (!app.published) saveLocal(app.state); },
  onResize: () => { clearTimeout(rz); rz = setTimeout(() => (app.threads ? showThreads() : graph.fit(false)), 160); },
});
const fx = createEffects($('fx'));
initAppearance(graph, fx);

/* hover tooltip: what it is and when you last saw it */
const tip = $('tip');
let mouse = [0, 0];
function placeTip() {
  if (tip.hidden) return;
  const r = $('stage').getBoundingClientRect();
  let x = mouse[0] + 16, y = mouse[1] + 14;
  if (x + tip.offsetWidth > r.width - 8) x = mouse[0] - tip.offsetWidth - 12;
  if (y + tip.offsetHeight > r.height - 8) y = mouse[1] - tip.offsetHeight - 12;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
let threadHover = null;
function showTip() {
  const h = app.hover, th = threadHover && app.threads?.threads.find((x) => x.key === threadHover.key);
  if (th) {
    const tr = trailOf(th.trailId);
    tip.innerHTML = `${threadHover.title ? `<b>${esc(threadHover.title)}</b> · ` : ''}<span class="sw" style="background:${th.color}"></span><b>${esc(th.path[0])} → ${esc(th.path[th.path.length - 1])}</b> · ${fmtDateTime(th.t)}${tr ? ` · ${plural(th.path.length, 'page')}` : ''}<br><span class="explain">${threadHover.title ? `Click to go to ${esc(threadHover.title)}` : app.pin === th.key ? 'Click again to let go' : 'Click the line to see this thread'}</span>`;
    tip.hidden = false; placeTip(); return;
  }
  if (h?.kind === 'article') {
    const a = app.DV.articles.get(h.id) || app.D.articles.get(h.id);
    if (!a) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${esc(a.title)}</b> · ${plural(a.visits, 'visit')} · last seen ${fmtDateTime(a.last)}`;
  } else { tip.hidden = true; return; }
  tip.hidden = false; placeTip();
}
$('graph').addEventListener('mousemove', (e) => { const r = $('stage').getBoundingClientRect(); mouse = [e.clientX - r.left, e.clientY - r.top]; placeTip(); });
$('graph').addEventListener('mouseleave', () => { tip.hidden = true; });

/** Draw the selection's threads and let the camera frame them (or go back to the whole history). */
function showThreads(frame = true) {
  graph.setHighlight(app.threads, app.pin);
  renderThreadbar();
  renderLegend();
  if (!frame) return;
  if (app.threads) graph.frameThreads(); else graph.fit(true);
}
function fitWhenSettled() {
  graph.settleAndFit();
  const iv = setInterval(() => { if (!graph.isSettling()) { clearInterval(iv); app.threads ? graph.frameThreads() : graph.fit(true); } }, 250);
}

/* the key: on the whole map, what the coloured pages mean; on trails, what the lines and beads mean */
function renderLegend() {
  const lg = $('readlegend');
  const th = app.threads?.kind === 'article' ? app.threads.threads[0] : null;
  const mark = app.settings.mark;
  let any = false, ends = false;
  for (const a of app.DV.articles.values()) { if (a.read || a.skim) any = true; if (a.begins || a.ends) ends = true; }
  const sw = (c) => `<i class="ln" style="background:${c}"></i>`, dot = (c) => `<i class="sw2" style="background:${c}"></i>`, R = graph.roleColors();
  let html = '';
  if (th) {
    // what the colours of a trail mean when a page is selected: cool before the page, warm after it
    const n = (kind) => (th.groups || []).filter((g) => g.startsWith(kind)).length;
    const downs = R.down.slice(0, Math.min(R.down.length, Math.max(1, n('down')))).map(sw).join('');
    html = `<span>${sw(R.up)}the way here</span>${n('side') ? `<span>${R.side.slice(0, Math.min(2, n('side'))).map(sw).join('')}branches off it</span>` : ''}${n('down') ? `<span>${downs}where you went on</span>` : ''}`;
    // on threads, read pages are solid beads and skimmed ones open rings
    if (any) html += '<span><span class="rd rd-read"></span>read</span><span><span class="rd rd-skim"></span>skimmed</span>';
  } else if (!app.threads) {
    if (mark === 'ends' && ends) html = `<span>${dot(R.up)}where you began</span><span>${dot(R.down[0])}where you stopped</span>`;
    else if (mark === 'reading' && any) html = '<span><i class="sw2" style="background:var(--read)"></i>read</span><span><i class="sw2" style="background:var(--skim, color-mix(in srgb, var(--read) 45%, transparent))"></i>skimmed</span>';
    if (html) html += '<span class="hint">bigger: more visits</span>';
  }
  lg.hidden = !html;
  lg.innerHTML = html;
}
on('settings', (k) => { if (k === 'mark') renderLegend(); });
on('skin', () => renderLegend());

/* the bar over the map: how many threads, and which period */
const LIMITS = [1, 3, 5, 10, 20, 50];
function renderThreadbar() {
  const bar = $('threadbar'), th = app.threads;
  bar.hidden = !th || th.kind === 'trail';
  if (bar.hidden) return;
  const lim = +app.settings.threads || 5;
  bar.innerHTML = `<label>Latest <select id="tlimit">${LIMITS.map((n) => `<option value="${n}"${n === lim ? ' selected' : ''}>${n}</option>`).join('')}</select> threads</label>
    <span class="tcount">${th.threads.length} of ${plural(th.total, 'thread')}</span>
    ${th.threads.length > 1 ? `<label class="tfade" title="How clearly older threads show next to the newest">Older ones <span class="hint">faint</span><input type="range" id="tfade" min="0" max="1" step="0.05" value="${(1 - app.settings.ageFade).toFixed(2)}" aria-label="How clearly older threads show"><span class="hint">clear</span></label>` : ''}
    ${app.period ? `<button class="btn small" id="tperiod" title="Show every period">${fmtDate(app.period[0])} – ${fmtDate(app.period[1])} ✕</button>` : ''}`;
  $('tlimit').onchange = (e) => { setSetting('threads', +e.target.value); refreshThreads(); };
  // drag to make older threads fainter or clearer (the same as Settings → How much older threads fade)
  let raf = 0;
  $('tfade')?.addEventListener('input', (e) => {
    app.settings.ageFade = 1 - +e.target.value;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => graph.setView({ ageFade: app.settings.ageFade }));
  });
  $('tfade')?.addEventListener('change', () => setSetting('ageFade', app.settings.ageFade));
  $('tperiod')?.addEventListener('click', () => setPeriod(null));
}

$('zoomin').onclick = () => graph.zoomBy(1.5);
$('zoomout').onclick = () => graph.zoomBy(1 / 1.5);
$('fit').onclick = () => (app.threads ? graph.frameThreads() : graph.fit(true));

on('data', (opts = {}) => {
  const first = graph.update(app.D, app.DV, app.state.layout);
  graph.setCursor(cursorVisit()?.article || null);
  showThreads(false);
  $('empty').hidden = app.state.trails.length > 0;
  if (first || opts.fresh) fitWhenSettled();
  else if (opts.added) {
    // keep the page you just added in view
    const t = cursorVisit()?.article;
    setTimeout(() => { if (graph.nodeCount() < 60) graph.fit(true); else if (t) graph.ensureVisible(t); }, graph.isSettling() ? 1600 : 250);
  }
});
on('select', () => showThreads());
on('threads', () => showThreads());
on('pin', () => { graph.setPin(app.pin); showTip(); });
on('cursor', () => graph.setCursor(cursorVisit()?.article || null));
on('range', () => { graph.setVisible(app.DV); showThreads(); });
on('skin', () => { if (app.sel) refreshThreads(); });

/* ---------- panels ---------- */
const record = initRecord({ showLeft: () => setPanel('left', true) });
const menus = initMenus({ graph });
initSyncUI({ openSettings: () => menus.openSettings() });
$('pub-own').onclick = () => { if (ownHistory()) { graph.reset(); commit({ fresh: true }); } setPanel('left', true); $('next').focus(); };
$('pub-open').onclick = () => menus.open();
$('pub-min').onclick = () => minimizeNote(true);
$('pubchip').onclick = () => minimizeNote(false);
initTrails();
initDetails({ record, loadTest: menus.loadTest });

/* ---------- Map or Stats ---------- */
const stats = initStats({
  openArticle: (t) => { setViewMode('map'); select({ kind: 'article', id: t }, { force: true }); },
  openTrail: (id) => { setViewMode('map'); select({ kind: 'trail', id }, { force: true }); },
});
function setViewMode(v) {
  document.documentElement.dataset.view = v;
  document.querySelectorAll('#viewseg [data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-selected', String(b.dataset.view === v)); });
  $('statsview').hidden = v !== 'stats';
  tip.hidden = true;
  graph.pause(v === 'stats'); // no need to draw the map while it's hidden
  if (v === 'stats') stats.render();
}
$('viewseg').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setViewMode(b.dataset.view); });
document.documentElement.dataset.view = 'map';
initSearch();
initTimeline();
document.querySelectorAll('[data-example]').forEach((b) => { if (!b.onclick) b.onclick = () => menus.loadTest(b.dataset.example); });

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  if (e.key === 'Escape' && !typing && $('settings').hidden) {
    if (app.pin) pinThread(null); else if (app.sel) select(null);
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !(typing && e.target.value)) { e.preventDefault(); if (undo()) toast('Undone'); }
});

/* ---------- start ---------- */
(async () => {
  graph.setView({ density: app.settings.density, fade: app.settings.fade, ageFade: app.settings.ageFade, rotate: app.settings.rotate, mark: app.settings.mark });
  // your own history: anything you recorded, opened or synced here (examples don't count)
  const local = await loadLocal();
  let synced = false; try { synced = !!JSON.parse(localStorage.getItem('wiki-trails.sync'))?.token; } catch { /* not connected */ }
  const mine = local && (synced || (local.trails.length > 0 && !isExample(local))) ? local : null;
  const shown = mine ? null : await loadPublished();
  if (shown) { app.published = shown.owner || 'Someone'; delete shown.owner; }
  app.state = mine || shown || local || emptyState();
  commit({ fresh: true });
  renderPublished();
  initSync(); // if this browser is connected to GitHub: fetch what's new there, send what's new here
  const rel = (p) => { if (!p) return null; const r = $('graph').getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };
  window.__wikiTrails = { // handy for debugging in the console (and for tests)
    app, graph, still: () => graph.setView({ rotate: false }), settling: () => graph.isSettling(), gstats: () => graph.stats(), drawMs: () => graph.drawMs(),
    nodeXY: (t) => rel(graph.screenOf(t)), pin: (k) => pinThread(k),
    sync: { now: (k) => syncNow(k), state: () => ({ on: sync.on, state: sync.state, error: sync.error, at: sync.at }) },
    // the same changes the panels make, for tests
    rename: (id, name) => { const t = trailOf(id); if (t) { snapshot(); t.name = name; commit(); } },
    mark: (trailId, visitId, depth) => markReading(trailId, visitId, depth),
    deleteTrail: (id) => { snapshot(); app.state.trails = app.state.trails.filter((t) => t.id !== id); commit(); },
    undo: () => undo(),
    addStep: (id, article) => { const t = trailOf(id); if (!t) return; snapshot(); t.visits.push({ id: uid(), article, parent: t.visits[t.visits.length - 1].id, t: Date.now() }); commit(); },
    loadExample: () => menus.loadTest('small'),
  };
})();
