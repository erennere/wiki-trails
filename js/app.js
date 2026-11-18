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
  function timeSpan(state2) {
    let a = Infinity, b = -Infinity;
    for (const tr of state2.trails) for (const v of tr.visits) {
      const t = visitTime(tr, v);
      if (t < a) a = t;
      if (t > b) b = t;
    }
    return a <= b ? [a, b] : null;
  }
  function derive(state2, range2 = null) {
    const articles = /* @__PURE__ */ new Map();
    const links = /* @__PURE__ */ new Map();
    const inRange = (t) => !range2 || t >= range2[0] && t <= range2[1];
    const art = (t) => {
      if (!articles.has(t)) articles.set(t, { title: t, visits: 0, trails: /* @__PURE__ */ new Set(), starts: /* @__PURE__ */ new Set(), last: 0 });
      return articles.get(t);
    };
    const trailIndex = /* @__PURE__ */ new Map();
    state2.trails.forEach((tr, i) => {
      const byId = new Map(tr.visits.map((v) => [v.id, v]));
      const children = new Map(tr.visits.map((v) => [v.id, []]));
      let root = null;
      for (const v of tr.visits) {
        if (v.parent != null) children.get(v.parent)?.push(v.id);
        if (v.parent == null && !root) root = v;
        const t = visitTime(tr, v);
        if (!inRange(t)) continue;
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
      trailIndex.set(tr.id, { trail: tr, index: i, byId, children, root });
    });
    return { articles, links, trailIndex };
  }
  function chainTo(trailInfo, visitId) {
    const out = [];
    for (let v = trailInfo.byId.get(visitId); v; v = v.parent == null ? null : trailInfo.byId.get(v.parent)) out.unshift(v);
    return out;
  }
  function trailSteps(d, trailIds) {
    const steps = [];
    for (const id of trailIds) {
      const ti = d.trailIndex.get(id);
      if (!ti) continue;
      ti.trail.visits.forEach((v, order) => {
        if (v.parent == null) return;
        const from = ti.byId.get(v.parent).article;
        if (from !== v.article) steps.push({ trailId: id, from, to: v.article, order });
      });
    }
    return steps;
  }
  function routesTo(d, title) {
    const steps = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [id, ti] of d.trailIndex) {
      for (const v of ti.trail.visits) {
        if (v.article !== title) continue;
        const chain = chainTo(ti, v.id);
        for (let i = 1; i < chain.length; i++) {
          const k = id + "|" + chain[i].id;
          if (seen.has(k)) continue;
          seen.add(k);
          if (chain[i - 1].article !== chain[i].article) steps.push({ trailId: id, from: chain[i - 1].article, to: chain[i].article, order: i });
        }
      }
    }
    return steps;
  }
  function routesThrough(d, a, b) {
    const steps = [], seen = /* @__PURE__ */ new Set();
    for (const [id, ti] of d.trailIndex) {
      for (const v of ti.trail.visits) {
        if (v.parent == null) continue;
        const from = ti.byId.get(v.parent).article;
        if (!(from === a && v.article === b || from === b && v.article === a)) continue;
        const chain = chainTo(ti, v.id);
        for (let i = 1; i < chain.length; i++) {
          const k = id + "|" + chain[i].id;
          if (seen.has(k)) continue;
          seen.add(k);
          if (chain[i - 1].article !== chain[i].article) steps.push({ trailId: id, from: chain[i - 1].article, to: chain[i].article, order: i });
        }
      }
    }
    return steps;
  }
  function trailLabel(tr) {
    if (tr.name) return tr.name;
    const first = tr.visits[0]?.article || "Empty";
    return `${first} trail`;
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
  function saveLocal(state2) {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      idbSet(KEY, JSON.parse(JSON.stringify(state2))).catch(() => {
        try {
          localStorage.setItem(OLD_KEY, JSON.stringify(state2));
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
  async function saveToFile(state2, { saveAs = false } = {}) {
    const text = JSON.stringify({ app: "wiki-trails", savedAt: (/* @__PURE__ */ new Date()).toISOString(), ...state2 });
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
      const state2 = validate(JSON.parse(await f.text()));
      handle = h;
      return { state: state2, name: f.name };
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

  // src/graph.js
  var d32 = window.d3;
  var TRAIL_COLORS = ["#ffff55", "#55ffff", "#ff55ff", "#ff5555", "#55ff55", "#ffaa00", "#7f7fff", "#ffffff", "#ff9ecf", "#aaff00"];
  var HUB = d32.interpolateRgbBasis(["#1d6b36", "#2fd35a", "#a8ff4d", "#ffe14d", "#ffaa00"]);
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
    let W2 = 1, H = 1, dpr = 1;
    let T = d32.zoomIdentity, ax = 1, ay = 1, kFit = 1;
    const zr = () => T.k / kFit;
    const style = { link: "#39ff88", label: "#c6ffd8", labelBg: "#010a04", labelStart: "#fff", cursor: "#ffaa00", font: "monospace", weight: "400", upper: false };
    let skin2 = { shape: "square", hollow: false, glow: true, edge: "plain", bend: 0.12, labelSize: 15, walker: false };
    const view = { density: 1, fade: true, focus: null };
    let nodes = [], nodeBy = /* @__PURE__ */ new Map(), adj = /* @__PURE__ */ new Map();
    let visArticles = /* @__PURE__ */ new Map(), visNodes = [], sorted = [], visMaxDeg = 1, spanMs = 30 * DAY, nowMs = Date.now();
    const posCache = /* @__PURE__ */ new Map();
    let quad = null, drawn = [];
    let over = null, cursor = null, hoverNode = null, hoverEdge = null;
    let drawMs = 0, simLeft = 0, pinnedFresh = false, lastInteract = 0, dirty = true, raf = 0, lastFrame = 0;
    const sim = d32.forceSimulation().stop().force("link", d32.forceLink().id((d) => d.title).distance((l) => 22 + 90 / (1 + 0.7 * Math.log2(1 + l.total))).strength((l) => Math.min(1, 0.1 + 0.15 * Math.log2(1 + l.total)))).force("charge", d32.forceManyBody().theta(0.9).distanceMax(520)).force("collide", d32.forceCollide((n) => radius(n.visits) + 4).iterations(1)).force("x", d32.forceX().strength(0.03)).force("y", d32.forceY().strength(0.03));
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
      const focusSet2 = view.focus;
      visNodes = nodes.filter((n) => visArticles.has(n.title) && (!focusSet2 || focusSet2.has(n.title)));
      const deg = /* @__PURE__ */ new Map();
      const ls = [];
      let tMin = Infinity, tMax = -Infinity;
      for (const l of visible.links.values()) {
        if (focusSet2 && !(focusSet2.has(l.a) && focusSet2.has(l.b))) continue;
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
    function recency(last) {
      if (!view.fade || !last) return 1;
      const tau = Math.max(30 * DAY, spanMs / 5);
      return 0.28 + 0.72 * Math.exp(-Math.max(0, nowMs - last) / tau);
    }
    function rescore(ls = sorted) {
      for (const l of ls) {
        l.rec = recency(l.last);
        l.score = l.total * (0.25 + 0.75 * l.rec);
      }
      sorted = [...ls].sort((p, q) => q.score - p.score);
      const strongCut = sorted[Math.floor(sorted.length * 0.08)]?.score ?? Infinity;
      for (const l of sorted) l.strong = l.total >= 3 && l.score >= strongCut;
    }
    function rebuildQuad() {
      quad = d32.quadtree(visNodes, (n) => n.x, (n) => n.y);
    }
    const sx = (x) => T.x + T.k * ax * x;
    const sy = (y) => T.y + T.k * ay * y;
    const lx = (px) => (px - T.x) / (T.k * ax);
    const ly = (py) => (py - T.y) / (T.k * ay);
    function ctrlPt(x1, y1, x2, y2, extra = 0) {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, bend = len * skin2.bend + extra;
      return [(x1 + x2) / 2 - dy / len * bend, (y1 + y2) / 2 + dx / len * bend];
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W2 = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W2 * dpr);
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
      ctx.clearRect(0, 0, W2, H);
      drawn = [];
      if (!visNodes.length) return;
      const k = zr(), rs = Math.max(0.7, Math.min(2.2, Math.sqrt(k)));
      const lit = over?.nodes || null;
      const dimF = over ? 0.13 : 1;
      const M = 60;
      const inView2 = (x, y) => x > -M && x < W2 + M && y > -M && y < H + M;
      const budget = Math.round(380 * view.density * Math.min(10, Math.max(1, Math.pow(k, 1.25))));
      const wsc = Math.max(0.7, Math.min(1.6, Math.pow(k, 0.35)));
      const major = /* @__PURE__ */ new Set();
      const dash = skin2.edge === "dotted" ? [1, 7] : skin2.edge === "blocks" ? [4, 4] : null;
      ctx.lineCap = skin2.edge === "blocks" ? "butt" : "round";
      ctx.strokeStyle = style.link;
      let count = 0;
      for (const l of sorted) {
        if (count >= budget) break;
        const A = nodeBy.get(l.a), B = nodeBy.get(l.b);
        if (!A || !B) continue;
        const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y);
        if (!inView2(x1, y1) && !inView2(x2, y2)) continue;
        count++;
        const [cx, cy] = ctrlPt(x1, y1, x2, y2);
        const w = widthOf(l.total) * wsc, a = alphaOf(l.total) * l.rec * dimF;
        drawn.push({ l, x1, y1, cx, cy, x2, y2, w });
        major.add(l.a);
        major.add(l.b);
        if (l.strong && skin2.glow !== false && !over) {
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
        else if (skin2.edge === "pulse" && l.strong) {
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
      if (over) drawLanes(now, rs);
      const nodeBudget = Math.round(160 * view.density * Math.min(12, Math.max(1, k * k)));
      const inViewNodes = [];
      for (const n of visNodes) {
        const x = sx(n.x), y = sy(n.y);
        if (inView2(x, y)) inViewNodes.push([n, x, y]);
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
      const hollow = !!skin2.hollow;
      for (const [n, x, y] of shown) {
        const isLit = !lit || lit.has(n.title);
        const col = HUB(Math.log1p(n.deg) / Math.log1p(visMaxDeg));
        const r = radius(n.visits) * rs;
        ctx.globalAlpha = isLit ? 1 : 0.16;
        ctx.save();
        ctx.translate(x, y);
        const p = shapeP2D(skin2.shape, r);
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
        if (n.title === hoverNode || n.title === over?.focus) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.labelStart;
          ctx.lineWidth = 2.5;
          ctx.stroke(shapeP2D(skin2.shape, r + 3));
        }
        if (n.title === cursor && Math.floor(now / 500) % 2 === 0) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = style.cursor;
          ctx.lineWidth = 3;
          ctx.setLineDash([4, 3]);
          ctx.stroke(shapeP2D(skin2.shape, r + 5));
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
        if (skin2.walker && over.walk?.length) drawWalker(now);
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
    function drawLanes(now, rs) {
      const off = -(now / 35) % 12;
      for (const lane of over.lanes) {
        const p = lanePath(lane, lane.extra);
        if (!p) continue;
        const [x1, y1, cx, cy, x2, y2] = p, col = lane.color, w = (1.4 + 1.1 * Math.log2(1 + lane.count)) * Math.min(1.4, rs);
        ctx.strokeStyle = col;
        if (over.lanes.length < 400) {
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = w * 3.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cx, cy, x2, y2);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = w;
        ctx.setLineDash(style.laneDash ? [6, 6] : []);
        ctx.lineDashOffset = off;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        const u = 0.58, mx = (1 - u) ** 2 * x1 + 2 * (1 - u) * u * cx + u * u * x2, my = (1 - u) ** 2 * y1 + 2 * (1 - u) * u * cy + u * u * y2;
        const tx = 2 * (1 - u) * (cx - x1) + 2 * u * (x2 - cx), ty = 2 * (1 - u) * (cy - y1) + 2 * u * (y2 - cy), an = Math.atan2(ty, tx);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(an);
        ctx.fillStyle = col;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-5, -4.5);
        ctx.lineTo(-5, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (over.edgeKey) {
        const d = drawn.find((e) => e.l.key === over.edgeKey) || (() => {
          const [a, b] = over.edgeKey.split("\0");
          const A = nodeBy.get(a), B = nodeBy.get(b);
          if (!A || !B) return null;
          const x1 = sx(A.x), y1 = sy(A.y), x2 = sx(B.x), y2 = sy(B.y), [cx, cy] = ctrlPt(x1, y1, x2, y2);
          return { x1, y1, cx, cy, x2, y2, w: 3 };
        })();
        if (d) {
          ctx.strokeStyle = style.cursor;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = d.w + 12;
          ctx.beginPath();
          ctx.moveTo(d.x1, d.y1);
          ctx.quadraticCurveTo(d.cx, d.cy, d.x2, d.y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = d.w + 3;
          ctx.stroke();
        }
      }
    }
    function drawWalker(now) {
      const steps = over.walk, dur = Math.max(4e3, steps.length * 1100), ph = now % dur / dur * steps.length;
      const i = Math.floor(ph), u = ph - i, st = steps[i];
      const p = lanePath({ from: st.from, to: st.to }, 0);
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
      const size = skin2.labelSize || 14;
      const font = `${style.weight} ${size}px ${style.font}`;
      ctx.font = font;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const limit = Math.round(26 * view.density * Math.min(8, Math.max(1, Math.pow(k, 1.15)))) + (lit ? 30 : 0);
      const cands = shown.filter(([n]) => !lit || lit.has(n.title)).map(([n, x, y]) => [n, x, y, (n.title === cursor || n.title === hoverNode || n.title === over?.focus ? 1e9 : 0) + n.visits * (1 + 0.5 * (n.isStart ? 1 : 0))]).sort((p, q) => q[3] - p[3]);
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
      return simLeft > 0 || !!over || !!cursor || skin2.edge === "pulse";
    }
    function frame(now) {
      raf = 0;
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
    const zoom = d32.zoom().scaleExtent([0.08, 24]).filter((e) => {
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
    const sel = d32.select(canvas).call(zoom).on("dblclick.zoom", null);
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
      const trails = new Set(spec.steps.map((s) => s.trailId));
      const mono = trails.size > 24;
      const lanes = /* @__PURE__ */ new Map();
      for (const s of spec.steps) {
        const pk = s.from < s.to ? s.from + "\0" + s.to : s.to + "\0" + s.from;
        const key = mono ? `${pk}|${s.from}` : `${pk}|${s.trailId}|${s.from}`;
        if (!lanes.has(key)) lanes.set(key, { pk, trailId: s.trailId, from: s.from, to: s.to, count: 0 });
        lanes.get(key).count++;
      }
      const byPair = d32.group([...lanes.values()], (l) => l.pk);
      const list = [];
      for (const [, arr] of byPair) arr.forEach((l, i) => list.push({ ...l, extra: (i - (arr.length - 1) / 2) * Math.min(6, 30 / arr.length), color: mono ? style.cursor : spec.colorOf(l.trailId) }));
      list.sort((p, q) => q.count - p.count);
      const capped = list.slice(0, 900);
      const ns = new Set(capped.flatMap((l) => [l.from, l.to]));
      if (spec.focus) ns.add(spec.focus);
      if (spec.edgeKey) for (const t of spec.edgeKey.split("\0")) ns.add(t);
      over = { ...spec, lanes: capped, nodes: ns, walk: spec.numbers ? [...spec.steps].sort((p, q) => p.order - q.order) : null };
      dirty = true;
      kick();
    }
    function setCursor(t) {
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
      style.laneDash = v("--lane-dash", "6 6") !== "none";
    }
    function setPalette(s) {
      skin2 = { shape: "square", hollow: false, glow: true, edge: "plain", bend: 0.12, labelSize: 14, walker: false, ...s };
      HUB = d32.interpolateRgbBasis(s.hub);
      TRAIL_COLORS.splice(0, TRAIL_COLORS.length, ...s.trails);
      readStyle();
      if (over) setHighlight(over);
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
      const padX = 70, padY = 40, vw = Math.max(50, W2 - padX * 2 - 60), vh = Math.max(50, H - padY * 2);
      const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      const want = vw / vh / (bw / bh);
      if (want >= 1) {
        ax = Math.min(2.4, want);
        ay = 1;
      } else {
        ax = 1;
        ay = Math.min(2.4, 1 / want);
      }
      const k = Math.min(vw / (bw * ax), vh / (bh * ay));
      kFit = k;
      const t = d32.zoomIdentity.translate(W2 / 2 - 30 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
      (animate ? sel.transition().duration(550) : sel).call(zoom.transform, t);
    }
    function focusOn(titles, padLeft = 0) {
      const list = [...titles].map((t2) => nodeBy.get(t2)).filter(Boolean);
      if (!list.length) return;
      const b = bbox(list), vw = Math.max(150, W2 - padLeft - 220), vh = Math.max(100, H - 120);
      const bw = Math.max(40, b[2] - b[0]), bh = Math.max(40, b[3] - b[1]);
      const k = Math.max(0.15, Math.min(6, Math.min(vw / (bw * ax), vh / (bh * ay))));
      const t = d32.zoomIdentity.translate(padLeft + (W2 - padLeft) / 2 - 40 - k * ax * (b[0] + b[2]) / 2, H / 2 - k * ay * (b[1] + b[3]) / 2).scale(k);
      sel.transition().duration(600).call(zoom.transform, t);
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
      update,
      reset,
      setVisible,
      setPalette,
      setHighlight,
      setCursor,
      setView,
      fit,
      focusOn,
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

  // src/effects.js
  var rand = (a, b) => a + Math.random() * (b - a);
  function createEffects(canvas) {
    const ctx = canvas.getContext("2d");
    let fx2 = { type: "none" }, parts = [], w = 0, h = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
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
      switch (fx2.type) {
        case "stars":
        case "nebula":
          parts = Array.from({ length: n(fx2.type === "nebula" ? 260 : 170) }, () => ({ x: rand(0, w), y: rand(0, h), s: Math.random() < 0.12 ? 2 : 1, p: rand(0, 6.3), v: rand(0.4, 1.6), c: Math.random() < 0.25 ? fx2.c2 : fx2.c1 }));
          break;
        case "rain":
          parts = Array.from({ length: n(150) }, () => ({ x: rand(0, w), y: rand(-h, h), l: rand(8, 26), v: rand(260, 520), c: Math.random() < 0.2 ? fx2.c2 : fx2.c1 }));
          break;
        case "bubbles":
          parts = Array.from({ length: n(45) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(3, 16), v: rand(12, 40), p: rand(0, 6.3) }));
          break;
        case "sparkles":
          parts = Array.from({ length: n(34) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(4, 11), p: rand(0, 6.3), v: rand(0.6, 1.4), c: Math.random() < 0.5 ? fx2.c1 : fx2.c2 }));
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
      const c1 = fx2.c1 || "#fff", c2 = fx2.c2 || c1;
      switch (fx2.type) {
        case "nebula": {
          for (const [x, y, r, c, a] of [[0.25, 0.3, 0.55, c2, 0.16], [0.75, 0.65, 0.5, c1, 0.12], [0.55, 0.15, 0.35, fx2.c3 || c2, 0.1]]) {
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
          sun.addColorStop(0, fx2.c3 || "#ffcf3f");
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
      if (fx2.type !== "none" && !reduced && !document.hidden) raf = requestAnimationFrame(loop);
    }
    document.addEventListener("visibilitychange", start);
    return {
      set(next) {
        fx2 = next && next.type ? next : { type: "none" };
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

  // src/skins.js
  var pad = (n, w = 6) => String(n).padStart(w, "0");
  var VGA = ["#ffff55", "#55ffff", "#ff55ff", "#ff5555", "#55ff55", "#ffaa00", "#7f7fff", "#ffffff", "#ff9ecf", "#aaff00"];
  var CATS = [
    ["retro", "Retro computing"],
    ["future", "Futuristic"],
    ["ai", "AI"],
    ["y2k", "Millennium / Y2K"],
    ["console", "90s console games"],
    ["synth", "Synthwave"],
    ["minimal", "Minimal"]
  ];
  var SKINS = [
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
      boot: ["WIKITRAILS BIOS v2.0  (C) 1996 Hyperlink Systems", "", "Memory test: 640K OK"],
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
      boot: ["Welcome to Wiki Trails.", "", "Extensions: Hyperlinks, Curiosity"],
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
      boot: ["C:\\> WIKITRLS.COM /AMBER", "", "HIMEM is testing extended memory... done."],
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
      boot: ["INSERT COIN", "", "1 PLAYER   1 CREDIT"],
      sound: { wave: "square", f: 660 },
      stats: (i) => `SCORE ${pad(i.clicks * 10)}   NODES ${i.articles}   WAVES ${i.trails}`,
      banner: (h) => h.topIn ? `ROUTE BONUS \xD7${h.topInCount}  via ${h.topIn}` : null,
      milestone: (a, b) => Math.floor(b / 100) > Math.floor(a / 100) ? "EXTRA LIFE!" : null
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
      ui: ["ticker"],
      titles: { builder: "TRAIL BUILDER", trails: "INDEX", brain: "WIKI TRAILS" },
      boot: ["P100  CEEFAX-ISH  100 " + (/* @__PURE__ */ new Date()).toDateString().slice(4).toUpperCase(), "", "SEARCHING FOR PAGE 101..."],
      sound: { wave: "square", f: 990 },
      stats: (i) => `P101  ${i.articles} ARTICLES  ${i.clicks} CLICKS  ${i.trails} TRAILS`,
      ticker: (i) => `WIKI TRAILS NEWS ... ${i.clicks} CLICKS RECORDED ... ${i.top ? `TOP STORY: ${i.top.a.toUpperCase()} \u2194 ${i.top.b.toUpperCase()} \xD7${i.top.total}` : "NO TOP STORY YET"} ... WEATHER: CURIOUS WITH A CHANCE OF RABBIT HOLES ...`
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
      boot: ["**** WIKI BASIC V2 ****", "64K RAM SYSTEM  38911 BASIC BYTES FREE", "READY.", 'LOAD "TRAILS",8,1'],
      sound: { wave: "triangle", f: 520 },
      stats: (i) => `READY. ${i.articles} ARTICLES  ${i.clicks} CLICKS`
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
      boot: ["HUD INITIALISING", "", "SENSOR ARRAY ....... ONLINE", "LINK MAPPER ........ ONLINE"],
      sound: { wave: "sine", f: 1320 },
      stats: (i) => `SYS NOMINAL \xB7 ${i.articles} NODES \xB7 ${i.clicks} LINK EVENTS \xB7 ${i.trails} SORTIES`,
      banner: (h) => `TARGET LOCK: ${h.title}`
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
      words: { trail: "constellation", trails: "constellations", Trails: "Constellations", article: "star", articles: "stars" },
      titles: { builder: "Plot a course", trails: "Constellations", brain: "Star chart" },
      boot: ["Aligning telescope\u2026", "", "Catalogue loaded."],
      sound: { wave: "sine", f: 784 },
      stats: (i) => `${i.articles} stars \xB7 ${i.trails} constellations \xB7 ${i.clicks} jumps`
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
      words: { trail: "thought", trails: "thoughts", Trails: "Thoughts", article: "neuron", articles: "neurons", click: "signal", clicks: "signals" },
      titles: { builder: "New thought", trails: "Thoughts", brain: "Cortex" },
      boot: ["Growing dendrites\u2026", "", "Synapses firing."],
      sound: { wave: "sine", f: 392 },
      stats: (i) => `${i.articles} neurons \xB7 ${i.clicks} signals \xB7 ${i.trails} thoughts`
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
      titles: { builder: "New sample", trails: "Samples", brain: "Embedding view" },
      boot: ["Loading weights\u2026", "", "Projecting to 2D."],
      sound: { wave: "sine", f: 1046 },
      stats: (i) => `n=${i.articles} \xB7 edges=${i.clicks} \xB7 samples=${i.trails}`
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
      ui: ["spark"],
      words: { trail: "run", trails: "runs", Trails: "Runs", click: "step", clicks: "steps" },
      titles: { builder: "train.py", trails: "runs/", brain: "tensorboard" },
      boot: ["$ python train.py --data wiki", "", "cuda: available"],
      sound: { wave: "triangle", f: 1200 },
      stats: (i) => `epoch ${i.trails} \xB7 step ${i.clicks} \xB7 loss ${(2.4 / Math.log(i.clicks + 3)).toFixed(4)} \xB7 nodes ${i.articles}`,
      milestone: (a, b) => Math.floor(b / 250) > Math.floor(a / 250) ? "checkpoint saved" : null
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
      ui: ["eye"],
      titles: { builder: "INPUT", trails: "OBSERVATION LOG", brain: "SENTINEL // MONITOR" },
      boot: ["SENTINEL ONLINE.", "", "Good morning. I have been expecting you."],
      sound: { wave: "sine", f: 220 },
      stats: (i) => `MONITORING ${i.articles} SUBJECTS \xB7 ${i.clicks} EVENTS LOGGED`,
      hover: (a) => `I see you are interested in ${a.title}. You have been here ${a.visits} time${a.visits === 1 ? "" : "s"}.`
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
      boot: ["Starting up\u2026", "", "Welcome"],
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
      boot: ["MILLENNIUM EDITION", "", "Y2K compliant \u2713"],
      sound: { wave: "triangle", f: 1760 },
      stats: (i) => `${1e3 - i.clicks % 1e3} clicks to the next millennium \xB7 ${i.articles} articles`,
      milestone: (a, b) => Math.floor(b / 1e3) > Math.floor(a / 1e3) ? "HAPPY NEW MILLENNIUM!" : null
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
      ui: ["ticker"],
      titles: { builder: "~*~ Add a trail ~*~", trails: "My Trails!!!", brain: "My Wiki Trails Homepage!!!" },
      boot: ["Connecting at 56k...", "", "KRRRRRSHHHHH pong pong"],
      sound: { wave: "square", f: 1200 },
      stats: (i) => `You are visitor #${pad(i.clicks)}!`,
      ticker: () => "\u{1F6A7} UNDER CONSTRUCTION \u{1F6A7}  Welcome to my Wiki Trails homepage!!!  Best viewed in 800\xD7600  \u2728 Sign my guestbook \u2728  \u{1F6A7}",
      milestone: (a, b) => Math.floor(b / 100) > Math.floor(a / 100) ? `${b}th VISITOR!!!` : null
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
      ui: ["eq"],
      words: { trail: "track", trails: "tracks", Trails: "Playlist", clicks: "beats", click: "beat" },
      titles: { builder: "NOW RECORDING", trails: "PLAYLIST", brain: "VISUALIZER" },
      boot: ["It really whips.", "", "Loading visualizer plug-in\u2026"],
      sound: { wave: "sawtooth", f: 660 },
      stats: (i) => `\u25B6 ${i.trails} tracks \xB7 ${i.clicks} beats \xB7 ${Math.floor(i.clicks / 60)}:${String(i.clicks % 60).padStart(2, "0")}`
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
      words: { trail: "quest", trails: "quests", Trails: "Quests", click: "XP", clicks: "XP" },
      titles: { builder: "Quest log", trails: "Quests", brain: "World map" },
      boot: ["Long ago, in a land of hyperlinks\u2026", "", "NEW GAME"],
      sound: { wave: "square", f: 988 },
      stats: (i) => `LV ${1 + Math.floor(i.clicks / 50)}   XP ${i.clicks % 50}/50   QUESTS ${i.trails}   PLACES ${i.articles}`,
      banner: (h) => `A wild ${h.title.toUpperCase()} appeared!`,
      milestone: (a, b) => Math.floor(b / 50) > Math.floor(a / 50) ? `LEVEL UP! LV ${1 + Math.floor(b / 50)}` : null
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
      boot: ["WIKI TRAILS", "", "PRESS START"],
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
      menu: { export: "Save to Memory Card\u2026", import: "Load from Memory Card\u2026" },
      boot: ["", "", "Licensed by Nobody in Particular"],
      sound: { wave: "triangle", f: 740 },
      stats: (i) => `MEMORY CARD 1 \xB7 ${Math.max(0, 15 - Math.ceil(i.trails / 12))} BLOCKS FREE \xB7 ${i.clicks} clicks`
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
      words: { trails: "fighters", Trails: "Select your trail" },
      titles: { builder: "NEW CHALLENGER", trails: "SELECT YOUR TRAIL", brain: "ARENA" },
      boot: ["", "ROUND 1", "FIGHT!"],
      sound: { wave: "sawtooth", f: 330 },
      stats: (i) => `ROUND ${i.trails} \xB7 ${i.top ? `COMBO \xD7${i.top.total}` : "NO COMBO"} \xB7 ${i.clicks} HITS`,
      banner: (h) => h.topIn ? `${h.topIn} VS ${h.title}` : `??? VS ${h.title}`,
      milestone: (a, b) => Math.floor(b / 10) > Math.floor(a / 10) ? `${b} HIT COMBO!` : null
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
      words: { trail: "adventure", trails: "adventures", Trails: "Adventures", article: "level", articles: "levels" },
      titles: { builder: "Next level", trails: "Adventures", brain: "World 1" },
      boot: ["WORLD 1-1", "", "\xD7 3"],
      sound: { wave: "square", f: 1318 },
      stats: (i) => `WORLD ${1 + Math.floor(i.trails / 20)} \xB7 ${i.articles} levels \xB7 \u2605 ${i.clicks}`,
      banner: (h) => `${h.title}: cleared ${h.a.visits}\xD7`
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
      boot: ["NEON//TRAILS  OS 1984", "", "Charging flux capacitor... 1.21 GW"],
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
      titles: { builder: "\uFF34\uFF32\uFF21\uFF29\uFF2C\u3000\u30D3\u30EB\u30C0\u30FC", trails: "\u30C8\u30EC\u30A4\u30EB\u3000\uFF46\uFF4F\uFF4C\uFF44\uFF45\uFF52", brain: "\uFF22\uFF32\uFF21\uFF29\uFF2E\uFF0E\uFF25\uFF38\uFF25\u3000\u8133\u5185" },
      boot: ["\uFF37\uFF29\uFF2B\uFF29\u3000\uFF34\uFF32\uFF21\uFF29\uFF2C\uFF33\u3000\uFF19\uFF18", "", "\uFF45\uFF4E\uFF4A\uFF4F\uFF59\u3000\uFF54\uFF48\uFF45\u3000\uFF41\uFF45\uFF53\uFF54\uFF48\uFF45\uFF54\uFF49\uFF43"],
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
      titles: { builder: "NETRUN // INPUT", trails: "DATA SHARDS", brain: "BRAIN.EXE // \u8133 \u30CD\u30AA\u30F3" },
      boot: ["JACKING IN\u2026", "", "ICE: bypassed"],
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
      titles: { builder: "Add", trails: "Trails", brain: "Graph" },
      boot: ["Wiki Trails"],
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
      titles: { builder: "Add", trails: "Trails", brain: "Graph" },
      boot: ["Wiki Trails"],
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
      titles: { builder: "\u9053 \xB7 Path", trails: "\u8A18 \xB7 Trails", brain: "\u5FC3 \xB7 Mind" },
      boot: ["\u4E00\u671F\u4E00\u4F1A"],
      sound: { wave: "sine", f: 330 }
    }
  ];
  var RENAMED = { win95: "desktop95", synth: "outrun", gameboy: "handheld", mac: "mono91" };
  var KEY2 = "wiki-trails.skin";
  var skinById = (id) => SKINS.find((s) => s.id === (RENAMED[id] || id)) || SKINS[0];
  function savedSkin() {
    try {
      return skinById(localStorage.getItem(KEY2));
    } catch {
      return SKINS[0];
    }
  }
  function rememberSkin(id) {
    try {
      localStorage.setItem(KEY2, id);
    } catch {
    }
  }

  // src/main.js
  var $ = (id) => document.getElementById(id);
  var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var state = emptyState();
  var D = derive(state);
  var DV = D;
  var range = null;
  var focusTitle = null;
  var cur = null;
  var pinned = null;
  var hovered = null;
  var undoStack = [];
  var graph = createGraph($("graph"), {
    onHover: (t) => {
      hovered = t ? { kind: "article", id: t } : null;
      applyHighlight();
      statusFor(t);
      bannerFor(t);
    },
    onEdgeHover: (l) => {
      if (hovered?.kind === "article") return;
      hovered = l ? { kind: "edge", id: l.key } : null;
      applyHighlight();
      if (l) status(`${l.a} \u2194 ${l.b}: clicked ${l.total}\xD7 (${l.ab}\xD7 \u2192 ${l.b}, ${l.ba}\xD7 \u2192 ${l.a})`);
    },
    onClick: (t) => clickArticle(t),
    onEdgeClick: (l) => clickEdge(l),
    onDblClick: (t) => setFocus(t),
    onBackground: () => {
      const had = pinned;
      pinned = null;
      closeCard();
      applyHighlight();
      renderTrails();
      if (had) graph.fit(true);
    },
    onSettled: () => {
      state.layout = graph.getPositions();
      saveLocal(state);
    },
    onResize: () => {
      clearTimeout(rzT);
      rzT = setTimeout(() => graph.fit(false), 120);
    }
  });
  var rzT;
  var colorOf = (trailId) => TRAIL_COLORS[(D.trailIndex.get(trailId)?.index ?? 0) % TRAIL_COLORS.length];
  var trailOf = (id) => state.trails.find((t) => t.id === id);
  var wikiUrl = (t) => `https://${state.lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;
  function snapshot() {
    const { layout, ...rest } = state;
    undoStack.push(JSON.stringify({ state: rest, cur }));
    let bytes = 0;
    for (const u of undoStack) bytes += u.length;
    while (undoStack.length > 1 && (undoStack.length > 100 || bytes > 24e6)) bytes -= undoStack.shift().length;
    markDirty();
  }
  function commit({ refit = false } = {}) {
    saveLocal(state);
    D = derive(state);
    DV = range ? derive(state, range) : D;
    if (cur && !D.trailIndex.get(cur.trailId)?.byId.has(cur.visitId)) cur = null;
    if (pinned?.kind === "trail" && !D.trailIndex.has(pinned.id)) pinned = null;
    if (pinned?.kind === "article" && !D.articles.has(pinned.id)) {
      pinned = null;
      closeCard();
    }
    if (focusTitle && !D.articles.has(focusTitle)) setFocus(null, false);
    if (focusTitle) {
      focusSet = graph.neighbourhood(focusTitle, focusSet?.size >= 25 ? 1 : 2);
      graph.setView({ focus: focusSet });
    }
    const firstLayout = graph.update(D, DV, state.layout);
    if (firstLayout) refit = true;
    renderTimeline();
    graph.setCursor(cursorArticle());
    renderAll();
    applyHighlight();
    if (refit) {
      graph.settleAndFit();
      if (graph.isSettling()) waitThenFit();
    }
  }
  function waitThenFit() {
    const iv = setInterval(() => {
      if (!graph.isSettling()) {
        clearInterval(iv);
        graph.fit(true);
        if (/Laying out|fresh layout/.test($("status").textContent)) status("Map ready.");
      }
    }, 200);
  }
  function cursorArticle() {
    return cur ? D.trailIndex.get(cur.trailId)?.byId.get(cur.visitId)?.article ?? null : null;
  }
  function refresh() {
    DV = range ? derive(state, range) : D;
    graph.setVisible(DV);
    renderStats();
    renderTimelineLabel();
    applyHighlight();
    if (pinned?.kind === "article") openCard(pinned.id);
  }
  function addLink() {
    const raw = $("next").value;
    const title = normTitle(raw);
    if (!title) {
      $("next").focus();
      return;
    }
    const here = cursorArticle();
    if (here === title) {
      msg("You are already on that page.", true);
      return;
    }
    const before = statInfo().clicks;
    snapshot();
    const lang = langFromUrl(raw);
    if (lang && !state.trails.length) state.lang = lang;
    if (!cur) {
      const t = { id: uid(), name: "", created: (/* @__PURE__ */ new Date()).toISOString(), visits: [] };
      const v = { id: uid(), article: title, parent: null, t: Date.now() };
      t.visits.push(v);
      state.trails.push(t);
      cur = { trailId: t.id, visitId: v.id };
    } else {
      const v = { id: uid(), article: title, parent: cur.visitId, t: Date.now() };
      trailOf(cur.trailId).visits.push(v);
      cur = { trailId: cur.trailId, visitId: v.id };
    }
    const first = state.trails.length === 1 && trailOf(cur.trailId).visits.length <= 2;
    $("next").value = "";
    commit({ refit: first });
    blip();
    toast(skin.milestone?.(before, statInfo().clicks));
    $("next").focus();
  }
  function stepBack() {
    if (!cur) return;
    const v = D.trailIndex.get(cur.trailId).byId.get(cur.visitId);
    if (v.parent != null) {
      cur = { trailId: cur.trailId, visitId: v.parent };
      afterCursorMove();
    }
  }
  function newTrail() {
    cur = null;
    afterCursorMove();
    $("next").focus();
  }
  function afterCursorMove() {
    graph.setCursor(cursorArticle());
    renderBuilder();
    renderTrails();
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return;
    const o = JSON.parse(s);
    state = { ...o.state, layout: graph.getPositions() };
    cur = o.cur;
    commit();
  }
  function lastVisit(trailId, title) {
    const t = trailOf(trailId);
    if (!t) return null;
    for (let i = t.visits.length - 1; i >= 0; i--) if (t.visits[i].article === title) return t.visits[i];
    return null;
  }
  function clickArticle(title) {
    blip(0.75);
    if (cur) {
      const v = lastVisit(cur.trailId, title);
      if (v) {
        cur = { trailId: cur.trailId, visitId: v.id };
        afterCursorMove();
      }
    }
    pinned = { kind: "article", id: title };
    openCard(title);
    applyHighlight();
    renderTrails();
    zoomToPinned();
  }
  var focusSet = null;
  var inView = (steps) => steps.filter((s) => DV.articles.has(s.from) && DV.articles.has(s.to) && (!focusSet || focusSet.has(s.from) && focusSet.has(s.to)));
  function specFor(target) {
    if (!target) return null;
    if (target.kind === "edge") {
      const [a2, b] = target.id.split("\0");
      return { steps: inView(routesThrough(D, a2, b)), colorOf, numbers: null, edgeKey: target.id };
    }
    if (target.kind === "trail") {
      const t = trailOf(target.id);
      if (!t) return null;
      const numbers2 = /* @__PURE__ */ new Map();
      t.visits.forEach((v, i) => {
        if (!numbers2.has(v.article)) numbers2.set(v.article, i + 1);
      });
      return { steps: inView(trailSteps(D, [t.id])), colorOf, numbers: numbers2, focus: t.visits[0].article };
    }
    const a = D.articles.get(target.id);
    if (!a) return null;
    const steps = inView([...trailSteps(D, [...a.starts]), ...routesTo(D, a.title)]);
    const trails = new Set(steps.map((s) => s.trailId));
    let numbers = null;
    if (trails.size === 1) {
      const t = trailOf([...trails][0]);
      numbers = /* @__PURE__ */ new Map();
      const lit = new Set(steps.flatMap((s) => [s.from, s.to]));
      t.visits.forEach((v, i) => {
        if (lit.has(v.article) && !numbers.has(v.article)) numbers.set(v.article, i + 1);
      });
    }
    return { steps, colorOf, numbers, focus: a.title };
  }
  function applyHighlight() {
    graph.setHighlight(specFor(hovered || pinned));
  }
  function zoomToPinned() {
    const sp = specFor(pinned);
    if (!sp) return;
    const pad2 = $("card").style.display === "block" ? $("card").offsetWidth + 24 : 0;
    graph.focusOn(new Set(sp.steps.flatMap((s) => [s.from, s.to]).concat(sp.focus ? [sp.focus] : []).concat(sp.edgeKey ? sp.edgeKey.split("\0") : [])), pad2);
  }
  function msg(t, warn = false) {
    $("msg").textContent = t || "";
    $("msg").classList.toggle("warn", warn);
  }
  function renderAll() {
    renderStats();
    renderBuilder();
    renderTrails();
    $("titles").innerHTML = [...D.articles.keys()].sort().map((t) => `<option value="${esc(t)}">`).join("");
    $("empty").style.display = state.trails.length ? "none" : "flex";
    $("lang").value = state.lang;
    if (pinned?.kind === "article") openCard(pinned.id);
    if (pinned?.kind === "edge") openEdgeCard(pinned.id);
    renderSaved();
  }
  function statInfo() {
    const clicks = [...DV.links.values()].reduce((s, l) => s + l.total, 0);
    let top = null;
    for (const l of DV.links.values()) if (!top || l.total > top.total) top = l;
    const trails = range ? new Set([...DV.articles.values()].flatMap((a) => [...a.trails])).size : state.trails.length;
    return { articles: DV.articles.size, clicks, trails, top: top && top.total > 1 ? top : null };
  }
  function renderStats() {
    const i = statInfo();
    $("stats").textContent = skin.stats ? skin.stats(i) : `${i.articles} ${W("articles")} \xB7 ${i.clicks} ${W("clicks")} \xB7 ${i.trails} ${W("trails")}` + (i.top ? ` \xB7 strongest: ${i.top.a} \u2194 ${i.top.b} \xD7${i.top.total}` : "");
    $("ticker").firstElementChild.textContent = skin.ticker ? skin.ticker(i) : "";
    if (skin.ui?.includes("eq")) $("eq").innerHTML = state.trails.slice(-16).map((t, k) => `<i style="height:${Math.min(18, 3 + t.visits.length * 1.4)}px;animation-delay:${k % 5 * -0.13}s"></i>`).join("");
    if (skin.ui?.includes("spark")) {
      const v = state.trails.slice(-40).map((t) => 1 / t.visits.length), mx = Math.max(...v, 1e-9);
      $("spark").innerHTML = v.length > 1 ? `loss <svg width="90" height="16" viewBox="0 0 90 16"><polyline points="${v.map((n, k) => `${(k / (v.length - 1) * 88 + 1).toFixed(1)},${(15 - n / mx * 13).toFixed(1)}`).join(" ")}"/></svg>` : "";
    }
  }
  function renderBuilder() {
    const box = $("crumbs");
    if (!cur) {
      box.innerHTML = "";
      $("qlabel").innerHTML = state.trails.length ? `Link 1: first page of a new ${esc(W("trail"))}` : "Link 1: first page";
    } else {
      const chain = chainTo(D.trailIndex.get(cur.trailId), cur.visitId);
      box.innerHTML = chain.map((v, i) => `<span class="c${i === chain.length - 1 ? " cur" : ""}" data-v="${v.id}" title="${esc(v.article)}"><i>${i + 1}</i>${esc(v.article)}</span>`).join('<span class="sep">\u203A</span>');
      box.querySelectorAll(".c").forEach((el) => el.onclick = () => {
        cur = { trailId: cur.trailId, visitId: el.dataset.v };
        afterCursorMove();
        $("next").focus();
      });
      $("qlabel").innerHTML = `Link ${chain.length + 1}: what did you click on <em>${esc(chain[chain.length - 1].article)}</em>?`;
    }
    $("back").disabled = !cur || D.trailIndex.get(cur.trailId).byId.get(cur.visitId).parent == null;
    $("newtrail").disabled = !cur;
    $("undo").disabled = !undoStack.length;
    hintKnown();
  }
  function hintKnown() {
    const t = normTitle($("next").value);
    const a = t && D.articles.get(t);
    if (a) msg(`Already in your graph: ${a.visits} visit${a.visits === 1 ? "" : "s"} in ${a.trails.size} trail${a.trails.size === 1 ? "" : "s"}. It will link into the same article.`);
    else msg("");
  }
  var armed = /* @__PURE__ */ new Set();
  function renderTrails() {
    $("tcount").textContent = `${state.trails.length} ${W("trails")}`;
    const box = $("trails");
    const q = $("tsearch").value.trim().toLowerCase();
    let list = [...state.trails].reverse();
    if (q) list = list.filter((t) => trailLabel(t).toLowerCase().includes(q) || t.visits.some((v) => v.article.toLowerCase().includes(q)));
    const LIMIT = 150, more = list.length - LIMIT;
    if (cur && !list.slice(0, LIMIT).some((t) => t.id === cur.trailId)) {
      const ct = trailOf(cur.trailId);
      if (ct) list = [ct, ...list];
    }
    list = list.slice(0, LIMIT);
    box.innerHTML = list.map((t) => {
      const ends = t.visits.filter((v) => !t.visits.some((w) => w.parent === v.id)).length;
      const date = new Date(t.created).toLocaleDateString(void 0, { day: "numeric", month: "short" });
      const cls = ["tr", cur?.trailId === t.id ? "active" : "", pinned?.kind === "trail" && pinned.id === t.id ? "pinned" : ""].join(" ");
      return `<div class="${cls}" data-t="${t.id}">
      <span class="sw" style="background:${colorOf(t.id)};color:${colorOf(t.id)}"></span>
      <div class="tx"><div class="nm">${esc(trailLabel(t))}</div><div class="mt">${t.visits.length} pages \xB7 ${ends} end${ends === 1 ? "" : "s"} \xB7 ${date}</div></div>
      <button class="ic" data-act="rename" title="Rename">\u270E</button>
      <button class="ic${armed.has(t.id) ? " armed" : ""}" data-act="del" title="Delete">${armed.has(t.id) ? "Delete?" : "\xD7"}</button>
    </div>`;
    }).join("") + (more > 0 ? `<div class="tr more">${more} more ${esc(W("trails"))}: type in the search box to find them</div>` : "");
    box.querySelectorAll(".tr[data-t]").forEach((row) => {
      const id = row.dataset.t;
      row.onmouseenter = () => {
        hovered = { kind: "trail", id };
        applyHighlight();
      };
      row.onmouseleave = () => {
        hovered = null;
        applyHighlight();
      };
      row.onclick = (e) => {
        const act = e.target.dataset?.act;
        if (act === "del") {
          if (!armed.has(id)) {
            armed.add(id);
            renderTrails();
            setTimeout(() => {
              armed.delete(id);
              renderTrails();
            }, 2500);
            return;
          }
          snapshot();
          armed.delete(id);
          state.trails = state.trails.filter((t2) => t2.id !== id);
          if (cur?.trailId === id) cur = null;
          hovered = null;
          commit();
          return;
        }
        if (act === "rename") {
          startRename(row, id);
          return;
        }
        if (e.target.tagName === "INPUT") return;
        const t = trailOf(id);
        cur = { trailId: id, visitId: t.visits[t.visits.length - 1].id };
        pinned = { kind: "trail", id };
        closeCard();
        afterCursorMove();
        applyHighlight();
        zoomToPinned();
        $("next").focus();
      };
    });
  }
  function startRename(row, id) {
    const t = trailOf(id);
    const nm = row.querySelector(".nm");
    nm.innerHTML = `<input value="${esc(t.name || trailLabel(t))}">`;
    const inp = nm.querySelector("input");
    inp.focus();
    inp.select();
    let finished = false;
    const done = (save) => {
      if (finished) return;
      finished = true;
      if (save) {
        snapshot();
        t.name = inp.value.trim();
        commit();
      } else renderTrails();
    };
    inp.onkeydown = (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    };
    inp.onblur = () => done(true);
  }
  function openCard(title) {
    const a = D.articles.get(title);
    if (!a) return closeCard();
    const out = [], inn = [];
    for (const l of D.links.values()) {
      if (l.a === title) {
        if (l.ab) out.push([l.b, l.ab]);
        if (l.ba) inn.push([l.b, l.ba]);
      }
      if (l.b === title) {
        if (l.ba) out.push([l.a, l.ba]);
        if (l.ab) inn.push([l.a, l.ab]);
      }
    }
    const list = (arr) => arr.length ? `<ul>${arr.sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, n]) => `<li><a data-go="${esc(t)}">${esc(t)}</a><span class="w">\xD7${n}</span></li>`).join("")}</ul>` : "<ul><li>none</li></ul>";
    const mode = a.starts.size ? `Start of ${a.starts.size} trail${a.starts.size === 1 ? "" : "s"}: showing every full journey from here, plus every route that led here.` : "Showing every route that led here.";
    $("card").innerHTML = `<div class="title"><span class="ico ico-brain"></span><span class="tt">Properties: ${esc(title)}</span><button class="x" id="cx" aria-label="Close">\xD7</button></div>
    <div class="inner">
    <div class="meta"><b>${esc(title)}</b><br>${a.visits} visit${a.visits === 1 ? "" : "s"} \xB7 ${a.trails.size} trail${a.trails.size === 1 ? "" : "s"}</div>
    <div class="mode">${mode}</div>
    <fieldset><legend>You went on to</legend>${list(out)}</fieldset>
    <fieldset><legend>You came from</legend>${list(inn)}</fieldset>
    <div class="btns">
      <button class="btn default" id="cont">${cur && lastVisit(cur.trailId, title) ? "Add next link from here" : "Start new trail here"}</button>
      <a class="ext" href="${wikiUrl(title)}" target="_blank" rel="noopener">Open on Wikipedia</a>
    </div></div>`;
    $("card").style.display = "block";
    $("cx").onclick = () => {
      pinned = null;
      closeCard();
      applyHighlight();
    };
    $("card").querySelectorAll("[data-go]").forEach((el) => el.onclick = () => clickArticle(el.dataset.go));
    $("cont").onclick = () => {
      showBuilder();
      if (cur && lastVisit(cur.trailId, title)) {
        $("next").focus();
        return;
      }
      snapshot();
      const t = { id: uid(), name: "", created: (/* @__PURE__ */ new Date()).toISOString(), visits: [{ id: uid(), article: title, parent: null, t: Date.now() }] };
      state.trails.push(t);
      cur = { trailId: t.id, visitId: t.visits[0].id };
      commit();
      $("next").focus();
    };
  }
  function closeCard() {
    $("card").style.display = "none";
  }
  $("add").onclick = addLink;
  $("next").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addLink();
  });
  $("next").addEventListener("input", hintKnown);
  $("back").onclick = stepBack;
  $("newtrail").onclick = newTrail;
  $("undo").onclick = undo;
  $("fit").onclick = () => graph.fit(true);
  document.addEventListener("keydown", (e) => {
    const typing = e.target.tagName === "INPUT" && e.target.value;
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !typing) {
      e.preventDefault();
      undo();
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      stepBack();
    }
    if (e.key === "Escape" && focusTitle && !pinned) {
      setFocus(null);
      return;
    }
    if (e.key === "Escape") {
      closeStart();
      const had = pinned;
      pinned = null;
      closeCard();
      applyHighlight();
      renderTrails();
      if (had) graph.fit(true);
    }
  });
  $("lang").onchange = () => {
    state.lang = $("lang").value;
    saveLocal(state);
    if (pinned?.kind === "article") openCard(pinned.id);
  };
  $("tsearch").addEventListener("input", () => {
    clearTimeout(window.__tsT);
    window.__tsT = setTimeout(renderTrails, 120);
  });
  var loadExample = () => {
    closeStart();
    snapshot();
    state = exampleState();
    cur = null;
    pinned = null;
    range = null;
    closeCard();
    graph.reset();
    commit({ refit: true });
  };
  function loadDataScript(src, name) {
    const key = src.split("/").pop().replace(/\.js$/, "");
    if (window[name]?.[key]) return Promise.resolve(window[name]);
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => window[name] ? res(window[name]) : rej(new Error("empty"));
      el.onerror = () => rej(new Error("not found"));
      document.head.appendChild(el);
    });
  }
  async function loadTestData(which = "wikispeedia-1000") {
    closeStart();
    status("Loading synapses\u2026");
    try {
      await loadDataScript(`data/${which}.js`, "WIKI_TRAILS_DATA");
      const s = validate(window.WIKI_TRAILS_DATA[which]);
      snapshot();
      state = s;
      cur = null;
      pinned = null;
      range = null;
      setFocus(null, false);
      closeCard();
      setPreset("all", false);
      graph.reset();
      commit({ refit: true });
      status(`Loaded ${s.trails.length} real human trails from Wikispeedia.${graph.isSettling() ? " Laying out the map\u2026" : ""}`);
    } catch (err) {
      status(`Could not load test data (${err.message}).`);
    }
  }
  $("example").onclick = loadExample;
  $("testdata").onclick = () => loadTestData("wikispeedia-1000");
  $("testdata2").onclick = () => loadTestData("wikispeedia-2years");
  $("example2").onclick = () => loadTestData("wikispeedia-1000");
  var fx = createEffects($("fx"));
  var skin = savedSkin();
  var chosen = skin.id;
  var W = (k) => skin.words?.[k] ?? k;
  var DEFAULT_TITLES = { builder: "TRAILBLZ.EXE", trails: "Trails", brain: "BRAIN.EXE - C:\\WIKI\\TRAILS" };
  function applySkin(id, { persist = true } = {}) {
    skin = skinById(id);
    const html = document.documentElement;
    html.dataset.skin = skin.id;
    html.dataset.chrome = skin.chrome || "bevel";
    html.dataset.ui = (skin.ui || []).join(" ");
    graph.setPalette(skin);
    fx.set(skin.fx);
    const t = { ...DEFAULT_TITLES, ...skin.titles || {} };
    $("tt-builder").textContent = t.builder;
    $("tt-trails").textContent = t.trails;
    $("tt-brain").textContent = t.brain;
    $("task-builder").textContent = t.builder;
    $("task-brain").textContent = t.brain;
    $("task-trails").textContent = t.trails;
    $("lbl-export").textContent = skin.menu?.export || "Export JSON\u2026";
    $("lbl-import").textContent = skin.menu?.import || "Import JSON\u2026";
    $("skinname").textContent = skin.name;
    $("newtrail").textContent = `New ${W("trail")}`;
    if (persist) {
      chosen = skin.id;
      rememberSkin(skin.id);
    }
    $("banner").classList.remove("on");
    renderStats();
    renderBuilder();
    renderTrails();
    applyHighlight();
    markChosen();
  }
  var toastT;
  function toast(t, sound = true) {
    if (!t) return;
    const el = $("toast");
    el.textContent = t;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("on"), 1700);
    if (sound) blip(1.5);
  }
  function bannerFor(t) {
    const el = $("banner");
    const a = t && D.articles.get(t);
    if (!a || !skin.banner) {
      el.classList.remove("on");
      return;
    }
    let topIn = null, topInCount = 0;
    for (const l of D.links.values()) {
      if (l.a === t && l.ba > topInCount) {
        topIn = l.b;
        topInCount = l.ba;
      }
      if (l.b === t && l.ab > topInCount) {
        topIn = l.a;
        topInCount = l.ab;
      }
    }
    const txt = skin.banner({ title: t, a, topIn, topInCount });
    if (!txt) {
      el.classList.remove("on");
      return;
    }
    el.textContent = txt;
    el.classList.add("on");
  }
  $("stage").addEventListener("mousemove", (e) => {
    if (!skin.ui?.includes("eye")) return;
    const r = $("eye").getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
    $("eye").firstElementChild.style.transform = `translate(${dx / d * Math.min(14, d / 20)}px, ${dy / d * Math.min(14, d / 20)}px)`;
  });
  var soundOn = false;
  try {
    soundOn = localStorage.getItem("wiki-trails.sound") === "1";
  } catch {
  }
  $("sound").checked = soundOn;
  $("sound").onchange = () => {
    soundOn = $("sound").checked;
    try {
      localStorage.setItem("wiki-trails.sound", soundOn ? "1" : "0");
    } catch {
    }
    blip();
  };
  var actx;
  function blip(mult = 1) {
    if (!soundOn) return;
    try {
      actx || (actx = new AudioContext());
      const o = actx.createOscillator(), g = actx.createGain(), sd = skin.sound || { wave: "square", f: 880 }, now = actx.currentTime;
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
  var gal = $("gallery");
  var MOCK = `<svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice"><path class="ml" d="M18 40 Q40 10 62 28 T104 18" stroke-width="3"/><path class="ml" d="M18 40 L50 50 L62 28" stroke-width="1" opacity=".55"/><path class="ml" d="M62 28 L88 46" stroke-width="1.6" opacity=".8"/><circle class="mn2" cx="18" cy="40" r="4.5"/><circle class="mn" cx="62" cy="28" r="5.5"/><circle class="mn" cx="104" cy="18" r="3"/><circle class="mn" cx="50" cy="50" r="2.5"/><circle class="mn" cx="88" cy="46" r="3"/></svg>`;
  function buildGallery() {
    $("gal-body").innerHTML = CATS.map(([c, label]) => `<div class="gal-cat">${label}</div><div class="gal-grid">${SKINS.filter((s) => s.cat === c).map((s) => `<button class="card" data-skin="${s.id}" data-chrome="${s.chrome || "bevel"}" data-id="${s.id}"><div class="mock-desk"><div class="mock-win"><div class="mock-title">${esc(s.titles?.brain || s.name)}</div><div class="mock-screen">${MOCK}</div><div class="mock-row"><span class="mock-field"></span><span class="mock-btn">OK</span></div></div></div><div class="card-name">${esc(s.name)}</div><div class="card-sub">${esc(s.blurb)}</div></button>`).join("")}</div>`).join("");
    for (const c of $("gal-body").querySelectorAll(".card")) {
      c.onmouseenter = () => {
        stopShow();
        applySkin(c.dataset.id, { persist: false });
      };
      c.onfocus = c.onmouseenter;
      c.onclick = () => {
        applySkin(c.dataset.id);
        blip();
      };
      c.ondblclick = () => {
        applySkin(c.dataset.id);
        hideGallery();
      };
    }
    $("gal-body").onmouseleave = () => {
      if (skin.id !== chosen) applySkin(chosen, { persist: false });
    };
  }
  function markChosen() {
    for (const c of document.querySelectorAll(".card")) c.classList.toggle("chosen", c.dataset.id === chosen);
    const cs = skinById(chosen);
    $("gal-now").textContent = skin.id === chosen ? `Current: ${cs.name}` : `Trying: ${skin.name} (current: ${cs.name})`;
  }
  function openGallery() {
    closeStart();
    stopShow();
    if (!$("gal-body").children.length) buildGallery();
    markChosen();
    gal.hidden = false;
    gal.querySelector(".card.chosen")?.scrollIntoView({ block: "nearest" });
  }
  function hideGallery() {
    gal.hidden = true;
  }
  function cancelGallery() {
    hideGallery();
    if (skin.id !== chosen) applySkin(chosen, { persist: false });
  }
  function flip(dir) {
    const i = SKINS.findIndex((s) => s.id === skin.id);
    applySkin(SKINS[(i + dir + SKINS.length) % SKINS.length].id);
    blip();
    document.querySelector(`.card[data-id="${skin.id}"]`)?.scrollIntoView({ block: "nearest" });
  }
  var showing = null;
  function startShow() {
    hideGallery();
    const step = () => {
      const i = SKINS.findIndex((s) => s.id === skin.id);
      applySkin(SKINS[(i + 1) % SKINS.length].id, { persist: false });
      toast(skin.name, false);
      status(`Slideshow: ${skin.name}. Click or press any key to keep it.`);
    };
    step();
    showing = setInterval(step, 3800);
    setTimeout(() => {
      document.addEventListener("pointerdown", keepShow, { once: true });
      document.addEventListener("keydown", keepShow, { once: true });
    }, 0);
  }
  function stopShow() {
    if (showing) {
      clearInterval(showing);
      showing = null;
    }
  }
  function keepShow() {
    if (!showing) return;
    stopShow();
    applySkin(skin.id);
    toast(`Kept: ${skin.name}`, false);
    status("Ready.");
  }
  $("skinbtn").onclick = openGallery;
  $("skins2").onclick = openGallery;
  $("skinsmenu").onclick = openGallery;
  $("gal-ok").onclick = () => {
    applySkin(skin.id);
    hideGallery();
  };
  $("galclose").onclick = cancelGallery;
  $("gal-prev").onclick = () => flip(-1);
  $("gal-next").onclick = () => flip(1);
  $("gal-show").onclick = startShow;
  $("gal-rand").onclick = () => {
    let s;
    do {
      s = SKINS[Math.floor(Math.random() * SKINS.length)];
    } while (s.id === skin.id);
    applySkin(s.id);
    blip();
    document.querySelector(`.card[data-id="${s.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  gal.addEventListener("click", (e) => {
    if (e.target === gal) cancelGallery();
  });
  document.addEventListener("keydown", (e) => {
    if (!gal.hidden) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        flip(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        flip(-1);
      } else if (e.key === "Escape") {
        e.stopImmediatePropagation();
        cancelGallery();
      } else if (e.key === "Enter") {
        applySkin(skin.id);
        hideGallery();
      }
      return;
    }
    if ((e.key === "s" || e.key === "S") && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !e.ctrlKey && !e.metaKey && !e.altKey) openGallery();
  }, true);
  applySkin(skin.id, { persist: false });
  function closeStart() {
    $("startmenu").hidden = true;
    $("startbtn").classList.remove("pressed");
    $("startbtn").setAttribute("aria-expanded", "false");
  }
  $("startbtn").onclick = (e) => {
    e.stopPropagation();
    const open = $("startmenu").hidden;
    $("startmenu").hidden = !open;
    $("startbtn").classList.toggle("pressed", open);
    $("startbtn").setAttribute("aria-expanded", String(open));
  };
  $("startmenu").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeStart);
  $("export").addEventListener("click", closeStart);
  $("import").addEventListener("change", closeStart);
  var tickClock = () => {
    $("clock").textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  tickClock();
  setInterval(tickClock, 15e3);
  function status(t) {
    $("status").textContent = t;
  }
  function statusFor(t) {
    const a = t && D.articles.get(t);
    if (!a) {
      status(cursorArticle() ? `Cursor: ${cursorArticle()}` : "Ready.");
      return;
    }
    if (skin.hover) {
      status(skin.hover(a));
      return;
    }
    status(`${a.title}: ${a.visits} visit(s), ${a.trails.size} trail(s)${a.starts.size ? `, start of ${a.starts.size}` : ""}`);
  }
  function boot() {
    let seen = false;
    try {
      seen = sessionStorage.getItem("wt-boot");
      sessionStorage.setItem("wt-boot", "1");
    } catch {
    }
    if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const el = $("boot"), log = $("bootlog");
    el.hidden = false;
    const bios = ["bevel", "terminal"].includes(skin.chrome);
    const lines = [...skin.boot, ...bios ? ['Detecting curiosity........ <span class="ok">FOUND</span>', 'Loading synapses........... <span class="ok">OK</span>', ""] : [""], '<span class="ok">Starting Wiki Trails\u2026</span>'];
    return new Promise((res) => {
      let i = 0;
      const done = () => {
        clearInterval(iv);
        el.hidden = true;
        res();
      };
      const iv = setInterval(() => {
        log.innerHTML += lines[i++] + "\n";
        if (i >= lines.length) {
          clearInterval(iv);
          setTimeout(done, 450);
        }
      }, 140);
      el.onclick = done;
      document.addEventListener("keydown", done, { once: true });
    });
  }
  var clearArmed = false;
  $("clear").onclick = () => {
    if (!clearArmed) {
      clearArmed = true;
      $("clear").lastChild.textContent = "Click again to clear";
      setTimeout(() => {
        clearArmed = false;
        $("clear").lastChild.textContent = "Clear all";
      }, 2500);
      return;
    }
    clearArmed = false;
    $("clear").lastChild.textContent = "Clear all";
    closeStart();
    snapshot();
    state = { ...emptyState(), lang: state.lang };
    cur = null;
    pinned = null;
    range = null;
    closeCard();
    graph.reset();
    commit({ refit: true });
  };
  var rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => graph.fit(false), 150);
  });
  function clickEdge(l) {
    blip(0.9);
    pinned = { kind: "edge", id: l.key };
    openEdgeCard(l.key);
    applyHighlight();
    renderTrails();
    zoomToPinned();
  }
  function openEdgeCard(key) {
    const l = DV.links.get(key) || D.links.get(key);
    if (!l) return closeCard();
    const trails = [...l.trails || []].map(trailOf).filter(Boolean).sort((p, q) => Date.parse(q.created) - Date.parse(p.created));
    const when = l.last ? new Date(l.last).toLocaleDateString(void 0, { day: "numeric", month: "short", year: "numeric" }) : "?";
    $("card").innerHTML = `<div class="title"><span class="ico ico-brain"></span><span class="tt">Connection</span><button class="x" id="cx" aria-label="Close">\xD7</button></div>
    <div class="inner">
    <div class="meta"><b><a data-go="${esc(l.a)}">${esc(l.a)}</a> \u2194 <a data-go="${esc(l.b)}">${esc(l.b)}</a></b><br>clicked ${l.total}\xD7 \xB7 last on ${when}</div>
    <div class="mode">${l.ab}\xD7 ${esc(l.a)} \u2192 ${esc(l.b)}<br>${l.ba}\xD7 ${esc(l.b)} \u2192 ${esc(l.a)}<br>Showing every route that used this connection.</div>
    <fieldset><legend>In ${trails.length} ${esc(W(trails.length === 1 ? "trail" : "trails"))}</legend><ul>${trails.slice(0, 10).map((t) => `<li><a data-trail="${t.id}">${esc(trailLabel(t))}</a><span class="w">${new Date(t.created).toLocaleDateString(void 0, { day: "numeric", month: "short" })}</span></li>`).join("")}${trails.length > 10 ? `<li>\u2026and ${trails.length - 10} more</li>` : ""}</ul></fieldset>
    </div>`;
    $("card").style.display = "block";
    $("cx").onclick = () => {
      pinned = null;
      closeCard();
      applyHighlight();
    };
    $("card").querySelectorAll("[data-go]").forEach((el) => {
      el.style.cursor = "pointer";
      el.onclick = () => clickArticle(el.dataset.go);
    });
    $("card").querySelectorAll("[data-trail]").forEach((el) => el.onclick = () => {
      pinned = { kind: "trail", id: el.dataset.trail };
      closeCard();
      applyHighlight();
      renderTrails();
      zoomToPinned();
    });
  }
  function setFocus(title, refitView = true) {
    focusTitle = title;
    const chip = $("focuschip");
    if (title) {
      let nb = graph.neighbourhood(title, 1);
      if (nb.size < 25) nb = graph.neighbourhood(title, 2);
      focusSet = nb;
      graph.setView({ focus: nb });
      pinned = null;
      hovered = null;
      closeCard();
      chip.hidden = false;
      chip.innerHTML = `Focus: ${esc(title)} <b>\xD7</b>`;
      status(`Focus: ${title} and its ${nb.size - 1} neighbours. Double-click another article to move, Esc to leave.`);
    } else {
      focusSet = null;
      graph.setView({ focus: null });
      chip.hidden = true;
    }
    graph.setVisible(DV);
    applyHighlight();
    if (refitView) graph.fit(true);
  }
  $("focuschip").onclick = () => setFocus(null);
  var VKEY = "wiki-trails.view";
  function saveView() {
    try {
      localStorage.setItem(VKEY, JSON.stringify({ density: +$("density").value, fade: $("fade").checked, max: !!document.documentElement.dataset.max }));
    } catch {
    }
  }
  function restoreView() {
    let v = {};
    try {
      v = JSON.parse(localStorage.getItem(VKEY)) || {};
    } catch {
    }
    if (v.density) $("density").value = v.density;
    if (v.fade === false) $("fade").checked = false;
    graph.setView({ density: +$("density").value, fade: $("fade").checked });
    if (v.max) toggleMax(true);
  }
  $("density").oninput = () => {
    graph.setView({ density: +$("density").value });
    saveView();
  };
  $("fade").onchange = () => {
    graph.setView({ fade: $("fade").checked });
    saveView();
  };
  function toggleMax(on = !document.documentElement.dataset.max) {
    if (on) document.documentElement.dataset.max = "1";
    else delete document.documentElement.dataset.max;
    $("maxbtn").classList.toggle("on", !!on);
    $("maxbtn").textContent = on ? "\u26F6 Restore" : "\u26F6 Maximize";
    saveView();
  }
  $("maxbtn").onclick = () => toggleMax();
  document.querySelector("[data-maxbtn]").onclick = () => toggleMax();
  var MINKEY = "wiki-trails.minimized";
  var minimized = /* @__PURE__ */ new Set();
  try {
    minimized = new Set(JSON.parse(localStorage.getItem(MINKEY)) || []);
  } catch {
  }
  function applyMin() {
    for (const id of ["w-builder", "w-trails"]) $(id).hidden = minimized.has(id);
    if (minimized.size === 2) document.documentElement.dataset.colEmpty = "1";
    else delete document.documentElement.dataset.colEmpty;
    document.querySelectorAll(".task[data-win]").forEach((b) => b.classList.toggle("on", !minimized.has(b.dataset.win)));
    try {
      localStorage.setItem(MINKEY, JSON.stringify([...minimized]));
    } catch {
    }
  }
  function setMin(id, on) {
    if (on) minimized.add(id);
    else minimized.delete(id);
    applyMin();
    blip(on ? 0.7 : 1.2);
  }
  document.querySelectorAll("[data-min]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    setMin(b.dataset.min, true);
  });
  document.querySelectorAll(".task[data-win]").forEach((b) => b.onclick = () => {
    const id = b.dataset.win;
    if (id === "w-brain") {
      if (document.documentElement.dataset.max) toggleMax(false);
      return;
    }
    setMin(id, !minimized.has(id));
    if (!minimized.has(id) && document.documentElement.dataset.max) toggleMax(false);
  });
  function showBuilder() {
    if (minimized.has("w-builder")) setMin("w-builder", false);
    if (document.documentElement.dataset.max) toggleMax(false);
  }
  applyMin();
  $("relayout").onclick = () => {
    graph.relayout();
    status("Computing a fresh layout\u2026");
    waitThenFit();
  };
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || !gal.hidden) return;
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      toggleMax();
    }
  });
  var tlBrush = null;
  var tlX = null;
  var tlSilent = false;
  function renderTimeline() {
    const svg = d3.select("#tlsvg"), node = svg.node(), w = node.clientWidth || 600, h = node.clientHeight || 42;
    svg.selectAll("*").remove();
    const span = timeSpan(state);
    if (!span) {
      $("tllabel").textContent = "";
      return;
    }
    const [t0, t1] = [span[0], Math.max(span[1], span[0] + 864e5)];
    const days = (t1 - t0) / 864e5, binMs = (days > 400 ? 7 : 1) * 864e5;
    const bins = /* @__PURE__ */ new Map();
    for (const tr of state.trails) for (const v of tr.visits) {
      if (v.parent == null) continue;
      const b = Math.floor((visitTime(tr, v) - t0) / binMs);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    tlX = d3.scaleTime().domain([t0, t1 + binMs]).range([4, w - 4]);
    const mx = Math.max(1, ...bins.values()), y = d3.scaleSqrt().domain([0, mx]).range([0, h - 16]);
    const bw = Math.max(1, tlX(t0 + binMs) - tlX(t0) - 0.5);
    svg.append("g").selectAll("rect").data([...bins]).join("rect").attr("class", "bar").attr("x", ([b]) => tlX(t0 + b * binMs)).attr("width", bw).attr("y", ([, c]) => h - 14 - y(c)).attr("height", ([, c]) => Math.max(1, y(c)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - 14})`).call(d3.axisBottom(tlX).ticks(Math.max(2, Math.floor(w / 110))).tickSize(3));
    tlBrush = d3.brushX().extent([[0, 0], [w, h - 14]]).on("end", (e) => {
      if (tlSilent) return;
      if (!e.selection) {
        setRange(null);
        markPreset("all");
        return;
      }
      const [a, b] = e.selection.map((px) => +tlX.invert(px));
      setRange([a, b]);
      markPreset(null);
    });
    const g = svg.append("g").attr("class", "brush").call(tlBrush);
    if (range) {
      tlSilent = true;
      g.call(tlBrush.move, [Math.max(4, tlX(range[0])), Math.min(w - 4, tlX(range[1]))]);
      tlSilent = false;
    }
    renderTimelineLabel();
  }
  function renderTimelineLabel() {
    const f = (t) => new Date(t).toLocaleDateString(void 0, { day: "numeric", month: "short", year: "2-digit" });
    $("tllabel").textContent = range ? `${f(range[0])} \u2013 ${f(range[1])}` : "All time";
  }
  function setRange(r) {
    range = r;
    refresh();
  }
  function markPreset(p) {
    document.querySelectorAll(".tl-presets .mi").forEach((b) => b.classList.toggle("on", b.dataset.range === p));
  }
  function setPreset(p, apply = true) {
    markPreset(p);
    const span = timeSpan(state);
    if (p === "all" || !span) range = null;
    else range = [Math.max(span[0], span[1] - +p * 864e5), span[1] + 1];
    if (apply) {
      refresh();
      renderTimeline();
      graph.fit(true);
    }
  }
  document.querySelectorAll(".tl-presets .mi").forEach((b) => b.onclick = () => setPreset(b.dataset.range));
  new ResizeObserver(() => {
    clearTimeout(window.__tlT);
    window.__tlT = setTimeout(renderTimeline, 150);
  }).observe($("tlsvg"));
  var SKEY = "wiki-trails.saved";
  var savedInfo = { at: 0, clicks: 0, name: "" };
  try {
    savedInfo = { ...savedInfo, ...JSON.parse(localStorage.getItem(SKEY)) };
  } catch {
  }
  var unsaved = false;
  function markDirty() {
    unsaved = true;
  }
  function totalClicks() {
    let n = 0;
    for (const t of state.trails) n += t.visits.length - 1;
    return n;
  }
  function renderSaved() {
    const el = $("savedinfo"), tray = $("trayinfo");
    const ago = savedInfo.at ? Date.now() - savedInfo.at : Infinity, days = Math.floor(ago / 864e5);
    const since = Math.max(0, totalClicks() - (savedInfo.clicks || 0));
    const due = state.trails.length > 0 && (since >= 200 || since > 0 && days >= 7 || !savedInfo.at && totalClicks() >= 30);
    const when = !savedInfo.at ? "never saved to a file" : days >= 1 ? `saved ${days} day${days === 1 ? "" : "s"} ago` : ago < 36e5 ? `saved ${Math.max(1, Math.round(ago / 6e4))} min ago` : "saved today";
    el.textContent = when + (since > 0 && savedInfo.at ? ` \xB7 ${since} new click${since === 1 ? "" : "s"}` : "");
    el.classList.toggle("due", due);
    tray.textContent = due ? "\u{1F4BE} Time to save" : "";
    tray.classList.toggle("due", due);
  }
  async function doSave(saveAs = false) {
    closeStart();
    try {
      state.layout = graph.getPositions();
      const r = await saveToFile(state, { saveAs });
      if (!r) return;
      savedInfo = { at: Date.now(), clicks: totalClicks(), name: r.name };
      try {
        localStorage.setItem(SKEY, JSON.stringify(savedInfo));
      } catch {
      }
      unsaved = false;
      renderSaved();
      status(r.how === "file" ? `Saved to ${r.name}. Ctrl+S updates the same file.` : `Downloaded ${r.name}. Keep it somewhere safe; open it with Open or by dropping it on the window.`);
    } catch (err) {
      status(`Could not save: ${err.message}`);
    }
  }
  var pendingOpen = null;
  function askOpen(s, name) {
    if (!state.trails.length) return applyOpen(s, "replace", name);
    pendingOpen = { s, name };
    const clicks = s.trails.reduce((n, t) => n + t.visits.length - 1, 0);
    $("od-text").innerHTML = `<b>${esc(name || "History file")}</b> has ${s.trails.length} trails and ${clicks} clicks. You currently have ${state.trails.length} trails.`;
    $("opendlg").hidden = false;
    $("od-merge").focus();
  }
  function applyOpen(s, how, name) {
    snapshot();
    if (how === "merge") {
      const m = merge(state, s);
      state = m.state;
      status(`Merged ${name || "the file"}: ${m.added} new trails added.`);
    } else {
      state = s;
      graph.reset();
      status(`Opened ${name || "the file"}: ${s.trails.length} trails.`);
    }
    cur = null;
    pinned = null;
    closeCard();
    range = null;
    setFocus(null, false);
    markPreset("all");
    savedInfo = { at: Date.now(), clicks: totalClicks(), name: name || "" };
    try {
      localStorage.setItem(SKEY, JSON.stringify(savedInfo));
    } catch {
    }
    commit({ refit: true });
    renderSaved();
  }
  $("od-merge").onclick = () => {
    $("opendlg").hidden = true;
    if (pendingOpen) applyOpen(pendingOpen.s, "merge", pendingOpen.name);
    pendingOpen = null;
  };
  $("od-replace").onclick = () => {
    $("opendlg").hidden = true;
    if (pendingOpen) applyOpen(pendingOpen.s, "replace", pendingOpen.name);
    pendingOpen = null;
  };
  $("od-cancel").onclick = $("odclose").onclick = () => {
    $("opendlg").hidden = true;
    pendingOpen = null;
  };
  async function doOpen() {
    closeStart();
    try {
      const r = await pickFile();
      if (r === "fallback") return $("import").click();
      if (r) askOpen(r.state, r.name);
    } catch (err) {
      status(`Could not open: ${err.message}`);
    }
  }
  async function openFileObj(f) {
    try {
      askOpen(await readFile(f), f.name);
    } catch (err) {
      status(`Could not open ${f.name}: ${err.message}`);
    }
  }
  $("import").onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) openFileObj(f);
  };
  $("savebtn").onclick = () => doSave();
  $("export").onclick = () => doSave();
  $("saveas").onclick = () => doSave(true);
  $("openbtn").onclick = doOpen;
  $("importbtn").onclick = doOpen;
  $("trayinfo").onclick = () => doSave();
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
  var dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    if ([...e.dataTransfer?.types || []].includes("Files")) {
      dragDepth++;
      $("dropzone").hidden = false;
    }
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("dropzone").hidden = true;
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("dropzone").hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) openFileObj(f);
  });
  window.addEventListener("beforeunload", (e) => {
  });
  setInterval(renderSaved, 6e4);
  (async () => {
    const booting = boot();
    state = await loadLocal() || await loadPublished() || emptyState();
    restoreView();
    await (document.fonts?.ready ?? Promise.resolve());
    await booting;
    commit({ refit: true });
    renderSaved();
    const rel = (p) => {
      if (!p) return null;
      const r = $("graph").getBoundingClientRect();
      return [r.left + p[0], r.top + p[1]];
    };
    window.__wikiTrails = {
      // handy for debugging in the console (and for tests)
      get state() {
        return state;
      },
      settling: () => graph.isSettling(),
      gstats: () => graph.stats(),
      nodeXY: (t) => rel(graph.screenOf(t)),
      drawMs: () => graph.drawMs(),
      edgeXY: (i) => rel(graph.edgeMid(i))
    };
  })();
})();
