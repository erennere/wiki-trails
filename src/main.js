import { uid, normTitle, langFromUrl, derive, chainTo, trailSteps, routesTo, routesThrough, trailLabel, emptyState, validate, timeSpan, visitTime } from './model.js';
import { loadLocal, loadPublished, saveLocal, saveToFile, pickFile, readFile, merge, fileName } from './storage.js';
import { createGraph, TRAIL_COLORS } from './graph.js';
import { createEffects } from './effects.js';
import { exampleState } from './example.js';
import { SKINS, CATS, savedSkin, skinById, rememberSkin } from './skins.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = emptyState();
let D = derive(state);   // all time: drives the layout
let DV = D;              // what you see: the time lens applied
let range = null;        // [fromMs, toMs] or null = all time
let focusTitle = null;   // focus mode: only this article's neighbourhood
let cur = null;          // { trailId, visitId } — where the next link starts
let pinned = null;       // { kind: 'article'|'trail'|'edge', id }
let hovered = null;
const undoStack = [];

const graph = createGraph($('graph'), {
  onHover: (t) => { hovered = t ? { kind: 'article', id: t } : null; applyHighlight(); statusFor(t); bannerFor(t); },
  onEdgeHover: (l) => { if (hovered?.kind === 'article') return; hovered = l ? { kind: 'edge', id: l.key } : null; applyHighlight(); if (l) status(`${l.a} ↔ ${l.b}: clicked ${l.total}× (${l.ab}× → ${l.b}, ${l.ba}× → ${l.a})`); },
  onClick: (t) => clickArticle(t),
  onEdgeClick: (l) => clickEdge(l),
  onDblClick: (t) => setFocus(t),
  onBackground: () => { const had = pinned; pinned = null; closeCard(); applyHighlight(); renderTrails(); if (had) graph.fit(true); },
  onSettled: () => { state.layout = graph.getPositions(); saveLocal(state); },
  onResize: () => { clearTimeout(rzT); rzT = setTimeout(() => graph.fit(false), 120); },
});
let rzT;

