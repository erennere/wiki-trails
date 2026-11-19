// Record: the trail you're building, as a numbered list of steps, plus one input for the next page.
import { app, on, commit, snapshot, setCursor, trailOf, cursorVisit, undo, canUndo, depthOf, markReading } from '../app.js';
import { uid, normTitle, langFromUrl, trailShape } from '../model.js';
import { $, esc, stepsHTML, blip, toast, plural } from '../ui.js';

export function initRecord({ showLeft }) {
  function render() {
    const v = cursorVisit();
    const tr = app.cur && trailOf(app.cur.trailId);
    const steps = $('steps');
    steps.innerHTML = tr ? stepsHTML(tr, trailShape(tr), { cursorId: app.cur.visitId, depth: app.D.trailIndex.get(tr.id)?.depth }) : '';
    // how you read the page you're on
    const rr = $('readrow');
    rr.hidden = !v;
    if (v) {
      const r = depthOf(app.cur.trailId, v.id);
      $('readq').innerHTML = `How did you read <em>${esc(v.article)}</em>?${r.guessed ? ' <span class="hint">(guessed)</span>' : ''}`;
      rr.querySelectorAll('[data-rd]').forEach((b) => b.classList.toggle('on', b.dataset.rd === r.depth));
    }
    steps.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
    $('reclabel').innerHTML = v ? `Next page after <em>${esc(v.article)}</em>` : app.state.trails.length ? 'First page of a new trail' : 'First page';
    $('next').placeholder = v ? 'Paste the link you clicked, or type its title' : 'Paste a Wikipedia link or type a title';
    $('newtrail').disabled = !tr;
    $('undo').disabled = !canUndo();
    $('rechint').textContent = tr ? 'Click a step to continue from there.' : 'Start with the page where you began reading.';
    hint();
  }
  function renderTitles() {
    $('titles').innerHTML = [...app.D.articles.keys()].sort().map((t) => `<option value="${esc(t)}">`).join('');
  }
  function msg(text, warn = false) { $('msg').textContent = text || ''; $('msg').classList.toggle('warn', warn); }
  function hint() {
    const t = normTitle($('next').value), a = t && app.D.articles.get(t);
    msg(a ? `You've been here before: ${plural(a.visits, 'visit')} in ${plural(a.trails.size, 'trail')}.` : '');
  }

  function add() {
    const raw = $('next').value, title = normTitle(raw);
    if (!title) { $('next').focus(); return; }
    const v = cursorVisit();
    if (v && v.article === title) { msg('That is the page you are on.', true); return; }
    snapshot();
    const lang = langFromUrl(raw);
    if (lang && !app.state.trails.length) app.state.lang = lang;
    const visit = { id: uid(), article: title, parent: v ? v.id : null, t: Date.now() };
    if (!v) {
      const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [visit] };
      app.state.trails.push(t);
      app.cur = { trailId: t.id, visitId: visit.id };
    } else {
      trailOf(app.cur.trailId).visits.push(visit);
      app.cur = { trailId: app.cur.trailId, visitId: visit.id };
    }
    $('next').value = '';
    commit({ added: true });
    blip();
    $('next').focus();
  }

  $('add').onclick = add;
  $('next').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('next').addEventListener('input', hint);
  $('newtrail').onclick = () => { setCursor(null); $('next').focus(); };
  $('undo').onclick = () => { if (undo()) toast('Undone'); };
  $('readrow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rd]'), v = cursorVisit(); if (!b || !v) return;
    markReading(app.cur.trailId, v.id, b.dataset.rd);
  });
  $('steps').addEventListener('click', (e) => {
    const rd = e.target.closest('[data-rd-v]');
    if (rd) { // flip between read and skimmed
      const r = depthOf(rd.dataset.rdT, rd.dataset.rdV);
      return markReading(rd.dataset.rdT, rd.dataset.rdV, r.depth === 'read' ? 'skim' : 'read');
    }
    const li = e.target.closest('.step'); if (!li || !app.cur) return;
    setCursor({ trailId: app.cur.trailId, visitId: li.dataset.v });
    $('next').focus();
  });

  on('data', () => { render(); renderTitles(); });
  on('cursor', render);
  on('dirty', () => { $('undo').disabled = !canUndo(); });

  return {
    /** Continue an existing trail from one of its pages (default: its latest page). */
    continueTrail(trailId, visitId) {
      const t = trailOf(trailId); if (!t) return;
      showLeft();
      setCursor({ trailId, visitId: visitId || t.visits[t.visits.length - 1].id });
      $('next').focus();
    },
    /** Start a new trail whose first page is this article. */
    startAt(title) {
      showLeft();
      snapshot();
      const t = { id: uid(), name: '', created: new Date().toISOString(), visits: [{ id: uid(), article: title, parent: null, t: Date.now() }] };
      app.state.trails.push(t);
      app.cur = { trailId: t.id, visitId: t.visits[0].id };
      commit({ added: true });
      $('next').focus();
    },
  };
}
