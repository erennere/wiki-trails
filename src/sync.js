// Sync with GitHub: your history lives in a private repository (see sync-core.js for the files and
// the merge rules). This browser keeps a copy so the app opens instantly and works offline.
//
//  - pull: when the app opens, every minute while it's visible, when you come back to it, and right
//    after the extension in this browser sent pages. Only month files that changed are downloaded.
//  - push: a couple of seconds after you change something here. What changed is found by comparing
//    each trail with the copy last synced (`base`), so every kind of change (recording by hand,
//    marking, renaming, deleting, undo, opening a file) is covered the same way.
import { app, on, emit, commit, snapshot, ownHistory } from './app.js';
import { validate } from './model.js';
import { idbGet, idbSet, saveLocal } from './storage.js';
import { client, pathOf, mergeTrail, SyncError } from './sync-core.js';
import { ext, connectExtension, helloExtension } from './extlink.js';

const CFG_KEY = 'wiki-trails.sync', CACHE_KEY = 'sync';
const POLL = 60e3;

export const sync = {
  cfg: null,                       // { repo, token, branch, private }
  state: 'off',                    // 'off' | 'idle' | 'busy' | 'error' | 'offline'
  error: '', at: 0,                // last problem, last successful sync
  get on() { return !!this.cfg; },
};
let cache = null;                  // { repo, commit, files: { path: blobSha }, base: { trailId: { h, c, v, del } } }
const seen = new Map();            // trailId -> hash when we last stamped `updated`

/* ---------- small helpers ---------- */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const hashTrail = (t) => cyrb53(JSON.stringify([t.name || '', t.created, t.visits, t.removed || []]));
const snap = (t) => ({ h: hashTrail(t), c: t.created, v: t.visits.map((v) => v.id).join(',') });
const validTrail = (t) => { try { return validate({ trails: [t] }).trails[0] || null; } catch { return null; } };
const set = (state, error = '') => { sync.state = state; sync.error = error; if (state === 'idle') sync.at = Date.now(); emit('sync'); };

function loadCfg() { try { const c = JSON.parse(localStorage.getItem(CFG_KEY)); return c?.repo && c?.token ? c : null; } catch { return null; } }
function saveCfg(c) { try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch { /* storage unavailable */ } }
async function saveCache() { try { await idbSet(CACHE_KEY, cache); } catch { /* the next sync starts over */ } }

// one sync step at a time
let chain = Promise.resolve();
function serial(task) { const p = chain.then(task, task); chain = p.catch(() => {}); return p; }

/* ---------- applying what's on GitHub ---------- */
const index = () => new Map(app.state.trails.map((t) => [t.id, t]));
function store(M) {
  app.state.trails = [...M.values()].sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0));
}
/** Take one trail from GitHub into M. Returns true if what you see changed. */
function integrate(rt, M) {
  const local = M.get(rt.id), base = cache.base[rt.id];
  const dirty = !!local && !!base && base.h !== hashTrail(local); // changed here and not sent yet
  const unknown = !!local && !base; // here before this browser was connected (or its sync copy was lost)
  if (rt.deleted) {
    if ((dirty || unknown) && (+local.updated || 0) > (+rt.updated || 0)) return false; // you edited it after it was deleted elsewhere
    cache.base[rt.id] = { h: 'deleted', c: rt.created, v: '', del: 1 };
    return M.delete(rt.id);
  }
  const v = validTrail(dirty || unknown ? mergeTrail(local, rt) : rt);
  if (!v) { if (!dirty) cache.base[rt.id] = { h: 'empty', c: rt.created, v: '' }; return false; }
  // an unknown trail counts as synced as far as GitHub's copy goes; anything extra here goes out next
  if (unknown) { const r = validTrail(rt); cache.base[rt.id] = r ? snap(r) : snap(v); }
  else if (!dirty) cache.base[rt.id] = snap(v);
  if (local && JSON.stringify(local) === JSON.stringify(v)) return false;
  M.set(v.id, v);
  return true;
}
function apply(M, changed) {
  if (!changed) return;
  store(M);
  commit({ synced: true });
}