const colorOf = (trailId) => TRAIL_COLORS[(D.trailIndex.get(trailId)?.index ?? 0) % TRAIL_COLORS.length];
const trailOf = (id) => state.trails.find((t) => t.id === id);
const wikiUrl = (t) => `https://${state.lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;

/* ---------- state changes ---------- */
function snapshot() {
  const { layout, ...rest } = state;
  undoStack.push(JSON.stringify({ state: rest, cur }));
  let bytes = 0; for (const u of undoStack) bytes += u.length;
  while (undoStack.length > 1 && (undoStack.length > 100 || bytes > 24e6)) bytes -= undoStack.shift().length; // keep memory bounded
  markDirty();
}
function commit({ refit = false } = {}) {
  saveLocal(state);
  D = derive(state);
  DV = range ? derive(state, range) : D;
  if (cur && !D.trailIndex.get(cur.trailId)?.byId.has(cur.visitId)) cur = null;
  if (pinned?.kind === 'trail' && !D.trailIndex.has(pinned.id)) pinned = null;
  if (pinned?.kind === 'article' && !D.articles.has(pinned.id)) { pinned = null; closeCard(); }
  if (focusTitle && !D.articles.has(focusTitle)) setFocus(null, false);
  if (focusTitle) { focusSet = graph.neighbourhood(focusTitle, focusSet?.size >= 25 ? 1 : 2); graph.setView({ focus: focusSet }); }
  const firstLayout = graph.update(D, DV, state.layout);
  if (firstLayout) refit = true;
  renderTimeline();
  graph.setCursor(cursorArticle());
  renderAll();
  applyHighlight();
  if (refit) { graph.settleAndFit(); if (graph.isSettling()) waitThenFit(); }
}
function waitThenFit() { const iv = setInterval(() => { if (!graph.isSettling()) { clearInterval(iv); graph.fit(true); if (/Laying out|fresh layout/.test($('status').textContent)) status('Map ready.'); } }, 200); }
function cursorArticle() { return cur ? D.trailIndex.get(cur.trailId)?.byId.get(cur.visitId)?.article ?? null : null; }
function refresh() { DV = range ? derive(state, range) : D; graph.setVisible(DV); renderStats(); renderTimelineLabel(); applyHighlight(); if (pinned?.kind === 'article') openCard(pinned.id); }

function addLink() {
  const raw = $('next').value;
  const title = normTitle(raw);
  if (!title) { $('next').focus(); return; }
  const here = cursorArticle();
  if (here === title) { msg('You are already on that page.', true); return; }
  const before = statInfo().clicks;
  snapshot();
  const lang = langFromUrl(raw);
  if (lang && !state.trails.length) state.lang = lang;
  if (!cur) {
    const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [] };
    const v = { id: uid(), article: title, parent: null, t: Date.now() };
    t.visits.push(v); state.trails.push(t);
    cur = { trailId: t.id, visitId: v.id };
  } else {
    const v = { id: uid(), article: title, parent: cur.visitId, t: Date.now() };
    trailOf(cur.trailId).visits.push(v);
    cur = { trailId: cur.trailId, visitId: v.id };
  }
  const first = state.trails.length === 1 && trailOf(cur.trailId).visits.length <= 2;
  $('next').value = '';
  commit({ refit: first });
  blip();
  toast(skin.milestone?.(before, statInfo().clicks));
  $('next').focus();
}

function stepBack() {
  if (!cur) return;
  const v = D.trailIndex.get(cur.trailId).byId.get(cur.visitId);
  if (v.parent != null) { cur = { trailId: cur.trailId, visitId: v.parent }; afterCursorMove(); }
}
function newTrail() { cur = null; afterCursorMove(); $('next').focus(); }
function afterCursorMove() { graph.setCursor(cursorArticle()); renderBuilder(); renderTrails(); }

function undo() {
  const s = undoStack.pop(); if (!s) return;
  const o = JSON.parse(s); state = { ...o.state, layout: graph.getPositions() }; cur = o.cur;
  commit();
}

/** Latest visit of `title` inside a trail. */
function lastVisit(trailId, title) {
  const t = trailOf(trailId); if (!t) return null;
  for (let i = t.visits.length - 1; i >= 0; i--) if (t.visits[i].article === title) return t.visits[i];
  return null;
}

function clickArticle(title) {
  blip(0.75);
  // Clicking an article of the trail you're building moves the cursor there (go back & branch).
  if (cur) { const v = lastVisit(cur.trailId, title); if (v) { cur = { trailId: cur.trailId, visitId: v.id }; afterCursorMove(); } }
  pinned = { kind: 'article', id: title };
  openCard(title);
  applyHighlight();
  renderTrails();
  zoomToPinned();
}

/* ---------- highlight ---------- */
let focusSet = null;
const inView = (steps) => steps.filter((s) => DV.articles.has(s.from) && DV.articles.has(s.to) && (!focusSet || (focusSet.has(s.from) && focusSet.has(s.to))));
function specFor(target) {
  if (!target) return null;
  if (target.kind === 'edge') {
    const [a, b] = target.id.split('\u0000');
    return { steps: inView(routesThrough(D, a, b)), colorOf, numbers: null, edgeKey: target.id };
  }
  if (target.kind === 'trail') {
    const t = trailOf(target.id); if (!t) return null;
    const numbers = new Map();
    t.visits.forEach((v, i) => { if (!numbers.has(v.article)) numbers.set(v.article, i + 1); });
    return { steps: inView(trailSteps(D, [t.id])), colorOf, numbers, focus: t.visits[0].article };
  }
  const a = D.articles.get(target.id); if (!a) return null;
  // Journeys of trails that start here + every route that ever led here.
  const steps = inView([...trailSteps(D, [...a.starts]), ...routesTo(D, a.title)]);
  const trails = new Set(steps.map((s) => s.trailId));
  let numbers = null;
  if (trails.size === 1) {
    const t = trailOf([...trails][0]); numbers = new Map();
    const lit = new Set(steps.flatMap((s) => [s.from, s.to]));
    t.visits.forEach((v, i) => { if (lit.has(v.article) && !numbers.has(v.article)) numbers.set(v.article, i + 1); });
  }
  return { steps, colorOf, numbers, focus: a.title };
}
function applyHighlight() { graph.setHighlight(specFor(hovered || pinned)); }
function zoomToPinned() {
  const sp = specFor(pinned); if (!sp) return;
  const pad = $('card').style.display === 'block' ? $('card').offsetWidth + 24 : 0;
  graph.focusOn(new Set(sp.steps.flatMap((s) => [s.from, s.to]).concat(sp.focus ? [sp.focus] : []).concat(sp.edgeKey ? sp.edgeKey.split('\u0000') : [])), pad);
}

/* ---------- rendering ---------- */
function msg(t, warn = false) { $('msg').textContent = t || ''; $('msg').classList.toggle('warn', warn); }

function renderAll() {
  renderStats(); renderBuilder(); renderTrails();
  $('titles').innerHTML = [...D.articles.keys()].sort().map((t) => `<option value="${esc(t)}">`).join('');
  $('empty').style.display = state.trails.length ? 'none' : 'flex';
  $('lang').value = state.lang;
  if (pinned?.kind === 'article') openCard(pinned.id);
  if (pinned?.kind === 'edge') openEdgeCard(pinned.id);
  renderSaved();
}

function statInfo() {
  const clicks = [...DV.links.values()].reduce((s, l) => s + l.total, 0);
  let top = null; for (const l of DV.links.values()) if (!top || l.total > top.total) top = l;
  const trails = range ? new Set([...DV.articles.values()].flatMap((a) => [...a.trails])).size : state.trails.length;
  return { articles: DV.articles.size, clicks, trails, top: top && top.total > 1 ? top : null };
}
function renderStats() {
  const i = statInfo();
  $('stats').textContent = skin.stats ? skin.stats(i)
    : `${i.articles} ${W('articles')} · ${i.clicks} ${W('clicks')} · ${i.trails} ${W('trails')}` + (i.top ? ` · strongest: ${i.top.a} ↔ ${i.top.b} ×${i.top.total}` : '');
  $('ticker').firstElementChild.textContent = skin.ticker ? skin.ticker(i) : '';
  if (skin.ui?.includes('eq')) $('eq').innerHTML = state.trails.slice(-16).map((t, k) => `<i style="height:${Math.min(18, 3 + t.visits.length * 1.4)}px;animation-delay:${(k % 5) * -0.13}s"></i>`).join('');
  if (skin.ui?.includes('spark')) {
    const v = state.trails.slice(-40).map((t) => 1 / t.visits.length), mx = Math.max(...v, 1e-9);
    $('spark').innerHTML = v.length > 1 ? `loss <svg width="90" height="16" viewBox="0 0 90 16"><polyline points="${v.map((n, k) => `${((k / (v.length - 1)) * 88 + 1).toFixed(1)},${(15 - (n / mx) * 13).toFixed(1)}`).join(' ')}"/></svg>` : '';
  }
}

function renderBuilder() {
  const box = $('crumbs');
  if (!cur) {
    box.innerHTML = '';
    $('qlabel').innerHTML = state.trails.length ? `Link 1: first page of a new ${esc(W('trail'))}` : 'Link 1: first page';
  } else {
    const chain = chainTo(D.trailIndex.get(cur.trailId), cur.visitId);
    box.innerHTML = chain.map((v, i) => `<span class="c${i === chain.length - 1 ? ' cur' : ''}" data-v="${v.id}" title="${esc(v.article)}"><i>${i + 1}</i>${esc(v.article)}</span>`).join('<span class="sep">›</span>');
    box.querySelectorAll('.c').forEach((el) => el.onclick = () => { cur = { trailId: cur.trailId, visitId: el.dataset.v }; afterCursorMove(); $('next').focus(); });
    $('qlabel').innerHTML = `Link ${chain.length + 1}: what did you click on <em>${esc(chain[chain.length - 1].article)}</em>?`;
  }
  $('back').disabled = !cur || D.trailIndex.get(cur.trailId).byId.get(cur.visitId).parent == null;
  $('newtrail').disabled = !cur;
  $('undo').disabled = !undoStack.length;
  hintKnown();
}

function hintKnown() {
  const t = normTitle($('next').value);
  const a = t && D.articles.get(t);
  if (a) msg(`Already in your graph: ${a.visits} visit${a.visits === 1 ? '' : 's'} in ${a.trails.size} trail${a.trails.size === 1 ? '' : 's'}. It will link into the same article.`);
  else msg('');
}

const armed = new Set();
function renderTrails() {
  $('tcount').textContent = `${state.trails.length} ${W('trails')}`;
  const box = $('trails');
  const q = $('tsearch').value.trim().toLowerCase();
  let list = [...state.trails].reverse();
  if (q) list = list.filter((t) => trailLabel(t).toLowerCase().includes(q) || t.visits.some((v) => v.article.toLowerCase().includes(q)));
  const LIMIT = 150, more = list.length - LIMIT;
  if (cur && !list.slice(0, LIMIT).some((t) => t.id === cur.trailId)) { const ct = trailOf(cur.trailId); if (ct) list = [ct, ...list]; }
  list = list.slice(0, LIMIT);
  box.innerHTML = list.map((t) => {
    const ends = t.visits.filter((v) => !t.visits.some((w) => w.parent === v.id)).length;
    const date = new Date(t.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const cls = ['tr', cur?.trailId === t.id ? 'active' : '', pinned?.kind === 'trail' && pinned.id === t.id ? 'pinned' : ''].join(' ');
    return `<div class="${cls}" data-t="${t.id}">
      <span class="sw" style="background:${colorOf(t.id)};color:${colorOf(t.id)}"></span>
      <div class="tx"><div class="nm">${esc(trailLabel(t))}</div><div class="mt">${t.visits.length} pages · ${ends} end${ends === 1 ? '' : 's'} · ${date}</div></div>
      <button class="ic" data-act="rename" title="Rename">✎</button>
      <button class="ic${armed.has(t.id) ? ' armed' : ''}" data-act="del" title="Delete">${armed.has(t.id) ? 'Delete?' : '×'}</button>
    </div>`;
  }).join('') + (more > 0 ? `<div class="tr more">${more} more ${esc(W('trails'))}: type in the search box to find them</div>` : '');
  box.querySelectorAll('.tr[data-t]').forEach((row) => {
    const id = row.dataset.t;
    row.onmouseenter = () => { hovered = { kind: 'trail', id }; applyHighlight(); };
    row.onmouseleave = () => { hovered = null; applyHighlight(); };
    row.onclick = (e) => {
      const act = e.target.dataset?.act;
      if (act === 'del') {
        if (!armed.has(id)) { armed.add(id); renderTrails(); setTimeout(() => { armed.delete(id); renderTrails(); }, 2500); return; }
        snapshot(); armed.delete(id); state.trails = state.trails.filter((t) => t.id !== id); if (cur?.trailId === id) cur = null; hovered = null; commit(); return;
      }
      if (act === 'rename') { startRename(row, id); return; }
      if (e.target.tagName === 'INPUT') return;
      // Continue this trail from its latest page and pin its highlight.
      const t = trailOf(id);
      cur = { trailId: id, visitId: t.visits[t.visits.length - 1].id };
      pinned = { kind: 'trail', id }; closeCard();
      afterCursorMove(); applyHighlight(); zoomToPinned(); $('next').focus();
    };
  });
}
function startRename(row, id) {
  const t = trailOf(id); const nm = row.querySelector('.nm');
  nm.innerHTML = `<input value="${esc(t.name || trailLabel(t))}">`;
  const inp = nm.querySelector('input'); inp.focus(); inp.select();
  let finished = false;
  const done = (save) => { if (finished) return; finished = true; if (save) { snapshot(); t.name = inp.value.trim(); commit(); } else renderTrails(); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  inp.onblur = () => done(true);
}

/* ---------- article card ---------- */
function openCard(title) {
  const a = D.articles.get(title); if (!a) return closeCard();
  const out = [], inn = [];
  for (const l of D.links.values()) {
    if (l.a === title) { if (l.ab) out.push([l.b, l.ab]); if (l.ba) inn.push([l.b, l.ba]); }
    if (l.b === title) { if (l.ba) out.push([l.a, l.ba]); if (l.ab) inn.push([l.a, l.ab]); }
  }
  const list = (arr) => arr.length ? `<ul>${arr.sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, n]) => `<li><a data-go="${esc(t)}">${esc(t)}</a><span class="w">×${n}</span></li>`).join('')}</ul>` : '<ul><li>none</li></ul>';
  const mode = a.starts.size ? `Start of ${a.starts.size} trail${a.starts.size === 1 ? '' : 's'}: showing every full journey from here, plus every route that led here.` : 'Showing every route that led here.';
  $('card').innerHTML = `<div class="title"><span class="ico ico-brain"></span><span class="tt">Properties: ${esc(title)}</span><button class="x" id="cx" aria-label="Close">×</button></div>
    <div class="inner">
    <div class="meta"><b>${esc(title)}</b><br>${a.visits} visit${a.visits === 1 ? '' : 's'} · ${a.trails.size} trail${a.trails.size === 1 ? '' : 's'}</div>
    <div class="mode">${mode}</div>
    <fieldset><legend>You went on to</legend>${list(out)}</fieldset>
    <fieldset><legend>You came from</legend>${list(inn)}</fieldset>
    <div class="btns">
      <button class="btn default" id="cont">${cur && lastVisit(cur.trailId, title) ? 'Add next link from here' : 'Start new trail here'}</button>
      <a class="ext" href="${wikiUrl(title)}" target="_blank" rel="noopener">Open on Wikipedia</a>
    </div></div>`;
  $('card').style.display = 'block';
  $('cx').onclick = () => { pinned = null; closeCard(); applyHighlight(); };
  $('card').querySelectorAll('[data-go]').forEach((el) => el.onclick = () => clickArticle(el.dataset.go));
  $('cont').onclick = () => {
    showBuilder();
    if (cur && lastVisit(cur.trailId, title)) { $('next').focus(); return; }
    snapshot();
    const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [{ id: uid(), article: title, parent: null, t: Date.now() }] };
    state.trails.push(t); cur = { trailId: t.id, visitId: t.visits[0].id };
    commit(); $('next').focus();
  };
}
function closeCard() { $('card').style.display = 'none'; }

/* ---------- controls ---------- */
$('add').onclick = addLink;
$('next').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLink(); });
$('next').addEventListener('input', hintKnown);
$('back').onclick = stepBack;
$('newtrail').onclick = newTrail;
$('undo').onclick = undo;
$('fit').onclick = () => graph.fit(true);
document.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' && e.target.value;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !typing) { e.preventDefault(); undo(); }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
  if (e.key === 'Escape' && focusTitle && !pinned) { setFocus(null); return; }
  if (e.key === 'Escape') { closeStart(); const had = pinned; pinned = null; closeCard(); applyHighlight(); renderTrails(); if (had) graph.fit(true); }
});
$('lang').onchange = () => { state.lang = $('lang').value; saveLocal(state); if (pinned?.kind === 'article') openCard(pinned.id); };
$('tsearch').addEventListener('input', () => { clearTimeout(window.__tsT); window.__tsT = setTimeout(renderTrails, 120); });
const loadExample = () => { closeStart(); snapshot(); state = exampleState(); cur = null; pinned = null; range = null; closeCard(); graph.reset(); commit({ refit: true }); };
// Data shipped as a <script> (not fetch) so it also works when index.html is opened from disk.
function loadDataScript(src, name) {
  const key = src.split('/').pop().replace(/\.js$/, '');
  if (window[name]?.[key]) return Promise.resolve(window[name]);
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = () => (window[name] ? res(window[name]) : rej(new Error('empty'))); el.onerror = () => rej(new Error('not found'));
    document.head.appendChild(el);
  });
}
async function loadTestData(which = 'wikispeedia-1000') {
  closeStart(); status('Loading synapses…');
  try {
    await loadDataScript(`data/${which}.js`, 'WIKI_TRAILS_DATA');
    const s = validate(window.WIKI_TRAILS_DATA[which]);
    snapshot(); state = s; cur = null; pinned = null; range = null; setFocus(null, false); closeCard(); setPreset('all', false); graph.reset(); commit({ refit: true });
    status(`Loaded ${s.trails.length} real human trails from Wikispeedia.${graph.isSettling() ? ' Laying out the map…' : ''}`);
  } catch (err) { status(`Could not load test data (${err.message}).`); }
}
$('example').onclick = loadExample;
$('testdata').onclick = () => loadTestData('wikispeedia-1000');
$('testdata2').onclick = () => loadTestData('wikispeedia-2years');
$('example2').onclick = () => loadTestData('wikispeedia-1000');

/* ---------- skins ---------- */
const fx = createEffects($('fx'));
let skin = savedSkin();
let chosen = skin.id;
const W = (k) => skin.words?.[k] ?? k;
const DEFAULT_TITLES = { builder: 'TRAILBLZ.EXE', trails: 'Trails', brain: 'BRAIN.EXE - C:\\WIKI\\TRAILS' };
function applySkin(id, { persist = true } = {}) {
  skin = skinById(id);
  const html = document.documentElement;
  html.dataset.skin = skin.id; html.dataset.chrome = skin.chrome || 'bevel'; html.dataset.ui = (skin.ui || []).join(' ');
  graph.setPalette(skin);
  fx.set(skin.fx);
  const t = { ...DEFAULT_TITLES, ...(skin.titles || {}) };
  $('tt-builder').textContent = t.builder; $('tt-trails').textContent = t.trails; $('tt-brain').textContent = t.brain;
  $('task-builder').textContent = t.builder; $('task-brain').textContent = t.brain; $('task-trails').textContent = t.trails;
  $('lbl-export').textContent = skin.menu?.export || 'Export JSON…';
  $('lbl-import').textContent = skin.menu?.import || 'Import JSON…';
  $('skinname').textContent = skin.name;
  $('newtrail').textContent = `New ${W('trail')}`;
  if (persist) { chosen = skin.id; rememberSkin(skin.id); }
  $('banner').classList.remove('on');
  renderStats(); renderBuilder(); renderTrails(); applyHighlight(); markChosen();
}

/* ---------- skin toys: toast, banner, eye, sound ---------- */
let toastT;
function toast(t, sound = true) {
  if (!t) return;
  const el = $('toast'); el.textContent = t; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1700);
  if (sound) blip(1.5);
}
function bannerFor(t) {
  const el = $('banner'); const a = t && D.articles.get(t);
  if (!a || !skin.banner) { el.classList.remove('on'); return; }
  let topIn = null, topInCount = 0;
  for (const l of D.links.values()) {
    if (l.a === t && l.ba > topInCount) { topIn = l.b; topInCount = l.ba; }
    if (l.b === t && l.ab > topInCount) { topIn = l.a; topInCount = l.ab; }
  }
  const txt = skin.banner({ title: t, a, topIn, topInCount });
  if (!txt) { el.classList.remove('on'); return; }
  el.textContent = txt; el.classList.add('on');
}
$('stage').addEventListener('mousemove', (e) => {
  if (!skin.ui?.includes('eye')) return;
  const r = $('eye').getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
  $('eye').firstElementChild.style.transform = `translate(${(dx / d) * Math.min(14, d / 20)}px, ${(dy / d) * Math.min(14, d / 20)}px)`;
});
let soundOn = false; try { soundOn = localStorage.getItem('wiki-trails.sound') === '1'; } catch {}
$('sound').checked = soundOn;
$('sound').onchange = () => { soundOn = $('sound').checked; try { localStorage.setItem('wiki-trails.sound', soundOn ? '1' : '0'); } catch {} blip(); };
let actx;
function blip(mult = 1) {
  if (!soundOn) return;
  try {
    actx ||= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), sd = skin.sound || { wave: 'square', f: 880 }, now = actx.currentTime;
    o.type = sd.wave; o.frequency.setValueAtTime(sd.f * mult, now); o.frequency.exponentialRampToValueAtTime(sd.f * mult * 1.5, now + .08);
    g.gain.setValueAtTime(.05, now); g.gain.exponentialRampToValueAtTime(.0001, now + .14);
    o.connect(g).connect(actx.destination); o.start(now); o.stop(now + .15);
  } catch { /* audio unavailable */ }
}

/* ---------- skin gallery + slideshow ---------- */
const gal = $('gallery');
const MOCK = `<svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice"><path class="ml" d="M18 40 Q40 10 62 28 T104 18" stroke-width="3"/><path class="ml" d="M18 40 L50 50 L62 28" stroke-width="1" opacity=".55"/><path class="ml" d="M62 28 L88 46" stroke-width="1.6" opacity=".8"/><circle class="mn2" cx="18" cy="40" r="4.5"/><circle class="mn" cx="62" cy="28" r="5.5"/><circle class="mn" cx="104" cy="18" r="3"/><circle class="mn" cx="50" cy="50" r="2.5"/><circle class="mn" cx="88" cy="46" r="3"/></svg>`;
function buildGallery() {
  $('gal-body').innerHTML = CATS.map(([c, label]) => `<div class="gal-cat">${label}</div><div class="gal-grid">${SKINS.filter((s) => s.cat === c).map((s) =>
    `<button class="card" data-skin="${s.id}" data-chrome="${s.chrome || 'bevel'}" data-id="${s.id}"><div class="mock-desk"><div class="mock-win"><div class="mock-title">${esc((s.titles?.brain) || s.name)}</div><div class="mock-screen">${MOCK}</div><div class="mock-row"><span class="mock-field"></span><span class="mock-btn">OK</span></div></div></div><div class="card-name">${esc(s.name)}</div><div class="card-sub">${esc(s.blurb)}</div></button>`).join('')}</div>`).join('');
  for (const c of $('gal-body').querySelectorAll('.card')) {
    c.onmouseenter = () => { stopShow(); applySkin(c.dataset.id, { persist: false }); };
    c.onfocus = c.onmouseenter;
    c.onclick = () => { applySkin(c.dataset.id); blip(); };
    c.ondblclick = () => { applySkin(c.dataset.id); hideGallery(); };
  }
  $('gal-body').onmouseleave = () => { if (skin.id !== chosen) applySkin(chosen, { persist: false }); };
}
function markChosen() {
  for (const c of document.querySelectorAll('.card')) c.classList.toggle('chosen', c.dataset.id === chosen);
  const cs = skinById(chosen);
  $('gal-now').textContent = skin.id === chosen ? `Current: ${cs.name}` : `Trying: ${skin.name} (current: ${cs.name})`;
}
function openGallery() { closeStart(); stopShow(); if (!$('gal-body').children.length) buildGallery(); markChosen(); gal.hidden = false; gal.querySelector('.card.chosen')?.scrollIntoView({ block: 'nearest' }); }
function hideGallery() { gal.hidden = true; }
function cancelGallery() { hideGallery(); if (skin.id !== chosen) applySkin(chosen, { persist: false }); }
function flip(dir) { const i = SKINS.findIndex((s) => s.id === skin.id); applySkin(SKINS[(i + dir + SKINS.length) % SKINS.length].id); blip(); document.querySelector(`.card[data-id="${skin.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
let showing = null;
function startShow() {
  hideGallery();
  const step = () => { const i = SKINS.findIndex((s) => s.id === skin.id); applySkin(SKINS[(i + 1) % SKINS.length].id, { persist: false }); toast(skin.name, false); status(`Slideshow: ${skin.name}. Click or press any key to keep it.`); };
  step(); showing = setInterval(step, 3800);
  setTimeout(() => { document.addEventListener('pointerdown', keepShow, { once: true }); document.addEventListener('keydown', keepShow, { once: true }); }, 0);
}
function stopShow() { if (showing) { clearInterval(showing); showing = null; } }
function keepShow() { if (!showing) return; stopShow(); applySkin(skin.id); toast(`Kept: ${skin.name}`, false); status('Ready.'); }
$('skinbtn').onclick = openGallery; $('skins2').onclick = openGallery; $('skinsmenu').onclick = openGallery;
$('gal-ok').onclick = () => { applySkin(skin.id); hideGallery(); };
$('galclose').onclick = cancelGallery;
$('gal-prev').onclick = () => flip(-1); $('gal-next').onclick = () => flip(1);
$('gal-show').onclick = startShow;
$('gal-rand').onclick = () => { let s; do { s = SKINS[Math.floor(Math.random() * SKINS.length)]; } while (s.id === skin.id); applySkin(s.id); blip(); document.querySelector(`.card[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
gal.addEventListener('click', (e) => { if (e.target === gal) cancelGallery(); });
document.addEventListener('keydown', (e) => {
  if (!gal.hidden) {
    if (e.key === 'ArrowRight') { e.preventDefault(); flip(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); flip(-1); }
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); cancelGallery(); }
    else if (e.key === 'Enter') { applySkin(skin.id); hideGallery(); }
    return;
  }
  if ((e.key === 's' || e.key === 'S') && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !e.ctrlKey && !e.metaKey && !e.altKey) openGallery();
}, true);
applySkin(skin.id, { persist: false });

/* ---------- start menu, clock, status, boot ---------- */
function closeStart() { $('startmenu').hidden = true; $('startbtn').classList.remove('pressed'); $('startbtn').setAttribute('aria-expanded', 'false'); }
$('startbtn').onclick = (e) => { e.stopPropagation(); const open = $('startmenu').hidden; $('startmenu').hidden = !open; $('startbtn').classList.toggle('pressed', open); $('startbtn').setAttribute('aria-expanded', String(open)); };
$('startmenu').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeStart);
$('export').addEventListener('click', closeStart);
$('import').addEventListener('change', closeStart);
const tickClock = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
tickClock(); setInterval(tickClock, 15000);
function status(t) { $('status').textContent = t; }
function statusFor(t) {
  const a = t && D.articles.get(t);
  if (!a) { status(cursorArticle() ? `Cursor: ${cursorArticle()}` : 'Ready.'); return; }
  if (skin.hover) { status(skin.hover(a)); return; }
  status(`${a.title}: ${a.visits} visit(s), ${a.trails.size} trail(s)${a.starts.size ? `, start of ${a.starts.size}` : ''}`);
}
function boot() {
  let seen = false; try { seen = sessionStorage.getItem('wt-boot'); sessionStorage.setItem('wt-boot', '1'); } catch {}
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const el = $('boot'), log = $('bootlog'); el.hidden = false;
  const bios = ['bevel', 'terminal'].includes(skin.chrome);
  const lines = [...skin.boot, ...(bios ? ['Detecting curiosity........ <span class="ok">FOUND</span>', 'Loading synapses........... <span class="ok">OK</span>', ''] : ['']), '<span class="ok">Starting Wiki Trails…</span>'];
  return new Promise((res) => {
    let i = 0; const done = () => { clearInterval(iv); el.hidden = true; res(); };
    const iv = setInterval(() => { log.innerHTML += lines[i++] + '\n'; if (i >= lines.length) { clearInterval(iv); setTimeout(done, 450); } }, 140);
    el.onclick = done; document.addEventListener('keydown', done, { once: true });
  });
}
let clearArmed = false;
$('clear').onclick = () => {
  if (!clearArmed) { clearArmed = true; $('clear').lastChild.textContent = 'Click again to clear'; setTimeout(() => { clearArmed = false; $('clear').lastChild.textContent = 'Clear all'; }, 2500); return; }
  clearArmed = false; $('clear').lastChild.textContent = 'Clear all'; closeStart();
  snapshot(); state = { ...emptyState(), lang: state.lang }; cur = null; pinned = null; range = null; closeCard(); graph.reset(); commit({ refit: true });
};
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => graph.fit(false), 150); });


