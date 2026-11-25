// Runs on Wikipedia and Wiktionary pages, in every language. For an article or entry it tells the recorder:
//  - which page this is (its canonical title, so redirects count as the target page) and on which site,
//  - which Wikipedia or Wiktionary page you came from (the page's referrer), if any,
//  - whether you got here by going back or forward, or by reloading,
//  - how long the page was in front of you while you were using it, and how far you scrolled.
// It sends nothing anywhere except to the extension itself.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const body = document.body;
  const siteOf = (host) => host.match(/(?:^|\.)(wikipedia|wiktionary)\.org$/)?.[1] || null;
  const SITE = siteOf(location.hostname);
  // only ordinary articles being read (not talk pages, special pages, edit views, …); on Wiktionary also
  // reconstructed words (Reconstruction:…) and appendices
  const cl = body?.classList;
  const ok = cl && (cl.contains('ns-0') || (SITE === 'wiktionary' && (cl.contains('ns-118') || cl.contains('ns-100'))));
  if (!SITE || !ok || !cl.contains('action-view')) return;

  const langOf = (host) => host.split('.')[0];
  // a page's address → { title, site, lang }; also /zh-cn/…, /sr-ec/… (pages in another script)
  const pageOf = (href) => {
    try {
      const u = new URL(href);
      const site = siteOf(u.hostname); if (!site) return null;
      let raw = null, m;
      if (u.pathname.startsWith('/wiki/')) raw = u.pathname.slice(6);
      else if (u.pathname === '/w/index.php') raw = u.searchParams.get('title');
      else if ((m = u.pathname.match(/^\/[a-z]{2,3}(?:-[a-z0-9]+)+\/(.+)$/))) raw = m[1];
      if (!raw) return null;
      let t = decodeURIComponent(raw).replace(/_/g, ' ').trim();
      if (!t) return null;
      if (site === 'wikipedia') t = t[0].toUpperCase() + t.slice(1); // on Wiktionary "water" and "Water" differ
      return { title: t, site, lang: langOf(u.hostname) };
    } catch { return null; }
  };
  // this wiki's main page, whatever it's called in this language (the logo links to it)
  const main = pageOf(document.querySelector('a.mw-wiki-logo, a.mw-logo, a.branding-box, .branding-box a')?.href || '')?.title || 'Main Page';
  const isMain = (p) => !!p && (p.title === 'Main Page' || (p.site === SITE && p.lang === langOf(location.hostname) && p.title === main));

  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  const me = pageOf(canonical);
  if (!me || isMain(me)) return;
  const title = me.title;
  let src = pageOf(document.referrer);
  // an article opened from the main page starts a trail of its own
  if (src && ((src.site === me.site && src.title === title) || isMain(src))) src = null;
  const from = src?.title || null;
  // going to another site (Wikipedia ↔ Wiktionary, or another language) the referrer is only the site's
  // address, not the page: say which site and language it was, and the recorder takes the page that was
  // open in this tab (or the tab the link was opened from)
  let via = null;
  if (!src && document.referrer) {
    try { const r = new URL(document.referrer), site = siteOf(r.hostname); if (site && r.hostname !== location.hostname && r.pathname.length <= 1) via = { site, lang: langOf(r.hostname) }; } catch { /* not a URL */ }
  }
  // Wikipedia's search, talk pages, categories… aren't articles. Their titles look like "Special:Search",
  // "Talk:Moon", "User talk:Eren" (articles with a colon usually have a space after it). The recorder
  // still counts such a page if it recorded it as an article.
  const fromNs = !!from && /^[^\s:]{2,}(?: [^\s:]+)?:\S/.test(from);
  const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate'; // navigate | reload | back_forward
  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const send = (msg) => { try { api.runtime.sendMessage({ wikiTrails: 1, doc, ...msg }); } catch { /* extension reloaded */ } };

  // wasDiscarded: the browser had put this tab to sleep and is loading it again, which isn't you opening it
  send({ type: 'open', title, site: SITE, lang: langOf(location.hostname), from, fromSite: src?.site, fromLang: src?.lang, fromNs, via, nav, restored: !!document.wasDiscarded, t: Date.now() });

  // time on the page: only while you're actually on it — the tab is showing, the browser window is the
  // one you're using, and you moved, scrolled or typed in the last 45 seconds. A page left open, in a
  // background tab or behind another window doesn't count.
  const IDLE = 45000;
  let secs = 0, last = performance.now(), active = performance.now(), maxScroll = 0;
  const visible = () => document.visibilityState === 'visible';
  let on = visible() && document.hasFocus();
  function tick() {
    const now = performance.now();
    if (on) { const until = Math.min(now, active + IDLE); if (until > last) secs += (until - last) / 1000; }
    last = now;
  }
  const state = () => { tick(); on = visible() && document.hasFocus(); };
  const poke = () => { tick(); active = performance.now(); if (!on) state(); };
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
  document.addEventListener('visibilitychange', () => { state(); if (visible()) active = performance.now(); else report(true); });
  addEventListener('focus', () => { state(); active = performance.now(); });
  addEventListener('blur', () => { state(); report(true); });
  addEventListener('pagehide', () => report(true));
  // coming back to this page from the browser's back/forward cache
  addEventListener('pageshow', (e) => { if (e.persisted) { last = active = performance.now(); on = visible() && document.hasFocus(); send({ type: 'shown', title, site: SITE, t: Date.now() }); } });
  setInterval(() => { if (on) report(); }, 15000);
})();
