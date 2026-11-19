// The toolbar button: is recording on, how many pages today, where they go, and a way into Wiki Trails.
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const APP = api.runtime.getManifest().homepage_url;
const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

function show(r) {
  const on = r?.on !== false, today = r?.today || 0, s = r?.sync || {};
  $('on').checked = on;
  $('status').className = 'status' + (on ? '' : ' off');
  $('status').innerHTML = `<span class="dot"></span>${on ? 'Recording' : 'Paused'}`;
  $('today').textContent = today ? `${today} page${today === 1 ? '' : 's'} recorded today` : 'Nothing recorded today yet';
  const el = $('sync');
  el.className = 'sync' + (s.repo && s.ok === false ? ' bad' : '');
  if (!s.repo) el.textContent = `Not sending pages anywhere yet. Open Wiki Trails, then Settings → Sync, and connect. This browser follows.${s.waiting ? ` ${s.waiting} page${s.waiting === 1 ? '' : 's'} waiting.` : ''}`;
  else if (s.ok === false) el.textContent = `Can't send to ${s.repo}: ${s.error}.${s.waiting ? ` ${s.waiting} waiting.` : ''}`;
  else el.textContent = `Sending pages to ${s.repo}${s.at ? `, last ${ago(s.at)}` : ''}.${s.waiting ? ` ${s.waiting} waiting.` : ''}`;
  $('manual').hidden = !!(s.repo && s.ok !== false);
  if (s.repo && !$('repo').value) $('repo').value = s.repo;
}
async function refresh() {
  try { show(await api.runtime.sendMessage({ wikiTrailsPopup: 'status' })); } catch { show(null); }
}
$('on').addEventListener('change', async () => { await api.storage.local.set({ 'rec:on': $('on').checked }); refresh(); });
$('connect').addEventListener('click', async () => {
  $('err').hidden = true; $('connect').disabled = true; $('connect').textContent = 'Connecting…';
  const r = await api.runtime.sendMessage({ wikiTrailsApp: 'connect', repo: $('repo').value.trim(), token: $('token').value.trim() }).catch((e) => ({ ok: false, error: e.message }));
  $('connect').disabled = false; $('connect').textContent = 'Connect';
  if (!r?.ok) { $('err').textContent = r?.error || 'Could not connect'; $('err').hidden = false; return; }
  $('token').value = ''; refresh();
});
$('open').addEventListener('click', async () => { await api.tabs.create({ url: APP }); window.close(); });
refresh();
