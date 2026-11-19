// The toolbar button: is recording on, how many pages today, and a way into Wiki Trails.
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
function show(on, today) {
  $('on').checked = on;
  $('status').className = 'status' + (on ? '' : ' off');
  $('status').innerHTML = `<span class="dot"></span>${on ? 'Recording' : 'Paused'}`;
  $('today').textContent = today ? `${today} page${today === 1 ? '' : 's'} recorded today` : 'Nothing recorded today yet';
}
async function refresh() {
  try {
    const r = await api.runtime.sendMessage({ wikiTrailsPopup: 'status' });
    show(r?.on !== false, r?.today || 0);
  } catch { show(true, 0); }
}
$('on').addEventListener('change', async () => {
  await api.storage.local.set({ 'rec:on': $('on').checked });
  refresh();
});
$('open').addEventListener('click', async () => {
  const url = api.runtime.getURL('app/index.html');
  await api.tabs.create({ url });
  window.close();
});
refresh();
