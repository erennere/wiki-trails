// Wiki Trails: wiring. The map and the panels only talk through the shared state in app.js.
import { app, on, commit, select, setHover, setFocus, specFor, cursorVisit, saveSettings, undo } from './app.js';
import { loadLocal, loadPublished, saveLocal } from './storage.js';
import { emptyState } from './model.js';
import { createGraph } from './views/map.js';
import { createEffects } from './views/effects.js';
import { initAppearance } from './appearance.js';
import { initRecord } from './panels/record.js';
import { initTrails } from './panels/trails.js';
import { initDetails } from './panels/details.js';
import { initSearch } from './panels/search.js';
import { initTimeline } from './panels/timeline.js';
import { initMenus } from './panels/menus.js';
import { $, esc, plural, fmtDateTime, toast } from './ui.js';

const html = document.documentElement;

/* ---------- side panels: open / closed ---------- */
function setPanel(side, open) {
  app.settings[side] = open; saveSettings();
  html.dataset[side] = open ? 'open' : 'closed';
}
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => setPanel(b.dataset.close, false));
document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => setPanel(b.dataset.open, true));
setPanel('left', app.settings.left);
setPanel('right', app.settings.right);

/* ---------- the map ---------- */
let rz;
const graph = createGraph($('graph'), {
  onHover: (t) => { setHover(t ? { kind: 'article', id: t } : null); showTip(); },
  onEdgeHover: (l) => { if (app.hover?.kind === 'article') return; setHover(l ? { kind: 'edge', id: l.key } : null); showTip(); },
  onClick: (t) => { select({ kind: 'article', id: t }); revealSel(app.sel); },
  onEdgeClick: (l) => { select({ kind: 'edge', id: l.key }); revealSel(app.sel); },
  onDblClick: (t) => focusArticle(t),
  onBackground: () => select(null),
  onSettled: () => { app.state.layout = graph.getPositions(); saveLocal(app.state); },
  onResize: () => { clearTimeout(rz); rz = setTimeout(() => graph.fit(false), 120); },
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
function showTip() {
  const h = app.hover;
  if (h?.kind === 'article') {
    const a = app.DV.articles.get(h.id) || app.D.articles.get(h.id);
    if (!a) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${esc(a.title)}</b> · ${plural(a.visits, 'visit')} · last seen ${fmtDateTime(a.last)}`;
  } else if (h?.kind === 'edge') {
    const l = app.DV.links.get(h.id) || app.D.links.get(h.id);
    if (!l) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${esc(l.a)} ↔ ${esc(l.b)}</b> · ${plural(l.total, 'click')} · last ${fmtDateTime(l.last)}`;
  } else { tip.hidden = true; return; }
  tip.hidden = false; placeTip();
}
$('graph').addEventListener('mousemove', (e) => { const r = $('stage').getBoundingClientRect(); mouse = [e.clientX - r.left, e.clientY - r.top]; placeTip(); });
$('graph').addEventListener('mouseleave', () => { tip.hidden = true; });

function applyHighlight() { graph.setHighlight(specFor(app.hover || app.sel)); }
/** every article the highlight for this selection touches */
function titlesOf(sel) {
  const sp = specFor(sel); if (!sp) return new Set();
  const titles = new Set(sp.paths.flatMap((p) => p.segs.flatMap((s) => [s.from, s.to])));
  if (sp.anchor) titles.add(sp.anchor);
  if (sp.edgeKey) sp.edgeKey.split('\u0000').forEach((t) => titles.add(t));
  return titles;
}
/** list or search click: frame the whole highlight */
function zoomTo(sel) { const t = titlesOf(sel); if (t.size) graph.focusOn(t); }
/** map click: zoom out only if part of the highlight is off-screen */
function revealSel(sel) { if (!sel) return; const t = titlesOf(sel); if (t.size) graph.reveal(t); }
function fitWhenSettled() {
  graph.settleAndFit();
  const iv = setInterval(() => { if (!graph.isSettling()) { clearInterval(iv); graph.fit(true); } }, 200);
}

/* focus: show only an article's neighbourhood */
function focusArticle(title) {
  if (!title) { setFocus(null); return; }
  let nb = graph.neighbourhood(title, 1);
  if (nb.size < 25) nb = graph.neighbourhood(title, 2);
  setFocus(title, nb);
  select({ kind: 'article', id: title });
}
function renderFocusbar() {
  const bar = $('focusbar');
  bar.hidden = !app.focus;
  if (app.focus) bar.innerHTML = `<span class="btn small primary" id="unfocus">Only around ${esc(app.focus.title)} · show everything ✕</span>`;
  $('unfocus')?.addEventListener('click', () => focusArticle(null));
}

$('zoomin').onclick = () => graph.zoomBy(1.5);
$('zoomout').onclick = () => graph.zoomBy(1 / 1.5);
$('fit').onclick = () => graph.fit(true);

on('data', (opts = {}) => {
  const first = graph.update(app.D, app.DV, app.state.layout);
  graph.setCursor(cursorVisit()?.article || null);
  if (app.focus) graph.setView({ focus: app.focus.set });
  applyHighlight();
  $('empty').hidden = app.state.trails.length > 0;
  if (first || opts.fresh) fitWhenSettled();
  else if (opts.added) {
    // keep the page you just added in view: refit a small map, gently pan a big one
    const t = cursorVisit()?.article;
    setTimeout(() => { if (graph.nodeCount() < 60) graph.fit(true); else if (t) graph.ensureVisible(t); }, graph.nodeCount() < 60 ? 250 : 900);
  }
});
on('select', (opts = {}) => { applyHighlight(); if (opts.zoom && app.sel) zoomTo(app.sel); });
on('hover', applyHighlight);
on('cursor', () => graph.setCursor(cursorVisit()?.article || null));
on('range', () => { graph.setVisible(app.DV); applyHighlight(); graph.fit(true); });
on('focus', () => { graph.setView({ focus: app.focus?.set || null }); graph.setVisible(app.DV); applyHighlight(); renderFocusbar(); graph.fit(true); });

/* ---------- panels ---------- */
const record = initRecord({ showLeft: () => setPanel('left', true) });
const menus = initMenus({ graph });
initTrails();
initDetails({ record, focusArticle, loadTest: menus.loadTest });
initSearch();
initTimeline();
document.querySelectorAll('[data-example]').forEach((b) => { if (!b.onclick) b.onclick = () => menus.loadTest(b.dataset.example); });

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  if (e.key === 'Escape' && !typing && $('settings').hidden) {
    if (app.focus) focusArticle(null); else if (app.sel) select(null);
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !(typing && e.target.value)) { e.preventDefault(); if (undo()) toast('Undone'); }
});

/* ---------- start ---------- */
(async () => {
  graph.setView({ density: app.settings.density, fade: app.settings.fade });
  app.state = (await loadLocal()) || (await loadPublished()) || emptyState();
  commit({ fresh: true });
  const rel = (p) => { if (!p) return null; const r = $('graph').getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };
  window.__wikiTrails = { // handy for debugging in the console (and for tests)
    app, settling: () => graph.isSettling(), gstats: () => graph.stats(), drawMs: () => graph.drawMs(),
    nodeXY: (t) => rel(graph.screenOf(t)), edgeXY: (i) => rel(graph.edgeMid(i)),
  };
})();
