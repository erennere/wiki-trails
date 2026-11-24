// The app's shared state and the few actions that change it.
// Panels and views never talk to each other directly: they call these
// actions and listen for events ('data', 'select', 'hover', 'cursor', 'range', 'threads', 'pin', 'skin', 'settings', 'dirty').
import { derive, emptyState, visitTime, timeSpan, threadOf, chainTo, continueFrom, sideTrips, setReadingRule } from './model.js';
import { saveLocal } from './storage.js';
import { orderVisits } from './sync-core.js';

const SETTINGS_KEY = 'wiki-trails.settings';
const DEFAULTS = { skin: 'desktop95', theme: 'system', density: 1, fade: true, ageFade: 0.85, rotate: true, threads: 5, guessReading: true, readAfter: 60, mark: 'ends', show: 1, sound: false, left: false, right: false };

export const app = {
  state: emptyState(),
  D: null,          // derived over all time (drives the map layout)
  DV: null,         // derived for the time range you're looking at
  range: null,      // [fromMs, toMs] or null for all time
  rangeName: 'all', // '30' | '365' | 'all' | 'custom'
  sel: null,        // what's selected: { kind: 'article' | 'trail', id }
  hover: null,      // what the pointer is over (preview only)
  cur: null,        // where the next recorded click attaches: { trailId, visitId }
  threads: null,    // the threads drawn for the selection (see threadsFor)
  period: null,     // [fromMs, toMs]: only show threads from this period (picked on the timeline)
  pin: null,        // the thread you clicked on (its key), shown fully and explained in the side panel
  colors: [],       // trail colours of the current skin
  settings: loadSettings(),
  published: null,  // whose published history you're looking at (data/trails.json), until you start your own
};
setReadingRule({ guess: app.settings.guessReading, readAfter: app.settings.readAfter });
app.D = app.DV = derive(app.state);

/* ---------- events ---------- */
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, data) { for (const fn of listeners[ev] || []) fn(data); }

/* ---------- lookups ---------- */
export const trailOf = (id) => app.state.trails.find((t) => t.id === id);
export const trailIndex = (id) => app.D.trailIndex.get(id)?.index ?? 0;
export const colorOf = (trailId) => app.colors[trailIndex(trailId) % Math.max(1, app.colors.length)] || '#888';
export function cursorVisit() { return app.cur ? app.D.trailIndex.get(app.cur.trailId)?.byId.get(app.cur.visitId) || null : null; }
export function totalClicks(state = app.state) { let n = 0; for (const t of state.trails) n += Math.max(0, t.visits.length - 1); return n; }
export function inRange(tr) {
  if (!app.range) return true;
  return tr.visits.some((v) => { const t = visitTime(tr, v); return t >= app.range[0] && t <= app.range[1]; });
}

/* ---------- data changes ---------- */
function rederive() {
  app.D = derive(app.state); app.DV = app.range ? derive(app.state, app.range) : app.D;
  const sp = timeSpan(app.state); app.span = sp ? sp[1] - sp[0] : 0;
}

/** Call after changing app.state. */
export function commit(opts = {}) {
  if (!app.published) saveLocal(app.state); // someone else's published history is only shown, never kept
  rederive();
  if (app.cur && !app.D.trailIndex.get(app.cur.trailId)?.byId.has(app.cur.visitId)) app.cur = null;
  const s = app.sel;
  if (s && ((s.kind === 'trail' && !trailOf(s.id)) || (s.kind === 'article' && !app.D.articles.has(s.id)))) app.sel = null;
  app.threads = threadsFor(app.sel); keepPin();
  emit('data', opts);
}

/** How you read a page on a trail: { depth: 'read' | 'skim' | null, guessed, secs } */
export const depthOf = (trailId, visitId) => app.D.trailIndex.get(trailId)?.depth.get(visitId) || { depth: null, guessed: false, secs: null };
/** Say how you read a page ('read', 'skim', or null to go back to the guess). */
export function markReading(trailId, visitId, depth) {
  const v = app.D.trailIndex.get(trailId)?.byId.get(visitId); if (!v) return;
  snapshot();
  // how you read a page is about the page, so the mark goes on every time you opened it
  for (const tr of app.state.trails) for (const x of tr.visits) if (x.article === v.article) { if (depth) x.read = depth; else delete x.read; }
  commit();
}
/** After changing how reading is guessed. */
export function applyReadingRule() {
  setReadingRule({ guess: app.settings.guessReading, readAfter: app.settings.readAfter });
  commit();
}

