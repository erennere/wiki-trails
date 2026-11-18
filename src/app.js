// The app's shared state and the few actions that change it.
// Panels and views never talk to each other directly: they call these
// actions and listen for events ('data', 'select', 'hover', 'cursor', 'range', 'threads', 'pin', 'skin', 'settings', 'dirty').
import { derive, emptyState, visitTime, timeSpan, threadOf, chainTo, sideTrips } from './model.js';
import { saveLocal } from './storage.js';

const SETTINGS_KEY = 'wiki-trails.settings';
const DEFAULTS = { skin: 'plain', theme: 'system', density: 1, fade: true, ageFade: 0.85, rotate: true, threads: 5, sound: false, left: true, right: true };

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
};
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
  saveLocal(app.state);
  rederive();
  if (app.cur && !app.D.trailIndex.get(app.cur.trailId)?.byId.has(app.cur.visitId)) app.cur = null;
  const s = app.sel;
  if (s && ((s.kind === 'trail' && !trailOf(s.id)) || (s.kind === 'article' && !app.D.articles.has(s.id)))) app.sel = null;
  app.threads = threadsFor(app.sel); keepPin();
  emit('data', opts);
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
  snapshot();
  app.state = next; app.cur = null; app.sel = null; app.hover = null; app.period = null;
  app.range = null; app.rangeName = 'all';
  commit({ fresh: true });
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
const collapse = (titles) => titles.filter((t, i) => i === 0 || t !== titles[i - 1]);
/**
 * One rule for every selection: the threads that went through it, newest first, each from where
 * it started to where it ended.
 *  - an article: every trail that passed through it (at its latest pass in the period)
 *  - a trail: that trail's main line, with its side trips
 * Returns { kind, anchor, threads: [{ key, trailId, visitId, t, path, passes, sides, color, rec }], total, times }.
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
  const add = (ti, v, passes) => all.push({ trailId: ti.trail.id, visitId: v.id, t: visitTime(ti.trail, v), path: collapse(threadOf(ti, v.id).map((x) => x.article)), passes, sides: [] });
  if (kind === 'trail') {
    const ti = D.trailIndex.get(target.id); if (!ti) return null;
    const vs = ti.trail.visits, last = vs[vs.length - 1];
    const main = chainTo(ti, last.id);
    all.push({ trailId: ti.trail.id, visitId: last.id, t: visitTime(ti.trail, vs[0]), path: collapse(main.map((x) => x.article)), passes: 1, sides: sideTrips(ti, new Set(main.map((x) => x.id))) });
  } else if (kind === 'article') {
    const a = D.articles.get(target.id); if (!a) return null;
    anchor = a.title;
    for (const id of a.trails) {
      const ti = D.trailIndex.get(id);
      let at = null, passes = 0;
      for (const v of ti.trail.visits) {
        if (v.article !== a.title) continue;
        const t = visitTime(ti.trail, v); if (!inLens(t)) continue;
        times.push(t); passes++;
        if (inPeriod(t)) at = v; // the latest pass in the period
      }
      if (at) add(ti, at, passes);
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
    th.rank = i;
    th.rec = Math.pow(0.6, i); // 1 for the newest, then 0.6, 0.36, …
  });
  return { kind, anchor, threads, total: all.length, times: times.sort((x, y) => x - y) };
}

/* ---------- settings ---------- */
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* storage unavailable */ } }
export function setSetting(key, value) { app.settings[key] = value; saveSettings(); emit('settings', key); }
