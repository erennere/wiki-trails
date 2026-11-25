// Search in the top bar: find an article or a trail and jump to it. Press "/" to focus.
import { app, select } from '../app.js';
import { trailLabel } from '../model.js';
import { $, esc, plural, fmtDate } from '../ui.js';

export function initSearch() {
  const input = $('search'), box = $('results');
  let items = [], active = 0;

  function run() {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; items = []; return; }
    const arts = [...app.D.articles.values()].filter((a) => a.title.toLowerCase().includes(q))
      .sort((p, q2) => (p.title.toLowerCase().startsWith(q) ? 0 : 1) - (q2.title.toLowerCase().startsWith(q) ? 0 : 1) || q2.visits - p.visits).slice(0, 7);
    const trails = [...app.V.trails].reverse().filter((t) => trailLabel(t).toLowerCase().includes(q)).slice(0, 5);
    items = [...arts.map((a) => ({ kind: 'article', id: a.title })), ...trails.map((t) => ({ kind: 'trail', id: t.id }))];
    active = 0;
    let i = 0;
    box.innerHTML = (arts.length ? `<h4>Articles</h4>${arts.map((a) => `<button data-i="${i++}">${esc(a.title)}<small>${plural(a.visits, 'visit')}</small></button>`).join('')}` : '')
      + (trails.length ? `<h4>Trails</h4>${trails.map((t) => `<button data-i="${i++}">${esc(trailLabel(t))}<small>${fmtDate(t.created, false)}</small></button>`).join('')}` : '')
      + (!items.length ? '<div class="none">Nothing found.</div>' : '');
    box.hidden = false;
    mark();
  }
  function mark() { box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.i === active)); }
  function choose(i) {
    const it = items[i]; if (!it) return;
    select(it, { zoom: true, force: true });
    input.value = ''; box.hidden = true; input.blur();
  }

  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') choose(active);
    else if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
  });
  box.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); choose(+b.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); }
  });
}