const undoStack = [];
/** Remember the current history so Undo can return to it. */
export function snapshot() {
  const { layout, ...rest } = app.state;
  undoStack.push(JSON.stringify({ state: rest, cur: app.cur }));
  let bytes = 0; for (const u of undoStack) bytes += u.length;
  while (undoStack.length > 1 && (undoStack.length > 100 || bytes > 24e6)) bytes -= undoStack.shift().length;
  emit('dirty');
}
export const canUndo = () => undoStack.length > 0;
export function undo() {
  const s = undoStack.pop(); if (!s) return false;
  const o = JSON.parse(s);
  app.state = { ...o.state, layout: app.state.layout };
  app.cur = o.cur;
  commit();
  return true;
}

/** Swap in a whole different history (open a file, load test data, clear). */
export function replaceState(next) {
  if (app.published) { app.published = null; emit('published'); } else snapshot();
  app.state = next; app.cur = null; app.sel = null; app.hover = null; app.period = null;
  app.range = null; app.rangeName = 'all';
  commit({ fresh: true });
}

/**
 * You were looking at someone's published history and now start your own (record a page, open a
 * file, connect sync): their trails make way for yours. Returns true if that happened.
 */
export function ownHistory() {
  if (!app.published) return false;
  app.published = null;
  app.state = { ...emptyState(), lang: app.state.lang };
  app.cur = null; app.sel = null; app.hover = null; app.period = null; app.pin = null; app.threads = null;
  emit('published');
  return true;
}

/* ---------- selection, hover, cursor ---------- */
const same = (a, b) => (a === b) || (a && b && a.kind === b.kind && a.id === b.id);
export function select(sel, opts = {}) {
  if (same(sel, app.sel) && !opts.force) return;
  app.sel = sel; app.period = null; app.pin = null; app.threads = threadsFor(sel);
  emit('select', opts);
}
export function setHover(h) { if (same(h, app.hover)) return; app.hover = h; emit('hover'); }
export function setCursor(cur) { app.cur = cur; emit('cursor'); }

export function setRange(range, name = range ? 'custom' : 'all') {
  app.range = range; app.rangeName = name;
  app.DV = range ? derive(app.state, range) : app.D;
  app.threads = threadsFor(app.sel); keepPin();
  emit('range');
}
/** Only show the selection's threads from this period (null = all). */
export function setPeriod(p) { app.period = p; refreshThreads(); }
export function refreshThreads() { app.threads = threadsFor(app.sel); keepPin(); emit('threads'); }
/** Focus one of the drawn threads (null = none). */
export function pinThread(key) { app.pin = key; emit('pin'); }
export const pinned = () => (app.pin && app.threads?.threads.find((t) => t.key === app.pin)) || null;
function keepPin() { if (app.pin && !pinned()) app.pin = null; }

/* ---------- what to highlight ---------- */
/** A list of visits as a path of pages (a page clicked into itself counts once), with how each was read. */
function pathOf(ti, visits) {
  const path = [], depths = [], ids = [];
  for (const v of visits) {
    if (path.length && path[path.length - 1] === v.article) continue;
    path.push(v.article); depths.push(ti.depth.get(v.id)?.depth || null); ids.push(v.id);
  }
  return { path, depths, ids };
}
/**
 * A trail as a tree to draw, made of pages, not of visits: going the same way twice (A → B → C, later
 * A → B → C → D) is one line, A → B → C → D, and a branch splits off only at the page where you went
 * somewhere else. Each page gets one place in the tree: where you first went to it, preferring the ways
 * on from the selected page over branches off the way here.
 * It's split into chains that cover the tree once: the main one runs from the start through the
 * selected page and on the way you went last; every other branch is a chain of its own that starts
 * where it forks off. A link between two pages that the tree reaches in other ways (you came back to a
 * page by another route) is a short chain of its own (extra: true), so nothing you did is lost.
 * Every page also gets its distance in clicks from the selected page along the tree (0 if none).
 * Returns { chains: [{ path, ids, depths, dist, side, grp, tids, extra? }], groups, path, ids, tids, depths, ways }.
 */
