// The recorder: turns the pages you open on Wikipedia into Wiki Trails trails.
//
// For every article page (reported by page.js) it decides where the page belongs:
//  - you clicked a link from another article  -> a step after that page, in the same trail
//    (also when the link opened in a new tab: the new tab continues the trail it came from)
//  - you went back or forward                 -> no new step; the next click branches from there
//  - you came from elsewhere (search engine, typed address, bookmark, Wikipedia's search box)
//                                              -> a new trail starts
// and keeps the time the page was in front of you and how far you scrolled.
//
// Everything is kept in the extension's own storage. Wiki Trails (app/index.html, opened from the
// toolbar button) picks up new steps from the keys "ev:…" (new pages) and "dw:…" (time on a page).
const api = globalThis.browser ?? globalThis.chrome;
const store = api.storage.local;
const HOUR = 3600e3;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- state, kept in storage because the background may be stopped at any time ---------- */
let S = null; // { on, tabs: {tabId: {trailId, visitId, article}}, docs: {doc: {trailId, visitId, tab}}, recent: [{trailId, visitId, article, t}], dwell: {visitId: {trailId, docs: {doc: secs}, scroll, t}}, today: {day, n} }
async function load() {
  if (S) return S;
  const r = await store.get(['rec:on', 'rec:state']);
  S = { on: r['rec:on'] !== false, tabs: {}, docs: {}, recent: [], dwell: {}, today: { day: '', n: 0 }, ...(r['rec:state'] || {}) };
  S.on = r['rec:on'] !== false;
  return S;
}
function prune(now) {
  S.recent = S.recent.filter((v) => now - v.t < 12 * HOUR).slice(-3000);
  for (const [k, d] of Object.entries(S.docs)) if (now - (d.t || 0) > 2 * 24 * HOUR) delete S.docs[k];
  for (const [k, d] of Object.entries(S.dwell)) if (now - (d.t || 0) > 2 * 24 * HOUR) delete S.dwell[k];
}
async function save() { const { on, ...rest } = S; await store.set({ 'rec:state': rest }); }

let seq = 0;
const evKey = () => `ev:${Date.now().toString(36).padStart(9, '0')}:${(seq++).toString(36).padStart(4, '0')}`;
async function emitVisit(trailId, visit) {
  await store.set({ [evKey()]: { kind: 'visit', trailId, visit } });
  const day = new Date().toDateString();
  if (S.today.day !== day) S.today = { day, n: 0 };
  S.today.n++;
  updateBadge();
}

/* ---------- where does a page belong? ---------- */
const latest = (pred) => { for (let i = S.recent.length - 1; i >= 0; i--) if (pred(S.recent[i])) return S.recent[i]; return null; };
function place(tabId, openerTabId, from, now) {
  const tab = S.tabs[tabId], opener = openerTabId != null ? S.tabs[openerTabId] : null;
  if (tab && tab.article === from) return { trailId: tab.trailId, visitId: tab.visitId };
  let v = tab && latest((x) => x.trailId === tab.trailId && x.article === from);
  if (!v && opener) v = opener.article === from ? opener : latest((x) => x.trailId === opener.trailId && x.article === from);
  if (!v) v = latest((x) => x.article === from && now - x.t < 6 * HOUR);
  return v ? { trailId: v.trailId, visitId: v.visitId } : null;
}

async function onOpen(m, tabId, openerTabId) {
  const now = m.t || Date.now();
  prune(now);
  const tab = S.tabs[tabId];
  const here = (trailId, visitId, article) => { S.tabs[tabId] = { trailId, visitId, article }; S.docs[m.doc] = { trailId, visitId, tab: tabId, t: now }; };
  // reloading, or landing again on the page you're on
  if (tab && tab.article === m.title && (m.nav === 'reload' || m.nav === 'navigate')) return here(tab.trailId, tab.visitId, m.title);
  // back or forward: go to that page's step in this tab's trail
  if (m.nav === 'back_forward' && tab) {
    const v = latest((x) => x.trailId === tab.trailId && x.article === m.title);
    if (v) return here(v.trailId, v.visitId, m.title);
  }
  if (!S.on) return;
  let trailId, parent = null;
  const at = m.from ? place(tabId, openerTabId, m.from, now) : null;
  if (at) ({ trailId, visitId: parent } = at);
  else if (m.from && !m.fromNs) {
    {
      // you clicked from a page that wasn't recorded (say, before you turned recording on): start there
      trailId = uid();
      const root = { id: uid(), article: m.from, parent: null, t: now - 1000, lang: m.lang, src: 'auto' };
      await emitVisit(trailId, root);
      S.recent.push({ trailId, visitId: root.id, article: m.from, t: root.t });
      parent = root.id;
    }
  } else trailId = uid(); // came from search, a search engine, a bookmark…: a new trail
  const visit = { id: uid(), article: m.title, parent, t: now, lang: m.lang, src: 'auto' };
  await emitVisit(trailId, visit);
  S.recent.push({ trailId, visitId: visit.id, article: m.title, t: now });
  here(trailId, visit.id, m.title);
}

function onShown(m, tabId) {
  const d = S.docs[m.doc];
  if (d) S.tabs[tabId] = { trailId: d.trailId, visitId: d.visitId, article: m.title };
}

async function onDwell(m) {
  const d = S.docs[m.doc];
  if (!d) return;
  const w = S.dwell[d.visitId] || (S.dwell[d.visitId] = { trailId: d.trailId, docs: {}, scroll: 0, t: Date.now() });
  w.docs[m.doc] = Math.max(w.docs[m.doc] || 0, m.secs || 0);
  w.scroll = Math.max(w.scroll, m.scroll || 0);
  w.t = Date.now();
  const secs = Object.values(w.docs).reduce((a, b) => a + b, 0);
  await store.set({ [`dw:${d.visitId}`]: { trailId: d.trailId, visitId: d.visitId, secs, scroll: w.scroll } });
}

/* ---------- messages, handled one at a time ---------- */
let queue = Promise.resolve();
api.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.wikiTrails) {
    const tabId = sender.tab?.id ?? -1, opener = sender.tab?.openerTabId ?? null;
    queue = queue.then(async () => {
      await load();
      if (m.type === 'open') await onOpen(m, tabId, opener);
      else if (m.type === 'shown') onShown(m, tabId);
      else if (m.type === 'dwell') await onDwell(m);
      await save();
    }).catch((e) => console.error('Wiki Trails recorder', e));
    return false;
  }
  if (m?.wikiTrailsPopup === 'status') {
    load().then(() => reply({ on: S.on, today: S.today.day === new Date().toDateString() ? S.today.n : 0 }));
    return true; // answer asynchronously
  }
  return false;
});
api.tabs?.onRemoved?.addListener((tabId) => {
  queue = queue.then(async () => { await load(); delete S.tabs[tabId]; await save(); });
});
api.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && 'rec:on' in ch && S) { S.on = ch['rec:on'].newValue !== false; updateBadge(); }
});

function updateBadge() {
  const a = api.action || api.browserAction;
  if (!a?.setBadgeText) return;
  a.setBadgeText({ text: S && !S.on ? 'off' : '' });
  a.setBadgeBackgroundColor?.({ color: '#888888' });
}
load().then(updateBadge);
