// File menu (save, open, examples, clear) and the Settings dialog (appearance, map, other).
import { app, on, replaceState, commit, snapshot, setSetting, totalClicks, applyReadingRule } from '../app.js';
import { validate, emptyState } from '../model.js';
import { saveToFile, pickFile, readFile, merge } from '../storage.js';
import { exampleState } from '../example.js';
import { sync } from '../sync.js';
import { SKINS, CATS } from '../skins.js';
import { applySkin, setTheme } from '../appearance.js';
import { $, esc, plural, fmtAgo, toast, confirmClick } from '../ui.js';

const SAVED_KEY = 'wiki-trails.saved';

export function initMenus({ graph }) {
  /* ---------- file menu ---------- */
  const fileMenu = $('filemenu');
  let saved = { at: 0, clicks: 0, name: '' };
  try { saved = { ...saved, ...JSON.parse(localStorage.getItem(SAVED_KEY)) }; } catch { /* first run */ }

  function saveDue() {
    const since = totalClicks() - (saved.clicks || 0);
    const days = saved.at ? (Date.now() - saved.at) / 864e5 : Infinity;
    if (!app.state.trails.length || since <= 0) return false;
    if (!saved.at) return totalClicks() >= 30;
    return since >= 200 || (days >= 7 && since >= 10);
  }
  function renderSaved() {
    const since = Math.max(0, totalClicks() - (saved.clicks || 0)), due = saveDue();
    $('savedinfo').textContent = !saved.at ? 'Not saved to a file yet.' : `Saved ${fmtAgo(saved.at)}${saved.name ? ` to ${saved.name}` : ''}${since ? ` · ${plural(since, 'new click')} since` : ''}.`;
    $('savedinfo').classList.toggle('due', due);
    $('filebtn').classList.toggle('due-dot', due);
    $('filebtn').title = due ? 'Time to save your history to a file' : 'Save, open, examples';
  }
  function closeMenus() { fileMenu.hidden = true; }
  $('filebtn').onclick = (e) => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; renderSaved(); };
  fileMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeMenus);

  async function doSave(saveAs = false) {
    closeMenus();
    try {
      app.state.layout = graph.getPositions();
      const r = await saveToFile(app.state, { saveAs }); if (!r) return;
      saved = { at: Date.now(), clicks: totalClicks(), name: r.name };
      try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
      renderSaved();
      toast(r.how === 'file' ? `Saved to ${r.name}. Ctrl+S updates the same file.` : `Downloaded ${r.name}. Open it any time with File → Open.`, 4000);
    } catch (err) { toast(`Could not save: ${err.message}`); }
  }

  let pending = null;
  function askOpen(s, name) {
    if (!app.state.trails.length || app.published) return applyOpen(s, 'replace', name); // a shown history isn't yours to add to
    pending = { s, name };
    const clicks = s.trails.reduce((n, t) => n + t.visits.length - 1, 0);
    $('od-text').innerHTML = `<b>${esc(name || 'This file')}</b> has ${plural(s.trails.length, 'trail')} and ${plural(clicks, 'click')}. You currently have ${plural(app.state.trails.length, 'trail')}.${sync.on ? ' Your history is synced, so this changes it on every device.' : ''}`;
    $('opendlg').hidden = false; $('od-merge').focus();
  }
  function applyOpen(s, how, name) {
    if (how === 'merge') { const m = merge(app.state, s); snapshot(); app.state = m.state; app.sel = null; commit({ fresh: true }); toast(`Added ${plural(m.added, 'new trail')} from ${name || 'the file'}.`); }
    else { graph.reset(); replaceState(s); toast(`Opened ${name || 'the file'}: ${plural(s.trails.length, 'trail')}.`); }
    saved = { at: Date.now(), clicks: totalClicks(), name: name || '' };
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
    renderSaved();
  }
  $('od-merge').onclick = () => { $('opendlg').hidden = true; if (pending) applyOpen(pending.s, 'merge', pending.name); pending = null; };
  $('od-replace').onclick = () => { $('opendlg').hidden = true; if (pending) applyOpen(pending.s, 'replace', pending.name); pending = null; };
  $('od-cancel').onclick = $('od-close').onclick = () => { $('opendlg').hidden = true; pending = null; };

  async function doOpen() {
    closeMenus();
    try {
      const r = await pickFile();
      if (r === 'fallback') return $('import').click();
      if (r) askOpen(r.state, r.name);
    } catch (err) { toast(`Could not open: ${err.message}`); }
  }
  async function openFileObj(f) { try { askOpen(await readFile(f), f.name); } catch (err) { toast(`Could not open ${f.name}: ${err.message}`); } }
  $('import').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFileObj(f); };

  // example data ships as a <script> so it also works when index.html is opened from disk
  function loadDataScript(name) {
    if (window.WIKI_TRAILS_DATA?.[name]) return Promise.resolve(window.WIKI_TRAILS_DATA[name]);
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = `data/${name}.js`;
      el.onload = () => (window.WIKI_TRAILS_DATA?.[name] ? res(window.WIKI_TRAILS_DATA[name]) : rej(new Error('empty')));
      el.onerror = () => rej(new Error('not found'));
      document.head.appendChild(el);
    });
  }
  async function loadTest(name) {
    closeMenus();
    if (sync.on) return toast('Examples would replace your synced history on every device. To try them, disconnect this browser in Settings first.', 5000);
    try {
      const s = name === 'small' ? exampleState() : validate(await loadDataScript(name));
      s.example = name;
      graph.reset(); replaceState(s);
      toast(`Loaded ${plural(s.trails.length, 'example trail')}${graph.isSettling() ? '. Arranging the map…' : '.'}`);
    } catch (err) { toast(`Could not load the example (${err.message}).`); }
  }

  $('m-save').onclick = () => doSave();
  $('m-saveas').onclick = () => doSave(true);
  $('m-open').onclick = doOpen;
  document.querySelectorAll('[data-example]').forEach((b) => b.onclick = () => loadTest(b.dataset.example));
  confirmClick($('m-clear'), () => (sync.on ? 'Click again to clear it on every device' : 'Click again to clear everything'), () => { closeMenus(); graph.reset(); replaceState({ ...emptyState(), lang: app.state.lang }); toast('History cleared. Undo brings it back.'); });

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); doSave(e.shiftKey); }
    if (e.key === 'o' || e.key === 'O') { e.preventDefault(); doOpen(); }
  });
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; $('dropzone').hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('dropzone').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('dropzone').hidden = true; const f = e.dataTransfer?.files?.[0]; if (f) openFileObj(f); });
  on('data', renderSaved);
  setInterval(renderSaved, 60000);

  /* ---------- settings ---------- */
  const MOCK = `<svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice"><path class="ml" d="M18 40 Q40 10 62 28 T104 18" stroke-width="3"/><path class="ml" d="M18 40 L50 50 L62 28" stroke-width="1" opacity=".55"/><path class="ml" d="M62 28 L88 46" stroke-width="1.6" opacity=".8"/><circle class="mn2" cx="18" cy="40" r="4.5"/><circle class="mn" cx="62" cy="28" r="5.5"/><circle class="mn" cx="104" cy="18" r="3"/><circle class="mn" cx="50" cy="50" r="2.5"/><circle class="mn" cx="88" cy="46" r="3"/></svg>`;
  function renderSkins() {
    const theme = document.documentElement.dataset.theme;
    $('skingrid').innerHTML = CATS.map(([c, label]) => `<div class="gal-cat">${label}</div><div class="gal-grid">${SKINS.filter((s) => s.cat === c).map((s) =>
      `<button class="card${s.id === app.settings.skin ? ' chosen' : ''}" data-skin="${s.id}" data-chrome="${s.chrome || 'bevel'}" data-theme="${theme}" data-id="${s.id}">
        <div class="mock-desk"><div class="mock-win"><div class="mock-title">${esc(s.name)}</div><div class="mock-screen">${MOCK}</div><div class="mock-row"><span class="mock-field"></span><span class="mock-btn">OK</span></div></div></div>
        <div class="card-name">${esc(s.name)}</div><div class="card-sub">${esc(s.blurb)}</div></button>`).join('')}</div>`).join('');
  }
  function renderSettings() {
    document.querySelectorAll('#themeseg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === app.settings.theme));
    $('density').value = app.settings.density;
    $('fade').checked = app.settings.fade;
    $('agefade').value = app.settings.ageFade;
    $('colourby').value = app.settings.mark;
    $('guessread').checked = app.settings.guessReading;
    $('readafter').value = String(app.settings.readAfter);
    $('rotate').checked = app.settings.rotate;
    $('sound').checked = app.settings.sound;
    $('lang').value = app.state.lang || 'en';
    renderSkins();
  }
  function openSettings() { closeMenus(); renderSettings(); $('settings').hidden = false; }
  function closeSettings() { $('settings').hidden = true; if (app.skin.id !== app.settings.skin) applySkin(app.settings.skin, { persist: false }); }
  $('settingsbtn').onclick = openSettings;
  $('set-close').onclick = closeSettings;
  $('set-done').onclick = closeSettings;
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
  document.querySelectorAll('#themeseg button').forEach((b) => b.onclick = () => { setTheme(b.dataset.theme); renderSettings(); });
  const grid = $('skingrid');
  grid.addEventListener('mouseover', (e) => { const c = e.target.closest('.card'); if (c && c.dataset.id !== app.skin.id) applySkin(c.dataset.id, { persist: false }); });
  grid.addEventListener('mouseleave', () => { if (app.skin.id !== app.settings.skin) applySkin(app.settings.skin, { persist: false }); });
  grid.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { applySkin(c.dataset.id); renderSkins(); } });
  $('density').oninput = () => { setSetting('density', +$('density').value); graph.setView({ density: app.settings.density }); };
  $('fade').onchange = () => { setSetting('fade', $('fade').checked); graph.setView({ fade: app.settings.fade }); };
  $('colourby').onchange = () => { setSetting('mark', $('colourby').value); graph.setView({ mark: app.settings.mark }); };
  $('guessread').onchange = () => { setSetting('guessReading', $('guessread').checked); applyReadingRule(); };
  $('readafter').onchange = () => { setSetting('readAfter', +$('readafter').value); applyReadingRule(); };
  $('agefade').oninput = () => { setSetting('ageFade', +$('agefade').value); graph.setView({ ageFade: app.settings.ageFade }); };
  $('rotate').onchange = () => { setSetting('rotate', $('rotate').checked); graph.setView({ rotate: app.settings.rotate }); };
  $('sound').onchange = () => setSetting('sound', $('sound').checked);
  $('lang').onchange = () => { app.state.lang = $('lang').value; commit(); };
  $('relayout').onclick = () => { graph.relayout(); toast('Arranging the map from scratch…'); closeSettings(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('settings').hidden) closeSettings(); if (!$('opendlg').hidden) $('opendlg').hidden = true; } });

  renderSaved();
  return { loadTest, openSettings, open: doOpen };
}
