// Runs on the Wiki Trails site (only there). Lets the app and the extension talk:
// the app hands over its GitHub connection, can pause recording, and hears when new pages were sent.
// Messages go through window.postMessage on this page only (see src/extlink.js for the app's side).
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const post = (type, extra = {}) => window.postMessage({ wikiTrailsExt: type, ...extra }, location.origin);
  const ask = (m) => new Promise((res) => {
    try { const p = api.runtime.sendMessage(m, (r) => res(r)); if (p?.then) p.then(res, () => res(null)); } catch { res(null); }
  });
  async function status() { const s = await ask({ wikiTrailsPopup: 'status' }); if (s) post('status', { status: s }); }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d.wikiTrailsPage !== 'string') return;
    if (d.wikiTrailsPage === 'hello') status();
    else if (d.wikiTrailsPage === 'connect') { post('connected', { result: await ask({ wikiTrailsApp: 'connect', repo: d.repo, token: d.token }) }); status(); }
    else if (d.wikiTrailsPage === 'recording') { await api.storage.local.set({ 'rec:on': !!d.on }); status(); }
  });
  api.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    const st = ch['sync:status'];
    if (st && st.newValue?.okAt && st.newValue.okAt !== st.oldValue?.okAt && st.newValue.pushed) post('pushed');
    if (st || 'rec:on' in ch || 'sync:cfg' in ch) status();
  });
  document.documentElement.dataset.wikiTrailsExt = api.runtime.getManifest().version;
  status();
})();
