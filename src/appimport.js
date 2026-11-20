/*
 * Trails from the Wikipedia app on iPhone and iPad.
 *
 * The app keeps every article you open as a page view: when, how many seconds you spent on it, and
 * the page view you opened it from (a link you tapped). Its "Export User Data" button (Settings →
 * Help and feedback) zips the app's data folder, and that holds those page views in WMFData.sqlite.
 * This reads that zip (or the database itself) and turns the page views into trails: a page view
 * with nothing before it starts a trail, one opened from another page view continues its trail.
 *
 * Trail and visit ids come from the times of the page views, so opening a newer export later adds
 * only what's new, and the trails you already have grow instead of doubling.
 */
import { unzipSync } from 'fflate';

const APPLE_EPOCH = 978307200; // Core Data dates count seconds from 2001-01-01
const SQLITE = 'SQLite format 3\u0000';

export function isAppExport(name, bytes) {
  if (/\.(zip|sqlite)$/i.test(name || '')) return true;
  return bytes && bytes.length > 16 && ((bytes[0] === 0x50 && bytes[1] === 0x4b) || String.fromCharCode(...bytes.subarray(0, 16)) === SQLITE);
}

/** Reads an export (zip) or a WMFData.sqlite file. Returns { trails, views, lang } in the Wiki Trails format. */
export async function readAppExport(bytes) {
  let db = null, wal = null;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // only unpack the database, not the saved articles and caches next to it
    const files = unzipSync(bytes, { filter: (f) => /(^|\/)WMFData\.sqlite(-wal)?$/.test(f.name) });
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('-wal')) wal = data; else db = data;
    }
    if (!db) throw new Error('this zip has no reading history from the Wikipedia app in it (no WMFData.sqlite)');
  } else db = bytes;
  if (String.fromCharCode(...db.subarray(0, 16)) !== SQLITE) throw new Error('not a database from the Wikipedia app');
  db = wal && wal.length > 32 ? applyWal(db, wal) : db.slice();
  db[18] = 1; db[19] = 1; // read as an ordinary database, with no log beside it
  const SQL = await loadSqlJs();
  const d = new SQL.Database(db);
  try { return toTrails(readViews(d)); } finally { d.close(); }
}

/*
 * The app writes new page views to a side file first (the write-ahead log) and moves them into the
 * database later, so recent ones are often only there. Copy every committed page from the log into
 * the database, as SQLite itself would.
 */
