(() => {
  // src/model.js
  var uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function emptyState() {
    return { version: 2, lang: "en", trails: [] };
  }
  function normTitle(input) {
    let s = (input || "").trim();
    const m = s.match(/\/wiki\/([^#?\s]+)/);
    if (m) {
      try {
        s = decodeURIComponent(m[1]);
      } catch {
        s = m[1];
      }
    }
    s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return s ? s[0].toUpperCase() + s.slice(1) : "";
  }
  function langFromUrl(input) {
    const m = (input || "").match(/\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\//i);
    return m ? m[1].toLowerCase() : null;
  }
  function validate(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.trails)) throw new Error("Not a Wiki Trails file");
    const s = { version: 2, lang: typeof raw.lang === "string" ? raw.lang : "en", trails: [] };
    if (raw.layout && typeof raw.layout === "object") s.layout = raw.layout;
    for (const t of raw.trails) {
      if (!t || !Array.isArray(t.visits)) continue;
      const ids = /* @__PURE__ */ new Set();
      const visits = [];
      for (const v of t.visits) {
        const article = normTitle(v?.article);
        if (!article || !v.id || ids.has(v.id)) continue;
        if (v.parent != null && !ids.has(v.parent)) continue;
        ids.add(v.id);
        const t2 = Number(v.t);
        visits.push({ id: String(v.id), article, parent: v.parent ?? null, ...t2 > 0 ? { t: t2 } : {} });
      }
      if (visits.length) s.trails.push({ id: String(t.id || uid()), name: String(t.name || ""), created: t.created || (/* @__PURE__ */ new Date()).toISOString(), visits });
    }
    return s;
  }
  var pairKey = (a, b) => a < b ? a + "\0" + b : b + "\0" + a;
  var visitTime = (tr, v) => v.t || Date.parse(tr.created) || 0;
  function timeSpan(state) {
    let a = Infinity, b = -Infinity;
    for (const tr of state.trails) for (const v of tr.visits) {
      const t = visitTime(tr, v);
      if (t < a) a = t;
      if (t > b) b = t;
    }
    return a <= b ? [a, b] : null;
  }
  function derive(state, range = null) {
    const articles = /* @__PURE__ */ new Map();
    const links = /* @__PURE__ */ new Map();
    const inRange2 = (t) => !range || t >= range[0] && t <= range[1];
    const art = (t) => {
      if (!articles.has(t)) articles.set(t, { title: t, visits: 0, trails: /* @__PURE__ */ new Set(), starts: /* @__PURE__ */ new Set(), last: 0 });
      return articles.get(t);
    };
    const trailIndex2 = /* @__PURE__ */ new Map();
    state.trails.forEach((tr, i) => {
      const byId = new Map(tr.visits.map((v) => [v.id, v]));
      const children = new Map(tr.visits.map((v) => [v.id, []]));
      let root = null;
      for (const v of tr.visits) {
        if (v.parent != null) children.get(v.parent)?.push(v.id);
        if (v.parent == null && !root) root = v;
        const t = visitTime(tr, v);
        if (!inRange2(t)) continue;
        const a = art(v.article);
        a.visits++;
        a.trails.add(tr.id);
        if (t > a.last) a.last = t;
        if (v.parent == null) {
          a.starts.add(tr.id);
          continue;
        }
        const from = byId.get(v.parent).article, to = v.article;
        if (from === to) continue;
        const k = pairKey(from, to);
        if (!links.has(k)) {
          const [a1, b1] = from < to ? [from, to] : [to, from];
          links.set(k, { key: k, a: a1, b: b1, ab: 0, ba: 0, total: 0, last: 0, trails: /* @__PURE__ */ new Set() });
        }
        const l = links.get(k);
        from === l.a ? l.ab++ : l.ba++;
        l.total++;
        l.trails.add(tr.id);
        if (t > l.last) l.last = t;
        art(from);
      }
      trailIndex2.set(tr.id, { trail: tr, index: i, byId, children, root });
    });
    return { articles, links, trailIndex: trailIndex2 };
  }
  function chainTo(trailInfo, visitId) {
    const out = [];
    for (let v = trailInfo.byId.get(visitId); v; v = v.parent == null ? null : trailInfo.byId.get(v.parent)) out.unshift(v);
    return out;
  }
  function trailPath(ti, anchorId = null) {
    const segs = [];
    const vs = ti.trail.visits;
    if (!anchorId) {
      const n = Math.max(1, vs.length - 1);
      vs.forEach((v, i) => {
        if (v.parent == null) return;
        const from = ti.byId.get(v.parent);
        const i0 = vs.indexOf(from);
        if (from.article !== v.article) segs.push({ from: from.article, to: v.article, p0: i0 / n, p1: i / n, before: false, vid: v.id });
      });
      return segs;
    }
    const chain = chainTo(ti, anchorId);
    const L = Math.max(1, chain.length - 1);
    for (let i = 1; i < chain.length; i++) {
      if (chain[i - 1].article !== chain[i].article) segs.push({ from: chain[i - 1].article, to: chain[i].article, p0: 0.5 * (i - 1) / L, p1: 0.5 * i / L, before: true, vid: chain[i].id });
    }
    const depth = /* @__PURE__ */ new Map([[anchorId, 0]]);
    const after = [];
    for (const v of vs) {
      if (v.parent == null || !depth.has(v.parent)) continue;
      depth.set(v.id, depth.get(v.parent) + 1);
      after.push(v);
    }
    const maxD = Math.max(1, ...after.map((v) => depth.get(v.id)));
    for (const v of after) {
      const from = ti.byId.get(v.parent), d = depth.get(v.id);
      if (from.article !== v.article) segs.push({ from: from.article, to: v.article, p0: 0.5 + 0.5 * (d - 1) / maxD, p1: 0.5 + 0.5 * d / maxD, before: false, vid: v.id });
    }
    return segs;
  }
  function trailShape(tr) {
    const byId = new Map(tr.visits.map((v) => [v.id, v]));
    const last = tr.visits[tr.visits.length - 1];
    const main = [];
    for (let v = last; v; v = v.parent == null ? null : byId.get(v.parent)) main.unshift(v);
    const onMain = new Set(main.map((v) => v.id));
    const children = /* @__PURE__ */ new Map();
    for (const v of tr.visits) if (v.parent != null) {
      if (!children.has(v.parent)) children.set(v.parent, []);
      children.get(v.parent).push(v);
    }
    const branches = [];
    for (const v of tr.visits) {
      if (onMain.has(v.id) || v.parent == null || !onMain.has(v.parent)) continue;
      const seq = [];
      const walk = (x) => {
        seq.push(x);
        for (const c of children.get(x.id) || []) walk(c);
      };
      walk(v);
      branches.push({ from: byId.get(v.parent), visits: seq });
    }
    const depth = /* @__PURE__ */ new Map();
    const lines = tr.visits.map((v, i) => {
      let d = 0;
      if (!onMain.has(v.id)) d = (depth.get(v.parent) || 0) + 1;
      depth.set(v.id, d);
      return { v, n: i + 1, depth: d, side: d > 0 };
    });
    return { main, branches, lines, onMain };
  }
  function trailLabel(tr) {
    if (tr.name) return tr.name;
    const first = tr.visits[0]?.article || "Empty";
    const last = tr.visits[tr.visits.length - 1]?.article;
    return last && last !== first ? `${first} \u2192 ${last}` : first;
  }

  // src/storage.js
  var DB = "wiki-trails";
  var STORE = "kv";
  var KEY = "history";
  var OLD_KEY = "wiki-trails.v2";
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function loadLocal() {
    try {
      const v = await idbGet(KEY);
      if (v) return validate(v);
    } catch {
    }
    try {
      const raw = localStorage.getItem(OLD_KEY);
      if (raw) {
        const s = validate(JSON.parse(raw));
        try {
          await idbSet(KEY, s);
          localStorage.removeItem(OLD_KEY);
        } catch {
        }
        return s;
      }
    } catch {
    }
    return null;
  }
  var saveT;
  function saveLocal(state) {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      idbSet(KEY, JSON.parse(JSON.stringify(state))).catch(() => {
        try {
          localStorage.setItem(OLD_KEY, JSON.stringify(state));
        } catch {
        }
      });
    }, 250);
  }
  async function loadPublished() {
    if (location.protocol === "file:") return null;
    try {
      const r = await fetch("data/trails.json", { cache: "no-cache" });
      if (!r.ok) return null;
      return validate(await r.json());
    } catch {
      return null;
    }
  }
  var handle = null;
  var TYPES = [{ description: "Wiki Trails history", accept: { "application/json": [".json"] } }];
  async function saveToFile(state, { saveAs = false } = {}) {
    const text = JSON.stringify({ app: "wiki-trails", savedAt: (/* @__PURE__ */ new Date()).toISOString(), ...state });
    if ("showSaveFilePicker" in window) {
      try {
        if (!handle || saveAs) handle = await window.showSaveFilePicker({ suggestedName: "wiki-trails-history.json", types: TYPES });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return { name: handle.name, how: "file" };
      } catch (e) {
        if (e.name === "AbortError") return null;
        handle = null;
      }
    }
    const name = `wiki-trails-history-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    return { name, how: "download" };
  }
  async function pickFile() {
    if (!("showOpenFilePicker" in window)) return "fallback";
    try {
      const [h] = await window.showOpenFilePicker({ types: TYPES });
      const f = await h.getFile();
      const state = validate(JSON.parse(await f.text()));
      handle = h;
      return { state, name: f.name };
    } catch (e) {
      if (e.name === "AbortError") return null;
      if (e.name === "SecurityError" || e.name === "NotAllowedError") return "fallback";
      throw e;
    }
  }
  async function readFile(file) {
    return validate(JSON.parse(await file.text()));
  }
  function merge(a, b) {
    const byId = new Map(a.trails.map((t) => [t.id, t]));
    let added = 0;
    for (const t of b.trails) {
      const mine = byId.get(t.id);
      if (!mine) {
        byId.set(t.id, t);
        added++;
      } else if (t.visits.length > mine.visits.length) byId.set(t.id, t);
    }
    const trails = [...byId.values()].sort((p, q) => Date.parse(p.created) - Date.parse(q.created));
    return { state: { ...a, trails, layout: { ...b.layout || {}, ...a.layout || {} } }, added };
  }

  // src/app.js
  var SETTINGS_KEY = "wiki-trails.settings";
  var DEFAULTS = { skin: "plain", theme: "system", density: 1, fade: true, sound: false, left: true, right: true };
  var app = {
    state: emptyState(),
    D: null,
    // derived over all time (drives the map layout)
    DV: null,
    // derived for the time range you're looking at
    range: null,
    // [fromMs, toMs] or null for all time
    rangeName: "all",
    // '30' | '365' | 'all' | 'custom'
    sel: null,
    // what's selected: { kind: 'article' | 'edge' | 'trail', id }
    hover: null,
    // what the pointer is over (preview only)
    cur: null,
    // where the next recorded click attaches: { trailId, visitId }
    focus: null,
    // focus mode: { title, set }
    colors: [],
    // trail colours of the current skin
    settings: loadSettings()
  };
  app.D = app.DV = derive(app.state);
  var listeners = {};
  function on(ev, fn) {
    (listeners[ev] || (listeners[ev] = [])).push(fn);
  }
  function emit(ev, data) {
    for (const fn of listeners[ev] || []) fn(data);
  }
  var trailOf = (id) => app.state.trails.find((t) => t.id === id);
  var trailIndex = (id) => app.D.trailIndex.get(id)?.index ?? 0;
  var colorOf = (trailId) => app.colors[trailIndex(trailId) % Math.max(1, app.colors.length)] || "#888";
  function cursorVisit() {
    return app.cur ? app.D.trailIndex.get(app.cur.trailId)?.byId.get(app.cur.visitId) || null : null;
  }
  function totalClicks(state = app.state) {
    let n = 0;
    for (const t of state.trails) n += Math.max(0, t.visits.length - 1);
    return n;
  }
  function inRange(tr) {
    if (!app.range) return true;
    return tr.visits.some((v) => {
      const t = visitTime(tr, v);
      return t >= app.range[0] && t <= app.range[1];
    });
  }
  function rederive() {
    app.D = derive(app.state);
    app.DV = app.range ? derive(app.state, app.range) : app.D;
    const sp = timeSpan(app.state);
    app.span = sp ? sp[1] - sp[0] : 0;
  }
  function commit(opts = {}) {
    saveLocal(app.state);
    rederive();
    if (app.cur && !app.D.trailIndex.get(app.cur.trailId)?.byId.has(app.cur.visitId)) app.cur = null;
    const s = app.sel;
    if (s && (s.kind === "trail" && !trailOf(s.id) || s.kind === "article" && !app.D.articles.has(s.id) || s.kind === "edge" && !app.D.links.has(s.id))) app.sel = null;
    if (app.focus && !app.D.articles.has(app.focus.title)) app.focus = null;
    emit("data", opts);
  }
  var undoStack = [];
  function snapshot() {
    const { layout, ...rest } = app.state;
    undoStack.push(JSON.stringify({ state: rest, cur: app.cur }));
    let bytes = 0;
    for (const u of undoStack) bytes += u.length;
    while (undoStack.length > 1 && (undoStack.length > 100 || bytes > 24e6)) bytes -= undoStack.shift().length;
    emit("dirty");
  }
  var canUndo = () => undoStack.length > 0;
  function undo() {
    const s = undoStack.pop();
    if (!s) return false;
    const o = JSON.parse(s);
    app.state = { ...o.state, layout: app.state.layout };
    app.cur = o.cur;
    commit();
    return true;
  }
  function replaceState(next) {
    snapshot();
    app.state = next;
    app.cur = null;
    app.sel = null;
    app.hover = null;
    app.focus = null;
    app.range = null;
    app.rangeName = "all";
    commit({ fresh: true });
  }
  var same = (a, b) => a === b || a && b && a.kind === b.kind && a.id === b.id;
  function select(sel, opts = {}) {
    if (same(sel, app.sel) && !opts.force) return;
    app.sel = sel;
    emit("select", opts);
  }
  function setHover(h) {
    if (same(h, app.hover)) return;
    app.hover = h;
    emit("hover");
  }
  function setCursor(cur) {
    app.cur = cur;
    emit("cursor");
  }
  function setRange(range, name = range ? "custom" : "all") {
    app.range = range;
    app.rangeName = name;
    app.DV = range ? derive(app.state, range) : app.D;
    emit("range");
  }
  function setFocus(title, set = null) {
    app.focus = title ? { title, set } : null;
    emit("focus");
  }
  var MAX_PATHS = 120;
  function recency(t) {
    const span = app.span || 30 * 864e5;
    const tau = Math.max(21 * 864e5, span / 4);
    return 0.15 + 0.85 * Math.exp(-Math.max(0, Date.now() - t) / tau);
  }
  function specFor(target) {
    if (!target) return null;
    const D = app.D, DV = app.DV, fs = app.focus?.set, r = app.range;
    const ok = (s) => DV.articles.has(s.from) && DV.articles.has(s.to) && (!fs || fs.has(s.from) && fs.has(s.to));
    const inR = (t) => !r || t >= r[0] && t <= r[1];
    const paths = [];
    const add = (ti, anchorVisit) => {
      const t = anchorVisit ? visitTime(ti.trail, anchorVisit) : Date.parse(ti.trail.created);
      const segs = trailPath(ti, anchorVisit?.id).filter(ok);
      paths.push({ trailId: ti.trail.id, segs, t, rec: recency(t) });
    };
    if (target.kind === "trail") {
      const ti = D.trailIndex.get(target.id);
      if (!ti) return null;
      add(ti, null);
      const numbers = /* @__PURE__ */ new Map();
      ti.trail.visits.forEach((v, i) => {
        if (!numbers.has(v.article)) numbers.set(v.article, i + 1);
      });
      return { mode: "trail", paths, numbers, anchor: null, total: 1 };
    }
    if (target.kind === "article") {
      const a = D.articles.get(target.id);
      if (!a) return null;
      for (const id of a.trails) {
        const ti = D.trailIndex.get(id);
        let anchor = null;
        for (const v of ti.trail.visits) if (v.article === a.title && inR(visitTime(ti.trail, v))) anchor = v;
        if (anchor) add(ti, anchor);
      }
    } else if (target.kind === "edge") {
      const l = D.links.get(target.id);
      if (!l) return null;
      for (const id of l.trails) {
        const ti = D.trailIndex.get(id);
        let anchor = null;
        for (const v of ti.trail.visits) {
          if (v.parent == null) continue;
          const from = ti.byId.get(v.parent).article;
          if ((from === l.a && v.article === l.b || from === l.b && v.article === l.a) && inR(visitTime(ti.trail, v))) anchor = v;
        }
        if (anchor) add(ti, anchor);
      }
    }
    paths.sort((p, q) => q.t - p.t);
    const total = paths.length;
    return { mode: "anchor", paths: paths.slice(0, MAX_PATHS), total, anchor: target.kind === "article" ? target.id : null, edgeKey: target.kind === "edge" ? target.id : null };
  }
  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings));
    } catch {
    }
  }
  function setSetting(key, value) {
    app.settings[key] = value;
    saveSettings();
    emit("settings", key);
  }

  // src/views/map.js
  var d3 = window.d3;
  var TRAIL_COLORS = ["#ffff55", "#55ffff", "#ff55ff", "#ff5555", "#55ff55", "#ffaa00", "#7f7fff", "#ffffff", "#ff9ecf", "#aaff00"];
  var HUB = d3.interpolateRgbBasis(["#1d6b36", "#2fd35a", "#a8ff4d", "#ffe14d", "#ffaa00"]);
  var MAXV = 30;
  var MAXT = 20;
  var radius = (v) => 2.3 + Math.min(1.7 * Math.sqrt(v), 8.5 * Math.sqrt(v / MAXV));
  var relT = (t) => Math.log1p(t) / Math.log1p(Math.max(MAXT, 8));
  var widthOf = (total) => 0.6 + 5 * relT(total) ** 1.4;
  var alphaOf = (total) => 0.16 + 0.7 * relT(total);
  var DAY = 864e5;
  function poly(pts) {
    return "M" + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L") + "Z";
  }
  function radial(n, rOut, rIn, rot = -Math.PI / 2) {
    const pts = [];
    for (let i = 0; i < n * (rIn ? 2 : 1); i++) {
      const r = rIn && i % 2 ? rIn : rOut, a = rot + i * Math.PI / (rIn ? n : n / 2);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return poly(pts);
  }
  function shapePath(shape, r) {
    switch (shape) {
      case "circle":
        return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
      case "diamond":
        return poly([[0, -r * 1.35], [r * 1.35, 0], [0, r * 1.35], [-r * 1.35, 0]]);
      case "tri":
        return poly([[0, -r * 1.45], [r * 1.3, r * 0.85], [-r * 1.3, r * 0.85]]);
      case "hex":
        return radial(6, r * 1.2, 0, 0);
      case "star":
        return radial(5, r * 1.6, r * 0.7);
      case "spark":
        return radial(4, r * 1.9, r * 0.45);
      default:
        return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}Z`;
    }
  }
  var p2dCache = /* @__PURE__ */ new Map();
  function shapeP2D(shape, r) {
    const k = shape + "|" + r.toFixed(1);
    let p = p2dCache.get(k);
    if (!p) {
      p = new Path2D(shapePath(shape, Math.max(0.8, r)));
      if (p2dCache.size > 4e3) p2dCache.clear();
      p2dCache.set(k, p);
    }
    return p;
  }
  function createGraph(canvas, handlers) {
    const ctx = canvas.getContext("2d");
    let W = 1, H = 1, dpr = 1;
    let T = d3.zoomIdentity, ax = 1, ay = 1, kFit = 1;
    const zr = () => T.k / kFit;
    const style = { link: "#39ff88", label: "#c6ffd8", labelBg: "#010a04", labelStart: "#fff", cursor: "#ffaa00", before: "#4da3ff", after: "#ffaa00", font: "monospace", weight: "400", upper: false };
    let skin = { shape: "square", hollow: false, glow: true, edge: "plain", bend: 0.12, labelSize: 15, walker: false };
    const view = { density: 1, fade: true, focus: null };
    let nodes = [], nodeBy = /* @__PURE__ */ new Map(), adj = /* @__PURE__ */ new Map();
    let visArticles = /* @__PURE__ */ new Map(), visNodes = [], sorted = [], visMaxDeg = 1, spanMs = 30 * DAY, nowMs = Date.now();
    const posCache = /* @__PURE__ */ new Map();
    let quad = null, drawn = [];
    let over = null, cursor = null, hoverNode = null, hoverEdge = null;
    let drawMs = 0, simLeft = 0, pinnedFresh = false, lastInteract = 0, dirty = true, raf = 0, lastFrame = 0;
    const sim = d3.forceSimulation().stop().force("link", d3.forceLink().id((d) => d.title).distance((l) => 22 + 90 / (1 + 0.7 * Math.log2(1 + l.total))).strength((l) => Math.min(1, 0.1 + 0.15 * Math.log2(1 + l.total)))).force("charge", d3.forceManyBody().theta(0.9).distanceMax(520)).force("collide", d3.forceCollide((n) => radius(n.visits) + 4).iterations(1)).force("x", d3.forceX().strength(0.03)).force("y", d3.forceY().strength(0.03));
    function runSim(alpha, ticks) {
      sim.alpha(alpha);
      simLeft = Math.max(simLeft, ticks);
      kick();
    }
    function simSlice(budget = 12) {
      if (simLeft <= 0) return;
      const t0 = performance.now();
      while (simLeft > 0 && performance.now() - t0 < budget) {
        sim.tick();
        simLeft--;
      }
      rebuildQuad();
      if (simLeft <= 0) {
        if (pinnedFresh) {
          for (const n of nodes) {
            n.fx = null;
            n.fy = null;
          }
          pinnedFresh = false;
        }
        for (const n of nodes) n.fresh = false;
        for (const n of nodes) posCache.set(n.title, { x: n.x, y: n.y });
        handlers.onSettled?.();
      }
      dirty = true;
    }
    function update(full, visible = full, saved = null) {
      nowMs = Date.now();
      if (saved) {
        for (const [t, p] of Object.entries(saved)) if (!posCache.has(t) && Array.isArray(p)) posCache.set(t, { x: +p[0], y: +p[1] });
      }
      const old = nodeBy;
      adj = /* @__PURE__ */ new Map();
      for (const l of full.links.values()) {
        if (!adj.has(l.a)) adj.set(l.a, []);
        if (!adj.has(l.b)) adj.set(l.b, []);
        adj.get(l.a).push(l.b);
        adj.get(l.b).push(l.a);
      }
      let fresh = 0;
      nodes = [...full.articles.values()].map((a) => {
        let n = old.get(a.title);
        if (!n) {
          const p = posCache.get(a.title);
          n = { title: a.title, x: p?.x, y: p?.y, fresh: !p };
        }
        n.visitsAll = a.visits;
        n.visits = a.visits;
        n.isStart = a.starts.size > 0;
        return n;
      });
      nodeBy = new Map(nodes.map((n) => [n.title, n]));
      for (const n of nodes) {
        if (n.x != null && !Number.isNaN(n.x)) continue;
        fresh++;
        const nb = (adj.get(n.title) || []).map((t) => nodeBy.get(t)).find((m) => m && m.x != null && !Number.isNaN(m.x));
        n.x = (nb ? nb.x : 0) + (Math.random() - 0.5) * 40;
        n.y = (nb ? nb.y : 0) + (Math.random() - 0.5) * 40;
        n.fresh = true;
      }
      const big = nodes.length > 400;
      sim.force("charge").strength((n) => -(big ? 70 : 170) - (big ? 18 : 30) * Math.sqrt(n.visitsAll));
      sim.nodes(nodes);
      sim.force("link").links([...full.links.values()].map((l) => ({ source: l.a, target: l.b, total: l.total })));
      const first = fresh > nodes.length * 0.5;
      if (first) {
        pinnedFresh = false;
        runSim(1, Math.min(300, 140 + nodes.length / 10));
      } else if (fresh) {
        for (const n of nodes) if (!n.fresh) {
          n.fx = n.x;
          n.fy = n.y;
        }
        pinnedFresh = true;
        runSim(0.5, 90);
      }
      setVisible(visible);
      return first;
    }
    function setVisible(visible) {
      visArticles = visible.articles;
      const focusSet = view.focus;
      visNodes = nodes.filter((n) => visArticles.has(n.title) && (!focusSet || focusSet.has(n.title)));
      const deg = /* @__PURE__ */ new Map();
      const ls = [];
      let tMin = Infinity, tMax = -Infinity;
      for (const l of visible.links.values()) {
        if (focusSet && !(focusSet.has(l.a) && focusSet.has(l.b))) continue;
        ls.push(l);
        deg.set(l.a, (deg.get(l.a) || 0) + l.total);
        deg.set(l.b, (deg.get(l.b) || 0) + l.total);
        if (l.last < tMin) tMin = l.last;
        if (l.last > tMax) tMax = l.last;
      }
      spanMs = Math.max(30 * DAY, tMax - tMin);
      for (const n of visNodes) {
        const a = visArticles.get(n.title);
        n.visits = a ? a.visits : 0;
        n.deg = deg.get(n.title) || 0;
        n.last = a?.last || 0;
      }
      visMaxDeg = Math.max(1, ...visNodes.map((n) => n.deg));
      MAXV = Math.max(10, ...visNodes.map((n) => n.visits));
      MAXT = Math.max(4, ...ls.map((l) => l.total));
      rescore(ls);
      rebuildQuad();
      dirty = true;
      kick();
    }
    function recency2(last) {
      if (!view.fade || !last) return 1;
      const tau = Math.max(30 * DAY, spanMs / 5);
      return 0.28 + 0.72 * Math.exp(-Math.max(0, nowMs - last) / tau);
    }
    function rescore(ls = sorted) {
      for (const l of ls) {
        l.rec = recency2(l.last);
        l.score = l.total * (0.25 + 0.75 * l.rec);
      }
      sorted = [...ls].sort((p, q) => q.score - p.score);
      const strongCut = sorted[Math.floor(sorted.length * 0.08)]?.score ?? Infinity;
      for (const l of sorted) l.strong = l.total >= 3 && l.score >= strongCut;
    }
    function rebuildQuad() {
      quad = d3.quadtree(visNodes, (n) => n.x, (n) => n.y);
    }
    const sx = (x) => T.x + T.k * ax * x;
    const sy = (y) => T.y + T.k * ay * y;
    const lx = (px) => (px - T.x) / (T.k * ax);
    const ly = (py) => (py - T.y) / (T.k * ay);
    function ctrlPt(x1, y1, x2, y2, extra = 0) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, bend = len * skin.bend + extra;
      return [(x1 + x2) / 2 - dy / len * bend, (y1 + y2) / 2 + dx / len * bend];
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      dirty = true;
      kick();
    }
    new ResizeObserver(() => {
      resize();
      handlers.onResize?.();
    }).observe(canvas);
    const textW = /* @__PURE__ */ new Map();
    function measure(t, font) {
      const k = font + "|" + t;
      let w = textW.get(k);
      if (w == null) {
        ctx.font = font;
        w = ctx.measureText(t).width;
        if (textW.size > 2e4) textW.clear();
        textW.set(k, w);
      }
      return w;
    }
    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawn = [];
      if (!visNodes.length) return;
      const k = zr(), rs = Math.max(0.7, Math.min(2.2, Math.sqrt(k)));
      const lit = over?.nodes || null;
      const dimF = over ? 0.13 : 1;
      const M = 60;
      const inView = (x, y) => x > -M && x < W + M && y > -M && y < H + M;
      const budget = Math.round(380 * view.density * Math.min(10, Math.max(1, Math.pow(k, 1.25))));
      const wsc = Math.max(0.7, Math.min(1.6, Math.pow(k, 0.35)));
      const major = /* @__PURE__ */ new Set();
      const dash = skin.edge === "dotted" ? [1, 7] : skin.edge === "blocks" ? [4, 4] : null;
      ctx.lineCap = skin.edge === "blocks" ? "butt" : "round";
      ctx.strokeStyle = style.link;
      let count = 0;
      for (const l of sorted) {
        if (count >= budget) break;
        const A = nodeBy.get(l.a), B = nodeBy.get(l.b);
        if (!A || !B) continue;
        const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y);
        if (!inView(x1, y1) && !inView(x2, y2)) continue;
        count++;
        const [cx, cy] = ctrlPt(x1, y1, x2, y2);
        const w = widthOf(l.total) * wsc, a = alphaOf(l.total) * l.rec * dimF;
        drawn.push({ l, x1, y1, cx, cy, x2, y2, w });
        major.add(l.a);
        major.add(l.b);
        if (l.strong && skin.glow !== false && !over) {
          ctx.globalAlpha = a * 0.16;
          ctx.lineWidth = w * 3 + 5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cx, cy, x2, y2);
          ctx.stroke();
        }
        ctx.globalAlpha = a;
        ctx.lineWidth = w;
        if (dash) ctx.setLineDash(dash.map((d) => d * Math.max(1, w / 2)));
        else if (skin.edge === "pulse" && l.strong) {
          ctx.setLineDash([2, 12]);
          ctx.lineDashOffset = -(now / 60) % 14;
        } else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (hoverEdge && !over) {
        const d = drawn.find((e) => e.l.key === hoverEdge);
        if (d) {
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = style.labelStart;
          ctx.lineWidth = d.w + 2.5;
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y1);
          ctx.quadraticCurveTo(d.cx, d.cy, d.x2, d.y2);
          ctx.stroke();
          major.add(d.l.a);
          major.add(d.l.b);
        }
      }
      if (over) drawPaths(rs);
      const nodeBudget = Math.round(160 * view.density * Math.min(12, Math.max(1, k * k)));
      const inViewNodes = [];
      for (const n of visNodes) {
        const x = sx(n.x), y = sy(n.y);
        if (inView(x, y)) inViewNodes.push([n, x, y]);
      }
      inViewNodes.sort((p, q) => q[0].visits - p[0].visits);
      const shown = [];
      ctx.fillStyle = style.link;
      for (let i = 0; i < inViewNodes.length; i++) {
        const [n, x, y] = inViewNodes[i];
        const important = major.has(n.title) || i < nodeBudget || lit && lit.has(n.title) || n.title === cursor || n.title === hoverNode;
        if (important) {
          shown.push(inViewNodes[i]);
          continue;
        }
        ctx.globalAlpha = over ? 0.05 : 0.22;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      const hollow = !!skin.hollow;
      for (const [n, x, y] of shown) {
        const isLit = !lit || lit.has(n.title);
        const col = HUB(Math.log1p(n.deg) / Math.log1p(visMaxDeg));
        const r = radius(n.visits) * rs;
        ctx.globalAlpha = isLit ? 1 : 0.16;
        ctx.save();
        ctx.translate(x, y);
        const p = shapeP2D(skin.shape, r);
        if (hollow) {
          ctx.strokeStyle = col;
          ctx.lineWidth = n.isStart ? 3 : 1.6;
          ctx.stroke(p);
        } else {
          ctx.fillStyle = col;
          ctx.fill(p);
          ctx.strokeStyle = n.isStart ? style.labelStart : style.labelBg;
          ctx.lineWidth = n.isStart ? 2 : 1;
          ctx.stroke(p);
        }
        if (over && isLit) {
          ctx.globalAlpha = 1;
          if (over.ends.has(n.title)) {
            ctx.strokeStyle = style.after;
            ctx.lineWidth = 2.5;
            ctx.stroke(shapeP2D(skin.shape, r + 3.5));
          }
          if (over.starts.has(n.title)) {
            ctx.strokeStyle = style.before;
            ctx.lineWidth = 2.5;
            ctx.stroke(shapeP2D(skin.shape, r + (over.ends.has(n.title) ? 7 : 3.5)));
          }
          if (n.title === over.anchor) {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = style.labelStart;
            ctx.fill(shapeP2D(skin.shape, r + 11));
            ctx.globalAlpha = 1;
            ctx.strokeStyle = style.labelStart;
            ctx.lineWidth = 3;
            ctx.stroke(shapeP2D(skin.shape, r + 6));
          }
        }
        if (n.title === hoverNode) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.labelStart;
          ctx.lineWidth = 2;
          ctx.stroke(shapeP2D(skin.shape, r + 3));
        }
        if (n.title === cursor && Math.floor(now / 500) % 2 === 0) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.cursor;
          ctx.lineWidth = 3;
          ctx.setLineDash([4, 3]);
          ctx.stroke(shapeP2D(skin.shape, r + 5));
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
      if (over?.numbers) {
        ctx.font = `600 12px ${style.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const [t, num] of over.numbers) {
          const n = nodeBy.get(t);
          if (!n || !visArticles.has(t)) continue;
          const x = sx(n.x), y = sy(n.y), r = radius(n.visits) * rs, bx = x - r - 9, by = y - r - 9;
          ctx.globalAlpha = 1;
          ctx.fillStyle = style.labelBg;
          ctx.strokeStyle = style.cursor;
          ctx.lineWidth = 1.5;
          ctx.fillRect(bx - 9, by - 8, 18, 16);
          ctx.strokeRect(bx - 9, by - 8, 18, 16);
          ctx.fillStyle = style.cursor;
          ctx.fillText(String(num), bx, by + 1);
        }
        ctx.textAlign = "start";
        if (skin.walker && over.walk?.length) drawWalker(now);
      }
      drawLabels(shown, lit);
      ctx.globalAlpha = 1;
    }
    function lanePath(lane, extra) {
      const A = nodeBy.get(lane.from), B = nodeBy.get(lane.to);
      if (!A || !B) return null;
      const [pa, pb] = lane.from < lane.to ? [A, B] : [B, A];
      const x1 = sx(pa.x), y1 = sy(pa.y), x2 = sx(pb.x), y2 = sy(pb.y);
      const [cx, cy] = ctrlPt(x1, y1, x2, y2, extra);
      return lane.from < lane.to ? [x1, y1, cx, cy, x2, y2] : [x2, y2, cx, cy, x1, y1];
    }
    function rampColor(p, mode) {
      if (mode === "trail") return d3.interpolateRgb(style.before, style.after)(p);
      if (p <= 0.5) return d3.interpolateRgb(style.labelBg, style.before)(0.28 + 0.72 * (p / 0.5));
      return d3.interpolateRgb(style.labelBg, style.after)(0.28 + 0.72 * (1 - (p - 0.5) / 0.5));
    }
    function drawPaths(rs) {
      const arrows = over.segs.length < 500;
      ctx.lineCap = "round";
      ctx.setLineDash([]);
      for (const s of over.segs) {
        const p = lanePath(s, s.extra);
        if (!p) continue;
        const [x1, y1, cx, cy, x2, y2] = p;
        const g = ctx.createLinearGradient(x1, y1, x2, y2);
        g.addColorStop(0, s.c0);
        g.addColorStop(1, s.c1);
        const w = (0.9 + 3.6 * s.rec) * Math.min(1.5, rs);
        ctx.globalAlpha = 0.28 + 0.67 * s.rec;
        ctx.strokeStyle = g;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        if (arrows && s.rec > 0.2 && Math.hypot(x2 - x1, y2 - y1) > 40) {
          const u = 0.6, mx = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, my = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2;
          const tx = 2 * (1 - u) * (cx - x1) + 2 * u * (x2 - cx), ty = 2 * (1 - u) * (cy - y1) + 2 * u * (y2 - cy), a = 3 + w;
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(Math.atan2(ty, tx));
          ctx.fillStyle = s.c1;
          ctx.beginPath();
          ctx.moveTo(a, 0);
          ctx.lineTo(-a * 0.8, -a * 0.7);
          ctx.lineTo(-a * 0.8, a * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      if (over.edgeKey) {
        const [a, b] = over.edgeKey.split("\0");
        const A = nodeBy.get(a), B = nodeBy.get(b);
        if (A && B) {
          const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y), [cx, cy] = ctrlPt(x1, y1, x2, y2);
          ctx.strokeStyle = style.labelStart;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 14;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cx, cy, x2, y2);
          ctx.stroke();
        }
      }
    }
    function drawWalker(now) {
      const steps = over.walk, dur = Math.max(4e3, steps.length * 1100), ph = now % dur / dur * steps.length;
      const i = Math.floor(ph), u = ph - i, st = steps[i];
      const p = lanePath(st, st.extra);
      if (!p) return;
      const [x1, y1, cx, cy, x2, y2] = p;
      const x = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, y = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2;
      ctx.save();
      ctx.translate(x, y - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = style.cursor;
      ctx.strokeStyle = style.labelBg;
      ctx.lineWidth = 1.5;
      const pth = new Path2D("M0,-9L7,2L3,2L3,8L-3,8L-3,2L-7,2Z");
      ctx.fill(pth);
      ctx.stroke(pth);
      ctx.restore();
    }
    function drawLabels(shown, lit) {
      const k = zr();
      const size = skin.labelSize || 14;
      const font = `${style.weight} ${size}px ${style.font}`;
      ctx.font = font;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const limit = Math.round(26 * view.density * Math.min(8, Math.max(1, Math.pow(k, 1.15)))) + (lit ? 24 : 0);
      const cands = shown.filter(([n]) => !lit || lit.has(n.title)).map(([n, x, y]) => [n, x, y, (n.title === cursor || n.title === hoverNode ? 1e9 : 0) + (over?.prio.get(n.title) || 0) + n.visits * (1 + 0.5 * (n.isStart ? 1 : 0))]).sort((p, q) => q[3] - p[3]);
      const placed = [];
      let count = 0;
      for (const [n, x, y] of cands) {
        if (count >= limit) break;
        const txt = style.upper ? n.title.toUpperCase() : n.title;
        const w = measure(txt, font), r = radius(n.visits) * Math.max(0.7, Math.min(2.2, Math.sqrt(k)));
        const box = [x + r + 4, y - size * 0.6, x + r + 6 + w, y + size * 0.6];
        if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
        placed.push(box);
        count++;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 4;
        ctx.strokeStyle = style.labelBg;
        ctx.strokeText(txt, box[0], y);
        ctx.fillStyle = n.isStart ? style.labelStart : style.label;
        ctx.fillText(txt, box[0], y);
      }
    }
    function animating() {
      return simLeft > 0 || !!cursor || skin.edge === "pulse" || !!(over?.walk && skin.walker);
    }
    let paused = false;
    function pause(p) {
      paused = p;
      if (!p) {
        dirty = true;
        kick();
      }
    }
    function frame(now) {
      raf = 0;
      if (paused) {
        simSlice();
        if (simLeft > 0) raf = requestAnimationFrame(frame);
        return;
      }
      simSlice();
      const interactive = now - lastInteract < 400 || simLeft > 0;
      if (dirty || animating() && (interactive || now - lastFrame > 33)) {
        const t0 = performance.now();
        draw(now);
        drawMs = drawMs * 0.8 + (performance.now() - t0) * 0.2;
        dirty = false;
        lastFrame = now;
      }
      if (animating() || dirty) raf = requestAnimationFrame(frame);
    }
    function kick() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function nodeAt(px, py) {
      if (!quad) return null;
      const x = lx(px), y = ly(py), rad = 16 / (T.k * Math.min(ax, ay));
      const n = quad.find(x, y, rad);
      if (!n || !visArticles.has(n.title)) return null;
      const r = radius(n.visits) * Math.max(0.7, Math.min(2.2, Math.sqrt(zr())));
      return Math.hypot(sx(n.x) - px, sy(n.y) - py) <= Math.max(7, r + 4) ? n : null;
    }
    function edgeAt(px, py) {
      let best = null, bd = 7;
      for (const d of drawn) {
        const minx = Math.min(d.x1, d.x2, d.cx) - 8, maxx = Math.max(d.x1, d.x2, d.cx) + 8, miny = Math.min(d.y1, d.y2, d.cy) - 8, maxy = Math.max(d.y1, d.y2, d.cy) + 8;
        if (px < minx || px > maxx || py < miny || py > maxy) continue;
        let px0 = d.x1, py0 = d.y1;
        for (let i = 1; i <= 14; i++) {
          const u = i / 14, x = (1 - u) ** 2 * d.x1 + 2 * (1 - u) * u * d.cx + u * u * d.x2, y = (1 - u) ** 2 * d.y1 + 2 * (1 - u) * u * d.cy + u * u * d.y2;
          const dist = segDist(px, py, px0, py0, x, y) - d.w / 2;
          if (dist < bd) {
            bd = dist;
            best = d.l;
          }
          px0 = x;
          py0 = y;
        }
      }
      return best;
    }
    function segDist(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L));
      return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
    }
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const zoom = d3.zoom().scaleExtent([0.08, 24]).filter((e) => {
      if (e.type === "wheel") return true;
      if (e.button || e.ctrlKey) return false;
      if (e.type === "mousedown" || e.type === "touchstart") return !nodeAt(...pos(e.touches?.[0] || e));
      return true;
    }).on("zoom", (e) => {
      T = e.transform;
      lastInteract = performance.now();
      dirty = true;
      kick();
    });
    const sel = d3.select(canvas).call(zoom).on("dblclick.zoom", null);
    let drag = null, suppressClick = false, hoverRaf = 0, lastMove = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      const [px, py] = pos(e), n = nodeAt(px, py);
      if (!n) return;
      drag = { n, px, py, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      const [px, py] = pos(e);
      if (drag) {
        if (Math.hypot(px - drag.px, py - drag.py) > 3) drag.moved = true;
        if (drag.moved) {
          drag.n.x = lx(px);
          drag.n.y = ly(py);
          drag.n.fx = drag.n.x;
          drag.n.fy = drag.n.y;
          lastInteract = performance.now();
          dirty = true;
          kick();
        }
        return;
      }
      lastMove = [px, py];
      if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        if (!lastMove) return;
        const n = nodeAt(...lastMove);
        const t = n ? n.title : null;
        const ed = t ? null : edgeAt(...lastMove);
        const ek = ed ? ed.key : null;
        if (t !== hoverNode) {
          hoverNode = t;
          handlers.onHover?.(t);
          dirty = true;
        }
        if (ek !== hoverEdge) {
          hoverEdge = ek;
          handlers.onEdgeHover?.(ed);
          dirty = true;
        }
        canvas.style.cursor = t || ek ? "pointer" : "";
        kick();
      });
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        suppressClick = true;
        d.n.fx = null;
        d.n.fy = null;
        posCache.set(d.n.title, { x: d.n.x, y: d.n.y });
        rebuildQuad();
        handlers.onSettled?.();
      }
    });
    canvas.addEventListener("pointerleave", () => {
      lastMove = null;
      if (hoverNode) {
        hoverNode = null;
        handlers.onHover?.(null);
      }
      if (hoverEdge) {
        hoverEdge = null;
        handlers.onEdgeHover?.(null);
      }
      dirty = true;
      kick();
    });
    canvas.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const [px, py] = pos(e), n = nodeAt(px, py);
      if (n) return handlers.onClick?.(n.title);
      const ed = edgeAt(px, py);
      if (ed) return handlers.onEdgeClick?.(ed);
      handlers.onBackground?.();
    });
    canvas.addEventListener("dblclick", (e) => {
      const n = nodeAt(...pos(e));
      if (n) handlers.onDblClick?.(n.title);
    });
    function setHighlight(spec) {
      if (!spec) {
        over = null;
        dirty = true;
        kick();
        return;
      }
      const paths = [...spec.paths || []].sort((p, q) => p.t - q.t);
      const perPair = /* @__PURE__ */ new Map(), segs = [];
      for (const p of paths) for (const sg of p.segs) {
        const pk = sg.from < sg.to ? sg.from + "\0" + sg.to : sg.to + "\0" + sg.from;
        const idx = perPair.get(pk) || 0;
        perPair.set(pk, idx + 1);
        segs.push({ ...sg, pk, idx, rec: p.rec, trailId: p.trailId });
      }
      for (const sg of segs) {
        const n = perPair.get(sg.pk);
        sg.extra = (sg.idx - (n - 1) / 2) * Math.min(4, 24 / n);
        sg.c0 = rampColor(sg.p0, spec.mode);
        sg.c1 = rampColor(sg.p1, spec.mode);
      }
      const nodes2 = /* @__PURE__ */ new Set(), starts = /* @__PURE__ */ new Set(), ends = /* @__PURE__ */ new Set(), prio = /* @__PURE__ */ new Map();
      for (const p of spec.paths || []) {
        if (!p.segs.length) continue;
        const froms = new Set(p.segs.map((sg) => sg.from)), tos = new Set(p.segs.map((sg) => sg.to));
        for (const sg of p.segs) {
          nodes2.add(sg.from);
          nodes2.add(sg.to);
          if (!tos.has(sg.from)) starts.add(sg.from);
          if (!froms.has(sg.to)) ends.add(sg.to);
        }
      }
      if (spec.anchor) nodes2.add(spec.anchor);
      if (spec.edgeKey) for (const t of spec.edgeKey.split("\0")) nodes2.add(t);
      for (const t of starts) prio.set(t, 1e6);
      for (const t of ends) prio.set(t, (prio.get(t) || 0) + 1e5);
      if (spec.anchor) prio.set(spec.anchor, 1e9);
      over = { ...spec, spec, segs, nodes: nodes2, starts, ends, prio, walk: spec.mode === "trail" ? [...segs].sort((p, q) => p.p0 - q.p0) : null };
      dirty = true;
      kick();
    }
    function setCursor2(t) {
      cursor = t;
      dirty = true;
      kick();
    }
    function readStyle() {
      const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
      style.link = v("--link", style.link);
      style.label = v("--label", style.label);
      style.labelBg = v("--label-bg", style.labelBg);
      style.labelStart = v("--label-start", style.labelStart);
      style.cursor = v("--cursor", style.cursor);
      style.font = v("--font-label", "monospace");
      style.weight = v("--label-weight", "400");
      style.upper = v("--label-case", "none") === "uppercase";
      style.before = v("--path-before", "#4da3ff");
      style.after = v("--path-after", style.cursor);
    }
    function setPalette(s) {
      skin = { shape: "square", hollow: false, glow: true, edge: "plain", bend: 0.12, labelSize: 14, walker: false, ...s };
      HUB = d3.interpolateRgbBasis(s.hub);
      TRAIL_COLORS.splice(0, TRAIL_COLORS.length, ...s.trails);
      readStyle();
      if (over) setHighlight(over.spec);
      dirty = true;
      kick();
      document.fonts?.ready.then(() => {
        textW.clear();
        dirty = true;
        kick();
      });
    }
    function setView(v) {
      Object.assign(view, v);
      if ("fade" in v) rescore();
      dirty = true;
      kick();
    }
    function bbox(list) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of list) {
        if (n.x < x0) x0 = n.x;
        if (n.x > x1) x1 = n.x;
        if (n.y < y0) y0 = n.y;
        if (n.y > y1) y1 = n.y;
      }
      return x0 <= x1 ? [x0, y0, x1, y1] : null;
    }
    function coreBox(list) {
      if (list.length < 150) return bbox(list);
      const top = [...list].sort((p, q2) => q2.visits - p.visits).slice(0, Math.max(120, Math.round(list.length * 0.25)));
      list = top;
      const xs = list.map((n) => n.x).sort((p, q2) => p - q2), ys = list.map((n) => n.y).sort((p, q2) => p - q2);
      const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
      return [q(xs, 0.01), q(ys, 0.01), q(xs, 0.99), q(ys, 0.99)];
    }
    function fit(animate = true) {
      const b = coreBox(visNodes.length ? visNodes : nodes);
      if (!b) return;
      const padX = 70, padY = 40, vw = Math.max(50, W - padX * 2 - 60), vh = Math.max(50, H - padY * 2);
      let bw = b[2] - b[0], bh = b[3] - b[1];
      if (bw < 240) {
        b[0] -= (240 - bw) / 2;
        b[2] += (240 - bw) / 2;
        bw = 240;
      }
      if (bh < 160) {
        b[1] -= (160 - bh) / 2;
        b[3] += (160 - bh) / 2;
        bh = 160;
      }
      const want = vw / vh / (bw / bh);
      const maxStretch = visNodes.length < 30 ? 1 : visNodes.length < 120 ? 1.6 : 2.4;
      if (want >= 1) {
        ax = Math.min(maxStretch, want);
        ay = 1;
      } else {
        ax = 1;
        ay = Math.min(maxStretch, 1 / want);
      }
      const k = Math.max(0.08, Math.min(24, Math.min(vw / (bw * ax), vh / (bh * ay))));
      kFit = k;
      const t = d3.zoomIdentity.translate(W / 2 - 30 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
      (animate ? sel.transition().duration(550) : sel).call(zoom.transform, t);
    }
    function focusOn(titles, padLeft = 0) {
      const list = [...titles].map((t2) => nodeBy.get(t2)).filter(Boolean);
      if (!list.length) return;
      const b = bbox(list), vw = Math.max(150, W - padLeft - 220), vh = Math.max(100, H - 120);
      const bw = Math.max(40, b[2] - b[0]), bh = Math.max(40, b[3] - b[1]);
      const k = Math.max(0.15, Math.min(6, Math.min(vw / (bw * ax), vh / (bh * ay))));
      const t = d3.zoomIdentity.translate(padLeft + (W - padLeft) / 2 - 40 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
      sel.transition().duration(600).call(zoom.transform, t);
    }
    function reveal(titles) {
      const list = [...titles].map((t2) => nodeBy.get(t2)).filter((n) => n && Number.isFinite(n.x));
      if (!list.length) return;
      const m = 50, mR = 160;
      if (!list.some((n) => {
        const x = sx(n.x), y = sy(n.y);
        return x < m || x > W - mR || y < m || y > H - m;
      })) return;
      let x0 = (m - T.x) / (T.k * ax), x1 = (W - mR - T.x) / (T.k * ax), y0 = (m - T.y) / (T.k * ay), y1 = (H - m - T.y) / (T.k * ay);
      for (const n of list) {
        x0 = Math.min(x0, n.x);
        x1 = Math.max(x1, n.x);
        y0 = Math.min(y0, n.y);
        y1 = Math.max(y1, n.y);
      }
      const k = Math.max(0.08, Math.min(T.k, (W - m - mR) / ((x1 - x0) * ax), (H - 2 * m) / ((y1 - y0) * ay)));
      const t = d3.zoomIdentity.translate(m + (W - m - mR) / 2 - k * ax * (x0 + x1) / 2, H / 2 - k * ay * (y0 + y1) / 2).scale(k);
      sel.transition().duration(500).call(zoom.transform, t);
    }
    function settleAndFit() {
      if (simLeft > 0 && nodes.length < 400) {
        while (simLeft > 0) {
          sim.tick();
          simLeft--;
        }
        simSlice(0);
      }
      fit(false);
    }
    function ensureVisible(title) {
      const n = nodeBy.get(title);
      if (!n) return;
      const x = sx(n.x), y = sy(n.y), m = 70;
      if (x > m && x < W - m && y > m && y < H - m) return;
      const dx = x < m ? m + 40 - x : x > W - m ? W - m - 40 - x : 0;
      const dy = y < m ? m + 40 - y : y > H - m ? H - m - 40 - y : 0;
      sel.transition().duration(450).call(zoom.transform, T.translate(dx / T.k, dy / T.k));
    }
    function getPositions() {
      const out = {};
      for (const n of nodes) if (Number.isFinite(n.x)) out[n.title] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
      return out;
    }
    function reset() {
      posCache.clear();
      nodeBy = /* @__PURE__ */ new Map();
      nodes = [];
    }
    function relayout() {
      posCache.clear();
      for (const n of nodes) {
        n.fx = n.fy = null;
        n.x += (Math.random() - 0.5) * 2;
      }
      pinnedFresh = false;
      runSim(1, Math.min(300, 140 + nodes.length / 10));
    }
    function neighbourhood(title, hops = 1) {
      const s = /* @__PURE__ */ new Set([title]);
      let frontier = [title];
      for (let h = 0; h < hops; h++) {
        const next = [];
        for (const t of frontier) for (const m of adj.get(t) || []) if (!s.has(m)) {
          s.add(m);
          next.push(m);
        }
        frontier = next;
      }
      return s;
    }
    resize();
    return {
      pause,
      zoomBy: (f) => sel.transition().duration(250).call(zoom.scaleBy, f),
      ensureVisible,
      nodeCount: () => nodes.length,
      update,
      reset,
      setVisible,
      setPalette,
      setHighlight,
      setCursor: setCursor2,
      setView,
      fit,
      focusOn,
      reveal,
      settleAndFit,
      getPositions,
      relayout,
      neighbourhood,
      screenOf: (t) => {
        const n = nodeBy.get(t);
        return n ? [sx(n.x), sy(n.y)] : null;
      },
      edgeMid: (i = 0) => {
        const d = drawn[i];
        if (!d) return null;
        const u = 0.5;
        return [(1 - u) ** 2 * d.x1 + 2 * (1 - u) * u * d.cx + u * u * d.x2, (1 - u) ** 2 * d.y1 + 2 * (1 - u) * u * d.cy + u * u * d.y2];
      },
      hasNode: (t) => nodeBy.has(t),
      isSettling: () => simLeft > 0,
      drawMs: () => Math.round(drawMs * 10) / 10,
      stats: () => ({ nodes: visNodes.length, links: sorted.length, drawn: drawn.length })
    };
  }

  // src/views/effects.js
  var rand = (a, b) => a + Math.random() * (b - a);
  function createEffects(canvas) {
    const ctx = canvas.getContext("2d");
    let fx3 = { type: "none" }, parts = [], w = 0, h = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      draw(performance.now());
    }
    new ResizeObserver(resize).observe(canvas);
    function seed() {
      const n = (k) => Math.round(k * (w * h) / (1e3 * 700));
      switch (fx3.type) {
        case "stars":
        case "nebula":
          parts = Array.from({ length: n(fx3.type === "nebula" ? 260 : 170) }, () => ({ x: rand(0, w), y: rand(0, h), s: Math.random() < 0.12 ? 2 : 1, p: rand(0, 6.3), v: rand(0.4, 1.6), c: Math.random() < 0.25 ? fx3.c2 : fx3.c1 }));
          break;
        case "rain":
          parts = Array.from({ length: n(150) }, () => ({ x: rand(0, w), y: rand(-h, h), l: rand(8, 26), v: rand(260, 520), c: Math.random() < 0.2 ? fx3.c2 : fx3.c1 }));
          break;
        case "bubbles":
          parts = Array.from({ length: n(45) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(3, 16), v: rand(12, 40), p: rand(0, 6.3) }));
          break;
        case "sparkles":
          parts = Array.from({ length: n(34) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(4, 11), p: rand(0, 6.3), v: rand(0.6, 1.4), c: Math.random() < 0.5 ? fx3.c1 : fx3.c2 }));
          break;
        case "dust":
          parts = Array.from({ length: n(80) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(0.8, 2.8), vx: rand(-6, 6), vy: rand(-5, 3), a: rand(0.08, 0.3) }));
          break;
        case "matrix":
          parts = Array.from({ length: Math.ceil(w / 18) }, (_, i) => ({ x: i * 18 + 4, y: rand(-h, h), v: rand(30, 90), on: Math.random() < 0.35 }));
          break;
        case "clouds":
          parts = Array.from({ length: 7 }, () => ({ x: rand(-200, w), y: rand(0, h), rx: rand(70, 160), ry: rand(30, 60), v: rand(6, 16) }));
          break;
        default:
          parts = [];
      }
    }
    function draw(now) {
      const t = (now - t0) / 1e3;
      ctx.clearRect(0, 0, w, h);
      const c1 = fx3.c1 || "#fff", c2 = fx3.c2 || c1;
      switch (fx3.type) {
        case "nebula": {
          for (const [x, y, r, c, a] of [[0.25, 0.3, 0.55, c2, 0.16], [0.75, 0.65, 0.5, c1, 0.12], [0.55, 0.15, 0.35, fx3.c3 || c2, 0.1]]) {
            const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
            g.addColorStop(0, hexA(c, a));
            g.addColorStop(1, hexA(c, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
          }
        }
        // falls through to the stars
        case "stars":
          for (const s of parts) {
            ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(t * s.v + s.p));
            ctx.fillStyle = s.c;
            ctx.fillRect(s.x, s.y, s.s, s.s);
          }
          ctx.globalAlpha = 1;
          break;
        case "rain":
          ctx.lineWidth = 1;
          for (const d of parts) {
            d.y += d.v / 30;
            if (d.y > h) {
              d.y = -d.l;
              d.x = rand(0, w);
            }
            ctx.strokeStyle = hexA(d.c, 0.35);
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x - 2, d.y + d.l);
            ctx.stroke();
          }
          break;
        case "radar": {
          const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2, a = t * 0.9 % (Math.PI * 2);
          ctx.strokeStyle = hexA(c1, 0.1);
          ctx.lineWidth = 1;
          for (let r = 80; r < R; r += 80) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 7);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(0, cy);
          ctx.lineTo(w, cy);
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, h);
          ctx.stroke();
          if (ctx.createConicGradient) {
            const g = ctx.createConicGradient(a - 0.7, cx, cy);
            g.addColorStop(0, hexA(c1, 0));
            g.addColorStop(0.07, hexA(c1, 0.13));
            g.addColorStop(0.072, hexA(c1, 0));
            g.addColorStop(1, hexA(c1, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
          }
          ctx.strokeStyle = hexA(c1, 0.5);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          ctx.stroke();
          break;
        }
        case "grid": {
          const hy = h * 0.64;
          const sun = ctx.createLinearGradient(0, hy - h * 0.3, 0, hy);
          sun.addColorStop(0, fx3.c3 || "#ffcf3f");
          sun.addColorStop(1, c2);
          ctx.save();
          ctx.beginPath();
          ctx.arc(w / 2, hy, h * 0.2, Math.PI, 0);
          ctx.closePath();
          ctx.clip();
          ctx.fillStyle = sun;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = "destination-out";
          for (let i = 0; i < 7; i++) {
            const yy = hy - i * i * 2.2 - 4;
            ctx.fillRect(0, yy, w, 1.5 + i * 0.6);
          }
          ctx.restore();
          ctx.strokeStyle = hexA(c1, 0.55);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, hy);
          ctx.lineTo(w, hy);
          ctx.stroke();
          for (let i = -24; i <= 24; i++) {
            ctx.beginPath();
            ctx.moveTo(w / 2 + i * 14, hy);
            ctx.lineTo(w / 2 + i * w * 0.12, h);
            ctx.stroke();
          }
          const off = t * 0.35 % 1;
          for (let i = 0; i < 14; i++) {
            const z = (i + off) / 14, y = hy + (h - hy) * z * z;
            ctx.globalAlpha = z;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case "bubbles":
          for (const b of parts) {
            b.y -= b.v / 30;
            b.x += Math.sin(t + b.p) * 0.3;
            if (b.y < -20) {
              b.y = h + 20;
              b.x = rand(0, w);
            }
            ctx.strokeStyle = hexA(c1, 0.55);
            ctx.fillStyle = hexA(c1, 0.08);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, 7);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = hexA("#ffffff", 0.7);
            ctx.beginPath();
            ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, 0, 7);
            ctx.fill();
          }
          break;
        case "sparkles":
          for (const s of parts) {
            const k = Math.max(0, Math.sin(t * s.v + s.p));
            if (k < 0.05) {
              if (Math.random() < 0.02) {
                s.x = rand(0, w);
                s.y = rand(0, h);
              }
              continue;
            }
            const r = s.r * k;
            ctx.fillStyle = hexA(s.c, 0.85 * k);
            ctx.beginPath();
            ctx.moveTo(s.x, s.y - r);
            ctx.quadraticCurveTo(s.x, s.y, s.x + r, s.y);
            ctx.quadraticCurveTo(s.x, s.y, s.x, s.y + r);
            ctx.quadraticCurveTo(s.x, s.y, s.x - r, s.y);
            ctx.quadraticCurveTo(s.x, s.y, s.x, s.y - r);
            ctx.fill();
          }
          break;
        case "dust":
          for (const d of parts) {
            d.x += d.vx / 30;
            d.y += d.vy / 30;
            if (d.x < -5) d.x = w + 5;
            if (d.x > w + 5) d.x = -5;
            if (d.y < -5) d.y = h + 5;
            if (d.y > h + 5) d.y = -5;
            ctx.fillStyle = hexA(c1, d.a);
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, 7);
            ctx.fill();
          }
          break;
        case "matrix":
          ctx.font = '12px "JetBrains Mono", monospace';
          for (const c of parts) {
            if (!c.on) continue;
            c.y += c.v / 30;
            if (c.y > h + 200) {
              c.y = rand(-200, 0);
              c.on = Math.random() < 0.5;
            }
            for (let k = 0; k < 10; k++) {
              ctx.fillStyle = hexA(c1, 0.16 * (1 - k / 10));
              ctx.fillText(((c.x * 7 + k * 13 + Math.floor(t * 4)) % 10).toString(), c.x, c.y - k * 14);
            }
          }
          if (Math.random() < 0.01) {
            for (const c of parts) if (!c.on && Math.random() < 0.1) c.on = true;
          }
          break;
        case "scan": {
          const y = t * 60 % (h + 80) - 40;
          const g = ctx.createLinearGradient(0, y - 40, 0, y + 4);
          g.addColorStop(0, hexA(c1, 0));
          g.addColorStop(1, hexA(c1, 0.14));
          ctx.fillStyle = g;
          ctx.fillRect(0, y - 40, w, 44);
          break;
        }
        case "vhs": {
          const y = t * 40 % (h + 120) - 60;
          ctx.fillStyle = hexA(c1, 0.06);
          ctx.fillRect(0, y, w, 50);
          if (t % 5 < 0.25) for (let i = 0; i < 6; i++) {
            ctx.fillStyle = hexA(i % 2 ? c1 : c2, 0.18);
            ctx.fillRect(rand(-40, 0), rand(0, h), w + 40, rand(2, 7));
          }
          break;
        }
        case "clouds":
          for (const c of parts) {
            c.x += c.v / 30;
            if (c.x - c.rx > w) {
              c.x = -c.rx * 2;
              c.y = rand(0, h);
            }
            ctx.fillStyle = hexA(c1, 0.1);
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, 7);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(c.x + c.rx * 0.5, c.y - c.ry * 0.4, c.rx * 0.6, c.ry * 0.8, 0, 0, 7);
            ctx.fill();
          }
          break;
      }
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now);
    }
    function start() {
      cancelAnimationFrame(raf);
      if (fx3.type !== "none" && !reduced && !document.hidden) raf = requestAnimationFrame(loop);
    }
    document.addEventListener("visibilitychange", start);
    return {
      set(next) {
        fx3 = next && next.type ? next : { type: "none" };
        resize();
        start();
      }
    };
  }
  function hexA(c, a) {
    if (!c) return `rgba(255,255,255,${a})`;
    if (c.startsWith("#")) {
      let x = c.slice(1);
      if (x.length === 3) x = [...x].map((ch) => ch + ch).join("");
      const n = parseInt(x.slice(0, 6), 16);
      return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    }
    return c;
  }

  // src/skins.js
  var VGA = ["#ffff55", "#55ffff", "#ff55ff", "#ff5555", "#55ff55", "#ffaa00", "#7f7fff", "#ffffff", "#ff9ecf", "#aaff00"];
  var CATS = [
    ["plain", "Plain"],
    ["retro", "Retro computing"],
    ["future", "Futuristic"],
    ["ai", "AI"],
    ["y2k", "Millennium / Y2K"],
    ["console", "90s console games"],
    ["synth", "Synthwave"],
    ["minimal", "Minimal"]
  ];
  var SKINS = [
    {
      id: "plain",
      name: "Plain",
      cat: "plain",
      blurb: "Clean and quiet. Follows your light or dark setting.",
      chrome: "flat",
      hub: ["#d3d8e0", "#a3adbd", "#6b778b", "#38404d"],
      trails: ["#2f6fdb", "#e07a2f", "#2a9d8f", "#d1495b", "#8e6cc9", "#c79a1c", "#3d8b40", "#d4628f", "#5d6b7a", "#b5651d"],
      dark: { hub: ["#3b404a", "#5d6576", "#8f99ab", "#d9dee7"], trails: ["#7aa2f7", "#f0a35e", "#4fd1c5", "#f2777a", "#b794f6", "#ecc94b", "#68d391", "#f687b3", "#a0aec0", "#ed8936"] },
      shape: "circle",
      glow: false,
      bend: 0.12,
      labelSize: 12.5,
      sound: { wave: "sine", f: 880 }
    },
    // ---------------- retro computing ----------------
    {
      id: "desktop95",
      name: "Desktop 95",
      cat: "retro",
      blurb: "Beveled windows and a green phosphor CRT.",
      chrome: "bevel",
      hub: ["#1d6b36", "#2fd35a", "#a8ff4d", "#ffe14d", "#ffaa00"],
      trails: VGA,
      shape: "square",
      sound: { wave: "square", f: 880 }
    },
    {
      id: "mono91",
      name: "Mono '91",
      cat: "retro",
      blurb: "1-bit black & white desktop with pinstripe title bars.",
      chrome: "onebit",
      hub: ["#bbbbbb", "#777777", "#000000"],
      trails: ["#dd0806", "#0000d4", "#1fb714", "#f20884", "#ff6403", "#4700a5", "#02abea", "#562c05", "#c9a400", "#90713a"],
      shape: "square",
      glow: false,
      sound: { wave: "sine", f: 660 }
    },
    {
      id: "amber",
      name: "Amber Terminal",
      cat: "retro",
      blurb: "A DOS box in warm amber with double-line borders.",
      chrome: "terminal",
      hub: ["#5a3a00", "#b37400", "#ffb000", "#ffd27a", "#fff2cc"],
      trails: ["#ffffff", "#ff5f1f", "#ffe066", "#7fff00", "#00e5ff", "#ff4fd8", "#ffb000", "#ff9e80", "#b2ff59", "#80d8ff"],
      shape: "square",
      sound: { wave: "square", f: 440 }
    },
    {
      id: "vector",
      name: "Vector Arcade",
      cat: "retro",
      blurb: "1979 vector monitor: glowing lines, hollow ships, a high score.",
      chrome: "terminal",
      hub: ["#3d7a8a", "#7cf9ff", "#ffffff"],
      trails: ["#ff5ad6", "#7cf9ff", "#ffff66", "#66ff99", "#ff7a5c", "#b48cff", "#ffffff", "#5cc8ff", "#ffb35c", "#c8ff5c"],
      shape: "tri",
      hollow: true,
      bend: 0,
      labelSize: 13,
      fx: { type: "stars", c1: "#cfefff", c2: "#ff5ad6" },
      sound: { wave: "square", f: 660 }
    },
    {
      id: "teletext",
      name: "Teletext",
      cat: "retro",
      blurb: "Chunky 8-colour TV text pages and a news ticker.",
      chrome: "terminal",
      hub: ["#0000ff", "#00ffff", "#00ff00", "#ffff00", "#ff0000"],
      trails: ["#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff", "#ff0000", "#00ff00", "#ffff00"],
      shape: "square",
      edge: "blocks",
      bend: 0,
      glow: false,
      labelSize: 14,
      sound: { wave: "square", f: 990 }
    },
    {
      id: "homecomputer",
      name: "8-bit Home",
      cat: "retro",
      blurb: "Blue-on-blue 8-bit home computer with tape-loading stripes.",
      chrome: "flat",
      hub: ["#6c5eb5", "#a59cf2", "#eeee77", "#ffffff"],
      trails: ["#eeee77", "#ff7777", "#77ff77", "#77ddff", "#ffaa55", "#ff77ff", "#ffffff", "#bbbbbb", "#aaffee", "#ffcc99"],
      shape: "square",
      glow: false,
      labelSize: 9,
      sound: { wave: "triangle", f: 520 }
    },
    // ---------------- futuristic ----------------
    {
      id: "holo",
      name: "Holo HUD",
      cat: "future",
      blurb: "Translucent sci-fi cockpit with a radar sweep.",
      chrome: "neon",
      hub: ["#0b5e6e", "#1fb8c9", "#4df3ff", "#e6fdff"],
      trails: ["#ffcf4d", "#4df3ff", "#ff6b9d", "#7dff9a", "#b18cff", "#ff9a4d", "#ffffff", "#4dd2ff", "#e6ff4d", "#ff4d4d"],
      shape: "hex",
      hollow: true,
      fx: { type: "radar", c1: "#4df3ff" },
      labelSize: 13,
      sound: { wave: "sine", f: 1320 }
    },
    {
      id: "starchart",
      name: "Star Chart",
      cat: "future",
      blurb: "Articles are stars, trails are constellations.",
      chrome: "flat",
      hub: ["#6a7fdb", "#a9c1ff", "#ffffff", "#ffe7a3"],
      trails: ["#ffe7a3", "#8fd3ff", "#ff9fd2", "#a7ffb5", "#c3a6ff", "#ffb38a", "#ffffff", "#7fe0ff", "#fff59d", "#ff8a8a"],
      shape: "star",
      bend: 0,
      fx: { type: "nebula", c1: "#7b5cff", c2: "#2d9bff", c3: "#ff5cc8" },
      sound: { wave: "sine", f: 784 }
    },
    {
      id: "bioneural",
      name: "Bio-Neural",
      cat: "future",
      blurb: "The brain, literally: organic curves and travelling signals.",
      chrome: "flat",
      hub: ["#3a0d4d", "#7b2cbf", "#c77dff", "#ff9de2", "#ffffff"],
      trails: ["#7df9d8", "#ff9de2", "#ffd36e", "#8ab4ff", "#c77dff", "#ff7a8a", "#b5ff7d", "#ffffff", "#7dd3ff", "#ffb37d"],
      shape: "circle",
      edge: "pulse",
      glow: false,
      bend: 0.28,
      fx: { type: "dust", c1: "#c77dff" },
      sound: { wave: "sine", f: 392 }
    },
    // ---------------- AI ----------------
    {
      id: "latent",
      name: "Latent Space",
      cat: "ai",
      blurb: "Calm AI-lab look: an embedding plot in soft pastels.",
      chrome: "flat",
      hub: ["#c9d6ff", "#9fb4ff", "#7c6cf0", "#f08cae", "#f5b76c"],
      trails: ["#6d5df5", "#f0568c", "#18a999", "#f5a524", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6", "#64748b", "#84cc16"],
      shape: "circle",
      glow: false,
      bend: 0.1,
      labelSize: 13,
      fx: { type: "dust", c1: "#6d5df5" },
      sound: { wave: "sine", f: 1046 }
    },
    {
      id: "training",
      name: "Training Run",
      cat: "ai",
      blurb: "A dark ML dashboard: epochs, steps and a falling loss.",
      chrome: "flat",
      hub: ["#1f6feb", "#58a6ff", "#3fb950", "#d2a8ff"],
      trails: ["#3fb950", "#58a6ff", "#d2a8ff", "#f0883e", "#ff7b72", "#79c0ff", "#e3b341", "#56d4dd", "#a5d6ff", "#7ee787"],
      shape: "circle",
      glow: false,
      labelSize: 12,
      fx: { type: "matrix", c1: "#3fb950" },
      sound: { wave: "triangle", f: 1200 }
    },
    {
      id: "sentinel",
      name: "Sentinel",
      cat: "ai",
      blurb: "A calm machine watches you browse. Its red eye follows you.",
      chrome: "flat",
      hub: ["#4a0000", "#a31515", "#ff3b3b", "#ffb3b3"],
      trails: ["#ff3b3b", "#ffffff", "#ff8a3b", "#ffd23b", "#ff3bb5", "#b53bff", "#3bd8ff", "#ff6b6b", "#ffb3b3", "#e0e0e0"],
      shape: "circle",
      hollow: true,
      fx: { type: "scan", c1: "#ff3b3b" },
      sound: { wave: "sine", f: 220 }
    },
    // ---------------- millennium ----------------
    {
      id: "aqua",
      name: "Aqua Bubble",
      cat: "y2k",
      blurb: "Glossy gel buttons, sky blue and rising bubbles.",
      chrome: "gloss",
      hub: ["#9fd3ff", "#4aa3ff", "#1f6fd1", "#ff8a00"],
      trails: ["#ff8a00", "#1f6fd1", "#18b24a", "#e0245e", "#8e44ad", "#00a3a3", "#f1c40f", "#34495e", "#d35400", "#2ecc71"],
      shape: "circle",
      glow: false,
      labelSize: 13,
      fx: { type: "bubbles", c1: "#ffffff" },
      sound: { wave: "sine", f: 1568 }
    },
    {
      id: "chrome",
      name: "Y2K Chrome",
      cat: "y2k",
      blurb: "Liquid silver, iridescent sparkles and a millennium countdown.",
      chrome: "gloss",
      hub: ["#7ef9ff", "#b388ff", "#ff8ad8", "#fff59d", "#ffffff"],
      trails: ["#7ef9ff", "#ff8ad8", "#fff59d", "#b388ff", "#69f0ae", "#ff9e80", "#ffffff", "#84ffff", "#ea80fc", "#ffd180"],
      shape: "spark",
      fx: { type: "sparkles", c1: "#ffffff", c2: "#b388ff" },
      sound: { wave: "triangle", f: 1760 }
    },
    {
      id: "geocities",
      name: "GeoCities",
      cat: "y2k",
      blurb: "Starfield tiles, rainbow bars, a hit counter. Sign my guestbook!",
      chrome: "bevel",
      hub: ["#00ffff", "#00ff00", "#ffff00", "#ff00ff"],
      trails: ["#ff00ff", "#00ff00", "#ffff00", "#00ffff", "#ff0000", "#ff9900", "#ffffff", "#0099ff", "#99ff00", "#ff66cc"],
      shape: "star",
      glow: false,
      fx: { type: "stars", c1: "#ffffff", c2: "#ffff00" },
      sound: { wave: "square", f: 1200 }
    },
    {
      id: "mediaplayer",
      name: "Media Player",
      cat: "y2k",
      blurb: "Oddly shaped player skin with a green LCD. Trails are tracks.",
      chrome: "gloss",
      hub: ["#00662a", "#00cc55", "#00ff66", "#ffcc00"],
      trails: ["#ffcc00", "#00ff66", "#ff5c5c", "#5cc8ff", "#ff9a00", "#c77dff", "#ffffff", "#a8ff60", "#ff7ad9", "#60ffe0"],
      shape: "circle",
      labelSize: 16,
      sound: { wave: "sawtooth", f: 660 }
    },
    // ---------------- console ----------------
    {
      id: "rpg16",
      name: "16-bit RPG",
      cat: "console",
      blurb: "Blue dialog boxes, a \u25B6 cursor, quests and XP.",
      chrome: "console",
      hub: ["#3048d8", "#7f8cff", "#ffffff", "#ffe14d"],
      trails: ["#ffe14d", "#ff6b6b", "#6bff9a", "#6bd4ff", "#ff9a3b", "#d68bff", "#ffffff", "#ffb3e6", "#b3ff6b", "#3bffd8"],
      shape: "diamond",
      sound: { wave: "square", f: 988 }
    },
    {
      id: "handheld",
      name: "Handheld '89",
      cat: "console",
      blurb: "Four shades of green on a dot-matrix screen.",
      chrome: "console",
      hub: ["#8bac0f", "#306230", "#0f380f"],
      trails: ["#0f380f", "#8e2a5c", "#2d4fb3", "#9a5b00", "#306230", "#5c2a8e", "#1f6f6f", "#7a1f1f", "#3b3b3b", "#4f6f00"],
      shape: "square",
      glow: false,
      labelSize: 9,
      sound: { wave: "square", f: 1046 }
    },
    {
      id: "polygon",
      name: "Polygon Era",
      cat: "console",
      blurb: "Late-90s 3D: wobbly polygons and memory cards.",
      chrome: "console",
      hub: ["#3a3fd8", "#8fa0ff", "#ff5a5a", "#ffcf3f"],
      trails: ["#ffcf3f", "#ff5a5a", "#5ad8ff", "#7dff7d", "#ff8aff", "#ff9a3f", "#ffffff", "#b38aff", "#3fffd2", "#d8ff3f"],
      shape: "tri",
      glow: false,
      sound: { wave: "triangle", f: 740 }
    },
    {
      id: "fighter",
      name: "Fighter Select",
      cat: "console",
      blurb: "Trails as a character-select grid. Hover = VS splash.",
      chrome: "console",
      hub: ["#7a3d00", "#ff7a00", "#ffde00", "#ff1e1e"],
      trails: ["#ffde00", "#ff1e1e", "#1ea0ff", "#1eff6a", "#ff7a00", "#c81eff", "#ffffff", "#ff1e9a", "#1effe0", "#a0ff1e"],
      shape: "square",
      labelSize: 12,
      sound: { wave: "sawtooth", f: 330 }
    },
    {
      id: "overworld",
      name: "Overworld Map",
      cat: "console",
      blurb: "Levels on a grassy map, dotted paths, a walking marker.",
      chrome: "console",
      hub: ["#e74c3c", "#f39c12", "#ffe14d"],
      trails: ["#e74c3c", "#2980b9", "#8e44ad", "#d35400", "#16a085", "#c0392b", "#2c3e50", "#f1c40f", "#27ae60", "#e84393"],
      shape: "circle",
      glow: false,
      edge: "dotted",
      walker: true,
      fx: { type: "clouds", c1: "#0b3d0b" },
      sound: { wave: "square", f: 1318 }
    },
    // ---------------- synthwave ----------------
    {
      id: "outrun",
      name: "Outrun Sunset",
      cat: "synth",
      blurb: "Neon pink sunset over an endless grid.",
      chrome: "neon",
      hub: ["#5a189a", "#9d4edd", "#ff2fd0", "#ff6c11", "#fff200"],
      trails: ["#2de2e6", "#ff2fd0", "#fff200", "#ff6c11", "#00ff9f", "#ff3864", "#b388ff", "#ffffff", "#7df9ff", "#f9c80e"],
      shape: "diamond",
      fx: { type: "grid", c1: "#ff2fd0", c2: "#ff2a6d", c3: "#ffcf3f" },
      sound: { wave: "sawtooth", f: 440 }
    },
    {
      id: "vaporwave",
      name: "Vaporwave",
      cat: "synth",
      blurb: "Pastel \uFF50\uFF49\uFF4E\uFF4B \uFF41\uFF4E\uFF44 \uFF54\uFF45\uFF41\uFF4C, 98-style dialogs, VHS glitches.",
      chrome: "bevel",
      hub: ["#b967ff", "#ff71ce", "#01cdfe", "#05ffa1", "#fffb96"],
      trails: ["#05ffa1", "#ff71ce", "#fffb96", "#01cdfe", "#b967ff", "#ff9a8b", "#ffffff", "#9bf6ff", "#ffc6ff", "#caffbf"],
      shape: "diamond",
      fx: { type: "vhs", c1: "#ff71ce", c2: "#01cdfe" },
      sound: { wave: "sine", f: 523 }
    },
    {
      id: "neonrain",
      name: "Neon Rain",
      cat: "synth",
      blurb: "Cyberpunk hazard tape, glitchy titles and neon rain.",
      chrome: "neon",
      hub: ["#ff003c", "#ff6b00", "#fcee0a", "#00f0ff"],
      trails: ["#fcee0a", "#00f0ff", "#ff003c", "#ff6bff", "#00ff9c", "#ff9a00", "#ffffff", "#9a7bff", "#5cffe9", "#ffd000"],
      shape: "diamond",
      fx: { type: "rain", c1: "#00f0ff", c2: "#ff003c" },
      sound: { wave: "sawtooth", f: 880 }
    },
    // ---------------- minimal ----------------
    {
      id: "swiss",
      name: "Swiss Paper",
      cat: "minimal",
      blurb: "White paper, black rules, one red accent. Straight lines only.",
      chrome: "flat",
      hub: ["#bbbbbb", "#555555", "#111111", "#e30613"],
      trails: ["#e30613", "#111111", "#0057b8", "#f2a900", "#00875a", "#7a3e9d", "#d9480f", "#495057", "#0b7285", "#5c940d"],
      shape: "circle",
      glow: false,
      bend: 0,
      labelSize: 12,
      sound: { wave: "sine", f: 880 }
    },
    {
      id: "midnight",
      name: "Midnight Mono",
      cat: "minimal",
      blurb: "Quiet dark mode: thin lines, soft greys, no noise.",
      chrome: "flat",
      hub: ["#3f3f46", "#71717a", "#d4d4d8", "#ffffff"],
      trails: ["#9b8afb", "#5eead4", "#fda4af", "#fcd34d", "#93c5fd", "#c4b5fd", "#86efac", "#fdba74", "#f9a8d4", "#a5b4fc"],
      shape: "circle",
      glow: false,
      bend: 0.1,
      labelSize: 12,
      sound: { wave: "sine", f: 660 }
    },
    {
      id: "zen",
      name: "Zen Ink",
      cat: "minimal",
      blurb: "Sumi ink on rice paper with a red seal.",
      chrome: "flat",
      hub: ["#c9c1ae", "#7d776a", "#1b1a17"],
      trails: ["#b7282e", "#1b1a17", "#2b4c7e", "#4f6b3a", "#8a5a2b", "#5b3f74", "#c2703d", "#3f6e6e", "#7a7a7a", "#9c2f5a"],
      shape: "circle",
      glow: false,
      bend: 0.22,
      labelSize: 14,
      sound: { wave: "sine", f: 330 }
    }
  ];
  var skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

  // src/appearance.js
  var graph = null;
  var fx = null;
  var darkQuery = matchMedia("(prefers-color-scheme: dark)");
  function resolvedTheme() {
    const t = app.settings.theme;
    return t === "system" ? darkQuery.matches ? "dark" : "light" : t;
  }
  function initAppearance(g, f) {
    graph = g;
    fx = f;
    darkQuery.addEventListener("change", () => {
      if (app.settings.theme === "system") applySkin(app.settings.skin, { persist: false });
    });
    applySkin(app.settings.skin, { persist: false });
  }
  function applySkin(id, { persist = true } = {}) {
    const skin = skinById(id);
    app.skin = skin;
    const html2 = document.documentElement;
    html2.dataset.skin = skin.id;
    html2.dataset.chrome = skin.chrome || "bevel";
    html2.dataset.theme = resolvedTheme();
    const pal = skin.dark && html2.dataset.theme === "dark" ? { ...skin, ...skin.dark } : skin;
    app.colors = pal.trails.slice();
    graph?.setPalette(pal);
    fx?.set(skin.fx);
    if (persist) setSetting("skin", skin.id);
    emit("skin");
  }
  function setTheme(theme) {
    setSetting("theme", theme);
    applySkin(app.settings.skin, { persist: false });
  }

  // src/ui.js
  var $ = (id) => document.getElementById(id);
  var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  function fmtDate(t, withYear = true) {
    return new Date(t).toLocaleDateString(void 0, { day: "numeric", month: "short", ...withYear ? { year: "numeric" } : {} });
  }
  function fmtDateTime(t) {
    return new Date(t).toLocaleString(void 0, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtAgo(t) {
    const d = Date.now() - t;
    if (d < 6e4) return "just now";
    if (d < 36e5) return `${Math.round(d / 6e4)} min ago`;
    if (d < 864e5) return `${Math.round(d / 36e5)} h ago`;
    const days = Math.round(d / 864e5);
    return days < 60 ? plural(days, "day") + " ago" : fmtDate(t);
  }
  var wikiUrl = (title) => `https://${app.state.lang || "en"}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  var toastT;
  function toast(text, ms = 2600) {
    const el = $("toast");
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("on"), ms);
  }
  var actx;
  function blip(mult = 1) {
    if (!app.settings.sound) return;
    try {
      actx || (actx = new AudioContext());
      const sd = app.skin?.sound || { wave: "sine", f: 880 }, o = actx.createOscillator(), g = actx.createGain(), now = actx.currentTime;
      o.type = sd.wave;
      o.frequency.setValueAtTime(sd.f * mult, now);
      o.frequency.exponentialRampToValueAtTime(sd.f * mult * 1.5, now + 0.08);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(1e-4, now + 0.14);
      o.connect(g).connect(actx.destination);
      o.start(now);
      o.stop(now + 0.15);
    } catch {
    }
  }
  function confirmClick(btn, label, fn) {
    btn.onclick = () => {
      if (btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
        fn();
        return;
      }
      btn.dataset.label = btn.textContent;
      btn.dataset.armed = "1";
      btn.textContent = label;
      setTimeout(() => {
        if (btn.dataset.armed) {
          delete btn.dataset.armed;
          btn.textContent = btn.dataset.label;
        }
      }, 3e3);
    };
  }
  function stepsHTML(tr, shape, { cursorId = null, clickable = true } = {}) {
    return shape.lines.map(({ v, n, depth, side }) => `<li class="step${side ? " side" : ""}${v.id === cursorId ? " cur" : ""}${clickable ? "" : " static"}" data-v="${v.id}" data-a="${esc(v.article)}" style="padding-left:${6 + depth * 16}px" title="${esc(v.article)}"><span class="n">${n}</span><span class="t">${esc(v.article)}</span></li>`).join("");
  }

  // src/panels/record.js
  function initRecord({ showLeft }) {
    function render() {
      const v = cursorVisit();
      const tr = app.cur && trailOf(app.cur.trailId);
      const steps = $("steps");
      steps.innerHTML = tr ? stepsHTML(tr, trailShape(tr), { cursorId: app.cur.visitId }) : "";
      steps.querySelector(".cur")?.scrollIntoView({ block: "nearest" });
      $("reclabel").innerHTML = v ? `Next page after <em>${esc(v.article)}</em>` : app.state.trails.length ? "First page of a new trail" : "First page";
      $("next").placeholder = v ? "Paste the link you clicked, or type its title" : "Paste a Wikipedia link or type a title";
      $("newtrail").disabled = !tr;
      $("undo").disabled = !canUndo();
      $("rechint").textContent = tr ? "Click a step to continue from there." : "Start with the page where you began reading.";
      hint();
    }
    function renderTitles() {
      $("titles").innerHTML = [...app.D.articles.keys()].sort().map((t) => `<option value="${esc(t)}">`).join("");
    }
    function msg(text, warn = false) {
      $("msg").textContent = text || "";
      $("msg").classList.toggle("warn", warn);
    }
    function hint() {
      const t = normTitle($("next").value), a = t && app.D.articles.get(t);
      msg(a ? `You've been here before: ${plural(a.visits, "visit")} in ${plural(a.trails.size, "trail")}.` : "");
    }
    function add() {
      const raw = $("next").value, title = normTitle(raw);
      if (!title) {
        $("next").focus();
        return;
      }
      const v = cursorVisit();
      if (v && v.article === title) {
        msg("That is the page you are on.", true);
        return;
      }
      snapshot();
      const lang = langFromUrl(raw);
      if (lang && !app.state.trails.length) app.state.lang = lang;
      const visit = { id: uid(), article: title, parent: v ? v.id : null, t: Date.now() };
      if (!v) {
        const t = { id: uid(), name: "", created: (/* @__PURE__ */ new Date()).toISOString(), visits: [visit] };
        app.state.trails.push(t);
        app.cur = { trailId: t.id, visitId: visit.id };
      } else {
        trailOf(app.cur.trailId).visits.push(visit);
        app.cur = { trailId: app.cur.trailId, visitId: visit.id };
      }
      $("next").value = "";
      commit({ added: true });
      blip();
      $("next").focus();
    }
    $("add").onclick = add;
    $("next").addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    $("next").addEventListener("input", hint);
    $("newtrail").onclick = () => {
      setCursor(null);
      $("next").focus();
    };
    $("undo").onclick = () => {
      if (undo()) toast("Undone");
    };
    $("steps").addEventListener("click", (e) => {
      const li = e.target.closest(".step");
      if (!li || !app.cur) return;
      setCursor({ trailId: app.cur.trailId, visitId: li.dataset.v });
      $("next").focus();
    });
    on("data", () => {
      render();
      renderTitles();
    });
    on("cursor", render);
    on("dirty", () => {
      $("undo").disabled = !canUndo();
    });
    return {
      /** Continue an existing trail from one of its pages (default: its latest page). */
      continueTrail(trailId, visitId) {
        const t = trailOf(trailId);
        if (!t) return;
        showLeft();
        setCursor({ trailId, visitId: visitId || t.visits[t.visits.length - 1].id });
        $("next").focus();
      },
      /** Start a new trail whose first page is this article. */
      startAt(title) {
        showLeft();
        snapshot();
        const t = { id: uid(), name: "", created: (/* @__PURE__ */ new Date()).toISOString(), visits: [{ id: uid(), article: title, parent: null, t: Date.now() }] };
        app.state.trails.push(t);
        app.cur = { trailId: t.id, visitId: t.visits[0].id };
        commit({ added: true });
        $("next").focus();
      }
    };
  }

  // src/panels/trails.js
  function initTrails() {
    let limit = 150;
    const box = $("trails");
    function render() {
      const q = $("tfilter").value.trim().toLowerCase();
      let list = [...app.state.trails].reverse().filter(inRange);
      const total = list.length;
      if (q) list = list.filter((t2) => trailLabel(t2).toLowerCase().includes(q) || t2.visits.some((v) => v.article.toLowerCase().includes(q)));
      $("tcount").textContent = app.state.trails.length ? `(${q ? `${list.length} of ` : ""}${total})` : "";
      const sel = app.sel?.kind === "trail" ? app.sel.id : null, rec = app.cur?.trailId;
      const shown = list.slice(0, limit);
      box.innerHTML = shown.map((t2) => `<div class="item${t2.id === sel ? " on" : ""}" data-t="${t2.id}">
        <span class="swatch" style="background:${colorOf(t2.id)}"></span>
        <div class="tx"><div class="nm">${esc(trailLabel(t2))}</div><div class="mt">${plural(t2.visits.length, "page")} \xB7 ${fmtDate(t2.created, false)}</div></div>
        ${t2.id === rec ? '<span class="tag">recording</span>' : ""}
      </div>`).join("") + (list.length > limit ? `<button class="btn small more" id="tmore">Show ${Math.min(150, list.length - limit)} more</button>` : "") + (!list.length ? `<div class="none">${q ? "No trail matches." : app.range ? "No trails in this period." : "No trails yet. Record your first one above."}</div>` : "");
      $("tmore")?.addEventListener("click", () => {
        limit += 150;
        render();
      });
    }
    box.addEventListener("click", (e) => {
      const r = e.target.closest(".item");
      if (r) select({ kind: "trail", id: r.dataset.t }, { zoom: true });
    });
    box.addEventListener("mouseover", (e) => {
      const r = e.target.closest(".item");
      setHover(r ? { kind: "trail", id: r.dataset.t } : null);
    });
    box.addEventListener("mouseleave", () => setHover(null));
    let t;
    $("tfilter").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        limit = 150;
        render();
      }, 120);
    });
    for (const ev of ["data", "range", "select", "cursor", "skin"]) on(ev, render);
    return { render };
  }

  // src/panels/details.js
  var LEGEND = `<div class="legend-line"><span class="lg lg-before"></span>how you got here <span class="lg lg-after"></span>where you went next<br><span class="explain">Thicker and brighter = more recent.</span></div>`;
  function initDetails({ record: record2, focusArticle: focusArticle2, loadTest }) {
    const box = $("details");
    let showAll = false;
    function render() {
      const s = app.sel;
      if (!s) return overview();
      if (s.kind === "article") return article(s.id);
      if (s.kind === "edge") return edge(s.id);
      if (s.kind === "trail") return trail(s.id);
    }
    function overview() {
      $("dtitle").textContent = "Overview";
      if (!app.state.trails.length) {
        box.innerHTML = `<h3>Welcome to Wiki Trails</h3>
        <p>Keep a map of how you wander through Wikipedia.</p>
        <section><h4>How it works</h4>
          <p>1. In <b>Record</b>, paste the Wikipedia page you started on.</p>
          <p>2. Each time you click a link, paste the next page. If you went back, click an earlier step first.</p>
          <p>3. Click any article on the map to see every trail that went through it.</p></section>
        <section><h4>Just looking?</h4><div class="actions">
          <button class="btn" data-test="wikispeedia-1000">Try 30 days of example trails</button>
          <button class="btn" data-test="wikispeedia-2years">Try 2 years</button></div>
          <p class="explain">Real reading trails from the Wikispeedia study.</p></section>`;
        box.querySelectorAll("[data-test]").forEach((b) => b.onclick = () => loadTest(b.dataset.test));
        return;
      }
      const DV = app.DV, clicks = [...DV.links.values()].reduce((n, l) => n + l.total, 0);
      const trails = [...app.state.trails].filter((t) => !app.range || DV.articles.has(t.visits[0].article)).reverse();
      const top = [...DV.articles.values()].sort((p, q) => q.visits - p.visits).slice(0, 8);
      const span = timeSpan(app.state);
      box.innerHTML = `<div class="stats"><div><b>${DV.articles.size}</b><span>articles</span></div><div><b>${clicks}</b><span>clicks</span></div><div><b>${app.range ? new Set([...DV.articles.values()].flatMap((a) => [...a.trails])).size : app.state.trails.length}</b><span>trails</span></div></div>
      <p class="explain">${app.range ? `Showing ${fmtDate(app.range[0])} \u2013 ${fmtDate(app.range[1])}.` : span ? `From ${fmtDate(span[0])} to ${fmtDate(span[1])}.` : ""} Click any article on the map to see every trail that went through it.</p>
      <section><h4>Most visited</h4>${top.map((a) => `<div class="lrow" data-a="${esc(a.title)}"><span class="l">${esc(a.title)}</span><span class="c">${a.visits}\xD7 \xB7 ${fmtAgo(a.last)}</span></div>`).join("")}</section>
      <section><h4>Latest trails</h4>${trails.slice(0, 6).map((t) => `<div class="lrow" data-t="${t.id}"><span class="l">${esc(trailLabel(t))}</span><span class="c">${fmtDate(t.created, false)}</span></div>`).join("")}</section>`;
    }
    function article(title) {
      const a = app.DV.articles.get(title) || app.D.articles.get(title);
      $("dtitle").textContent = "Article";
      if (!a) {
        box.innerHTML = '<p class="explain">Not in this period.</p>';
        return;
      }
      const seen = [];
      for (const id of a.trails) {
        const ti = app.D.trailIndex.get(id);
        if (!ti) continue;
        for (const v of ti.trail.visits) {
          if (v.article !== title) continue;
          const t = visitTime(ti.trail, v);
          if (app.range && (t < app.range[0] || t > app.range[1])) continue;
          const from = v.parent != null ? ti.byId.get(v.parent).article : null;
          const next = (ti.children.get(v.id) || []).map((cid) => ti.byId.get(cid).article);
          seen.push({ t, trail: ti.trail, from, next });
        }
      }
      seen.sort((p, q) => q.t - p.t);
      const inc = /* @__PURE__ */ new Map(), out = /* @__PURE__ */ new Map();
      for (const l of app.DV.links.values()) {
        if (l.a === title) {
          if (l.ab) out.set(l.b, l.ab);
          if (l.ba) inc.set(l.b, l.ba);
        }
        if (l.b === title) {
          if (l.ba) out.set(l.a, l.ba);
          if (l.ab) inc.set(l.a, l.ab);
        }
      }
      const list = (m) => [...m].sort((p, q) => q[1] - p[1]).slice(0, 8).map(([t, n]) => `<div class="lrow" data-a="${esc(t)}"><span class="l">${esc(t)}</span><span class="c">${n}\xD7</span></div>`).join("") || '<p class="explain">None.</p>';
      const shownSeen = showAll ? seen : seen.slice(0, 12);
      const focused = app.focus?.title === title;
      box.innerHTML = `<h3>${esc(title)}</h3>
      <div class="sub">You saw this page ${plural(seen.length, "time")}${seen.length ? `, last on ${fmtDateTime(seen[0].t)}` : ""}${seen.length > 1 ? `, first on ${fmtDate(seen[seen.length - 1].t)}` : ""}.</div>
      ${seen.length ? LEGEND : ""}
      <div class="actions">
        <button class="btn small" id="d-start">Start a trail here</button>
        <button class="btn small" id="d-focus">${focused ? "Show the whole map" : "Only its neighbourhood"}</button>
        <a class="btn small" href="${wikiUrl(title)}" target="_blank" rel="noopener">Open on Wikipedia \u2197</a>
      </div>
      <section><h4>When you saw it</h4>${shownSeen.map((s) => `<div class="lrow" data-t="${s.trail.id}" title="Show this trail">
          <span class="l"><span class="when">${fmtDateTime(s.t)}</span><br><span class="explain">${s.from ? `from ${esc(s.from)}` : "start of the trail"}${s.next.length ? ` \u2192 ${esc(s.next.join(", "))}` : " \xB7 end of the trail"}</span></span></div>`).join("")}
        ${seen.length > shownSeen.length ? `<button class="btn small more" id="d-all">Show all ${seen.length}</button>` : ""}</section>
      <section><h4>You came from</h4>${list(inc)}</section>
      <section><h4>You went on to</h4>${list(out)}</section>`;
      $("d-start").onclick = () => record2.startAt(title);
      $("d-focus").onclick = () => focusArticle2(focused ? null : title);
      $("d-all")?.addEventListener("click", () => {
        showAll = true;
        render();
      });
    }
    function edge(key) {
      const l = app.DV.links.get(key) || app.D.links.get(key);
      $("dtitle").textContent = "Connection";
      if (!l) {
        box.innerHTML = '<p class="explain">Not in this period.</p>';
        return;
      }
      const uses = [];
      for (const id of l.trails) {
        const ti = app.D.trailIndex.get(id);
        if (!ti) continue;
        for (const v of ti.trail.visits) {
          if (v.parent == null) continue;
          const from = ti.byId.get(v.parent).article;
          if (from === l.a && v.article === l.b || from === l.b && v.article === l.a) uses.push({ t: visitTime(ti.trail, v), trail: ti.trail, from, to: v.article });
        }
      }
      uses.sort((p, q) => q.t - p.t);
      box.innerHTML = `<h3><a class="alink" data-a="${esc(l.a)}">${esc(l.a)}</a> \u2194 <a class="alink" data-a="${esc(l.b)}">${esc(l.b)}</a></h3>
      <div class="sub">Clicked ${plural(l.total, "time")}${uses.length ? `, last on ${fmtDateTime(uses[0].t)}` : ""}.</div>
      ${LEGEND}
      <section><h4>Directions</h4><div class="dirbar"><span>${esc(l.a)} \u2192 ${esc(l.b)}</span><b>${l.ab}\xD7</b><span>${esc(l.b)} \u2192 ${esc(l.a)}</span><b>${l.ba}\xD7</b></div></section>
      <section><h4>When you clicked it</h4>${uses.slice(0, showAll ? 1e9 : 12).map((u) => `<div class="lrow" data-t="${u.trail.id}"><span class="l"><span class="when">${fmtDateTime(u.t)}</span><br><span class="explain">${esc(u.from)} \u2192 ${esc(u.to)} \xB7 ${esc(trailLabel(u.trail))}</span></span></div>`).join("")}
        ${uses.length > 12 && !showAll ? `<button class="btn small more" id="d-all">Show all ${uses.length}</button>` : ""}</section>`;
      $("d-all")?.addEventListener("click", () => {
        showAll = true;
        render();
      });
    }
    function trail(id) {
      const tr = trailOf(id);
      $("dtitle").textContent = "Trail";
      if (!tr) return overview();
      const sh = trailShape(tr);
      const t0 = visitTime(tr, tr.visits[0]), t1 = visitTime(tr, tr.visits[tr.visits.length - 1]);
      const mins = Math.round((t1 - t0) / 6e4);
      box.innerHTML = `<h3 id="d-name">${esc(trailLabel(tr))}</h3>
      <div class="sub">${fmtDateTime(t0)} \xB7 ${plural(tr.visits.length, "page")}${sh.branches.length ? ` \xB7 went back ${plural(sh.branches.length, "time")}` : ""}${mins > 0 ? ` \xB7 ${mins} min` : ""}</div>
      <div class="legend-line"><span class="lg lg-trail"></span>from the start (blue) to the end (orange)</div>
      <div class="actions">
        <button class="btn small" id="d-cont">Continue this trail</button>
        <button class="btn small" id="d-rename">Rename</button>
        <button class="btn small danger" id="d-del">Delete</button>
      </div>
      <section><h4>Steps</h4><ol class="steps">${stepsHTML(tr, sh, { cursorId: app.cur?.trailId === tr.id ? app.cur.visitId : null })}</ol>
      <p class="explain">Indented steps are pages you opened and then went back from.</p></section>`;
      $("d-cont").onclick = () => record2.continueTrail(tr.id);
      $("d-rename").onclick = () => {
        const h = $("d-name");
        h.innerHTML = `<input class="renamer" value="${esc(trailLabel(tr))}">`;
        const inp = h.querySelector("input");
        inp.focus();
        inp.select();
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          if (save) {
            snapshot();
            tr.name = inp.value.trim();
            commit();
          } else render();
        };
        inp.onkeydown = (e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        };
        inp.onblur = () => finish(true);
      };
      confirmClick($("d-del"), "Click again to delete", () => {
        snapshot();
        app.state.trails = app.state.trails.filter((t) => t.id !== tr.id);
        if (app.cur?.trailId === tr.id) app.cur = null;
        app.sel = null;
        commit();
        toast("Trail deleted. Undo brings it back.");
      });
    }
    box.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]");
      if (a && !e.target.closest(".btn")) return select({ kind: "article", id: a.dataset.a }, { zoom: true });
      const t = e.target.closest("[data-t]");
      if (t) return select({ kind: "trail", id: t.dataset.t }, { zoom: true });
    });
    on("select", () => {
      showAll = false;
      render();
    });
    for (const ev of ["data", "range", "focus", "cursor"]) on(ev, render);
    return { render };
  }

  // src/panels/search.js
  function initSearch() {
    const input = $("search"), box = $("results");
    let items = [], active = 0;
    function run() {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        box.hidden = true;
        items = [];
        return;
      }
      const arts = [...app.D.articles.values()].filter((a) => a.title.toLowerCase().includes(q)).sort((p, q2) => (p.title.toLowerCase().startsWith(q) ? 0 : 1) - (q2.title.toLowerCase().startsWith(q) ? 0 : 1) || q2.visits - p.visits).slice(0, 7);
      const trails = [...app.state.trails].reverse().filter((t) => trailLabel(t).toLowerCase().includes(q)).slice(0, 5);
      items = [...arts.map((a) => ({ kind: "article", id: a.title })), ...trails.map((t) => ({ kind: "trail", id: t.id }))];
      active = 0;
      let i = 0;
      box.innerHTML = (arts.length ? `<h4>Articles</h4>${arts.map((a) => `<button data-i="${i++}">${esc(a.title)}<small>${plural(a.visits, "visit")}</small></button>`).join("")}` : "") + (trails.length ? `<h4>Trails</h4>${trails.map((t) => `<button data-i="${i++}">${esc(trailLabel(t))}<small>${fmtDate(t.created, false)}</small></button>`).join("")}` : "") + (!items.length ? '<div class="none">Nothing found.</div>' : "");
      box.hidden = false;
      mark();
    }
    function mark() {
      box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.i === active));
    }
    function choose(i) {
      const it = items[i];
      if (!it) return;
      select(it, { zoom: true, force: true });
      input.value = "";
      box.hidden = true;
      input.blur();
    }
    input.addEventListener("input", run);
    input.addEventListener("focus", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(items.length - 1, active + 1);
        mark();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(0, active - 1);
        mark();
      } else if (e.key === "Enter") choose(active);
      else if (e.key === "Escape") {
        input.value = "";
        box.hidden = true;
        input.blur();
      }
    });
    box.addEventListener("mousedown", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) {
        e.preventDefault();
        choose(+b.dataset.i);
      }
    });
    input.addEventListener("blur", () => setTimeout(() => {
      box.hidden = true;
    }, 120));
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  // src/panels/timeline.js
  var d32 = window.d3;
  function initTimeline() {
    let brush = null, x = null, silent = false;
    function markSeg() {
      document.querySelectorAll("#rangeseg button").forEach((b) => b.classList.toggle("on", b.dataset.range === app.rangeName));
      $("tllabel").textContent = app.range ? `${fmtDate(app.range[0])} \u2013 ${fmtDate(app.range[1])}` : "All time";
    }
    function render() {
      const svg = d32.select("#tlsvg"), node = svg.node(), w = node.clientWidth || 600, h = node.clientHeight || 38;
      svg.selectAll("*").remove();
      const span = timeSpan(app.state);
      $("timeline").hidden = !span;
      if (!span) return;
      const days = (span[1] - span[0]) / 864e5;
      const binMs = days > 400 ? 7 * 864e5 : days > 3 ? 864e5 : 36e5;
      const t0 = span[0] - binMs / 2, t1 = Math.max(span[1], span[0] + 12 * binMs);
      const bins = /* @__PURE__ */ new Map();
      for (const tr of app.state.trails) for (const v of tr.visits) {
        if (v.parent == null) continue;
        const b = Math.floor((visitTime(tr, v) - t0) / binMs);
        bins.set(b, (bins.get(b) || 0) + 1);
      }
      x = d32.scaleTime().domain([t0, t1 + binMs]).range([4, w - 4]);
      const mx = Math.max(1, ...bins.values()), y = d32.scaleSqrt().domain([0, mx]).range([0, h - 15]);
      const bw = Math.max(1, x(t0 + binMs) - x(t0) - 0.5);
      svg.append("g").selectAll("rect").data([...bins]).join("rect").attr("class", "bar").attr("x", ([b]) => x(t0 + b * binMs)).attr("width", bw).attr("y", ([, c]) => h - 13 - y(c)).attr("height", ([, c]) => Math.max(1, y(c)));
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - 13})`).call(d32.axisBottom(x).ticks(Math.max(2, Math.floor(w / 110))).tickSize(3));
      brush = d32.brushX().extent([[0, 0], [w, h - 13]]).on("end", (e) => {
        if (silent) return;
        if (!e.selection) return setRange(null, "all");
        setRange(e.selection.map((px) => +x.invert(px)), "custom");
      });
      const g = svg.append("g").attr("class", "brush").call(brush);
      if (app.range) {
        silent = true;
        g.call(brush.move, [Math.max(4, x(app.range[0])), Math.min(w - 4, x(app.range[1]))]);
        silent = false;
      }
      markSeg();
    }
    function preset(name) {
      const span = timeSpan(app.state);
      if (name === "all" || !span) setRange(null, "all");
      else setRange([Math.max(span[0], span[1] - +name * 864e5), span[1] + 1], name);
      render();
    }
    document.querySelectorAll("#rangeseg button").forEach((b) => b.onclick = () => preset(b.dataset.range));
    new ResizeObserver(() => {
      clearTimeout(window.__tlT);
      window.__tlT = setTimeout(render, 150);
    }).observe($("tlsvg"));
    on("data", render);
    on("range", markSeg);
    return { render };
  }

  // src/example.js
  function build(name, spec, daysAgo) {
    const visits = [];
    const last = /* @__PURE__ */ new Map();
    for (const seg of spec.split("|")) {
      const parts = seg.split(">").map(normTitle).filter(Boolean);
      let parent = last.get(parts[0]) ?? null;
      let start = 0;
      if (parent == null && visits.length === 0) {
        const v = { id: uid(), article: parts[0], parent: null };
        visits.push(v);
        last.set(v.article, v.id);
        parent = v.id;
        start = 1;
      } else start = 1;
      for (let i = start; i < parts.length; i++) {
        const v = { id: uid(), article: parts[i], parent };
        visits.push(v);
        last.set(v.article, v.id);
        parent = v.id;
      }
    }
    return { id: uid(), name, created: new Date(Date.now() - daysAgo * 864e5).toISOString(), visits };
  }
  function exampleState() {
    return {
      version: 2,
      lang: "en",
      trails: [
        build("", "Graph theory > Leonhard Euler > Seven Bridges of K\xF6nigsberg > Eulerian path | Leonhard Euler > Euler's identity > Complex number", 9),
        build("", "Neuron > Synapse > Neurotransmitter > Dopamine | Neuron > Action potential > Ion channel", 7),
        build("Brain to graphs", "Brain > Neuron > Synapse > Hebbian theory > Neural network (machine learning) > Graph theory > Leonhard Euler", 6),
        build("", "Neural network (machine learning) > Backpropagation > Gradient descent | Neural network (machine learning) > Perceptron > Frank Rosenblatt", 4),
        build("", "Brain > Neuron > Synapse > Hebbian theory > Donald O. Hebb | Hebbian theory > Neural network (machine learning) > Backpropagation > Gradient descent", 2),
        build("", "Complex number > Euler's identity > Leonhard Euler > Graph theory > Directed acyclic graph > Topological sorting", 1)
      ]
    };
  }

  // src/panels/menus.js
  var SAVED_KEY = "wiki-trails.saved";
  function initMenus({ graph: graph3 }) {
    const fileMenu = $("filemenu");
    let saved = { at: 0, clicks: 0, name: "" };
    try {
      saved = { ...saved, ...JSON.parse(localStorage.getItem(SAVED_KEY)) };
    } catch {
    }
    function saveDue() {
      const since = totalClicks() - (saved.clicks || 0);
      const days = saved.at ? (Date.now() - saved.at) / 864e5 : Infinity;
      if (!app.state.trails.length || since <= 0) return false;
      if (!saved.at) return totalClicks() >= 30;
      return since >= 200 || days >= 7 && since >= 10;
    }
    function renderSaved() {
      const since = Math.max(0, totalClicks() - (saved.clicks || 0)), due = saveDue();
      $("savedinfo").textContent = !saved.at ? "Not saved to a file yet." : `Saved ${fmtAgo(saved.at)}${saved.name ? ` to ${saved.name}` : ""}${since ? ` \xB7 ${plural(since, "new click")} since` : ""}.`;
      $("savedinfo").classList.toggle("due", due);
      $("filebtn").classList.toggle("due-dot", due);
      $("filebtn").title = due ? "Time to save your history to a file" : "Save, open, examples";
    }
    function closeMenus() {
      fileMenu.hidden = true;
    }
    $("filebtn").onclick = (e) => {
      e.stopPropagation();
      fileMenu.hidden = !fileMenu.hidden;
      renderSaved();
    };
    fileMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", closeMenus);
    async function doSave(saveAs = false) {
      closeMenus();
      try {
        app.state.layout = graph3.getPositions();
        const r = await saveToFile(app.state, { saveAs });
        if (!r) return;
        saved = { at: Date.now(), clicks: totalClicks(), name: r.name };
        try {
          localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
        } catch {
        }
        renderSaved();
        toast(r.how === "file" ? `Saved to ${r.name}. Ctrl+S updates the same file.` : `Downloaded ${r.name}. Open it any time with File \u2192 Open.`, 4e3);
      } catch (err) {
        toast(`Could not save: ${err.message}`);
      }
    }
    let pending = null;
    function askOpen(s, name) {
      if (!app.state.trails.length) return applyOpen(s, "replace", name);
      pending = { s, name };
      const clicks = s.trails.reduce((n, t) => n + t.visits.length - 1, 0);
      $("od-text").innerHTML = `<b>${esc(name || "This file")}</b> has ${plural(s.trails.length, "trail")} and ${plural(clicks, "click")}. You currently have ${plural(app.state.trails.length, "trail")}.`;
      $("opendlg").hidden = false;
      $("od-merge").focus();
    }
    function applyOpen(s, how, name) {
      if (how === "merge") {
        const m = merge(app.state, s);
        snapshot();
        app.state = m.state;
        app.sel = null;
        commit({ fresh: true });
        toast(`Added ${plural(m.added, "new trail")} from ${name || "the file"}.`);
      } else {
        graph3.reset();
        replaceState(s);
        toast(`Opened ${name || "the file"}: ${plural(s.trails.length, "trail")}.`);
      }
      saved = { at: Date.now(), clicks: totalClicks(), name: name || "" };
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
      } catch {
      }
      renderSaved();
    }
    $("od-merge").onclick = () => {
      $("opendlg").hidden = true;
      if (pending) applyOpen(pending.s, "merge", pending.name);
      pending = null;
    };
    $("od-replace").onclick = () => {
      $("opendlg").hidden = true;
      if (pending) applyOpen(pending.s, "replace", pending.name);
      pending = null;
    };
    $("od-cancel").onclick = $("od-close").onclick = () => {
      $("opendlg").hidden = true;
      pending = null;
    };
    async function doOpen() {
      closeMenus();
      try {
        const r = await pickFile();
        if (r === "fallback") return $("import").click();
        if (r) askOpen(r.state, r.name);
      } catch (err) {
        toast(`Could not open: ${err.message}`);
      }
    }
    async function openFileObj(f) {
      try {
        askOpen(await readFile(f), f.name);
      } catch (err) {
        toast(`Could not open ${f.name}: ${err.message}`);
      }
    }
    $("import").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) openFileObj(f);
    };
    function loadDataScript(name) {
      if (window.WIKI_TRAILS_DATA?.[name]) return Promise.resolve(window.WIKI_TRAILS_DATA[name]);
      return new Promise((res, rej) => {
        const el = document.createElement("script");
        el.src = `data/${name}.js`;
        el.onload = () => window.WIKI_TRAILS_DATA?.[name] ? res(window.WIKI_TRAILS_DATA[name]) : rej(new Error("empty"));
        el.onerror = () => rej(new Error("not found"));
        document.head.appendChild(el);
      });
    }
    async function loadTest(name) {
      closeMenus();
      try {
        const s = name === "small" ? exampleState() : validate(await loadDataScript(name));
        graph3.reset();
        replaceState(s);
        toast(`Loaded ${plural(s.trails.length, "example trail")}${graph3.isSettling() ? ". Arranging the map\u2026" : "."}`);
      } catch (err) {
        toast(`Could not load the example (${err.message}).`);
      }
    }
    $("m-save").onclick = () => doSave();
    $("m-saveas").onclick = () => doSave(true);
    $("m-open").onclick = doOpen;
    document.querySelectorAll("[data-example]").forEach((b) => b.onclick = () => loadTest(b.dataset.example));
    confirmClick($("m-clear"), "Click again to clear everything", () => {
      closeMenus();
      graph3.reset();
      replaceState({ ...emptyState(), lang: app.state.lang });
      toast("History cleared. Undo brings it back.");
    });
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        doSave(e.shiftKey);
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        doOpen();
      }
    });
    let depth = 0;
    window.addEventListener("dragenter", (e) => {
      if ([...e.dataTransfer?.types || []].includes("Files")) {
        depth++;
        $("dropzone").hidden = false;
      }
    });
    window.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) $("dropzone").hidden = true;
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      $("dropzone").hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) openFileObj(f);
    });
    on("data", renderSaved);
    setInterval(renderSaved, 6e4);
    const MOCK = `<svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice"><path class="ml" d="M18 40 Q40 10 62 28 T104 18" stroke-width="3"/><path class="ml" d="M18 40 L50 50 L62 28" stroke-width="1" opacity=".55"/><path class="ml" d="M62 28 L88 46" stroke-width="1.6" opacity=".8"/><circle class="mn2" cx="18" cy="40" r="4.5"/><circle class="mn" cx="62" cy="28" r="5.5"/><circle class="mn" cx="104" cy="18" r="3"/><circle class="mn" cx="50" cy="50" r="2.5"/><circle class="mn" cx="88" cy="46" r="3"/></svg>`;
    function renderSkins() {
      const theme = document.documentElement.dataset.theme;
      $("skingrid").innerHTML = CATS.map(([c, label]) => `<div class="gal-cat">${label}</div><div class="gal-grid">${SKINS.filter((s) => s.cat === c).map((s) => `<button class="card${s.id === app.settings.skin ? " chosen" : ""}" data-skin="${s.id}" data-chrome="${s.chrome || "bevel"}" data-theme="${theme}" data-id="${s.id}">
        <div class="mock-desk"><div class="mock-win"><div class="mock-title">${esc(s.name)}</div><div class="mock-screen">${MOCK}</div><div class="mock-row"><span class="mock-field"></span><span class="mock-btn">OK</span></div></div></div>
        <div class="card-name">${esc(s.name)}</div><div class="card-sub">${esc(s.blurb)}</div></button>`).join("")}</div>`).join("");
    }
    function renderSettings() {
      document.querySelectorAll("#themeseg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === app.settings.theme));
      $("density").value = app.settings.density;
      $("fade").checked = app.settings.fade;
      $("sound").checked = app.settings.sound;
      $("lang").value = app.state.lang || "en";
      renderSkins();
    }
    function openSettings() {
      closeMenus();
      renderSettings();
      $("settings").hidden = false;
    }
    function closeSettings() {
      $("settings").hidden = true;
      if (app.skin.id !== app.settings.skin) applySkin(app.settings.skin, { persist: false });
    }
    $("settingsbtn").onclick = openSettings;
    $("set-close").onclick = closeSettings;
    $("set-done").onclick = closeSettings;
    $("settings").addEventListener("click", (e) => {
      if (e.target === $("settings")) closeSettings();
    });
    document.querySelectorAll("#themeseg button").forEach((b) => b.onclick = () => {
      setTheme(b.dataset.theme);
      renderSettings();
    });
    const grid = $("skingrid");
    grid.addEventListener("mouseover", (e) => {
      const c = e.target.closest(".card");
      if (c && c.dataset.id !== app.skin.id) applySkin(c.dataset.id, { persist: false });
    });
    grid.addEventListener("mouseleave", () => {
      if (app.skin.id !== app.settings.skin) applySkin(app.settings.skin, { persist: false });
    });
    grid.addEventListener("click", (e) => {
      const c = e.target.closest(".card");
      if (c) {
        applySkin(c.dataset.id);
        renderSkins();
      }
    });
    $("density").oninput = () => {
      setSetting("density", +$("density").value);
      graph3.setView({ density: app.settings.density });
    };
    $("fade").onchange = () => {
      setSetting("fade", $("fade").checked);
      graph3.setView({ fade: app.settings.fade });
    };
    $("sound").onchange = () => setSetting("sound", $("sound").checked);
    $("lang").onchange = () => {
      app.state.lang = $("lang").value;
      commit();
    };
    $("relayout").onclick = () => {
      graph3.relayout();
      toast("Arranging the map from scratch\u2026");
      closeSettings();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("settings").hidden) closeSettings();
        if (!$("opendlg").hidden) $("opendlg").hidden = true;
      }
    });
    renderSaved();
    return { loadTest, openSettings };
  }

  // src/main.js
  var html = document.documentElement;
  function setPanel(side, open) {
    app.settings[side] = open;
    saveSettings();
    html.dataset[side] = open ? "open" : "closed";
  }
  document.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => setPanel(b.dataset.close, false));
  document.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => setPanel(b.dataset.open, true));
  setPanel("left", app.settings.left);
  setPanel("right", app.settings.right);
  var rz;
  var graph2 = createGraph($("graph"), {
    onHover: (t) => {
      setHover(t ? { kind: "article", id: t } : null);
      showTip();
    },
    onEdgeHover: (l) => {
      if (app.hover?.kind === "article") return;
      setHover(l ? { kind: "edge", id: l.key } : null);
      showTip();
    },
    onClick: (t) => {
      select({ kind: "article", id: t });
      revealSel(app.sel);
    },
    onEdgeClick: (l) => {
      select({ kind: "edge", id: l.key });
      revealSel(app.sel);
    },
    onDblClick: (t) => focusArticle(t),
    onBackground: () => select(null),
    onSettled: () => {
      app.state.layout = graph2.getPositions();
      saveLocal(app.state);
    },
    onResize: () => {
      clearTimeout(rz);
      rz = setTimeout(() => graph2.fit(false), 120);
    }
  });
  var fx2 = createEffects($("fx"));
  initAppearance(graph2, fx2);
  var tip = $("tip");
  var mouse = [0, 0];
  function placeTip() {
    if (tip.hidden) return;
    const r = $("stage").getBoundingClientRect();
    let x = mouse[0] + 16, y = mouse[1] + 14;
    if (x + tip.offsetWidth > r.width - 8) x = mouse[0] - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > r.height - 8) y = mouse[1] - tip.offsetHeight - 12;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function showTip() {
    const h = app.hover;
    if (h?.kind === "article") {
      const a = app.DV.articles.get(h.id) || app.D.articles.get(h.id);
      if (!a) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = `<b>${esc(a.title)}</b> \xB7 ${plural(a.visits, "visit")} \xB7 last seen ${fmtDateTime(a.last)}`;
    } else if (h?.kind === "edge") {
      const l = app.DV.links.get(h.id) || app.D.links.get(h.id);
      if (!l) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = `<b>${esc(l.a)} \u2194 ${esc(l.b)}</b> \xB7 ${plural(l.total, "click")} \xB7 last ${fmtDateTime(l.last)}`;
    } else {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    placeTip();
  }
  $("graph").addEventListener("mousemove", (e) => {
    const r = $("stage").getBoundingClientRect();
    mouse = [e.clientX - r.left, e.clientY - r.top];
    placeTip();
  });
  $("graph").addEventListener("mouseleave", () => {
    tip.hidden = true;
  });
  function applyHighlight() {
    graph2.setHighlight(specFor(app.hover || app.sel));
  }
  function titlesOf(sel) {
    const sp = specFor(sel);
    if (!sp) return /* @__PURE__ */ new Set();
    const titles = new Set(sp.paths.flatMap((p) => p.segs.flatMap((s) => [s.from, s.to])));
    if (sp.anchor) titles.add(sp.anchor);
    if (sp.edgeKey) sp.edgeKey.split("\0").forEach((t) => titles.add(t));
    return titles;
  }
  function zoomTo(sel) {
    const t = titlesOf(sel);
    if (t.size) graph2.focusOn(t);
  }
  function revealSel(sel) {
    if (!sel) return;
    const t = titlesOf(sel);
    if (t.size) graph2.reveal(t);
  }
  function fitWhenSettled() {
    graph2.settleAndFit();
    const iv = setInterval(() => {
      if (!graph2.isSettling()) {
        clearInterval(iv);
        graph2.fit(true);
      }
    }, 200);
  }
  function focusArticle(title) {
    if (!title) {
      setFocus(null);
      return;
    }
    let nb = graph2.neighbourhood(title, 1);
    if (nb.size < 25) nb = graph2.neighbourhood(title, 2);
    setFocus(title, nb);
    select({ kind: "article", id: title });
  }
  function renderFocusbar() {
    const bar = $("focusbar");
    bar.hidden = !app.focus;
    if (app.focus) bar.innerHTML = `<span class="btn small primary" id="unfocus">Only around ${esc(app.focus.title)} \xB7 show everything \u2715</span>`;
    $("unfocus")?.addEventListener("click", () => focusArticle(null));
  }
  $("zoomin").onclick = () => graph2.zoomBy(1.5);
  $("zoomout").onclick = () => graph2.zoomBy(1 / 1.5);
  $("fit").onclick = () => graph2.fit(true);
  on("data", (opts = {}) => {
    const first = graph2.update(app.D, app.DV, app.state.layout);
    graph2.setCursor(cursorVisit()?.article || null);
    if (app.focus) graph2.setView({ focus: app.focus.set });
    applyHighlight();
    $("empty").hidden = app.state.trails.length > 0;
    if (first || opts.fresh) fitWhenSettled();
    else if (opts.added) {
      const t = cursorVisit()?.article;
      setTimeout(() => {
        if (graph2.nodeCount() < 60) graph2.fit(true);
        else if (t) graph2.ensureVisible(t);
      }, graph2.nodeCount() < 60 ? 250 : 900);
    }
  });
  on("select", (opts = {}) => {
    applyHighlight();
    if (opts.zoom && app.sel) zoomTo(app.sel);
  });
  on("hover", applyHighlight);
  on("cursor", () => graph2.setCursor(cursorVisit()?.article || null));
  on("range", () => {
    graph2.setVisible(app.DV);
    applyHighlight();
    graph2.fit(true);
  });
  on("focus", () => {
    graph2.setView({ focus: app.focus?.set || null });
    graph2.setVisible(app.DV);
    applyHighlight();
    renderFocusbar();
    graph2.fit(true);
  });
  var record = initRecord({ showLeft: () => setPanel("left", true) });
  var menus = initMenus({ graph: graph2 });
  initTrails();
  initDetails({ record, focusArticle, loadTest: menus.loadTest });
  initSearch();
  initTimeline();
  document.querySelectorAll("[data-example]").forEach((b) => {
    if (!b.onclick) b.onclick = () => menus.loadTest(b.dataset.example);
  });
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
    if (e.key === "Escape" && !typing && $("settings").hidden) {
      if (app.focus) focusArticle(null);
      else if (app.sel) select(null);
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !(typing && e.target.value)) {
      e.preventDefault();
      if (undo()) toast("Undone");
    }
  });
  (async () => {
    graph2.setView({ density: app.settings.density, fade: app.settings.fade });
    app.state = await loadLocal() || await loadPublished() || emptyState();
    commit({ fresh: true });
    const rel = (p) => {
      if (!p) return null;
      const r = $("graph").getBoundingClientRect();
      return [r.left + p[0], r.top + p[1]];
    };
    window.__wikiTrails = {
      // handy for debugging in the console (and for tests)
      app,
      settling: () => graph2.isSettling(),
      gstats: () => graph2.stats(),
      drawMs: () => graph2.drawMs(),
      nodeXY: (t) => rel(graph2.screenOf(t)),
      edgeXY: (i) => rel(graph2.edgeMid(i))
    };
  })();
})();
