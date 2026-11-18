import { uid, normTitle, langFromUrl, derive, chainTo, trailSteps, routesTo, trailLabel, emptyState, validate } from './model.js';
import { loadInitial, saveLocal, exportFile, importFile } from './storage.js';
import { createGraph, TRAIL_COLORS } from './graph.js';
import { exampleState } from './example.js';
import { SKINS, savedSkin, skinById, rememberSkin } from './skins.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = emptyState();
let D = derive(state);
let cur = null;          // { trailId, visitId } — where the next link starts
let pinned = null;       // { kind: 'article'|'trail', id }
let hovered = null;
const undoStack = [];

const graph = createGraph($('svg'), {
  onHover: (t) => { hovered = t ? { kind: 'article', id: t } : null; applyHighlight(); statusFor(t); },
  onClick: (t) => clickArticle(t),
  onBackground: () => { const had = pinned; pinned = null; closeCard(); applyHighlight(); renderTrails(); if (had) graph.fit(true); },
});

const colorOf = (trailId) => TRAIL_COLORS[(D.trailIndex.get(trailId)?.index ?? 0) % TRAIL_COLORS.length];
const trailOf = (id) => state.trails.find((t) => t.id === id);
const wikiUrl = (t) => `https://${state.lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;

/* ---------- state changes ---------- */
function snapshot() { undoStack.push(JSON.stringify({ state, cur })); if (undoStack.length > 100) undoStack.shift(); }
function commit({ refit = false } = {}) {
  saveLocal(state);
  D = derive(state);
  if (cur && !D.trailIndex.get(cur.trailId)?.byId.has(cur.visitId)) cur = null;
  if (pinned?.kind === 'trail' && !D.trailIndex.has(pinned.id)) pinned = null;
  if (pinned?.kind === 'article' && !D.articles.has(pinned.id)) { pinned = null; closeCard(); }
  graph.update(D);
  graph.setCursor(cursorArticle());
  renderAll();
  applyHighlight();
  if (refit) graph.settleAndFit();
}
function cursorArticle() { return cur ? D.trailIndex.get(cur.trailId)?.byId.get(cur.visitId)?.article ?? null : null; }

function addLink() {
  const raw = $('next').value;
  const title = normTitle(raw);
  if (!title) { $('next').focus(); return; }
  const here = cursorArticle();
  if (here === title) { msg('You are already on that page.', true); return; }
  snapshot();
  const lang = langFromUrl(raw);
  if (lang && !state.trails.length) state.lang = lang;
  if (!cur) {
    const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [] };
    const v = { id: uid(), article: title, parent: null };
    t.visits.push(v); state.trails.push(t);
    cur = { trailId: t.id, visitId: v.id };
  } else {
    const v = { id: uid(), article: title, parent: cur.visitId };
    trailOf(cur.trailId).visits.push(v);
    cur = { trailId: cur.trailId, visitId: v.id };
  }
  const first = state.trails.length === 1 && trailOf(cur.trailId).visits.length <= 2;
  $('next').value = '';
  commit({ refit: first });
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
  const o = JSON.parse(s); state = o.state; cur = o.cur;
  commit();
}

/** Latest visit of `title` inside a trail. */
function lastVisit(trailId, title) {
  const t = trailOf(trailId); if (!t) return null;
  for (let i = t.visits.length - 1; i >= 0; i--) if (t.visits[i].article === title) return t.visits[i];
  return null;
}

function clickArticle(title) {
  // Clicking an article of the trail you're building moves the cursor there (go back & branch).
  if (cur) { const v = lastVisit(cur.trailId, title); if (v) { cur = { trailId: cur.trailId, visitId: v.id }; afterCursorMove(); } }
  pinned = { kind: 'article', id: title };
  openCard(title);
  applyHighlight();
  renderTrails();
  zoomToPinned();
}

/* ---------- highlight ---------- */
function specFor(target) {
  if (!target) return null;
  if (target.kind === 'trail') {
    const t = trailOf(target.id); if (!t) return null;
    const numbers = new Map();
    t.visits.forEach((v, i) => { if (!numbers.has(v.article)) numbers.set(v.article, i + 1); });
    return { steps: trailSteps(D, [t.id]), colorOf, numbers, focus: t.visits[0].article };
  }
  const a = D.articles.get(target.id); if (!a) return null;
  // Journeys of trails that start here + every route that ever led here.
  const steps = [...trailSteps(D, [...a.starts]), ...routesTo(D, a.title)];
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
  graph.focusOn(new Set(sp.steps.flatMap((s) => [s.from, s.to]).concat(sp.focus ? [sp.focus] : [])), pad);
}

/* ---------- rendering ---------- */
function msg(t, warn = false) { $('msg').textContent = t || ''; $('msg').classList.toggle('warn', warn); }

function renderAll() {
  renderStats(); renderBuilder(); renderTrails();
  $('titles').innerHTML = [...D.articles.keys()].sort().map((t) => `<option value="${esc(t)}">`).join('');
  $('empty').style.display = state.trails.length ? 'none' : 'flex';
  $('lang').value = state.lang;
  if (pinned?.kind === 'article') openCard(pinned.id);
}

function renderStats() {
  const clicks = [...D.links.values()].reduce((s, l) => s + l.total, 0);
  let top = null; for (const l of D.links.values()) if (!top || l.total > top.total) top = l;
  $('stats').textContent = `${D.articles.size} articles · ${clicks} clicks · ${state.trails.length} trails` +
    (top && top.total > 1 ? ` · strongest: ${top.a} ↔ ${top.b} ×${top.total}` : '');
}

function renderBuilder() {
  const box = $('crumbs');
  if (!cur) {
    box.innerHTML = '';
    $('qlabel').innerHTML = state.trails.length ? 'Link 1: first page of a new trail' : 'Link 1: first page';
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
  $('tcount').textContent = `${state.trails.length} trail(s)`;
  const box = $('trails');
  box.innerHTML = [...state.trails].reverse().map((t) => {
    const ends = t.visits.filter((v) => !t.visits.some((w) => w.parent === v.id)).length;
    const date = new Date(t.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const cls = ['tr', cur?.trailId === t.id ? 'active' : '', pinned?.kind === 'trail' && pinned.id === t.id ? 'pinned' : ''].join(' ');
    return `<div class="${cls}" data-t="${t.id}">
      <span class="sw" style="background:${colorOf(t.id)};color:${colorOf(t.id)}"></span>
      <div class="tx"><div class="nm">${esc(trailLabel(t))}</div><div class="mt">${t.visits.length} pages · ${ends} end${ends === 1 ? '' : 's'} · ${date}</div></div>
      <button class="ic" data-act="rename" title="Rename">✎</button>
      <button class="ic${armed.has(t.id) ? ' armed' : ''}" data-act="del" title="Delete">${armed.has(t.id) ? 'Delete?' : '×'}</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.tr').forEach((row) => {
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
    if (cur && lastVisit(cur.trailId, title)) { $('next').focus(); return; }
    snapshot();
    const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [{ id: uid(), article: title, parent: null }] };
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
  if (e.key === 'Escape') { closeStart(); const had = pinned; pinned = null; closeCard(); applyHighlight(); renderTrails(); if (had) graph.fit(true); }
});
$('lang').onchange = () => { state.lang = $('lang').value; saveLocal(state); if (pinned?.kind === 'article') openCard(pinned.id); };
$('export').onclick = () => exportFile(state);
$('import').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { const s = await importFile(f); snapshot(); state = s; cur = null; pinned = null; closeCard(); commit({ refit: true }); msg(`Imported ${s.trails.length} trails.`); }
  catch (err) { msg(`Could not import: ${err.message}`, true); }
};
const loadExample = () => { closeStart(); snapshot(); state = exampleState(); cur = null; pinned = null; closeCard(); commit({ refit: true }); };
async function loadTestData() {
  closeStart(); status('Loading synapses…');
  try {
    const r = await fetch('data/wikispeedia-1000.json'); if (!r.ok) throw new Error(r.status);
    const s = validate(await r.json());
    snapshot(); state = s; cur = null; pinned = null; closeCard(); commit({ refit: true });
    status(`Loaded ${s.trails.length} real human trails from Wikispeedia.`);
  } catch (err) { status(`Could not load test data (${err.message}).`); }
}
$('example').onclick = loadExample;
$('testdata').onclick = loadTestData;
$('example2').onclick = loadTestData;

