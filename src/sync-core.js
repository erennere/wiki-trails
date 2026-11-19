// Your history's home on GitHub: a private repository with one file per month of trails,
//   trails/2026-11.json = { "version": 2, "trails": [ …one trail per line… ] }
// A trail lives in the file of the month it started (UTC). Both the app and the browser extension
// read and write these files through GitHub's REST API, so every browser shows the same history.
//
// Writes never overwrite blindly: read the file, merge, write it back with the sha we read; if
// someone else wrote in between, GitHub refuses and we read and merge again. The merge is the same
// whoever runs it, so every device ends up with the same result:
//  - pages (visits) are combined from both copies; a page is only dropped if it's listed in `removed`
//  - the name, and how you marked each page, come from the copy edited last (`updated`)
//  - a deleted trail is kept as a stub { id, created, updated, deleted: true } so the deletion spreads;
//    whichever happened last, deleting or editing, wins
// Shared by the app (src/sync.js) and the extension's recorder (bundled from extension/recorder.js).

export const API = 'https://api.github.com';
export const FILE_RE = /^trails\/\d{4}-\d{2}\.json$/;

/** The file a trail belongs in: trails/YYYY-MM.json from when it started. */
export function pathOf(created) {
  const d = new Date(created);
  const ok = !Number.isNaN(d.getTime());
  const y = ok ? d.getUTCFullYear() : 1970, m = ok ? d.getUTCMonth() + 1 : 1;
  return `trails/${y}-${String(m).padStart(2, '0')}.json`;
}

