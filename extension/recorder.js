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
// New pages wait in the extension's storage ("ev:…" for a new page, "dw:…" for time on a page) and
// are sent to your GitHub repository about a minute later (see sync-core.js), where Wiki Trails
// picks them up on every device. Without a connection they simply wait.
import { client, pathOf, applyPatches, mergeInto, SyncError } from '../src/sync-core.js';

const api = globalThis.browser ?? globalThis.chrome;
const store = api.storage.local;
const HOUR = 3600e3;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- state, kept in storage because the background may be stopped at any time ---------- */
let S = null; // { on, tabs: {tabId: {trailId, visitId, article}}, docs: {doc: {trailId, visitId, tab}}, recent: [{trailId, visitId, article, t}], dwell: {visitId: {trailId, docs: {doc: secs}, scroll, t}}, trails: {trailId: created}, today: {day, n} }
async function load() {
  if (S) return S;
  const r = await store.get(['rec:on', 'rec:state']);
  S = { on: r['rec:on'] !== false, tabs: {}, docs: {}, recent: [], dwell: {}, trails: {}, today: { day: '', n: 0 }, ...(r['rec:state'] || {}) };
  S.trails ||= {};
  S.on = r['rec:on'] !== false;
  return S;
}
function prune(now) {
  S.recent = S.recent.filter((v) => now - v.t < 12 * HOUR).slice(-3000);
  for (const [k, d] of Object.entries(S.docs)) if (now - (d.t || 0) > 2 * 24 * HOUR) delete S.docs[k];
  for (const [k, d] of Object.entries(S.dwell)) if (now - (d.t || 0) > 2 * 24 * HOUR) delete S.dwell[k];
  const used = new Set([...S.recent, ...Object.values(S.tabs), ...Object.values(S.docs), ...Object.values(S.dwell)].map((x) => x.trailId));
  for (const id of Object.keys(S.trails)) if (!used.has(id)) delete S.trails[id];
}
/** Forget trails that were deleted in Wiki Trails: the next page you open starts a new one. */
function forget(ids) {
  const gone = new Set(ids);
  S.recent = S.recent.filter((x) => !gone.has(x.trailId));
  for (const m of [S.tabs, S.docs, S.dwell]) for (const [k, x] of Object.entries(m)) if (gone.has(x.trailId)) delete m[k];
  for (const id of gone) delete S.trails[id];
}
async function save() { const { on, ...rest } = S; await store.set({ 'rec:state': rest }); }