/* ---------- connection click ---------- */
function clickEdge(l) {
  blip(0.9);
  pinned = { kind: 'edge', id: l.key };
  openEdgeCard(l.key);
  applyHighlight(); renderTrails(); zoomToPinned();
}
function openEdgeCard(key) {
  const l = DV.links.get(key) || D.links.get(key); if (!l) return closeCard();
  const trails = [...(l.trails || [])].map(trailOf).filter(Boolean).sort((p, q) => Date.parse(q.created) - Date.parse(p.created));
  const when = l.last ? new Date(l.last).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '?';
  $('card').innerHTML = `<div class="title"><span class="ico ico-brain"></span><span class="tt">Connection</span><button class="x" id="cx" aria-label="Close">×</button></div>
    <div class="inner">
    <div class="meta"><b><a data-go="${esc(l.a)}">${esc(l.a)}</a> ↔ <a data-go="${esc(l.b)}">${esc(l.b)}</a></b><br>clicked ${l.total}× · last on ${when}</div>
    <div class="mode">${l.ab}× ${esc(l.a)} → ${esc(l.b)}<br>${l.ba}× ${esc(l.b)} → ${esc(l.a)}<br>Showing every route that used this connection.</div>
    <fieldset><legend>In ${trails.length} ${esc(W(trails.length === 1 ? 'trail' : 'trails'))}</legend><ul>${trails.slice(0, 10).map((t) => `<li><a data-trail="${t.id}">${esc(trailLabel(t))}</a><span class="w">${new Date(t.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></li>`).join('')}${trails.length > 10 ? `<li>…and ${trails.length - 10} more</li>` : ''}</ul></fieldset>
    </div>`;
  $('card').style.display = 'block';
  $('cx').onclick = () => { pinned = null; closeCard(); applyHighlight(); };
  $('card').querySelectorAll('[data-go]').forEach((el) => { el.style.cursor = 'pointer'; el.onclick = () => clickArticle(el.dataset.go); });
  $('card').querySelectorAll('[data-trail]').forEach((el) => el.onclick = () => { pinned = { kind: 'trail', id: el.dataset.trail }; closeCard(); applyHighlight(); renderTrails(); zoomToPinned(); });
}

/* ---------- focus mode ---------- */
function setFocus(title, refitView = true) {
  focusTitle = title;
  const chip = $('focuschip');
  if (title) {
    let nb = graph.neighbourhood(title, 1);
    if (nb.size < 25) nb = graph.neighbourhood(title, 2);
    focusSet = nb; graph.setView({ focus: nb });
    pinned = null; hovered = null; closeCard();
    chip.hidden = false; chip.innerHTML = `Focus: ${esc(title)} <b>×</b>`;
    status(`Focus: ${title} and its ${nb.size - 1} neighbours. Double-click another article to move, Esc to leave.`);
  } else {
    focusSet = null; graph.setView({ focus: null }); chip.hidden = true;
  }
  graph.setVisible(DV); applyHighlight();
  if (refitView) graph.fit(true);
}
$('focuschip').onclick = () => setFocus(null);

/* ---------- view: density, fade, maximize, relayout ---------- */
const VKEY = 'wiki-trails.view';
function saveView() { try { localStorage.setItem(VKEY, JSON.stringify({ density: +$('density').value, fade: $('fade').checked, max: !!document.documentElement.dataset.max })); } catch {} }
function restoreView() {
  let v = {}; try { v = JSON.parse(localStorage.getItem(VKEY)) || {}; } catch {}
  if (v.density) $('density').value = v.density;
  if (v.fade === false) $('fade').checked = false;
  graph.setView({ density: +$('density').value, fade: $('fade').checked });
  if (v.max) toggleMax(true);
}
$('density').oninput = () => { graph.setView({ density: +$('density').value }); saveView(); };
$('fade').onchange = () => { graph.setView({ fade: $('fade').checked }); saveView(); };
function toggleMax(on = !document.documentElement.dataset.max) {
  if (on) document.documentElement.dataset.max = '1'; else delete document.documentElement.dataset.max;
  $('maxbtn').classList.toggle('on', !!on); $('maxbtn').textContent = on ? '⛶ Restore' : '⛶ Maximize';
  saveView();
}
$('maxbtn').onclick = () => toggleMax();
document.querySelector('[data-maxbtn]').onclick = () => toggleMax();

/* ---------- minimizable side windows (they go to the taskbar) ---------- */
const MINKEY = 'wiki-trails.minimized';
let minimized = new Set();
try { minimized = new Set(JSON.parse(localStorage.getItem(MINKEY)) || []); } catch {}
function applyMin() {
  for (const id of ['w-builder', 'w-trails']) $(id).hidden = minimized.has(id);
  if (minimized.size === 2) document.documentElement.dataset.colEmpty = '1'; else delete document.documentElement.dataset.colEmpty;
  document.querySelectorAll('.task[data-win]').forEach((b) => b.classList.toggle('on', !minimized.has(b.dataset.win)));
  try { localStorage.setItem(MINKEY, JSON.stringify([...minimized])); } catch {}
}
function setMin(id, on) { if (on) minimized.add(id); else minimized.delete(id); applyMin(); blip(on ? 0.7 : 1.2); }
document.querySelectorAll('[data-min]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); setMin(b.dataset.min, true); });
document.querySelectorAll('.task[data-win]').forEach((b) => b.onclick = () => {
  const id = b.dataset.win;
  if (id === 'w-brain') { if (document.documentElement.dataset.max) toggleMax(false); return; }
  setMin(id, !minimized.has(id));
  if (!minimized.has(id) && document.documentElement.dataset.max) toggleMax(false);
});
function showBuilder() { if (minimized.has('w-builder')) setMin('w-builder', false); if (document.documentElement.dataset.max) toggleMax(false); }
applyMin();
$('relayout').onclick = () => { graph.relayout(); status('Computing a fresh layout…'); waitThenFit(); };
document.addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || !gal.hidden) return;
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleMax(); }
});