function treeOf(ti, anchors, mainId) {
  const visits = ti.trail.visits, byId = ti.byId;
  const at = (id) => byId.get(id)?.article;
  const S = anchors.size ? at(mainId) ?? at([...anchors][0]) : null; // the selected page
  // the way here, as pages: from where the trail began to the selected page, any loop on the way cut out
  const U = [], vid = new Map();
  if (S) {
    for (const v of chainTo(ti, mainId)) {
      const i = U.indexOf(v.article);
      if (i >= 0) { for (const x of U.splice(i + 1)) vid.delete(x); } else { U.push(v.article); vid.set(v.article, v.id); }
      if (v.article === S) break;
    }
    vid.set(S, mainId);
  }
  // each page's place: the page it hangs from, and what it is to the selected page, for its colour:
  //  'up'      the way here (the pages before it, and the page itself)
  //  'down:p'  a way on from here, one per page you went on to (p), with everything after it
  //  'side:n'  a branch off the way here, by where it leaves it (n clicks before the page)
  //  'all'     nothing selected
  const par = new Map(), grp = new Map(), seq = new Map(), tOf = new Map();
  const claim = (page, from, g, v) => { par.set(page, from); grp.set(page, g); vid.set(page, v.id); seq.set(page, seq.size); tOf.set(page, v.t || 0); };
  if (S) U.forEach((p, i) => { par.set(p, i ? U[i - 1] : null); grp.set(p, 'up'); seq.set(p, seq.size); });
  else if (ti.root) claim(ti.root.article, null, 'all', ti.root);
  const groupFrom = (from, page) => {
    if (!S) return 'all';
    if (from === S) return 'down:' + page;
    const i = U.indexOf(from);
    if (i >= 0) return 'side:' + (U.length - 1 - i);
    return grp.get(from);
  };
  // first everything you went on to from the selected page, then the rest; within each, in the order
  // you opened the pages. A page reached from one not placed yet waits for the next round.
  const below = new Set();
  if (S) for (const v of visits) { const p = v.parent == null ? null : byId.get(v.parent); if (anchors.has(v.id) || (p && below.has(p.id))) below.add(v.id); }
  for (const phase of S ? [below, null] : [null]) {
    for (let changed = true; changed;) {
      changed = false;
      for (const v of visits) {
        if (v.parent == null || grp.has(v.article)) continue;
        if (phase && !phase.has(v.parent)) continue;
        const from = at(v.parent);
        if (from === v.article || !grp.has(from)) continue;
        claim(v.article, from, groupFrom(from, v.article), v); changed = true;
      }
    }
  }
  // pages no way above reaches (a trail joined without a link): trees of their own, off to the side
  for (const v of visits) if (!grp.has(v.article)) {
    const from = v.parent != null ? at(v.parent) : null;
    claim(v.article, from && grp.has(from) && from !== v.article ? from : null, from && grp.has(from) ? groupFrom(from, v.article) : S ? 'side:99' : 'all', v);
  }
  // clicks from the selected page along the tree
  const dist = new Map();
  const dOf = (p) => {
    if (!S) return 0;
    if (dist.has(p)) return dist.get(p);
    const i = U.indexOf(p);
    const d = i >= 0 ? U.length - 1 - i : par.get(p) != null ? dOf(par.get(p)) + 1 : 99;
    dist.set(p, d); return d;
  };
  // the tree's branches, each followed on the way you went last (the latest you were anywhere along it)
  const kids = new Map();
  for (const [p, f] of par) if (f != null && !(S && U.includes(p))) (kids.get(f) || kids.set(f, []).get(f)).push(p);
  for (const l of kids.values()) l.sort((x, y) => seq.get(x) - seq.get(y));
  const latest = new Map();
  const late = (p) => {
    if (latest.has(p)) return latest.get(p);
    let t = tOf.get(p) || 0;
    for (const k of kids.get(p) || []) t = Math.max(t, late(k));
    latest.set(p, t); return t;
  };
  const goOn = (p) => { const out = [p]; let x = p; for (;;) { const ks = (kids.get(x) || []).filter((k) => !inChain.has(k)); if (!ks.length) break; x = ks.reduce((a, b) => (late(b) >= late(a) ? b : a)); out.push(x); inChain.add(x); } return out; };
  const inChain = new Set();
  const roots = [...par].filter(([p, f]) => f == null).map(([p]) => p);
  const lists = [];
  const start = S ? U[0] : roots[0];
  if (start != null) {
    let main;
    if (S) { U.forEach((p) => inChain.add(p)); main = [...U.slice(0, -1), ...goOn(S)]; } else { inChain.add(start); main = goOn(start); }
    lists.push(main);
  }
  for (const r of roots) if (!inChain.has(r)) { inChain.add(r); lists.push(goOn(r)); }
  for (let c = 0; c < lists.length; c++) for (const p of lists[c]) for (const k of kids.get(p) || []) {
    if (inChain.has(k)) continue;
    inChain.add(k); lists.push([p, ...goOn(k)]);
  }
  // links the tree doesn't have: another way you came to a page
  const pk = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a), have = new Set();
  for (const l of lists) for (let k = 1; k < l.length; k++) have.add(pk(l[k - 1], l[k]));
  const extra = [];
  for (const v of visits) {
    const from = v.parent != null ? at(v.parent) : null;
    if (!from || from === v.article || have.has(pk(from, v.article))) continue;
    have.add(pk(from, v.article)); extra.push([from, v.article]);
  }
  // the order colours are handed out in: ways on from here as you took them, then branches off the way
  // here, nearest first
  const groups = [...new Set([...grp.keys()].sort((x, y) => seq.get(x) - seq.get(y)).map((p) => grp.get(p)))].filter((g) => g !== 'up' && g !== 'all').sort((a, b) => {
    const [ka, na] = a.split(':'), [kb, nb] = b.split(':');
    if (ka !== kb) return ka === 'down' ? -1 : 1;
    return ka === 'down' ? 0 : +na - +nb;
  });
  const real = (id) => byId.get(id); // a joined trail keeps where each visit really is
  const mk = (path, isExtra) => {
    const ids = path.map((p) => vid.get(p));
    const c = { path, depths: ids.map((id) => ti.depth.get(id)?.depth || null), dist: path.map(dOf) };
    c.grp = path.map((p) => grp.get(p) || 'all');
    c.side = c.grp.map((g) => g.startsWith('side:'));
    c.tids = ids.map((id) => real(id)?._t || ti.trail.id);
    c.ids = ids.map((id) => real(id)?._v || id);
    if (isExtra) c.extra = true;
    return c;
  };
  const chains = lists.map((l) => mk(l)).filter((c, i) => i === 0 || c.path.length > 1);
  const ways = chains.length;
  for (const e of extra) chains.push(mk(e, true));
  return { chains, groups, path: chains[0].path, ids: chains[0].ids, tids: chains[0].tids, depths: chains[0].depths, ways, sides: [] };
}

