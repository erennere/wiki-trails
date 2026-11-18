// Trails: every trail, newest first. Click one to see it; recording happens in the Record panel.
import { app, on, select, setHover, colorOf, inRange } from '../app.js';
import { trailLabel } from '../model.js';
import { $, esc, plural, fmtDate } from '../ui.js';

export function initTrails() {
  let limit = 150;
  const box = $('trails');

  function render() {
    const q = $('tfilter').value.trim().toLowerCase();
    let list = [...app.state.trails].reverse().filter(inRange);
    const total = list.length;
    if (q) list = list.filter((t) => trailLabel(t).toLowerCase().includes(q) || t.visits.some((v) => v.article.toLowerCase().includes(q)));
    $('tcount').textContent = app.state.trails.length ? `(${q ? `${list.length} of ` : ''}${total})` : '';
    const sel = app.sel?.kind === 'trail' ? app.sel.id : null, rec = app.cur?.trailId;
    const shown = list.slice(0, limit);
    box.innerHTML = shown.map((t) => `<div class="item${t.id === sel ? ' on' : ''}" data-t="${t.id}">
        <span class="swatch" style="background:${colorOf(t.id)}"></span>
        <div class="tx"><div class="nm">${esc(trailLabel(t))}</div><div class="mt">${plural(t.visits.length, 'page')} · ${fmtDate(t.created, false)}</div></div>
        ${t.id === rec ? '<span class="tag">recording</span>' : ''}
      </div>`).join('')
      + (list.length > limit ? `<button class="btn small more" id="tmore">Show ${Math.min(150, list.length - limit)} more</button>` : '')
      + (!list.length ? `<div class="none">${q ? 'No trail matches.' : app.range ? 'No trails in this period.' : 'No trails yet. Record your first one above.'}</div>` : '');
    $('tmore')?.addEventListener('click', () => { limit += 150; render(); });
  }

  box.addEventListener('click', (e) => { const r = e.target.closest('.item'); if (r) select({ kind: 'trail', id: r.dataset.t }, { zoom: true }); });
  box.addEventListener('mouseover', (e) => { const r = e.target.closest('.item'); setHover(r ? { kind: 'trail', id: r.dataset.t } : null); });
  box.addEventListener('mouseleave', () => setHover(null));
  let t; $('tfilter').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { limit = 150; render(); }, 120); });

  for (const ev of ['data', 'range', 'select', 'cursor', 'skin']) on(ev, render);
  return { render };
}