/* ---------- time lens ---------- */
let tlBrush = null, tlX = null, tlSilent = false;
function renderTimeline() {
  const svg = d3.select('#tlsvg'), node = svg.node(), w = node.clientWidth || 600, h = node.clientHeight || 42;
  svg.selectAll('*').remove();
  const span = timeSpan(state);
  if (!span) { $('tllabel').textContent = ''; return; }
  const [t0, t1] = [span[0], Math.max(span[1], span[0] + 864e5)];
  const days = (t1 - t0) / 864e5, binMs = (days > 400 ? 7 : 1) * 864e5;
  const bins = new Map();
  for (const tr of state.trails) for (const v of tr.visits) { if (v.parent == null) continue; const b = Math.floor((visitTime(tr, v) - t0) / binMs); bins.set(b, (bins.get(b) || 0) + 1); }
  tlX = d3.scaleTime().domain([t0, t1 + binMs]).range([4, w - 4]);
  const mx = Math.max(1, ...bins.values()), y = d3.scaleSqrt().domain([0, mx]).range([0, h - 16]);
  const bw = Math.max(1, tlX(t0 + binMs) - tlX(t0) - 0.5);
  svg.append('g').selectAll('rect').data([...bins]).join('rect').attr('class', 'bar')
    .attr('x', ([b]) => tlX(t0 + b * binMs)).attr('width', bw).attr('y', ([, c]) => h - 14 - y(c)).attr('height', ([, c]) => Math.max(1, y(c)));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 14})`).call(d3.axisBottom(tlX).ticks(Math.max(2, Math.floor(w / 110))).tickSize(3));
  tlBrush = d3.brushX().extent([[0, 0], [w, h - 14]]).on('end', (e) => {
    if (tlSilent) return;
    if (!e.selection) { setRange(null); markPreset('all'); return; }
    const [a, b] = e.selection.map((px) => +tlX.invert(px));
    setRange([a, b]); markPreset(null);
  });
  const g = svg.append('g').attr('class', 'brush').call(tlBrush);
  if (range) { tlSilent = true; g.call(tlBrush.move, [Math.max(4, tlX(range[0])), Math.min(w - 4, tlX(range[1]))]); tlSilent = false; }
  renderTimelineLabel();
}
function renderTimelineLabel() {
  const f = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  $('tllabel').textContent = range ? `${f(range[0])} – ${f(range[1])}` : 'All time';
}
function setRange(r) { range = r; refresh(); }
function markPreset(p) { document.querySelectorAll('.tl-presets .mi').forEach((b) => b.classList.toggle('on', b.dataset.range === p)); }
function setPreset(p, apply = true) {
  markPreset(p);
  const span = timeSpan(state);
  if (p === 'all' || !span) range = null;
  else range = [Math.max(span[0], span[1] - (+p) * 864e5), span[1] + 1];
  if (apply) { refresh(); renderTimeline(); graph.fit(true); }
}
document.querySelectorAll('.tl-presets .mi').forEach((b) => b.onclick = () => setPreset(b.dataset.range));
new ResizeObserver(() => { clearTimeout(window.__tlT); window.__tlT = setTimeout(renderTimeline, 150); }).observe($('tlsvg'));

/* ---------- history files ---------- */
const SKEY = 'wiki-trails.saved';
let savedInfo = { at: 0, clicks: 0, name: '' };
try { savedInfo = { ...savedInfo, ...JSON.parse(localStorage.getItem(SKEY)) }; } catch {}
let unsaved = false;
function markDirty() { unsaved = true; }
function totalClicks() { let n = 0; for (const t of state.trails) n += t.visits.length - 1; return n; }
function renderSaved() {
  const el = $('savedinfo'), tray = $('trayinfo');
  const ago = savedInfo.at ? Date.now() - savedInfo.at : Infinity, days = Math.floor(ago / 864e5);
  const since = Math.max(0, totalClicks() - (savedInfo.clicks || 0));
  const due = state.trails.length > 0 && (since >= 200 || (since > 0 && days >= 7) || (!savedInfo.at && totalClicks() >= 30));
  const when = !savedInfo.at ? 'never saved to a file' : days >= 1 ? `saved ${days} day${days === 1 ? '' : 's'} ago` : ago < 36e5 ? `saved ${Math.max(1, Math.round(ago / 6e4))} min ago` : 'saved today';
  el.textContent = when + (since > 0 && savedInfo.at ? ` · ${since} new click${since === 1 ? '' : 's'}` : '');
  el.classList.toggle('due', due);
  tray.textContent = due ? '💾 Time to save' : ''; tray.classList.toggle('due', due);
}
async function doSave(saveAs = false) {
  closeStart();
  try {
    state.layout = graph.getPositions();
    const r = await saveToFile(state, { saveAs }); if (!r) return;
    savedInfo = { at: Date.now(), clicks: totalClicks(), name: r.name };
    try { localStorage.setItem(SKEY, JSON.stringify(savedInfo)); } catch {}
    unsaved = false; renderSaved();
    status(r.how === 'file' ? `Saved to ${r.name}. Ctrl+S updates the same file.` : `Downloaded ${r.name}. Keep it somewhere safe; open it with Open or by dropping it on the window.`);
  } catch (err) { status(`Could not save: ${err.message}`); }
}
let pendingOpen = null;
function askOpen(s, name) {
  if (!state.trails.length) return applyOpen(s, 'replace', name);
  pendingOpen = { s, name };
  const clicks = s.trails.reduce((n, t) => n + t.visits.length - 1, 0);
  $('od-text').innerHTML = `<b>${esc(name || 'History file')}</b> has ${s.trails.length} trails and ${clicks} clicks. You currently have ${state.trails.length} trails.`;
  $('opendlg').hidden = false; $('od-merge').focus();
}
function applyOpen(s, how, name) {
  snapshot();
  if (how === 'merge') { const m = merge(state, s); state = m.state; status(`Merged ${name || 'the file'}: ${m.added} new trails added.`); }
  else { state = s; graph.reset(); status(`Opened ${name || 'the file'}: ${s.trails.length} trails.`); }
  cur = null; pinned = null; closeCard(); range = null; setFocus(null, false); markPreset('all');
  savedInfo = { at: Date.now(), clicks: totalClicks(), name: name || '' };
  try { localStorage.setItem(SKEY, JSON.stringify(savedInfo)); } catch {}
  commit({ refit: true }); renderSaved();
}
$('od-merge').onclick = () => { $('opendlg').hidden = true; if (pendingOpen) applyOpen(pendingOpen.s, 'merge', pendingOpen.name); pendingOpen = null; };
$('od-replace').onclick = () => { $('opendlg').hidden = true; if (pendingOpen) applyOpen(pendingOpen.s, 'replace', pendingOpen.name); pendingOpen = null; };
$('od-cancel').onclick = $('odclose').onclick = () => { $('opendlg').hidden = true; pendingOpen = null; };
async function doOpen() {
  closeStart();
  try {
    const r = await pickFile();
    if (r === 'fallback') return $('import').click();
    if (r) askOpen(r.state, r.name);
  } catch (err) { status(`Could not open: ${err.message}`); }
}
async function openFileObj(f) {
  try { askOpen(await readFile(f), f.name); } catch (err) { status(`Could not open ${f.name}: ${err.message}`); }
}
$('import').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFileObj(f); };
$('savebtn').onclick = () => doSave(); $('export').onclick = () => doSave(); $('saveas').onclick = () => doSave(true);
$('openbtn').onclick = doOpen; $('importbtn').onclick = doOpen; $('trayinfo').onclick = () => doSave();
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); doSave(e.shiftKey); }
  if (e.key === 'o' || e.key === 'O') { e.preventDefault(); doOpen(); }
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true; const f = e.dataTransfer?.files?.[0]; if (f) openFileObj(f); });
window.addEventListener('beforeunload', (e) => { /* the browser copy is saved continuously; files are optional backups */ });
setInterval(renderSaved, 60000);

/* ---------- start ---------- */
(async () => {
  const booting = boot();
  state = (await loadLocal()) || (await loadPublished()) || emptyState();
  restoreView();
  await (document.fonts?.ready ?? Promise.resolve());
  await booting;
  commit({ refit: true });
  renderSaved();
  const rel = (p) => { if (!p) return null; const r = $('graph').getBoundingClientRect(); return [r.left + p[0], r.top + p[1]]; };
  window.__wikiTrails = { // handy for debugging in the console (and for tests)
    get state() { return state; }, settling: () => graph.isSettling(), gstats: () => graph.stats(),
    nodeXY: (t) => rel(graph.screenOf(t)), drawMs: () => graph.drawMs(), edgeXY: (i) => rel(graph.edgeMid(i)),
  };
})();
