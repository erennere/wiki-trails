// Data model: trails are trees of visits; articles and connections are derived.
//
// state = {
//   version: 2,
//   lang: 'en',
//   trails: [{ id, name, created, visits: [{ id, article, parent, t, read? }] }]
// }
// A visit's `parent` is the visit you clicked from (null for the trail's first page).
// `read` is how you read the page, if you said so: 'read' (thoroughly) or 'skim'.
// Otherwise it's taken from `secs` (time the page was in front of you, measured by the browser
// extension), or guessed from how long it was until you opened the next page.
// Going "back" in the browser is not a click, so it creates no connection.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyState() {
  return { version: 2, lang: 'en', trails: [] };
}

/** Turn a Wikipedia URL or a typed title into a canonical article title. */
export function normTitle(input) {
  let s = (input || '').trim();
  const m = s.match(/\/wiki\/([^#?\s]+)/);
  if (m) { try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } }
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Language code from a URL like https://de.wikipedia.org/wiki/..., or null. */
export function langFromUrl(input) {
  const m = (input || '').match(/\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\//i);
  return m ? m[1].toLowerCase() : null;
}

export function validate(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.trails)) throw new Error('Not a Wiki Trails file');
  const s = { version: 2, lang: typeof raw.lang === 'string' ? raw.lang : 'en', trails: [] };
  if (raw.layout && typeof raw.layout === 'object') s.layout = raw.layout;
  if (raw.example) s.example = String(raw.example); // loaded from File → Examples, so not your own history
  for (const t of raw.trails) {
    if (!t || !Array.isArray(t.visits)) continue;
    const ids = new Set();
    const visits = [];
    for (const v of t.visits) {
      const article = normTitle(v?.article);
      if (!article || !v.id || ids.has(v.id)) continue;
      if (v.parent != null && !ids.has(v.parent)) continue; // parents must come first
      ids.add(v.id);
      const t = Number(v.t); 
      visits.push({
        id: String(v.id), article, parent: v.parent ?? null, ...(t > 0 ? { t } : {}),
        ...(v.read === 'read' || v.read === 'skim' ? { read: v.read } : {}),
        // recorded by the browser extension: time the page was in front of you, how far you scrolled
        ...(Number.isFinite(v.secs) && v.secs >= 0 ? { secs: Math.round(v.secs) } : {}),
        ...(Number.isFinite(v.scroll) ? { scroll: Math.max(0, Math.min(1, v.scroll)) } : {}),
        ...(v.src === 'auto' ? { src: 'auto' } : {}),
        ...(typeof v.lang === 'string' && /^[a-z-]{2,12}$/.test(v.lang) ? { lang: v.lang } : {}),
      });
    }
    if (!visits.length) continue;
    const tr = { id: String(t.id || uid()), name: String(t.name || ''), created: t.created || new Date().toISOString(), visits };
    // kept for syncing between devices (see sync-core.js): when you last edited it, and pages you took out
    if (+t.updated > 0) tr.updated = +t.updated;
    if (Array.isArray(t.removed) && t.removed.length) tr.removed = t.removed.map(String);
    s.trails.push(tr);
  }
  return s;
}

export const pairKey = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

/**
 * Derive everything the graph needs.
 * articles: Map title -> { title, visits, read, skim, trails:Set, starts:Set(trailId) }
 * links:    Map pairKey -> { key, a, b, ab, ba, total }   (a < b alphabetically)
 */
/** Time of a visit in ms (older files have no per-visit time: fall back to the trail's start). */
export const visitTime = (tr, v) => v.t || Date.parse(tr.created) || 0;

/* ---------- how you read a page ---------- */
// Read or skimmed is about the page, not one visit: it's the total time you spent on it, over every
// time you opened it. The browser extension measures that time only while the page was in front of
// you and you were using it, so a page left open somewhere doesn't count. At least `readAfter` seconds
// in total counts as read. If you said how you read a page, that's what counts.
// Pages you recorded by hand have no measured time; for those (if guessing is on) the time until you
// opened the next page stands in, each gap between 3 s and 2 h (longer gaps say nothing).
const reading = { guess: true, readAfter: 60 };
export function setReadingRule(r) { Object.assign(reading, r); }
/** For every page: { depth: 'read' | 'skim' | null, guessed, measured, secs (in total), scroll (furthest) } */
export function readingOfPages(state) {
  const P = new Map();
  const pg = (a) => P.get(a) || P.set(a, { secs: 0, measured: 0, gap: 0, gaps: 0, scroll: null, mark: null, markT: -1 }).get(a);
  for (const tr of state.trails) {
    const order = tr.visits.filter((v) => v.t).sort((a, b) => a.t - b.t), next = new Map();
    for (let i = 0; i + 1 < order.length; i++) next.set(order[i].id, order[i + 1].t - order[i].t);
    for (const v of tr.visits) {
      const p = pg(v.article), t = visitTime(tr, v);
      if (v.read && t >= p.markT) { p.mark = v.read; p.markT = t; }
      if (v.secs != null) { p.secs += v.secs; p.measured++; if (v.scroll != null) p.scroll = Math.max(p.scroll ?? 0, v.scroll); }
      else if (v.src !== 'auto') { const g = next.get(v.id); if (g != null && g >= 3000 && g <= 7200e3) { p.gap += g / 1000; p.gaps++; } }
    }
  }
  const out = new Map();
  for (const [a, p] of P) {
    const secs = p.measured ? p.secs : p.gaps ? p.gap : null;
    if (p.mark) out.set(a, { depth: p.mark, guessed: false, measured: !!p.measured, secs, scroll: p.scroll });
    else if (p.measured) out.set(a, { depth: p.secs >= reading.readAfter ? 'read' : 'skim', guessed: true, measured: true, secs, scroll: p.scroll });
    else if (reading.guess && p.gaps) out.set(a, { depth: p.gap >= reading.readAfter ? 'read' : 'skim', guessed: true, measured: false, secs });
    else out.set(a, { depth: null, guessed: false, measured: false, secs: null, scroll: null });
  }
  return out;
}

/** First and last visit time over the whole history. */
export function timeSpan(state) {
  let a = Infinity, b = -Infinity;
  for (const tr of state.trails) for (const v of tr.visits) { const t = visitTime(tr, v); if (t < a) a = t; if (t > b) b = t; }
  return a <= b ? [a, b] : null;
}

/**
 * range: optional [fromMs, toMs]; visits outside it are ignored (the map keeps its layout).
 */
export function derive(state, range = null) {
  const articles = new Map();
  const links = new Map();
  const inRange = (t) => !range || (t >= range[0] && t <= range[1]);
  const art = (t) => {
    if (!articles.has(t)) articles.set(t, { title: t, visits: 0, read: 0, skim: 0, trails: new Set(), starts: new Set(), last: 0 });
    return articles.get(t);
  };
  const trailIndex = new Map();
  const pages = readingOfPages(state); // over your whole history: read or skimmed is about the page
  state.trails.forEach((tr, i) => {
    const byId = new Map(tr.visits.map((v) => [v.id, v]));
    const children = new Map(tr.visits.map((v) => [v.id, []]));
    let root = null;
    const depth = new Map(tr.visits.map((v) => [v.id, pages.get(v.article)]));
    for (const v of tr.visits) {
      if (v.parent != null) children.get(v.parent)?.push(v.id);
      if (v.parent == null && !root) root = v;
      const t = visitTime(tr, v);
      if (!inRange(t)) continue;
      const a = art(v.article);
      a.visits++; a.trails.add(tr.id); if (t > a.last) a.last = t;
      if (v.parent == null) { a.starts.add(tr.id); continue; }
      const from = byId.get(v.parent).article, to = v.article;
      if (from === to) continue;
      const k = pairKey(from, to);
      if (!links.has(k)) { const [a1, b1] = from < to ? [from, to] : [to, from]; links.set(k, { key: k, a: a1, b: b1, ab: 0, ba: 0, total: 0, last: 0, trails: new Set() }); }
      const l = links.get(k);
      from === l.a ? l.ab++ : l.ba++;
      l.total++; l.trails.add(tr.id); if (t > l.last) l.last = t;
      art(from); // make sure the source exists even if its own visit was out of range
    }
    trailIndex.set(tr.id, { trail: tr, index: i, byId, children, root, depth });
  });
  for (const a of articles.values()) { const r = pages.get(a.title); a.reading = r; a.read = r?.depth === 'read' ? 1 : 0; a.skim = r?.depth === 'skim' ? 1 : 0; a.begins = 0; a.ends = 0; }
  const ex = explorations(state, trailIndex);
  // where explorations began (a trail's first page, unless the trail continues another one) and where you
  // stopped going on (the tip of every branch, as the pins on a drawn trail); a page you only looked up
  // on its own is just a beginning
  // how deep each page lies: the fewest clicks from where one of its trails began (a trail that continues
  // another one counts on from the page it continues)
  for (const a of articles.values()) a.depth = Infinity;
  const depthIn = new Map();
  const walk = (tr, ti, v, d) => {
    const key = tr.id + '\u0001' + v.id;
    if ((depthIn.get(key) ?? Infinity) <= d) return;
    depthIn.set(key, d);
    const a = articles.get(v.article); if (a && inRange(visitTime(tr, v))) a.depth = Math.min(a.depth, d);
    for (const cid of ti.children.get(v.id) || []) { const c = ti.byId.get(cid); if (c) walk(tr, ti, c, d + (c.article === v.article ? 0 : 1)); }
  };
  const order = [...trailIndex.values()].sort((p, q) => (ex.join.has(p.trail.id) ? 1 : 0) - (ex.join.has(q.trail.id) ? 1 : 0));
  for (const ti of order) {
    const j = ex.join.get(ti.trail.id), from = j ? depthIn.get(j.trailId + '\u0001' + j.visitId) ?? 0 : 0;
    for (const v of ti.trail.visits) if (v.parent == null) walk(ti.trail, ti, v, from);
  }
  for (const a of articles.values()) if (!Number.isFinite(a.depth)) a.depth = 0;
  const goesOn = new Set([...ex.join.values()].map((j) => j.trailId + '\u0001' + j.visitId));
  for (const ti of trailIndex.values()) {
    const tr = ti.trail;
    if (!ex.join.has(tr.id) && ti.root && inRange(visitTime(tr, ti.root))) articles.get(ti.root.article).begins++;
    for (const v of tr.visits) {
      if (v.parent == null || ti.children.get(v.id).length || goesOn.has(tr.id + '\u0001' + v.id) || !inRange(visitTime(tr, v))) continue;
      articles.get(v.article).ends++;
    }
  }
  return { articles, links, trailIndex, pages, ...ex };
}

/*
 * Trails that belong together. A trail that starts on a page you were also on in another trail, within
 * three hours, is the same exploration: you opened that page again (from a bookmark, a search, Wiki
 * Trails, a restored tab…) and went on from there. It's joined to the other trail at that page.
 * Joins are made nearest in time first, preferring a later trail joining an earlier one, and never
 * in a loop, so each exploration is one tree.
 * Returns { join: Map(trailId -> { trailId, visitId }), groupOf: Map(trailId -> [trailIds]) }.
 */
const JOIN_WINDOW = 3 * 3600e3;
function explorations(state, trailIndex) {
  const at = new Map();
  for (const tr of state.trails) for (const v of tr.visits) {
    const l = at.get(v.article) || at.set(v.article, []).get(v.article);
    l.push({ t: visitTime(tr, v), trailId: tr.id, visitId: v.id });
  }
  for (const l of at.values()) l.sort((a, b) => a.t - b.t);
  const cand = [];
  for (const tr of state.trails) {
    const r = trailIndex.get(tr.id)?.root; if (!r) continue;
    const t0 = visitTime(tr, r), l = at.get(r.article);
    let lo = 0, hi = l.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (l[m].t < t0 - JOIN_WINDOW) lo = m + 1; else hi = m; }
    let best = null;
    for (let i = lo; i < l.length && l[i].t <= t0 + JOIN_WINDOW; i++) {
      const e = l[i]; if (e.trailId === tr.id) continue;
      const dt = Math.abs(e.t - t0), later = e.t <= t0 ? 0 : 1;
      if (!best || later < best.later || (later === best.later && dt < best.dt)) best = { ...e, dt, later };
    }
    if (best) cand.push({ from: tr.id, to: best.trailId, visitId: best.visitId, dt: best.dt, later: best.later });
  }
  cand.sort((a, b) => a.later - b.later || a.dt - b.dt);
  const up = new Map();
  const find = (x) => { let r = x; while (up.has(r)) r = up.get(r); while (up.has(x)) { const n = up.get(x); up.set(x, r); x = n; } return r; };
  const join = new Map();
  for (const c of cand) {
    if (join.has(c.from)) continue;
    const a = find(c.from), b = find(c.to); if (a === b) continue;
    up.set(a, b); join.set(c.from, { trailId: c.to, visitId: c.visitId });
  }
  const groups = new Map(), groupOf = new Map();
  for (const tr of state.trails) { const g = find(tr.id); (groups.get(g) || groups.set(g, []).get(g)).push(tr.id); }
  for (const ids of groups.values()) for (const id of ids) groupOf.set(id, ids);
  return { join, groupOf };
}

/** Chain of visits from the trail's start to `visitId` (inclusive). */
export function chainTo(trailInfo, visitId) {
  const out = [];
  for (let v = trailInfo.byId.get(visitId); v; v = v.parent == null ? null : trailInfo.byId.get(v.parent)) out.unshift(v);
  return out;
}

/**
 * One thread through a visit, as the list of visits from the trail's start to its end:
 * the way in (start → this visit), then onward, at each step taking the branch you used last.
 */
export function threadOf(ti, visitId) {
  return [...chainTo(ti, visitId), ...continueFrom(ti, visitId).slice(1)];
}
/** From a visit on: that visit, then at every fork the way you went last (the latest descendant). */
export function continueFrom(ti, visitId) {
  const vs = ti.trail.visits;
  const latest = new Map(); // visit id → index of the latest visit at or below it
  for (let i = vs.length - 1; i >= 0; i--) {
    const v = vs[i], m = Math.max(i, latest.get(v.id) ?? -1);
    latest.set(v.id, m);
    if (v.parent != null) latest.set(v.parent, Math.max(latest.get(v.parent) ?? -1, m));
  }
  const out = [];
  for (let c = ti.byId.get(visitId); c;) {
    out.push(c);
    const kids = ti.children.get(c.id) || [];
    if (!kids.length) break;
    let best = kids[0];
    for (const k of kids) if (latest.get(k) > latest.get(best)) best = k;
    c = ti.byId.get(best);
  }
  return out;
}

/** Side trips of a trail: for every page you went back from, the pages from the fork to it. */
export function sideTrips(ti, mainIds) {
  const out = [];
  for (const v of ti.trail.visits) {
    if (mainIds.has(v.id) || (ti.children.get(v.id) || []).length) continue; // leaves off the main line
    const branch = [];
    for (let c = v; c; c = c.parent == null ? null : ti.byId.get(c.parent)) { branch.unshift(c.article); if (mainIds.has(c.id)) break; }
    if (branch.length > 1) out.push(branch);
  }
  return out;
}

/**
 * A trail as a path for drawing, relative to an "anchor" page (the article you clicked).
 * Returns segments {from, to, p0, p1, before}: p runs 0 → 0.5 along the way in (start → anchor)
 * and 0.5 → 1 along everything after it (including branches), so colour can show arrival vs. onward.
 * Without an anchor, p simply runs 0 → 1 in click order (a whole trail).
 */
export function trailPath(ti, anchorId = null) {
  const segs = [];
  const vs = ti.trail.visits;
  if (!anchorId) {
    const n = Math.max(1, vs.length - 1);
    vs.forEach((v, i) => {
      if (v.parent == null) return;
      const from = ti.byId.get(v.parent);
      const i0 = vs.indexOf(from);
      if (from.article !== v.article) segs.push({ from: from.article, to: v.article, p0: i0 / n, p1: i / n, before: false, vid: v.id });
    });
    return segs;
  }
  const chain = chainTo(ti, anchorId);
  const L = Math.max(1, chain.length - 1);
  for (let i = 1; i < chain.length; i++) {
    if (chain[i - 1].article !== chain[i].article) segs.push({ from: chain[i - 1].article, to: chain[i].article, p0: 0.5 * (i - 1) / L, p1: 0.5 * i / L, before: true, vid: chain[i].id });
  }
  // everything reached from the anchor, by depth
  const depth = new Map([[anchorId, 0]]);
  const after = [];
  for (const v of vs) {
    if (v.parent == null || !depth.has(v.parent)) continue;
    depth.set(v.id, depth.get(v.parent) + 1);
    after.push(v);
  }
  const maxD = Math.max(1, ...after.map((v) => depth.get(v.id)));
  for (const v of after) {
    const from = ti.byId.get(v.parent), d = depth.get(v.id);
    if (from.article !== v.article) segs.push({ from: from.article, to: v.article, p0: 0.5 + 0.5 * (d - 1) / maxD, p1: 0.5 + 0.5 * d / maxD, before: false, vid: v.id });
  }
  return segs;
}

/**
 * A trail as a sequence. The "main line" is the path from the start to the latest page;
 * pages you opened and then went back from are side branches.
 */
export function trailShape(tr) {
  const byId = new Map(tr.visits.map((v) => [v.id, v]));
  const last = tr.visits[tr.visits.length - 1];
  const main = [];
  for (let v = last; v; v = v.parent == null ? null : byId.get(v.parent)) main.unshift(v);
  const onMain = new Set(main.map((v) => v.id));
  const children = new Map();
  for (const v of tr.visits) if (v.parent != null) { if (!children.has(v.parent)) children.set(v.parent, []); children.get(v.parent).push(v); }
  // side branches: each starts at a page off the main line whose parent is on the main line (or on another branch)
  const branches = [];
  for (const v of tr.visits) {
    if (onMain.has(v.id) || v.parent == null || !onMain.has(v.parent)) continue;
    const seq = [];
    const walk = (x) => { seq.push(x); for (const c of children.get(x.id) || []) walk(c); };
    walk(v);
    branches.push({ from: byId.get(v.parent), visits: seq });
  }
  // the numbered list (click order) with indentation for side branches
  const depth = new Map();
  const lines = tr.visits.map((v, i) => {
    let d = 0;
    if (!onMain.has(v.id)) d = (depth.get(v.parent) || 0) + 1;
    depth.set(v.id, d);
    return { v, n: i + 1, depth: d, side: d > 0 };
  });
  return { main, branches, lines, onMain };
}

/** "Brain → Telephone" (start → where the trail is now), or the trail's own name. */
export function trailLabel(tr) {
  if (tr.name) return tr.name;
  const first = tr.visits[0]?.article || 'Empty';
  const last = tr.visits[tr.visits.length - 1]?.article;
  return last && last !== first ? `${first} → ${last}` : first;
}
