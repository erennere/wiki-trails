// Storage: IndexedDB in the browser (no ~5 MB localStorage ceiling), plus history files on disk.
import { validate, uid } from './model.js';
import { isAppExport, readAppExport } from './appimport.js';

const DB = 'wiki-trails', STORE = 'kv', KEY = 'history', OLD_KEY = 'wiki-trails.v2';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

export async function loadLocal() {
  try { const v = await idbGet(KEY); if (v) return validate(v); } catch { /* IndexedDB unavailable */ }
  try { // migrate from the old localStorage copy
    const raw = localStorage.getItem(OLD_KEY);
    if (raw) { const s = validate(JSON.parse(raw)); try { await idbSet(KEY, s); localStorage.removeItem(OLD_KEY); } catch {} return s; }
  } catch { /* nothing stored */ }
  return null;
}

let saveT;
export function saveLocal(state) {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    idbSet(KEY, JSON.parse(JSON.stringify(state))).catch(() => { try { localStorage.setItem(OLD_KEY, JSON.stringify(state)); } catch { /* full */ } });
  }, 250);
}

/** Example data you loaded from File → Examples doesn't count as your own history. */
export function isExample(s) {
  return !!s && (!!s.example || (s.trails.length > 0 && s.trails.every((t) => /^t\d{4,}$/.test(t.id))));
}

/**
 * The history the site shows to visitors who have none of their own (see index.html):
 *  - live from the owner's history repository, if it's public (<meta name="wiki-trails-history">)
 *  - otherwise the copy in data/trails.json
 */
export async function loadPublished() {
  if (!/^https?:$/.test(location.protocol)) return null; // browsers block fetch() from disk; the extension has no published file
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
  const repo = meta('wiki-trails-history'), owner = meta('wiki-trails-owner');
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/trails`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' });
      if (r.ok) {
        const files = (await r.json()).filter((f) => /^\d{4}-\d{2}\.json$/.test(f.name) && f.download_url);
        const docs = await Promise.all(files.map((f) => fetch(f.download_url, { cache: 'no-cache' }).then((x) => (x.ok ? x.json() : null)).catch(() => null)));
        const byId = new Map();
        for (const d of docs) for (const t of d?.trails || []) if (t?.id) byId.set(t.id, t);
        const s = validate({ trails: [...byId.values()].filter((t) => !t.deleted) });
        for (const t of s.trails) { delete t.updated; delete t.removed; }
        s.trails.sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0));
        if (s.trails.length) { s.owner = owner || repo.split('/')[0]; return s; }
      }
    } catch { /* private, offline or rate-limited: use the copy below */ }
  }
  try {
    const r = await fetch('data/trails.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const raw = await r.json();
    const s = validate(raw);
    s.owner = owner || (typeof raw.owner === 'string' ? raw.owner.slice(0, 60) : '');
    return s.trails.length ? s : null;
  } catch { return null; }
}

/* ---------- history files ---------- */
let handle = null;   // remembered file (Chrome/Edge): Ctrl+S then writes to it silently
const TYPES = [{ description: 'Wiki Trails history', accept: { 'application/json': ['.json'] } }];
const OPEN_TYPES = [{ description: 'Wiki Trails history, or data exported from the Wikipedia app', accept: { 'application/json': ['.json'], 'application/zip': ['.zip'], 'application/x-sqlite3': ['.sqlite'] } }];
export const fileName = () => handle?.name || null;

export async function saveToFile(state, { saveAs = false } = {}) {
  const text = JSON.stringify({ app: 'wiki-trails', savedAt: new Date().toISOString(), ...state });
  if ('showSaveFilePicker' in window) {
    try {
      if (!handle || saveAs) handle = await window.showSaveFilePicker({ suggestedName: 'wiki-trails-history.json', types: TYPES });
      const w = await handle.createWritable(); await w.write(text); await w.close();
      return { name: handle.name, how: 'file' };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      handle = null; // fall back to a download below
    }
  }
  const name = `wiki-trails-history-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  return { name, how: 'download' };
}

/** Returns {state, name}, null if cancelled, or 'fallback' when the browser has no file picker. */
export async function pickFile() {
  if (!('showOpenFilePicker' in window)) return 'fallback';
  try {
    const [h] = await window.showOpenFilePicker({ types: OPEN_TYPES });
    const f = await h.getFile();
    const r = await readAny(f);
    if (!r.app) handle = h; // later saves go back to the same file
    return { ...r, name: f.name };
  } catch (e) {
    if (e.name === 'AbortError') return null;
    if (e.name === 'SecurityError' || e.name === 'NotAllowedError') return 'fallback';
    throw e;
  }
}
export async function readFile(file) { return (await readAny(file)).state; }
/** A Wiki Trails file, or what the Wikipedia app exported. Returns { state, app: views read | 0 }. */
export async function readAny(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isAppExport(file.name, bytes)) { const r = await readAppExport(bytes); return { state: validate(r), app: r.views || 0 }; }
  return { state: validate(JSON.parse(new TextDecoder().decode(bytes))), app: 0 };
}

/** Merge two histories: trails are unioned by id (the longer copy wins), layouts combined. */
export function merge(a, b) {
  const byId = new Map(a.trails.map((t) => [t.id, t]));
  let added = 0;
  for (const t of b.trails) {
    const mine = byId.get(t.id);
    if (!mine) { byId.set(t.id, t); added++; }
    else if (t.visits.length > mine.visits.length) byId.set(t.id, t);
  }
  const trails = [...byId.values()].sort((p, q) => Date.parse(p.created) - Date.parse(q.created));
  return { state: { ...a, trails, layout: { ...(b.layout || {}), ...(a.layout || {}) } }, added };
}
export { uid };
