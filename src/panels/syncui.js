// Settings → Sync between your devices, and the sync status in the top bar.
import { app, on } from '../app.js';
import { sync, connect, disconnect, syncNow } from '../sync.js';
import { ext } from '../extlink.js';
import { $, esc, plural, fmtAgo, toast } from '../ui.js';

export function initSyncUI({ openSettings }) {
  let asking = null; // { repo, token } while we ask what to do with this browser's trails

  function chip() {
    const c = $('syncchip');
    c.hidden = !sync.on;
    if (!sync.on) return;
    c.className = `btn syncchip ${sync.state}`;
    const text = { busy: 'Syncing…', offline: 'Offline', error: 'Sync problem' }[sync.state] || 'Synced';
    $('syncchip-text').textContent = text;
    c.title = sync.state === 'error' ? sync.error
      : sync.state === 'offline' ? 'Offline: changes are kept here and sent when you are back online.'
      : `History synced with ${sync.cfg.repo}${sync.at ? `, ${fmtAgo(sync.at)}` : ''}. Click for details.`;
  }

  function extLine() {
    if (!ext.present) return 'The Wiki Trails extension isn’t installed in this browser (or can’t see this page).';
    const s = ext.status || {}, es = s.sync || {};
    const rec = s.on === false ? 'Recording is paused' : 'Recording';
    if (!es.repo) return `Extension in this browser: ${rec.toLowerCase()}, not connected yet.`;
    if (es.ok === false) return `Extension in this browser: ${rec.toLowerCase()}, but it can’t send pages: ${es.error || 'unknown problem'}.`;
    return `Extension in this browser: ${rec.toLowerCase()}, sending pages to ${es.repo}${es.at ? ` (last sent ${fmtAgo(es.at)})` : ''}${es.waiting ? `, ${plural(es.waiting, 'page')} waiting` : ''}.`;
  }

  function render() {
    chip();
    $('sync-form').hidden = sync.on || !!asking;
    $('sync-ask').hidden = !asking;
    $('sync-on').hidden = !sync.on;
    if (sync.on) {
      const when = sync.at ? `last synced ${fmtAgo(sync.at)}` : 'not synced yet';
      const st = sync.state === 'busy' ? 'syncing now…' : sync.state === 'offline' ? 'offline, will sync when you’re back online' : sync.state === 'error' ? 'there’s a problem (see below)' : when;
      $('sync-state').innerHTML = `Connected to <b>${esc(sync.cfg.repo)}</b>: ${esc(st)}.`
        + (sync.cfg.private === false ? ' <span class="warn">This repository is public, so anyone can see your history: make it private on GitHub (Settings → General → Danger zone).</span>' : '');
      $('sync-ext').textContent = extLine();
    }
    const err = sync.on && sync.state === 'error' ? sync.error : $('sync-err').dataset.msg || '';
    $('sync-err').hidden = !err; $('sync-err').textContent = err;
  }
  const showErr = (msg) => { $('sync-err').dataset.msg = msg || ''; render(); };

  async function doConnect(keep) {
    const repo = asking?.repo ?? $('sync-repo').value.trim(), token = asking?.token ?? $('sync-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, ''))) return showErr('Write the repository as owner/name, for example eren/wiki-trails-data.');
    if (!token) return showErr('Paste the access token from GitHub.');
    showErr('');
    $('sync-connect').disabled = true; $('sync-connect').textContent = 'Connecting…';
    try {
      const r = await connect(repo, token, keep);
      if (r.ask) {
        asking = { repo, token };
        $('sync-ask-text').innerHTML = `This browser has ${plural(r.ask, 'trail')} that ${r.ask === 1 ? 'isn’t' : 'aren’t'} in ${esc(repo)} yet${r.remoteCount ? ` (it has ${plural(r.remoteCount, 'trail')})` : ''}. Add ${r.ask === 1 ? 'it' : 'them'} to your synced history? Leave ${r.ask === 1 ? 'it' : 'them'} out if ${r.ask === 1 ? 'it’s' : 'they’re'} examples or tests.`;
      } else {
        asking = null; $('sync-token').value = '';
        toast(`Connected: ${plural(r.trails, 'trail')} in your synced history.`, 3500);
      }
    } catch (e) {
      asking = null;
      showErr(e.status === 401 ? 'GitHub refused the token. Check that you copied all of it and that it hasn’t expired.'
        : e.status === 404 ? 'GitHub can’t find that repository, or the token can’t see it. The token needs access to this repository.'
        : e.status === 403 ? 'The token isn’t allowed to write to that repository. It needs Contents: Read and write.'
        : e.message || String(e));
    } finally { $('sync-connect').disabled = false; $('sync-connect').textContent = 'Connect'; render(); }
  }
  $('sync-connect').onclick = () => doConnect();
  $('sync-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') doConnect(); });
  $('sync-add').onclick = () => doConnect(true);
  $('sync-leave').onclick = () => doConnect(false);
  $('sync-cancel').onclick = () => { asking = null; render(); };
  $('sync-now').onclick = () => syncNow();
  $('sync-off').onclick = () => { disconnect(); toast('This browser no longer syncs. Your history stays here.'); render(); };
  $('syncchip').onclick = () => { openSettings(); $('sync-h').scrollIntoView({ block: 'start' }); };

  on('sync', render);
  on('ext', render);
  on('ext-connected', (r) => { if (r && r.ok === false) toast(`The extension couldn’t connect: ${r.error || 'unknown problem'}`, 4000); render(); });
  setInterval(chip, 30e3);
  render();
  return { render };
}