/** Fetch every month file that changed since last time and take it in. */
async function pull() {
  const gh = client(sync.cfg);
  const head = await gh.head(sync.cfg.branch);
  if (!head || head === cache.commit) return false;
  const files = (await gh.files(head)).filter((f) => cache.files[f.path] !== f.sha);
  const got = await pool(files, 6, async (f) => ({ f, file: await gh.blob(f.sha) }));
  const M = index();
  let changed = false;
  for (const { f, file } of got) {
    for (const rt of file.trails) changed = integrate(rt, M) || changed;
    cache.files[f.path] = f.sha;
  }
  cache.commit = head;
  apply(M, changed);
  await saveCache();
  return changed;
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/* ---------- sending what changed here ---------- */
/** Trails that differ from the last synced copy, plus deletions. Stamps them with `updated`. */
function diff() {
  const now = Date.now(), out = [], here = new Set();
  let stamped = false;
  for (const t of app.state.trails) {
    here.add(t.id);
    const b = cache.base[t.id];
    if (b && b.h === hashTrail(t)) continue;
    // pages that were here before and are gone now (undo, …) must stay gone on the other devices too
    if (b?.v) {
      const have = new Set(t.visits.map((v) => v.id));
      const gone = b.v.split(',').filter((id) => id && !have.has(id));
      if (gone.length) t.removed = [...new Set([...(t.removed || []), ...gone])];
    }
    const h = hashTrail(t);
    if (b && b.h === h) continue;
    if (seen.get(t.id) !== h) { t.updated = now; seen.set(t.id, h); stamped = true; }
    out.push({ id: t.id, created: t.created, h, vids: t.visits.map((v) => v.id).join(','), send: JSON.parse(JSON.stringify(t)) });
  }
  for (const [id, b] of Object.entries(cache.base)) {
    if (b.del || here.has(id) || b.h === 'empty') continue;
    out.push({ id, created: b.c, tomb: true, send: { id, created: b.c, updated: now, deleted: true } });
  }
  if (stamped) saveLocal(app.state);
  return out;
}

async function push() {
  const items = diff();
  if (!items.length) return false;
  const gh = client(sync.cfg);
  const byPath = new Map();
  for (const it of items) { const p = pathOf(it.created); (byPath.get(p) || byPath.set(p, []).get(p)).push(it); }
  let changed = false;
  for (const [path, group] of byPath) {
    const ours = new Map(group.map((it) => [it.id, it]));
    const res = await gh.update(path, (file) => {
      const at = new Map(file.trails.map((t, i) => [t.id, i]));
      let ch = false;
      for (const it of group) {
        const i = at.get(it.id);
        if (i == null) { if (!it.tomb) { file.trails.push(it.send); at.set(it.id, file.trails.length - 1); ch = true; } continue; }
        const m = mergeTrail(file.trails[i], it.send);
        if (JSON.stringify(m) !== JSON.stringify(file.trails[i])) { file.trails[i] = m; ch = true; }
      }
      return ch;
    }, commitMessage(group));
    // take the file as it is now: our trails as merged, plus anything others changed in it
    const M = index();
    const present = new Set();
    for (const rt of res.file.trails) {
      present.add(rt.id);
      const it = ours.get(rt.id);
      if (!it) { changed = integrate(rt, M) || changed; continue; }
      const local = M.get(rt.id);
      if (local && hashTrail(local) !== it.h) {
        // you changed it again while we were sending: keep yours, it goes out next time
        cache.base[rt.id] = rt.deleted ? { h: 'deleted', c: rt.created, v: '', del: 1 } : { h: 'changed', c: rt.created, v: it.vids };
        continue;
      }
      changed = integrate(rt, M.has(rt.id) ? withBase(M, rt) : M) || changed;
    }
    for (const it of group) if (it.tomb && !present.has(it.id)) cache.base[it.id] = { h: 'deleted', c: it.created, v: '', del: 1 }; // nothing to delete there
    if (res.sha) cache.files[path] = res.sha;
    apply(M, changed); changed = false;
  }
  await saveCache();
  return true;
}
/** Our own trail came back merged: it's no longer "changed here", so take GitHub's copy as is. */
function withBase(M, rt) { const local = M.get(rt.id); cache.base[rt.id] = snap(local); return M; }
function commitMessage(group) {
  const n = group.filter((g) => !g.tomb).length, d = group.length - n;
  const parts = [];
  if (n) parts.push(`${n} trail${n === 1 ? '' : 's'} changed`);
  if (d) parts.push(`${d} deleted`);
  return `Wiki Trails app: ${parts.join(', ')}`;
}

/* ---------- running it ---------- */
let pushT = null, pollT = null, lastPull = 0, needPush = false, started = false;
async function step(kind) {
  if (!sync.cfg) return;
  set('busy');
  try {
    if (kind !== 'push') { await pull(); lastPull = Date.now(); }
    if (kind !== 'pull' || needPush) { needPush = false; await push(); }
    set('idle');
  } catch (e) {
    if (e instanceof SyncError && e.status === 0) set('offline', e.message);
    else set('error', friendly(e));
    if (kind !== 'pull') needPush = true;
  }
}
function friendly(e) {
  if (!(e instanceof SyncError)) return e.message || String(e);
  if (e.status === 401) return 'GitHub refused the token. It may have expired: make a new one and connect again.';
  if (e.status === 403) return /rate limit/i.test(e.message) ? 'Too many requests to GitHub for now; trying again later.' : "The token isn't allowed to write to this repository (it needs Contents: Read and write).";
  if (e.status === 404) return "GitHub can't find the repository, or the token can't see it.";
  return `GitHub: ${e.message}`;
}
export const syncNow = (kind = 'both') => serial(() => step(kind));
function schedulePush(ms = 2000) {
  if (!sync.cfg) return;
  needPush = true;
  clearTimeout(pushT); pushT = setTimeout(() => syncNow('push'), ms);
}
function startTimers() {
  clearInterval(pollT);
  pollT = setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastPull > POLL - 1000) syncNow(needPush ? 'both' : 'pull'); }, POLL / 2);
}

