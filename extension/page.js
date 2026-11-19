// Runs on Wikipedia pages. For an article it tells the recorder:
//  - which article this is (its canonical title, so redirects count as the target page),
//  - which Wikipedia article you came from (the page's referrer), if any,
//  - whether you got here by going back or forward, or by reloading,
//  - how long the page was in front of you while you were using it, and how far you scrolled.
// It sends nothing anywhere except to the extension itself.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const body = document.body;
  // only ordinary articles being read (not talk pages, special pages, edit views, …)
  if (!body || !body.classList.contains('ns-0') || !body.classList.contains('action-view')) return;

  const titleOf = (href) => {
    try {
      const u = new URL(href);
      if (!/(^|\.)wikipedia\.org$/.test(u.hostname)) return null;
      let raw = null;
      if (u.pathname.startsWith('/wiki/')) raw = u.pathname.slice(6);
      else if (u.pathname === '/w/index.php') raw = u.searchParams.get('title');
      if (!raw) return null;
      const t = decodeURIComponent(raw).replace(/_/g, ' ').trim();
      return t ? t[0].toUpperCase() + t.slice(1) : null;
    } catch { return null; }
  };
  const langOf = (host) => host.split('.')[0];

  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  const title = titleOf(canonical);
  if (!title || title === 'Main Page') return;
  let from = titleOf(document.referrer);
  if (from === title || from === 'Main Page') from = null; // an article opened from the Main Page starts a trail of its own
  // Wikipedia's search, talk pages, categories… aren't articles. Their titles look like "Special:Search",
  // "Talk:Moon", "User talk:Eren" (articles with a colon usually have a space after it). The recorder
  // still counts such a page if it recorded it as an article.
  const fromNs = !!from && /^[^\s:]{2,}(?: [^\s:]+)?:\S/.test(from);
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate'; // navigate | reload | back_forward
  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const send = (msg) => { try { api.runtime.sendMessage({ wikiTrails: 1, doc, ...msg }); } catch { /* extension reloaded */ } };

  send({ type: 'open', title, lang: langOf(location.hostname), from, fromNs, nav, t: Date.now() });

  // time on the page: counted only while it's visible and you've done something in the last 2 minutes
  const IDLE = 120000;
  let secs = 0, last = performance.now(), active = performance.now(), maxScroll = 0;
  const visible = () => document.visibilityState === 'visible';
  function tick() {
    const now = performance.now();
    if (visible() && now - active < IDLE) secs += (now - last) / 1000;
    last = now;
  }
  const poke = () => { tick(); active = performance.now(); };
  function scrolled() {
    const h = document.documentElement.scrollHeight - innerHeight;
    maxScroll = Math.max(maxScroll, h > 0 ? Math.min(1, scrollY / h) : 1);
  }
  let sent = -1;
  function report(force = false) {
    tick();
    const s = Math.round(secs);
    if (!force && s === sent) return;
    sent = s;
    send({ type: 'dwell', secs: s, scroll: Math.round(maxScroll * 100) / 100 });
  }
  for (const ev of ['mousemove', 'keydown', 'wheel', 'touchstart', 'pointerdown']) addEventListener(ev, poke, { passive: true, capture: true });
  addEventListener('scroll', () => { poke(); scrolled(); }, { passive: true });
  scrolled();
  document.addEventListener('visibilitychange', () => { if (visible()) { last = active = performance.now(); } else report(true); });
  addEventListener('pagehide', () => report(true));
  // coming back to this page from the browser's back/forward cache
  addEventListener('pageshow', (e) => { if (e.persisted) { last = active = performance.now(); send({ type: 'shown', title, t: Date.now() }); } });
  setInterval(() => { if (visible()) report(); }, 15000);
})();
