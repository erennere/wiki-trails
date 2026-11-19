// Inside the browser extension, Wiki Trails picks up the pages the recorder noted
// (see extension/recorder.js): new pages arrive as "ev:…" keys, time on a page as "dw:…" keys,
// in the extension's storage. They're added to your history and then cleared.
import { app, commit, emit } from './app.js';

const ext = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome?.runtime?.id ? globalThis.chrome : null;
export const inExtension = !!ext?.storage?.local;

export async function recordingOn() {
  if (!inExtension) return false;
  const r = await ext.storage.local.get('rec:on');
  return r['rec:on'] !== false;
}
export async function setRecording(on) { if (inExtension) await ext.storage.local.set({ 'rec:on': !!on }); }

export function initBridge() {
  if (!inExtension) return;
  let busy = false, again = false, timer = null;
  const run = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try { await ingest(); } catch (e) { console.error('Wiki Trails: could not add recorded pages', e); }
    busy = false;
    if (again) { again = false; run(); }
  };
  ext.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (Object.keys(ch).some((k) => (k.startsWith('ev:') || k.startsWith('dw:')) && ch[k].newValue)) { clearTimeout(timer); timer = setTimeout(run, 300); }
    if ('rec:on' in ch) emit('recording', ch['rec:on'].newValue !== false);
  });
  run();
}

async function ingest() {
  const all = await ext.storage.local.get(null);
  const evKeys = Object.keys(all).filter((k) => k.startsWith('ev:')).sort();
  const dwKeys = Object.keys(all).filter((k) => k.startsWith('dw:'));
  if (!evKeys.length && !dwKeys.length) return;
  const trails = new Map(app.state.trails.map((t) => [t.id, t]));
  const where = new Map(); // visit id -> trail, for visits added in this round
  const wasEmpty = app.state.trails.length === 0;
  let added = 0, changed = 0, lang = null;
  for (const k of evKeys) {
    const e = all[k];
    if (e?.kind !== 'visit' || !e.visit?.article) continue;
    const v = e.visit;
    let tr = trails.get(e.trailId);
    if (!tr) { tr = { id: e.trailId, name: '', created: new Date(v.t || Date.now()).toISOString(), visits: [] }; app.state.trails.push(tr); trails.set(tr.id, tr); }
    if (tr.visits.some((x) => x.id === v.id)) continue;
    let parent = v.parent ?? null;
    if (parent != null && !tr.visits.some((x) => x.id === parent)) {
      // the page it came from is gone (you deleted it): start a trail of its own
      tr = { id: `${e.trailId}-${v.id}`, name: '', created: new Date(v.t || Date.now()).toISOString(), visits: [] };
      app.state.trails.push(tr); trails.set(tr.id, tr); parent = null;
    }
    tr.visits.push({ id: v.id, article: v.article, parent, t: v.t || Date.now(), src: 'auto' });
    lang ||= v.lang || null;
    where.set(v.id, tr);
    added++;
  }
  for (const k of dwKeys) {
    const d = all[k];
    const tr = where.get(d?.visitId) || trails.get(d?.trailId) || app.state.trails.find((t) => t.visits.some((x) => x.id === d?.visitId));
    const v = tr?.visits.find((x) => x.id === d.visitId);
    if (!v) continue;
    if (v.secs !== d.secs || v.scroll !== d.scroll) { v.secs = Math.round(d.secs || 0); v.scroll = Math.max(0, Math.min(1, d.scroll || 0)); changed++; }
  }
  if (wasEmpty && lang) app.state.lang = lang; // links open on the Wikipedia you browse
  if (added || changed) commit({ added: added > 0, auto: true });
  await ext.storage.local.remove([...evKeys, ...dwKeys]);
}