export function applyWal(db, wal) {
  const dv = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
  const magic = dv.getUint32(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return db.slice();
  const big = magic === 0x377f0683;
  const pageSize = dv.getUint32(8);
  const salt1 = dv.getUint32(16), salt2 = dv.getUint32(20);
  if (!pageSize || pageSize & (pageSize - 1)) return db.slice();
  const sum = (s, off, len) => {
    let [s0, s1] = s;
    for (let i = off; i < off + len; i += 8) {
      s0 = (s0 + dv.getUint32(i, !big) + s1) >>> 0;
      s1 = (s1 + dv.getUint32(i + 4, !big) + s0) >>> 0;
    }
    return [s0, s1];
  };
  let s = sum([0, 0], 0, 24);
  if (s[0] !== dv.getUint32(24) || s[1] !== dv.getUint32(28)) return db.slice();
  const frame = 24 + pageSize;
  const pending = new Map();
  let committed = new Map(), size = 0;
  for (let off = 32; off + frame <= wal.length; off += frame) {
    if (dv.getUint32(off + 8) !== salt1 || dv.getUint32(off + 12) !== salt2) break;
    s = sum(s, off, 8); s = sum(s, off + 24, pageSize);
    if (s[0] !== dv.getUint32(off + 16) || s[1] !== dv.getUint32(off + 20)) break;
    pending.set(dv.getUint32(off), off + 24);
    const commit = dv.getUint32(off + 4);
    if (commit) { for (const [k, v] of pending) committed.set(k, v); pending.clear(); size = commit; }
  }
  if (!size) return db.slice();
  const out = new Uint8Array(size * pageSize);
  out.set(db.subarray(0, Math.min(db.length, out.length)));
  for (const [pgno, at] of committed) if (pgno <= size) out.set(wal.subarray(at, at + pageSize), (pgno - 1) * pageSize);
  return out;
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}
let sqlPromise = null;
function loadSqlJs() {
  sqlPromise ||= (async () => {
    if (!window.initSqlJs) await loadScript('vendor/sql-wasm.js');
    if (!window.__wikiTrailsSqlWasm) await loadScript('vendor/sql-wasm-binary.js');
    const bin = Uint8Array.from(atob(window.__wikiTrailsSqlWasm), (c) => c.charCodeAt(0));
    return window.initSqlJs({ wasmBinary: bin });
  })();
  sqlPromise.catch(() => { sqlPromise = null; });
  return sqlPromise;
}

/* Core Data names its tables and columns after the app's entities: ZCDPAGEVIEW, ZTIMESTAMP and so on.
   They're found by their columns, so a renamed table in a later app version still works. */
function readViews(d) {
  const tables = d.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map((r) => r[0]) || [];
  const cols = (t) => new Set((d.exec(`PRAGMA table_info("${t.replace(/"/g, '""')}")`)[0]?.values || []).map((r) => String(r[1]).toUpperCase()));
  let views = null, pages = null;
  for (const t of tables) {
    const c = cols(t);
    if (!views && c.has('ZPREVIOUSPAGEVIEW') && c.has('ZPAGE') && c.has('ZTIMESTAMP')) views = { t, secs: c.has('ZNUMBEROFSECONDS') };
    if (!pages && c.has('ZTITLE') && c.has('ZPROJECTID') && c.has('Z_PK')) pages = { t, ns: c.has('ZNAMESPACEID') };
  }
  if (!views || !pages) throw new Error('this Wikipedia app data has no page views in it (the app may be too old)');
  const q = `SELECT v.Z_PK, v.ZTIMESTAMP, ${views.secs ? 'v.ZNUMBEROFSECONDS' : '0'}, v.ZPREVIOUSPAGEVIEW, p.ZTITLE, p.ZPROJECTID, ${pages.ns ? 'p.ZNAMESPACEID' : '0'}
    FROM "${views.t}" v JOIN "${pages.t}" p ON p.Z_PK = v.ZPAGE ORDER BY v.ZTIMESTAMP, v.Z_PK`;
  return (d.exec(q)[0]?.values || []).map(([pk, ts, secs, prev, title, project, ns]) => ({
    pk, t: Math.round((Number(ts) + APPLE_EPOCH) * 1000), secs: Number(secs) || 0, prev, title: String(title || '').replace(/_/g, ' ').trim(),
    lang: /^wikipedia~/.test(project || '') ? String(project).split('~')[1] : null, ns: Number(ns) || 0,
  }));
}

export function toTrails(rows) {
  // only Wikipedia articles, as in the browser
  const ok = rows.filter((r) => r.lang && r.ns === 0 && r.title && Number.isFinite(r.t) && r.t > 0);
  const byPk = new Map(ok.map((r) => [r.pk, r]));
  const kids = new Map(), roots = [];
  for (const r of ok) {
    const p = r.prev != null ? byPk.get(r.prev) : null;
    if (p && p.t <= r.t && p !== r) (kids.get(p.pk) || kids.set(p.pk, []).get(p.pk)).push(r);
    else roots.push(r);
  }
  const langs = new Map();
  const trails = [], usedT = new Set();
  for (const root of roots) {
    let id = 'app' + root.t.toString(36);
    for (let k = 2; usedT.has(id); k++) id = 'app' + root.t.toString(36) + '-' + k;
    usedT.add(id);
    // parents before children, each level in the order you opened the pages
    const visits = [], used = new Set(), q = [[root, null]];
    while (q.length) {
      const [r, parent] = q.shift();
      let vid = r.t.toString(36);
      for (let k = 2; used.has(vid); k++) vid = r.t.toString(36) + '-' + k;
      used.add(vid);
      visits.push({ id: vid, article: r.title, parent, t: r.t, lang: r.lang, src: 'auto', ...(r.secs > 0 ? { secs: r.secs } : {}) });
      langs.set(r.lang, (langs.get(r.lang) || 0) + 1);
      for (const c of (kids.get(r.pk) || []).sort((a, b) => a.t - b.t)) q.push([c, vid]);
    }
    trails.push({ id, name: '', created: new Date(root.t).toISOString(), visits });
  }
  trails.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  const lang = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] || 'en';
  return { version: 2, lang, trails, views: ok.length };
}
