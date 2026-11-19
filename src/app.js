// The app's shared state and the few actions that change it.
// Panels and views never talk to each other directly: they call these
// actions and listen for events ('data', 'select', 'hover', 'cursor', 'range', 'threads', 'pin', 'skin', 'settings', 'dirty').
import { derive, emptyState, visitTime, timeSpan, threadOf, chainTo, continueFrom, sideTrips, setReadingRule } from './model.js';
import { saveLocal } from './storage.js';
import { orderVisits } from './sync-core.js';

const SETTINGS_KEY = 'wiki-trails.settings';
const DEFAULTS = { skin: 'desktop95', theme: 'system', density: 1, fade: true, ageFade: 0.85, rotate: true, threads: 5, guessReading: true, readAfter: 60, colourBy: 'reading', sound: false, left: true, right: true };

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
 * A trail as a tree to draw. It's split into chains that cover every page of the trail once: the main
 * one runs from the start through `mainId` and on the way you went last; every other branch is a chain
 * of its own that starts where it forks off, so branches visibly split from one line.
 * Every page also gets its distance (in clicks) from the nearest of `anchors` (0 everywhere if none).
 * Returns { chains: [{ path, ids, depths, dist }], path, ids, depths (of the main chain), ways }.
 */
function treeOf(ti, anchors, mainId) {
  // clicks away, counted along the trail (opening the same page again is no click)
  const dist = new Map(), q = [...anchors];
  for (const id of q) dist.set(id, 0);
  while (q.length) {
    const id = q.shift(), v = ti.byId.get(id), d0 = dist.get(id), nb = [...(ti.children.get(id) || [])];
    if (v?.parent != null) nb.push(v.parent);
    for (const n of nb) {
      const d = d0 + (ti.byId.get(n)?.article === v?.article ? 0 : 1);
      if (dist.has(n) && dist.get(n) <= d) continue;
      dist.set(n, d);
      if (d === d0) q.unshift(n); else q.push(n);
    }
  }
  const dOf = (id) => (anchors.size ? dist.get(id) ?? 99 : 0);
  const main = [...chainTo(ti, mainId), ...continueFrom(ti, mainId).slice(1)];
  const drawn = new Set(main.map((v) => v.id)), lists = [main];
  for (let c = 0; c < lists.length; c++) {
    for (const v of lists[c]) for (const k of ti.children.get(v.id) || []) {
      if (drawn.has(k)) continue;
      const on = continueFrom(ti, k);
      for (const x of on) drawn.add(x.id);
      lists.push([v, ...on]);
    }
  }
  // the route through the selected page: how you got there, and everything you went on to from it.
  // The rest (what else you did on the way there) is a side branch, drawn muted.
  let route = null;
  if (anchors.size) {
    route = new Set();
    for (const id of anchors) {
      for (const v of chainTo(ti, id)) route.add(v.id);
      const st = [id];
      while (st.length) { const x = st.pop(); route.add(x); for (const k of ti.children.get(x) || []) st.push(k); }
    }
  }
  // what each page is to the selected one, for its colour:
  //  'up'      the way here (the pages before it on the trail, and the page itself)
  //  'down:id' a way on from here, one per page you went on to, with everything after it
  //  'side:n'  a branch off the way here, by where it leaves it (n clicks before the page)
  const grp = new Map(), ups = new Set();
  if (anchors.size) {
    for (const id of anchors) for (const v of chainTo(ti, id)) ups.add(v.id);
    for (const a of anchors) for (const k of ti.children.get(a) || []) {
      const st = [k];
      while (st.length) { const x = st.pop(); if (grp.has(x) || ups.has(x)) continue; grp.set(x, 'down:' + k); for (const y of ti.children.get(x) || []) st.push(y); }
    }
    for (const id of ups) grp.set(id, 'up');
    for (const v of ti.trail.visits) {
      if (grp.has(v.id)) continue;
      let a = v;
      while (a && !ups.has(a.id)) a = a.parent == null ? null : ti.byId.get(a.parent);
      grp.set(v.id, 'side:' + (a ? dOf(a.id) : 99));
    }
  }
  // the order colours are handed out in: ways on from here as you took them, then branches off the way
  // here, nearest first
  const firstT = new Map();
  for (const v of ti.trail.visits) { const g = grp.get(v.id); if (g && !firstT.has(g)) firstT.set(g, v.t || 0); }
  const groups = [...firstT.keys()].filter((g) => g !== 'up').sort((a, b) => {
    const [ka, na] = a.split(':'), [kb, nb] = b.split(':');
    if (ka !== kb) return ka === 'down' ? -1 : 1;
    return ka === 'down' ? firstT.get(a) - firstT.get(b) : +na - +nb;
  });
  const real = (id) => ti.byId.get(id); // a joined trail keeps where each visit really is
  const chains = lists.map((vs) => {
    const c = pathOf(ti, vs);
    c.dist = c.ids.map(dOf);
    c.side = c.ids.map((id) => (route ? !route.has(id) : false));
    c.grp = c.ids.map((id) => grp.get(id) || 'all');
    c.tids = c.ids.map((id) => real(id)?._t || ti.trail.id);
    c.ids = c.ids.map((id) => real(id)?._v || id);
    return c;
  }).filter((c, i) => i === 0 || c.path.length > 1);
  return { chains, groups, path: chains[0].path, ids: chains[0].ids, tids: chains[0].tids, depths: chains[0].depths, ways: chains.length, sides: [] };
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
