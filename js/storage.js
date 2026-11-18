import { emptyState, validate } from './model.js';

const KEY = 'wiki-trails.v2';

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? validate(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveLocal(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

/** The repo's published dataset (data/trails.json), shown to visitors with no local data. */
export async function loadPublished() {
  try {
    const r = await fetch('data/trails.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    return validate(await r.json());
  } catch { return null; }
}

export async function loadInitial() {
  return loadLocal() || (await loadPublished()) || emptyState();
}

export function exportFile(state, name = 'trails.json') {
  const blob = new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importFile(file) {
  return file.text().then((t) => validate(JSON.parse(t)));
}
