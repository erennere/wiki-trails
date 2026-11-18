// Data model: trails are trees of visits; articles and connections are derived.
//
// state = {
//   version: 2,
//   lang: 'en',
//   trails: [{ id, name, created, visits: [{ id, article, parent }] }]
// }
// A visit's `parent` is the visit you clicked from (null for the trail's first page).
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
      visits.push({ id: String(v.id), article, parent: v.parent ?? null, ...(t > 0 ? { t } : {}) });
    }
    if (visits.length) s.trails.push({ id: String(t.id || uid()), name: String(t.name || ''), created: t.created || new Date().toISOString(), visits });
  }
  return s;
}

export const pairKey = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

/**
 * Derive everything the graph needs.
 * articles: Map title -> { title, visits, trails:Set, starts:Set(trailId) }
 * links:    Map pairKey -> { key, a, b, ab, ba, total }   (a < b alphabetically)
 */
/** Time of a visit in ms (older files have no per-visit time: fall back to the trail's start). */
export const visitTime = (tr, v) => v.t || Date.parse(tr.created) || 0;

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
    if (!articles.has(t)) articles.set(t, { title: t, visits: 0, trails: new Set(), starts: new Set(), last: 0 });
    return articles.get(t);
  };
  const trailIndex = new Map();
  state.trails.forEach((tr, i) => {
    const byId = new Map(tr.visits.map((v) => [v.id, v]));
    const children = new Map(tr.visits.map((v) => [v.id, []]));
    let root = null;
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
    trailIndex.set(tr.id, { trail: tr, index: i, byId, children, root });
  });
  return { articles, links, trailIndex };
}

/** Chain of visits from the trail's start to `visitId` (inclusive). */
export function chainTo(trailInfo, visitId) {
  const out = [];
  for (let v = trailInfo.byId.get(visitId); v; v = v.parent == null ? null : trailInfo.byId.get(v.parent)) out.unshift(v);
  return out;
}

/** Directed steps {trailId, from, to, order} of whole trails. */
export function trailSteps(d, trailIds) {
  const steps = [];
  for (const id of trailIds) {
    const ti = d.trailIndex.get(id); if (!ti) continue;
    ti.trail.visits.forEach((v, order) => {
      if (v.parent == null) return;
      const from = ti.byId.get(v.parent).article;
      if (from !== v.article) steps.push({ trailId: id, from, to: v.article, order });
    });
  }
  return steps;
}

/** Every route (start -> ... -> article) that reached `title`, over all trails. */
export function routesTo(d, title) {
  const steps = [];
  const seen = new Set();
  for (const [id, ti] of d.trailIndex) {
    for (const v of ti.trail.visits) {
      if (v.article !== title) continue;
      const chain = chainTo(ti, v.id);
      for (let i = 1; i < chain.length; i++) {
        const k = id + '|' + chain[i].id;
        if (seen.has(k)) continue; seen.add(k);
        if (chain[i - 1].article !== chain[i].article) steps.push({ trailId: id, from: chain[i - 1].article, to: chain[i].article, order: i });
      }
    }
  }
  return steps;
}

/** Every route that used the connection a↔b: the trails' steps up to and including that click. */
export function routesThrough(d, a, b) {
  const steps = [], seen = new Set();
  for (const [id, ti] of d.trailIndex) {
    for (const v of ti.trail.visits) {
      if (v.parent == null) continue;
      const from = ti.byId.get(v.parent).article;
      if (!((from === a && v.article === b) || (from === b && v.article === a))) continue;
      const chain = chainTo(ti, v.id);
      for (let i = 1; i < chain.length; i++) {
        const k = id + '|' + chain[i].id;
        if (seen.has(k)) continue; seen.add(k);
        if (chain[i - 1].article !== chain[i].article) steps.push({ trailId: id, from: chain[i - 1].article, to: chain[i].article, order: i });
      }
    }
  }
  return steps;
}

export function trailLabel(tr) {
  if (tr.name) return tr.name;
  const first = tr.visits[0]?.article || 'Empty';
  return `${first} trail`;
}