/* ---------- text <-> base64, UTF-8 safe ---------- */
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- talking to GitHub ---------- */
export class SyncError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  /** The token was refused or can't reach the repository: retrying won't help until it's fixed. */
  get fatal() { return this.status === 401 || this.status === 403 || this.status === 404; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A small client for one repository: cfg = { repo: 'owner/name', token }. */
export function client(cfg) {
  const repo = String(cfg.repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
  async function call(method, path, body, { cache = 'no-store', timeout = 30000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let r;
    try {
      r = await fetch(API + path, {
        method, cache, signal: ctl.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SyncError(0, e.name === 'AbortError' ? 'GitHub took too long to answer' : "Can't reach GitHub (offline?)");
    } finally { clearTimeout(timer); }
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw new SyncError(r.status, data?.message || r.statusText || `HTTP ${r.status}`);
    return data;
  }
  const R = `/repos/${repo}`;
  const gh = {
    repo,
    call,
    /** { private, canWrite, branch } — also checks that the token works. */
    async info() {
      const d = await call('GET', R);
      return { private: !!d.private, canWrite: !!(d.permissions?.push ?? true), branch: d.default_branch || 'main', fullName: d.full_name || repo };
    },
    /** The latest commit on the branch, or null while the repository is empty. */
    async head(branch) {
      try { return (await call('GET', `${R}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; }
      catch (e) { if (e.status === 409 || e.status === 404) return null; throw e; }
    },
    /** Every month file at a commit: [{ path, sha }]. */
    async files(commit) {
      const d = await call('GET', `${R}/git/trees/${commit}?recursive=1`);
      return (d.tree || []).filter((e) => e.type === 'blob' && FILE_RE.test(e.path)).map((e) => ({ path: e.path, sha: e.sha }));
    },
    async blob(sha) {
      const d = await call('GET', `${R}/git/blobs/${sha}`, null, { cache: 'force-cache' }); // a blob never changes
      return parseFile(b64decode(d.content));
    },
    /** A month file and its sha ({ file: emptyFile(), sha: null } if it doesn't exist yet). */
    async read(path) {
      try {
        const d = await call('GET', `${R}/contents/${path}`);
        return { file: d.content ? parseFile(b64decode(d.content)) : await gh.blob(d.sha), sha: d.sha };
      } catch (e) {
        if (e.status === 404) return { file: emptyFile(), sha: null };
        throw e;
      }
    },
    /**
     * Change a month file safely: change(file) edits the file in place and returns true if it changed.
     * Retries when someone else wrote it meanwhile. Returns { file, sha, changed }.
     */
    async update(path, change, message) {
      for (let attempt = 0; ; attempt++) {
        const { file, sha } = await gh.read(path);
        if (!change(file)) return { file, sha, changed: false };
        try {
          const d = await call('PUT', `${R}/contents/${path}`, { message, content: b64encode(formatFile(file)), ...(sha ? { sha } : {}) });
          return { file, sha: d.content?.sha, commit: d.commit?.sha, changed: true };
        } catch (e) {
          // 409/422: the file changed since we read it (or appeared). Read again and merge again.
          if ((e.status === 409 || e.status === 422) && attempt < 6) { await wait(400 * (attempt + 1) + Math.random() * 400); continue; }
          throw e;
        }
      }
    },
  };
  return gh;
}

/* ---------- month files ---------- */
export const emptyFile = () => ({ version: 2, trails: [] });
export function parseFile(text) {
  let d; try { d = JSON.parse(text); } catch { return emptyFile(); }
  return { version: 2, trails: Array.isArray(d?.trails) ? d.trails.filter((t) => t && t.id) : [] };
}
/** One trail per line, oldest first, so changes show up as small diffs. */
export function formatFile(file) {
  const ts = [...file.trails].sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0) || (a.id < b.id ? -1 : 1));
  return `{"version":2,"trails":[\n${ts.map((t) => JSON.stringify(t)).join(',\n')}\n]}\n`;
}

/* ---------- merging ---------- */
const stamp = (t) => +t?.updated || 0;
/** Of two copies of a trail, the one edited last (ties are settled the same way everywhere). */
function newer(a, b) {
  if (stamp(a) !== stamp(b)) return stamp(a) > stamp(b) ? [a, b] : [b, a];
  if (!!a.deleted !== !!b.deleted) return a.deleted ? [a, b] : [b, a];
  return JSON.stringify(a) >= JSON.stringify(b) ? [a, b] : [b, a];
}
/** Visits sorted by time, each after the one it came from. */
export function orderVisits(visits) {
  const sorted = visits.map((v, i) => [v, i]).sort((x, y) => ((x[0].t || 0) - (y[0].t || 0)) || x[1] - y[1]).map((x) => x[0]);
  const out = [], placed = new Set(), ids = new Set(visits.map((v) => v.id));
  let rest = sorted;
  while (rest.length) {
    const later = [];
    for (const v of rest) {
      if (v.parent == null || placed.has(v.parent) || !ids.has(v.parent)) { out.push(v); placed.add(v.id); } else later.push(v);
    }
    if (later.length === rest.length) { out.push(...later); break; } // a loop: shouldn't happen
    rest = later;
  }
  return out;
}
/** Combine two copies of the same trail. */
export function mergeTrail(a, b) {
  if (!a) return b; if (!b) return a;
  const [w, l] = newer(a, b);
  const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])];
  if (w.deleted) return { id: w.id, created: w.created || l.created, updated: stamp(w), deleted: true };
  const rm = new Set(removed), mine = new Map((w.visits || []).map((v) => [v.id, v]));
  const visits = [];
  for (const v of w.visits || []) if (!rm.has(v.id)) visits.push(v);
  for (const v of l.deleted ? [] : l.visits || []) {
    if (rm.has(v.id)) continue;
    const m = mine.get(v.id);
    if (!m) { visits.push(v); continue; }
    // the same page in both: keep the newer copy, but the longest measured time and scroll
    if ((v.secs ?? -1) > (m.secs ?? -1) || (v.scroll ?? -1) > (m.scroll ?? -1)) {
      const i = visits.indexOf(m);
      const c = { ...m };
      if ((v.secs ?? -1) > (m.secs ?? -1)) c.secs = v.secs;
      if ((v.scroll ?? -1) > (m.scroll ?? -1)) c.scroll = v.scroll;
      if (i >= 0) visits[i] = c;
    }
  }
  const out = { ...w, visits: orderVisits(visits) };
  delete out.deleted;
  if (removed.length) out.removed = removed; else delete out.removed;
  return out;
}

/**
 * Pages the extension recorded, for one month file:
 * patches = Map(trailId -> { created, visits: [visit], dwell: [{ visitId, secs, scroll }] }).
 * Returns { changed, deleted: [trailIds that were deleted in the app meanwhile] }.
 * Recording doesn't count as editing, so `updated` stays as it is.
 */
export function applyPatches(file, patches) {
  const byId = new Map(file.trails.map((t) => [t.id, t]));
  let changed = false;
  const deleted = [];
  for (const [id, p] of patches) {
    let tr = byId.get(id);
    if (tr?.deleted) { deleted.push(id); continue; }
    if (!tr) {
      if (!p.visits.length) continue; // time on a page of a trail we don't know: nothing to attach it to
      tr = { id, name: '', created: p.created, updated: 0, visits: [] };
      file.trails.push(tr); byId.set(id, tr); changed = true;
    }
    const rm = new Set(tr.removed || []), have = new Map(tr.visits.map((v) => [v.id, v]));
    let added = false;
    for (const v of p.visits) if (!have.has(v.id) && !rm.has(v.id)) { tr.visits.push(v); have.set(v.id, v); added = changed = true; }
    if (added) tr.visits = orderVisits(tr.visits);
    for (const d of p.dwell) {
      const v = have.get(d.visitId); if (!v) continue;
      const i = tr.visits.indexOf(v), c = { ...v };
      let ch = false;
      if (Number.isFinite(d.secs) && d.secs > (v.secs ?? -1)) { c.secs = Math.round(d.secs); ch = true; }
      if (Number.isFinite(d.scroll) && d.scroll > (v.scroll ?? -1) + 0.005) { c.scroll = Math.round(d.scroll * 1000) / 1000; ch = true; }
      if (ch) { tr.visits[i] = c; have.set(c.id, c); changed = true; }
    }
  }
  return { changed, deleted };
}

/** Merge whole trails into a month file (used for history brought in from elsewhere). */
export function mergeInto(file, trails) {
  const byId = new Map(file.trails.map((t, i) => [t.id, i]));
  let changed = false;
  for (const t of trails) {
    const i = byId.get(t.id);
    const m = i == null ? t : mergeTrail(file.trails[i], t);
    if (i == null) { file.trails.push(m); byId.set(t.id, file.trails.length - 1); changed = true; }
    else if (JSON.stringify(m) !== JSON.stringify(file.trails[i])) { file.trails[i] = m; changed = true; }
  }
  return changed;
}
