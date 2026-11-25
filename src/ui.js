// Small helpers shared by the panels.
import { app } from './app.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function fmtDate(t, withYear = true) {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
export function fmtDateTime(t) {
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtAgo(t) {
  const d = Date.now() - t;
  if (d < 6e4) return 'just now';
  if (d < 36e5) return `${Math.round(d / 6e4)} min ago`;
  if (d < 864e5) return `${Math.round(d / 36e5)} h ago`;
  const days = Math.round(d / 864e5);
  return days < 60 ? plural(days, 'day') + ' ago' : fmtDate(t);
}
/** A page's address: on the site you're looking at, in the language you last read it in. */
export const wikiUrl = (title) => `https://${app.D?.articles.get(title)?.lang || app.state.lang || 'en'}.${app.site || 'wikipedia'}.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

let toastT;
/** A short message at the bottom of the screen. */
export function toast(text, ms = 2600) {
  const el = $('toast'); if (!el || !text) return;
  el.textContent = text; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms);
}

let actx;
/** Optional click sound (Settings → Sound effects). */
export function blip(mult = 1) {
  if (!app.settings.sound) return;
  try {
    actx ||= new AudioContext();
    const sd = app.skin?.sound || { wave: 'sine', f: 880 }, o = actx.createOscillator(), g = actx.createGain(), now = actx.currentTime;
    o.type = sd.wave; o.frequency.setValueAtTime(sd.f * mult, now); o.frequency.exponentialRampToValueAtTime(sd.f * mult * 1.5, now + .08);
    g.gain.setValueAtTime(.05, now); g.gain.exponentialRampToValueAtTime(.0001, now + .14);
    o.connect(g).connect(actx.destination); o.start(now); o.stop(now + .15);
  } catch { /* audio unavailable */ }
}

/** Two-step confirm on a button: first click arms it, second click within 3 s runs fn. */
export function confirmClick(btn, label, fn) {
  btn.onclick = () => {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
    btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = typeof label === 'function' ? label() : label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3000);
  };
}

export const dur = (s) => (s >= 5400 ? `${(s / 3600).toFixed(s >= 36000 ? 0 : 1)} h` : s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
/** A small mark for how you read a page: a filled dot (read), a ring (skimmed), a dash (don't know). */
export function readMark(r, { button = true, trailId = '', visitId = '' } = {}) {
  const d = r?.depth, cls = `rd ${d === 'read' ? 'rd-read' : d === 'skim' ? 'rd-skim' : 'rd-none'}${r?.guessed ? ' guessed' : ''}`;
  const what = d === 'read' ? 'Read' : d === 'skim' ? 'Skimmed' : 'Not marked';
  const how = r?.measured ? ` (${dur(r.secs)} on this page in total${r.scroll != null ? `, scrolled ${Math.round(r.scroll * 100)}%` : ''})`
    : r?.guessed ? ` (guessed: ${dur(r.secs)} before the next page)` : '';
  const tip = `${what}${how}${button ? ' · click to change' : ''}`;
  return button ? `<button class="${cls}" data-rd-t="${trailId}" data-rd-v="${visitId}" title="${tip}" aria-label="${tip}"></button>` : `<span class="${cls}" title="${tip}"></span>`;
}

/** The numbered steps of a trail (side branches indented), with how you read each page. */
export function stepsHTML(tr, shape, { cursorId = null, clickable = true, depth = null } = {}) {
  return shape.lines.map(({ v, n, depth: lvl, side }) =>
    `<li class="step${side ? ' side' : ''}${v.id === cursorId ? ' cur' : ''}${clickable ? '' : ' static'}" data-v="${v.id}" data-a="${esc(v.article)}" style="padding-left:${6 + lvl * 16}px" title="${esc(v.article)}"><span class="n">${n}</span>${depth ? readMark(depth.get(v.id), { trailId: tr.id, visitId: v.id }) : ''}<span class="t">${esc(v.article)}</span></li>`).join('');
}