/* ---------- skins ---------- */
let skin = savedSkin();
function applySkin(id, persist = true) {
  skin = skinById(id);
  document.documentElement.dataset.skin = skin.id;
  graph.setPalette(skin);
  for (const sel of document.querySelectorAll('.skin-select')) sel.value = skin.id;
  if (persist) rememberSkin(skin.id);
  renderTrails(); applyHighlight();
}
for (const sel of document.querySelectorAll('.skin-select')) {
  sel.innerHTML = SKINS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.onchange = () => applySkin(sel.value);
}
applySkin(skin.id, false);

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
  status(`${a.title}: ${a.visits} visit(s), ${a.trails.size} trail(s)${a.starts.size ? `, start of ${a.starts.size}` : ''}`);
}
function boot() {
  let seen = false; try { seen = sessionStorage.getItem('wt-boot'); sessionStorage.setItem('wt-boot', '1'); } catch {}
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const el = $('boot'), log = $('bootlog'); el.hidden = false;
  const lines = [...skin.boot, 'Detecting curiosity........ <span class="ok">FOUND</span>', 'Loading synapses........... <span class="ok">OK</span>', 'Mounting C:\\WIKI\\TRAILS....... <span class="ok">OK</span>', '', 'Starting Wiki Trails 95...'];
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
  snapshot(); state = { ...emptyState(), lang: state.lang }; cur = null; pinned = null; closeCard(); commit({ refit: true });
};
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => graph.fit(false), 150); });

/* ---------- start ---------- */
(async () => {
  const booting = boot();
  state = await loadInitial();
  await (document.fonts?.ready ?? Promise.resolve());
  await booting;
  commit({ refit: true });
  window.__wikiTrails = { get state() { return state; } }; // handy for debugging in the console
})();