/** Start syncing if this browser is connected. Call once, after the local copy is loaded. */
export async function initSync() {
  if (!started) {
    started = true;
    on('data', (o) => { if (!o?.synced && sync.cfg) schedulePush(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sync.cfg && Date.now() - lastPull > 15e3) syncNow(); });
    window.addEventListener('online', () => sync.cfg && syncNow());
    on('ext-pushed', () => sync.cfg && setTimeout(() => syncNow('pull'), 1500));
    on('ext', handOver);
    helloExtension();
  }
  sync.cfg = loadCfg();
  if (!sync.cfg) { set('off'); return; }
  try { cache = await idbGet(CACHE_KEY); } catch { cache = null; }
  if (!cache || cache.repo !== sync.cfg.repo) cache = { repo: sync.cfg.repo, commit: null, files: {}, base: {} };
  set('idle'); sync.at = 0;
  startTimers();
  await syncNow();
}

/** Give the extension in this browser the same repository, once per page load (or when asked). */
let handed = '';
function handOver(force) {
  if (!sync.cfg || !ext.present) return;
  const s = ext.status?.sync || {};
  const key = sync.cfg.repo + '\u0000' + sync.cfg.token;
  if (force !== true && (handed === key || (s.repo === sync.cfg.repo && s.ok !== false))) return;
  handed = key;
  connectExtension(sync.cfg.repo, sync.cfg.token);
}

/**
 * Connect this browser to a repository. If this browser already has trails that aren't there yet,
 * the first call returns { ask: n } and you call again with keep: true (add them) or false (leave them out).
 */
export async function connect(repo, token, keep) {
  const gh = client({ repo, token });
  const info = await gh.info();
  if (!info.canWrite) throw new SyncError(403, "The token isn't allowed to write to this repository.");
  ownHistory(); // someone's published history isn't yours to sync
  const head = await gh.head(info.branch);
  const files = head ? await gh.files(head) : [];
  const got = await pool(files, 6, async (f) => ({ f, file: await gh.blob(f.sha) }));
  const remote = new Set(); let live = 0;
  for (const { file } of got) for (const t of file.trails) { remote.add(t.id); if (!t.deleted) live++; }
  const mine = app.state.trails.filter((t) => !remote.has(t.id));
  if (mine.length && keep == null) return { ask: mine.length, remoteCount: live, private: info.private };
  await chain; // let a running sync finish
  sync.cfg = { repo: gh.repo, token, branch: info.branch, private: info.private };
  saveCfg(sync.cfg);
  cache = { repo: gh.repo, commit: null, files: {}, base: {} };
  seen.clear();
  if (mine.length && keep === false) { snapshot(); app.state.trails = app.state.trails.filter((t) => remote.has(t.id)); }
  const M = index();
  let changed = !!(mine.length && keep === false);
  for (const { f, file } of got) { for (const rt of file.trails) changed = integrate(rt, M) || changed; cache.files[f.path] = f.sha; }
  cache.commit = head;
  apply(M, changed || true);
  await saveCache();
  set('idle'); startTimers();
  handOver(true);
  await syncNow('push');
  return { ok: true, private: info.private, trails: app.state.trails.length };
}

export function disconnect() {
  sync.cfg = null; saveCfg(null); cache = null; seen.clear();
  clearInterval(pollT); clearTimeout(pushT);
  idbSet(CACHE_KEY, null).catch(() => {});
  set('off');
}
