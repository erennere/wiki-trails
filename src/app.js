// The app's shared state and the few actions that change it.
// Panels and views never talk to each other directly: they call these
// actions and listen for events ('data', 'select', 'hover', 'cursor', 'range', 'focus', 'skin', 'settings', 'dirty').
import { derive, emptyState, visitTime, trailPath, timeSpan } from './model.js';
import { saveLocal } from './storage.js';

const SETTINGS_KEY = 'wiki-trails.settings';
const DEFAULTS = { skin: 'plain', theme: 'system', density: 1, fade: true, sound: false, left: true, right: true };

export const app = {
  state: emptyState(),
  D: null,          // derived over all time (drives the map layout)
  DV: null,         // derived for the time range you're looking at
  range: null,      // [fromMs, toMs] or null for all time
  rangeName: 'all', // '30' | '365' | 'all' | 'custom'
  sel: null,        // what's selected: { kind: 'article' | 'edge' | 'trail', id }
  hover: null,      // what the pointer is over (preview only)
  cur: null,        // where the next recorded click attaches: { trailId, visitId }
  focus: null,      // focus mode: { title, set }
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
  if (s && ((s.kind === 'trail' && !trailOf(s.id)) || (s.kind === 'article' && !app.D.articles.has(s.id)) || (s.kind === 'edge' && !app.D.links.has(s.id)))) app.sel = null;
  if (app.focus && !app.D.articles.has(app.focus.title)) app.focus = null;
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
  app.state = next; app.cur = null; app.sel = null; app.hover = null; app.focus = null;
  app.range = null; app.rangeName = 'all';
  commit({ fresh: true });
}

/* ---------- selection, hover, cursor ---------- */
const same = (a, b) => (a === b) || (a && b && a.kind === b.kind && a.id === b.id);
export function select(sel, opts = {}) { if (same(sel, app.sel) && !opts.force) return; app.sel = sel; emit('select', opts); }
export function setHover(h) { if (same(h, app.hover)) return; app.hover = h; emit('hover'); }
export function setCursor(cur) { app.cur = cur; emit('cursor'); }

export function setRange(range, name = range ? 'custom' : 'all') {
  app.range = range; app.rangeName = name;
  app.DV = range ? derive(app.state, range) : app.D;
  emit('range');
}
export function setFocus(title, set = null) { app.focus = title ? { title, set } : null; emit('focus'); }

/* ---------- what to highlight ---------- */
const MAX_PATHS = 120;
/** 1 for something you did today, fading towards 0.15 for the oldest part of your history. */
export function recency(t) {
  const span = app.span || 30 * 864e5;
  const tau = Math.max(21 * 864e5, span / 4);
  return 0.15 + 0.85 * Math.exp(-Math.max(0, Date.now() - t) / tau);
}
/**
 * One rule for every selection: draw the trails involved, start to end.
 *  - an article: every trail that passed through it, anchored at that page
 *    (blue = how you got there, orange = where you went next)
 *  - a connection: every trail that used it, anchored at that click
 *  - a trail: that one trail, blue at its start to orange at its end, with step numbers
 * Recent trails are drawn thicker and brighter.
 */
export function specFor(target) {
  if (!target) return null;
  const D = app.D, DV = app.DV, fs = app.focus?.set, r = app.range;
  const ok = (s) => DV.articles.has(s.from) && DV.articles.has(s.to) && (!fs || (fs.has(s.from) && fs.has(s.to)));
  const inR = (t) => !r || (t >= r[0] && t <= r[1]);
  const paths = [];
  const add = (ti, anchorVisit) => {
    const t = anchorVisit ? visitTime(ti.trail, anchorVisit) : Date.parse(ti.trail.created);
    const segs = trailPath(ti, anchorVisit?.id).filter(ok);
    paths.push({ trailId: ti.trail.id, segs, t, rec: recency(t) });
  };
  if (target.kind === 'trail') {
    const ti = D.trailIndex.get(target.id); if (!ti) return null;
    add(ti, null);
    const numbers = new Map();
    ti.trail.visits.forEach((v, i) => { if (!numbers.has(v.article)) numbers.set(v.article, i + 1); });
    return { mode: 'trail', paths, numbers, anchor: null, total: 1 };
  }
  if (target.kind === 'article') {
    const a = D.articles.get(target.id); if (!a) return null;
    for (const id of a.trails) {
      const ti = D.trailIndex.get(id);
      // the latest time this trail was on the page (a trail can come back to a page)
      let anchor = null;
      for (const v of ti.trail.visits) if (v.article === a.title && inR(visitTime(ti.trail, v))) anchor = v;
      if (anchor) add(ti, anchor);
    }
  } else if (target.kind === 'edge') {
    const l = D.links.get(target.id); if (!l) return null;
    for (const id of l.trails) {
      const ti = D.trailIndex.get(id);
      let anchor = null;
      for (const v of ti.trail.visits) {
        if (v.parent == null) continue;
        const from = ti.byId.get(v.parent).article;
        if (((from === l.a && v.article === l.b) || (from === l.b && v.article === l.a)) && inR(visitTime(ti.trail, v))) anchor = v;
      }
      if (anchor) add(ti, anchor);
    }
  }
  paths.sort((p, q) => q.t - p.t);
  const total = paths.length;
  return { mode: 'anchor', paths: paths.slice(0, MAX_PATHS), total, anchor: target.kind === 'article' ? target.id : null, edgeKey: target.kind === 'edge' ? target.id : null };
}

/* ---------- settings ---------- */
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* storage unavailable */ } }
export function setSetting(key, value) { app.settings[key] = value; saveSettings(); emit('settings', key); }