/** Several trails that belong together (see explorations() in model.js), as one trail to draw. */
function joinedTrail(ids) {
  const D = app.D, key = (t, v) => t + '\u0001' + v, inGroup = new Set(ids);
  const visits = [];
  for (const id of ids) {
    const ti = D.trailIndex.get(id); if (!ti) continue;
    const j = D.join.get(id);
    for (const v of ti.trail.visits) {
      const parent = v.parent != null ? key(id, v.parent) : j && inGroup.has(j.trailId) ? key(j.trailId, j.visitId) : null;
      visits.push({ ...v, id: key(id, v.id), parent, t: visitTime(ti.trail, v), _t: id, _v: v.id });
    }
  }
  const ordered = orderVisits(visits);
  const byId = new Map(ordered.map((x) => [x.id, x])), children = new Map(ordered.map((x) => [x.id, []]));
  for (const x of ordered) if (x.parent != null) children.get(x.parent)?.push(x.id);
  const depth = new Map(ordered.map((x) => [x.id, D.pages.get(x.article)]));
  return { trail: { id: ids[0], visits: ordered }, byId, children, depth, root: ordered.find((x) => x.parent == null), key };
}

/**
 * One rule for every selection: the threads that went through it, newest first, each from where
 * it started to where it ended.
 *  - an article: every trail that passed through it (at its latest pass in the period)
 *  - a trail: that trail's main line, with its side trips
 * Returns { kind, anchor, threads: [{ key, trailId, visitId, t, path, depths, ids, passes, sides, color, rec }], total, times }.
 * `times` are all the moments you were there (in the time lens), for the timeline.
 */