let seq = 0;
const evKey = () => `ev:${Date.now().toString(36).padStart(9, '0')}:${(seq++).toString(36).padStart(4, '0')}`;
async function emitVisit(trailId, visit) {
  const created = S.trails[trailId] ||= new Date(visit.t).toISOString();
  await store.set({ [evKey()]: { kind: 'visit', trailId, created, visit } });
  schedulePush(SOON);
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
  // not you opening a page: the browser reloading tabs it had open (after a restart, or a tab it had
  // put to sleep), or a reload or back/forward in a tab we know nothing about. Nothing is recorded; if
  // the page was recorded recently, time you now spend on it counts there, and links you click go on
  // from it.
  if (m.restored || (!tab && (m.nav === 'reload' || m.nav === 'back_forward'))) {
    const v = latest((x) => x.article === m.title);
    if (v) here(v.trailId, v.visitId, m.title);
    return;
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
  await store.set({ [`dw:${d.visitId}`]: { trailId: d.trailId, created: S.trails[d.trailId], visitId: d.visitId, secs, scroll: w.scroll } });
  schedulePush(LATER);
}

/* ---------- sending pages to GitHub ---------- */
const SOON = 1, LATER = 10;              // minutes: new pages go out after a minute, reading time can wait
const BACKOFF = [1, 2, 5, 10, 30, 60];   // after a failure
let pushing = null;
async function schedulePush(minutes) {
  if (!api.alarms) return;
  const a = await api.alarms.get('push');
  if (a && a.scheduledTime <= Date.now() + minutes * 60e3 + 1000) return; // already due sooner
  api.alarms.create('push', { delayInMinutes: minutes });
}
async function syncStatus() {
  const r = await store.get(['sync:cfg', 'sync:status']);
  const all = await store.get(null);
  const waiting = Object.keys(all).filter((k) => k.startsWith('ev:')).length;
  const cfg = r['sync:cfg'], st = r['sync:status'] || {};
  return { repo: cfg?.repo || null, ok: cfg ? st.ok : null, at: st.okAt || 0, error: st.error || '', waiting };
}
async function setStatus(patch) {
  const st = (await store.get('sync:status'))['sync:status'] || {};
  await store.set({ 'sync:status': { ...st, ...patch, t: Date.now() } });
}

/** Send everything waiting. One run at a time. */
function push() { return (pushing ||= doPush().finally(() => { pushing = null; })); }
async function doPush() {
  const cfg = (await store.get('sync:cfg'))['sync:cfg'];
  if (!cfg?.token) return;
  await load();
  const all = await store.get(null);
  const evs = Object.keys(all).filter((k) => k.startsWith('ev:')).sort();
  const dws = Object.keys(all).filter((k) => k.startsWith('dw:'));
  const mig = all['mig:history']?.trails || [];
  if (!evs.length && !dws.length && !mig.length) return;
  const files = new Map(); // path -> { patches: Map(trailId -> {created, visits, dwell}), trails: [] }
  const file = (path) => files.get(path) || files.set(path, { patches: new Map(), trails: [] }).get(path);
  const created = (id, fallback) => all['mig:created']?.[id] || S?.trails?.[id] || fallback;
  const patch = (id, c) => { const f = file(pathOf(c)); return f.patches.get(id) || f.patches.set(id, { created: c, visits: [], dwell: [] }).get(id); };
  for (const k of evs) { const e = all[k]; if (!e?.visit) continue; patch(e.trailId, e.created || created(e.trailId, new Date(e.visit.t || Date.now()).toISOString())).visits.push(e.visit); }
  for (const k of dws) { const d = all[k]; if (!d?.created && !created(d?.trailId)) continue; patch(d.trailId, d.created || created(d.trailId)).dwell.push({ visitId: d.visitId, secs: d.secs, scroll: d.scroll }); }
  for (const t of mig) file(pathOf(t.created)).trails.push(t);
  const gh = client(cfg);
  const deleted = [];
  let pages = 0;
  try {
    for (const [path, f] of files) {
      const n = [...f.patches.values()].reduce((a, p) => a + p.visits.length, 0);
      await gh.update(path, (doc) => {
        const r = applyPatches(doc, f.patches);
        deleted.push(...r.deleted);
        return mergeInto(doc, f.trails) || r.changed;
      }, n ? `${BROWSER}: ${n} page${n === 1 ? '' : 's'}` : f.trails.length ? `${BROWSER}: earlier history` : `${BROWSER}: time on pages`);
      pages += n;
    }
  } catch (e) {
    const st = (await store.get('sync:status'))['sync:status'] || {};
    const fails = (st.fails || 0) + 1;
    await setStatus({ ok: false, error: describe(e), fails });
    if (!(e instanceof SyncError && e.status === 401)) schedulePush(BACKOFF[Math.min(fails, BACKOFF.length) - 1]);
    return;
  }
  // done: drop what was sent (time on a page may have grown meanwhile; then it goes next time)
  const now = await store.get(dws);
  await store.remove([...evs, ...dws.filter((k) => JSON.stringify(now[k]) === JSON.stringify(all[k])), ...(mig.length ? ['mig:history', 'mig:created'] : [])]);
  if (deleted.length) { await load(); forget(deleted); await save(); }
  await setStatus({ ok: true, okAt: Date.now(), error: '', fails: 0, pushed: pages });
  const left = Object.keys(await store.get(null)).some((k) => k.startsWith('ev:') || k.startsWith('dw:'));
  if (left) schedulePush(SOON);
}
function describe(e) {
  if (!(e instanceof SyncError)) return e?.message || String(e);
  if (e.status === 0) return 'offline, will try again';
  if (e.status === 401) return 'GitHub refused the token (expired?). Connect again in Wiki Trails, Settings';
  if (e.status === 403) return /rate limit/i.test(e.message) ? 'too many requests, will try again' : "the token can't write to the repository (needs Contents: Read and write)";
  if (e.status === 404) return "GitHub can't find the repository, or the token can't see it";
  return e.message;
}
const BROWSER = /Edg\//.test(navigator.userAgent) ? 'Edge' : /Firefox\//.test(navigator.userAgent) ? 'Firefox' : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'Browser';

async function connect(repo, token) {
  try {
    const gh = client({ repo, token });
    const info = await gh.info();
    await store.set({ 'sync:cfg': { repo: gh.repo, token, branch: info.branch } });
    await setStatus({ ok: true, error: '', fails: 0 });
    schedulePush(0.05);
    return { ok: true, repo: gh.repo };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/* ---------- history from the earlier version, which kept its own copy of Wiki Trails ---------- */
async function migrate() {
  if (typeof indexedDB === 'undefined') return;
  const trails = await new Promise((res) => {
    const r = indexedDB.open('wiki-trails');
    r.onupgradeneeded = () => { r.transaction.abort(); res([]); }; // nothing there
    r.onerror = () => res([]);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); return res([]); }
      const q = db.transaction('kv').objectStore('kv').get('history');
      q.onsuccess = () => { db.close(); res(Array.isArray(q.result?.trails) ? q.result.trails : []); };
      q.onerror = () => { db.close(); res([]); };
    };
  });
  if (!trails.length) return;
  const done = (await store.get('mig:done'))['mig:done'];
  if (done) return;
  await store.set({ 'mig:history': { trails }, 'mig:created': Object.fromEntries(trails.map((t) => [t.id, t.created])), 'mig:done': true });
  schedulePush(SOON);
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
    load().then(async () => reply({ on: S.on, today: S.today.day === new Date().toDateString() ? S.today.n : 0, sync: await syncStatus(), version: api.runtime.getManifest().version }));
    return true; // answer asynchronously
  }
  if (m?.wikiTrailsApp === 'connect') { connect(String(m.repo || ''), String(m.token || '')).then(reply); return true; }
  if (m?.wikiTrailsApp === 'disconnect') { store.remove(['sync:cfg', 'sync:status']).then(() => reply({ ok: true })); return true; }
  if (m?.wikiTrailsApp === 'push') { push().then(() => reply({ ok: true })); return true; }
  if (m?.wikiTrailsApp === 'migrate') { migrate().then(() => push()).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) })); return true; }
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
api.alarms?.onAlarm.addListener((a) => { if (a.name === 'push') push(); });
// a new browser session: tab numbers start over, so what we knew about tabs no longer applies
api.runtime.onStartup?.addListener(() => {
  queue = queue.then(async () => { await load(); S.tabs = {}; S.docs = {}; await save(); }).catch(() => {});
  schedulePush(0.2);
});
api.runtime.onInstalled?.addListener(() => { migrate().catch(() => {}); schedulePush(0.2); });
load().then(updateBadge);
