// Storage: IndexedDB in the browser (no ~5 MB localStorage ceiling), plus history files on disk.
import { validate, uid } from './model.js';

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

/** The repo's published dataset (data/trails.json), shown to visitors with no local data. */
export async function loadPublished() {
  if (!/^https?:$/.test(location.protocol)) return null; // browsers block fetch() from disk; the extension has no published file
  try {
    const r = await fetch('data/trails.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const raw = await r.json();
    const s = validate(raw);
    s.owner = typeof raw.owner === 'string' ? raw.owner.slice(0, 60) : '';
    return s.trails.length ? s : null;
  } catch { return null; }
}

/* ---------- history files ---------- */
let handle = null;   // remembered file (Chrome/Edge): Ctrl+S then writes to it silently
const TYPES = [{ description: 'Wiki Trails history', accept: { 'application/json': ['.json'] } }];
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
    const [h] = await window.showOpenFilePicker({ types: TYPES });
    const f = await h.getFile();
    const state = validate(JSON.parse(await f.text()));
    handle = h; // later saves go back to the same file
    return { state, name: f.name };
  } catch (e) {
    if (e.name === 'AbortError') return null;
    if (e.name === 'SecurityError' || e.name === 'NotAllowedError') return 'fallback';
    throw e;
  }
}
export async function readFile(file) { return validate(JSON.parse(await file.text())); }

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