export function threadsFor(target) {
  if (!target) return null;
  const D = app.D, r = app.range, p = app.period;
  const inLens = (t) => !r || (t >= r[0] && t <= r[1]);
  const inPeriod = (t) => !p || (t >= p[0] && t <= p[1]);
  const all = [], times = [];
  const kind = target.kind;
  let anchor = null;
  if (kind === 'trail') {
    const ti = D.trailIndex.get(target.id); if (!ti) return null;
    const vs = ti.trail.visits, last = vs[vs.length - 1];
    all.push({ trailId: ti.trail.id, visitId: last.id, t: visitTime(ti.trail, vs[0]), passes: 1, ...treeOf(ti, new Set(), last.id) });
  } else if (kind === 'article') {
    const a = D.articles.get(target.id); if (!a) return null;
    anchor = a.title;
    // trails that belong together count as one exploration (see explorations() in model.js)
    const done = new Set();
    for (const id of a.trails) {
      const group = D.groupOf.get(id) || [id];
      if (done.has(group)) continue;
      done.add(group);
      const ti = group.length > 1 ? joinedTrail(group) : D.trailIndex.get(id);
      const here = [];
      for (const v of ti.trail.visits) {
        if (v.article !== a.title) continue;
        const t = v.t || visitTime(ti.trail, v); if (!inLens(t)) continue;
        times.push(t);
        if (inPeriod(t)) here.push(v);
      }
      if (!here.length) continue;
      // the whole exploration, as a tree, measured from the times it was on this page. Its main line
      // runs through the latest time you went on from here (or simply the latest time you were here).
      const latest = (l) => l.reduce((x, y) => ((y.t || 0) >= (x.t || 0) ? y : x));
      const went = here.filter((v) => (ti.children.get(v.id) || []).some((k) => ti.byId.get(k)?.article !== v.article || (ti.children.get(k) || []).length));
      const at = latest(went.length ? went : here), last = latest(here);
      all.push({ trailId: at._t || id, visitId: at._v || at.id, t: last.t || visitTime(ti.trail, last), passes: here.length, trails: group.length, ...treeOf(ti, new Set(here.map((v) => v.id)), at.id) });
    }
  } else return null;
  all.sort((x, y) => y.t - x.t);
  const limit = kind === 'trail' ? 1 : Math.min(50, +app.settings.threads || 5);
  const threads = all.slice(0, limit), pal = app.colors.length ? app.colors : ['#2f6fdb'];
  // each thread its own colour; each older one is drawn clearly fainter than the one before,
  // so the newest stands out without reading any dates
  threads.forEach((th, i) => {
    th.key = th.trailId + ':' + th.visitId;
    th.color = pal[i % pal.length];
    // within a trail, the map colours each part by how it relates to the selected page (th.groups,
    // see roleColors in views/map3d.js); a single trail on its own keeps one colour
    th.rank = i;
    th.rec = Math.pow(0.6, i); // 1 for the newest, then 0.6, 0.36, …
  });
  return { kind, anchor, threads, total: all.length, times: times.sort((x, y) => x - y) };
}

/* ---------- settings ---------- */
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { /* nothing saved */ }
  // Desktop 95 is the default look now: a look you never picked yourself follows the default
  if (!saved.skinPicked && saved.skin === 'plain') delete saved.skin;
  return { ...DEFAULTS, ...saved };
}
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* storage unavailable */ } }
export function setSetting(key, value) { app.settings[key] = value; saveSettings(); emit('settings', key); }
