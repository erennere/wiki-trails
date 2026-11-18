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
    for (const t of raw.trails) {
      if (!t || !Array.isArray(t.visits)) continue;
      const ids = /* @__PURE__ */ new Set();
      const visits = [];
      for (const v of t.visits) {
        const article = normTitle(v?.article);
        if (!article || !v.id || ids.has(v.id)) continue;
        if (v.parent != null && !ids.has(v.parent)) continue;
        ids.add(v.id);
        visits.push({ id: String(v.id), article, parent: v.parent ?? null });
      }
      if (visits.length) s.trails.push({ id: String(t.id || uid()), name: String(t.name || ""), created: t.created || (/* @__PURE__ */ new Date()).toISOString(), visits });
    }
    return s;
  }
  var pairKey = (a, b) => a < b ? a + "\0" + b : b + "\0" + a;
  function derive(state2) {
    const articles = /* @__PURE__ */ new Map();
    const links = /* @__PURE__ */ new Map();
    const art = (t) => {
      if (!articles.has(t)) articles.set(t, { title: t, visits: 0, trails: /* @__PURE__ */ new Set(), starts: /* @__PURE__ */ new Set() });
      return articles.get(t);
    };
    const trailIndex = /* @__PURE__ */ new Map();
    state2.trails.forEach((tr, i) => {
      const byId = new Map(tr.visits.map((v) => [v.id, v]));
      const children = new Map(tr.visits.map((v) => [v.id, []]));
      let root = null;
      for (const v of tr.visits) {
        const a = art(v.article);
        a.visits++;
        a.trails.add(tr.id);
        if (v.parent == null) {
          if (!root) root = v;
          a.starts.add(tr.id);
          continue;
        }
        children.get(v.parent)?.push(v.id);
        const from = byId.get(v.parent).article, to = v.article;
        if (from === to) continue;
        const k = pairKey(from, to);
        if (!links.has(k)) {
          const [a1, b1] = from < to ? [from, to] : [to, from];
          links.set(k, { key: k, a: a1, b: b1, ab: 0, ba: 0, total: 0 });
        }
        const l = links.get(k);
        from === l.a ? l.ab++ : l.ba++;
        l.total++;
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
  function trailLabel(tr) {
    if (tr.name) return tr.name;
    const first = tr.visits[0]?.article || "Empty";
    return `${first} trail`;
  }

  // src/storage.js
  var KEY = "wiki-trails.v2";
  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? validate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  function saveLocal(state2) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state2));
    } catch {
    }
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
  async function loadInitial() {
    return loadLocal() || await loadPublished() || emptyState();
  }
  function exportFile(state2, name = "trails.json") {
    const blob = new Blob([JSON.stringify(state2, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }
  function importFile(file) {
    return file.text().then((t) => validate(JSON.parse(t)));
  }

  // src/graph.js
  var d3 = window.d3;
  var TRAIL_COLORS = ["#ffff55", "#55ffff", "#ff55ff", "#ff5555", "#55ff55", "#ffaa00", "#7f7fff", "#ffffff", "#ff9ecf", "#aaff00"];
  var HUB = d3.interpolateRgbBasis(["#1d6b36", "#2fd35a", "#a8ff4d", "#ffe14d", "#ffaa00"]);
  var radius = (n) => Math.round(3 + 1.9 * Math.sqrt(n.visits));
  var BEND = 0.12;
  var SHAPE = "square";
  var HOLLOW = false;
  var LABEL_SIZE = 15;
  var WALKER = false;
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
  var width = (l) => Math.min(11, 0.7 + 1.9 * Math.log2(1 + l.total));
  var alpha = (l) => Math.min(0.9, 0.2 + 0.16 * Math.log2(1 + l.total));
  function createGraph(svgEl, handlers) {
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const defs = svg.append("defs");
    defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%").call((f) => {
      f.append("feGaussianBlur").attr("stdDeviation", 3.2).attr("result", "b");
      const m = f.append("feMerge");
      m.append("feMergeNode").attr("in", "b");
      m.append("feMergeNode").attr("in", "SourceGraphic");
    });
    defs.append("filter").attr("id", "softglow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%").append("feGaussianBlur").attr("stdDeviation", 5);
    const root = svg.append("g");
    const gLinks = root.append("g").attr("class", "links");
    const gStrong = root.append("g").attr("class", "links strong").attr("filter", "url(#glow)");
    const gOver = root.append("g").attr("class", "overlay");
    const gNodes = root.append("g").attr("class", "nodes");
    const gBadges = root.append("g").attr("class", "badges");
    let k = 1;
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => {
      root.attr("transform", e.transform);
      k = e.transform.k;
      updateLabels();
    });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", (e) => {
      if (e.target === svgEl) handlers.onBackground?.();
    });
    let nodes = [], links = [], nodeBy = /* @__PURE__ */ new Map(), linkBy = /* @__PURE__ */ new Map();
    let over = null;
    let cursor = null;
    let maxDeg = 1;
    let labelRank = () => 1;
    const sim = d3.forceSimulation().force("link", d3.forceLink().id((d) => d.title).distance((l) => 28 + 110 / (1 + 0.7 * Math.log2(1 + l.total))).strength((l) => Math.min(1, 0.12 + 0.16 * Math.log2(1 + l.total)))).force("charge", d3.forceManyBody().strength((n) => -180 - 30 * Math.sqrt(n.visits)).distanceMax(600)).force("collide", d3.forceCollide((n) => radius(n) + 7)).force("x", d3.forceX().strength(0.035)).force("y", d3.forceY().strength(0.045)).alphaDecay(0.03).on("tick", tick);
    function ctrl(s, t, extra = 0) {
      const dx = t.x - s.x, dy = t.y - s.y, len = Math.hypot(dx, dy) || 1;
      const bend = len * BEND + extra;
      return { x: (s.x + t.x) / 2 - dy / len * bend, y: (s.y + t.y) / 2 + dx / len * bend };
    }
    function curve(aTitle, bTitle, fromTitle, extra = 0) {
      const a = nodeBy.get(aTitle), b = nodeBy.get(bTitle);
      if (!a || !b) return { d: "", mid: null };
      const c = ctrl(a, b, extra);
      const [s, t] = fromTitle === aTitle ? [a, b] : [b, a];
      const u = 0.58, x = (1 - u) ** 2 * s.x + 2 * (1 - u) * u * c.x + u * u * t.x, y = (1 - u) ** 2 * s.y + 2 * (1 - u) * u * c.y + u * u * t.y;
      const tx = 2 * (1 - u) * (c.x - s.x) + 2 * u * (t.x - c.x), ty = 2 * (1 - u) * (c.y - s.y) + 2 * u * (t.y - c.y);
      return { d: `M${s.x},${s.y}Q${c.x},${c.y} ${t.x},${t.y}`, mid: { x, y, ang: Math.atan2(ty, tx) } };
    }
    function tick() {
      gLinks.selectAll("path").attr("d", (l) => curve(l.a, l.b, l.a).d);
      gStrong.selectAll("path").attr("d", (l) => curve(l.a, l.b, l.a).d);
      gNodes.selectAll("g.node").attr("transform", (n) => `translate(${n.x},${n.y})`);
      if (over) drawOverlay(false);
    }
    function update(derived) {
      const old = new Map(nodes.map((n) => [n.title, n]));
      nodes = [...derived.articles.values()].map((a) => {
        const o = old.get(a.title);
        return Object.assign(o || { x: (Math.random() - 0.5) * 80, y: (Math.random() - 0.5) * 80 }, { title: a.title, visits: a.visits, isStart: a.starts.size > 0, deg: 0 });
      });
      nodeBy = new Map(nodes.map((n) => [n.title, n]));
      for (const l of derived.links.values()) {
        const A = nodeBy.get(l.a), B = nodeBy.get(l.b);
        A.deg += l.total;
        B.deg += l.total;
        if (!old.has(l.a) && old.has(l.b)) {
          A.x = B.x + (Math.random() - 0.5) * 40;
          A.y = B.y + (Math.random() - 0.5) * 40;
        }
        if (!old.has(l.b) && old.has(l.a)) {
          B.x = A.x + (Math.random() - 0.5) * 40;
          B.y = A.y + (Math.random() - 0.5) * 40;
        }
      }
      maxDeg = Math.max(1, ...nodes.map((n) => n.deg));
      links = [...derived.links.values()].map((l) => ({ ...l, source: l.a, target: l.b }));
      linkBy = new Map(links.map((l) => [l.key, l]));
      gLinks.selectAll("path").data(links.filter((l) => l.total < 3), (l) => l.key).join("path").attr("class", "link").attr("stroke-width", width).attr("stroke-opacity", alpha);
      gStrong.selectAll("path").data(links.filter((l) => l.total >= 3), (l) => l.key).join("path").attr("class", "link").attr("stroke-width", width).attr("stroke-opacity", alpha);
      const vs = nodes.map((n) => n.visits).sort((a, b) => b - a);
      labelRank = (count) => vs[Math.min(vs.length - 1, Math.max(0, Math.round(count) - 1))] ?? 1;
      const sel = gNodes.selectAll("g.node").data(nodes, (n) => n.title);
      sel.exit().remove();
      const ent = sel.enter().append("g").attr("class", "node").on("mouseenter", (e, n) => handlers.onHover?.(n.title, n)).on("mouseleave", () => handlers.onHover?.(null)).on("click", (e, n) => {
        e.stopPropagation();
        handlers.onClick?.(n.title);
      }).call(d3.drag().on("start", (e, n) => {
        if (!e.active) sim.alphaTarget(0.2).restart();
        n.fx = n.x;
        n.fy = n.y;
      }).on("drag", (e, n) => {
        n.fx = e.x;
        n.fy = e.y;
      }).on("end", (e, n) => {
        if (!e.active) sim.alphaTarget(0);
        n.fx = null;
        n.fy = null;
      }));
      ent.append("path").attr("class", "core");
      ent.append("text").attr("class", "lbl");
      ent.append("title");
      const all = ent.merge(sel);
      paintNodes(all);
      all.select("text").attr("dy", "0.35em").text((n) => n.title);
      all.select("title").text((n) => `${n.title}
${n.visits} visit${n.visits === 1 ? "" : "s"}${n.isStart ? " \xB7 trail start" : ""}`);
      all.classed("start", (n) => n.isStart).classed("cursor", (n) => n.title === cursor);
      sim.nodes(nodes);
      sim.force("link").links(links);
      sim.alpha(old.size ? 0.5 : 1).restart();
      updateLabels();
      if (over) setHighlight(over);
    }
    function paintNodes(sel = gNodes.selectAll("g.node")) {
      const col = (n) => HUB(Math.log1p(n.deg) / Math.log1p(maxDeg));
      sel.select("path.core").attr("d", (n) => shapePath(SHAPE, radius(n))).attr("shape-rendering", SHAPE === "square" ? "crispEdges" : null).attr("fill", col).style("color", col);
    }
    function updateLabels() {
      const lit = over ? over.nodes : null;
      let litRank = () => 1;
      if (lit) {
        const vs = [...lit].map((t) => nodeBy.get(t)?.visits ?? 0).sort((x, y) => y - x);
        litRank = (c) => vs[Math.min(vs.length - 1, Math.round(c) - 1)] ?? 1;
      }
      gNodes.selectAll("g.node").select("text").attr("opacity", (n) => {
        const z = Math.max(1, k * k);
        if (lit) return lit.has(n.title) && (lit.size <= 45 * z || n.visits >= litRank(45 * z) || n.title === over?.focus) ? 1 : 0;
        if (n.title === cursor || nodes.length <= 40) return 1;
        return n.visits >= labelRank(24 * z) ? 1 : 0;
      }).style("font-size", `${LABEL_SIZE / k}px`).attr("x", (n) => radius(n) * (SHAPE === "star" || SHAPE === "spark" ? 1.5 : 1.2) + 5 / k).style("stroke-width", `${4 / k}px`);
    }
    function setHighlight(spec) {
      over = spec ? { ...spec, nodes: new Set(spec.steps.flatMap((s) => [s.from, s.to]).concat(spec.focus ? [spec.focus] : [])) } : null;
      const lit = over?.nodes;
      gNodes.selectAll("g.node").classed("dim", (n) => lit && !lit.has(n.title)).classed("focus", (n) => over?.focus === n.title);
      gLinks.selectAll("path").classed("dim", !!over);
      gStrong.selectAll("path").classed("dim", !!over);
      drawOverlay(true);
      updateLabels();
    }
    function drawOverlay(rebuild) {
      if (!over) {
        gOver.selectAll("*").remove();
        gBadges.selectAll("*").remove();
        return;
      }
      if (rebuild) {
        const lanes = /* @__PURE__ */ new Map();
        for (const s of over.steps) {
          const pk = s.from < s.to ? s.from + "\0" + s.to : s.to + "\0" + s.from;
          const lk = `${pk}|${s.trailId}|${s.from}`;
          if (!lanes.has(lk)) lanes.set(lk, { pk, trailId: s.trailId, from: s.from, to: s.to, count: 0 });
          lanes.get(lk).count++;
        }
        const perPair = d3.group([...lanes.values()], (l) => l.pk);
        const data = [];
        for (const [, arr] of perPair) arr.forEach((l, i) => data.push({ ...l, extra: (i - (arr.length - 1) / 2) * Math.min(6, 36 / arr.length), id: `${l.pk}|${l.trailId}|${l.from}` }));
        over.lanes = data;
        gOver.selectAll("*").remove();
        const g = gOver.selectAll("g.lane").data(data, (d) => d.id).join("g").attr("class", "lane");
        g.append("path").attr("class", "lane-glow").attr("opacity", data.length > 80 ? 0.12 : null).attr("stroke", (d) => over.colorOf(d.trailId)).attr("stroke-width", (d) => 4 + 2 * Math.log2(1 + d.count));
        g.append("path").attr("class", "lane-flow").attr("stroke", (d) => over.colorOf(d.trailId)).attr("stroke-width", (d) => 1.6 + 1.2 * Math.log2(1 + d.count));
        g.append("path").attr("class", "lane-arrow").attr("fill", (d) => over.colorOf(d.trailId)).attr("shape-rendering", "crispEdges").attr("d", "M-4,-5L-4,5L1,5L1,3L3,3L3,1L5,1L5,-1L3,-1L3,-3L1,-3L1,-5Z");
        gBadges.selectAll("*").remove();
        over.walk = null;
        if (WALKER && over.numbers && over.steps.length) {
          over.walk = [...over.steps].sort((x, y) => x.order - y.order);
          const wk = gBadges.append("g").attr("class", "walker");
          wk.append("path").attr("d", "M0,-9L7,2L3,2L3,8L-3,8L-3,2L-7,2Z");
          wk.append("animateMotion").attr("dur", `${Math.max(4, over.walk.length * 1.1)}s`).attr("repeatCount", "indefinite").attr("rotate", "0");
        }
        if (over.numbers) {
          const b = gBadges.selectAll("g.badge").data([...over.numbers].filter(([t]) => nodeBy.has(t))).join("g").attr("class", "badge");
          b.append("rect").attr("x", -9).attr("y", -8).attr("width", 18).attr("height", 16);
          b.append("text").attr("dy", "0.35em").text(([, n]) => n);
        }
      }
      gOver.selectAll("g.lane").each(function(d) {
        const [a, b] = d.pk.split("\0");
        const c = curve(a, b, d.from, d.extra);
        const g = d3.select(this);
        g.selectAll("path.lane-glow, path.lane-flow").attr("d", c.d);
        if (c.mid) g.select("path.lane-arrow").attr("transform", `translate(${c.mid.x},${c.mid.y}) rotate(${c.mid.ang * 180 / Math.PI})`);
      });
      if (over.walk) gBadges.select("g.walker animateMotion").attr("path", over.walk.map((st) => {
        const [a, b] = st.from < st.to ? [st.from, st.to] : [st.to, st.from];
        return curve(a, b, st.from).d;
      }).join(" "));
      gBadges.selectAll("g.badge").attr("transform", ([t]) => {
        const n = nodeBy.get(t);
        return `translate(${n.x - radius(n) - 9},${n.y - radius(n) - 9})`;
      });
    }
    function setCursor(title) {
      cursor = title;
      gNodes.selectAll("g.node").classed("cursor", (n) => n.title === cursor);
      updateLabels();
    }
    function fit(animate = true) {
      if (!nodes.length) return;
      const box = svgEl.getBoundingClientRect();
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 160, y0 = Math.min(...ys) - 50, y1 = Math.max(...ys) + 50;
      const s = Math.min(1.6, 0.92 * Math.min(box.width / (x1 - x0), box.height / (y1 - y0)));
      const t = d3.zoomIdentity.translate(box.width / 2 - s * (x0 + x1) / 2, box.height / 2 - s * (y0 + y1) / 2).scale(s);
      (animate ? svg.transition().duration(600) : svg).call(zoom.transform, t);
    }
    function focusOn(titles, padLeft = 0) {
      const pts = [...titles].map((t2) => nodeBy.get(t2)).filter(Boolean);
      if (!pts.length) return;
      const full = svgEl.getBoundingClientRect();
      const box = { width: Math.max(200, full.width - padLeft), height: full.height };
      const xs = pts.map((n) => n.x), ys = pts.map((n) => n.y);
      const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 140, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
      const s = Math.max(0.3, Math.min(2.2, 0.85 * Math.min(box.width / (x1 - x0), box.height / (y1 - y0))));
      const t = d3.zoomIdentity.translate(full.width - box.width + box.width / 2 - s * (x0 + x1) / 2, box.height / 2 - s * (y0 + y1) / 2).scale(s);
      svg.transition().duration(650).call(zoom.transform, t);
    }
    function settleAndFit() {
      sim.stop();
      for (let i = 0; i < 220; i++) sim.tick();
      tick();
      fit(false);
      sim.alpha(0.05).restart();
    }
    function setPalette(skin2) {
      HUB = d3.interpolateRgbBasis(skin2.hub);
      TRAIL_COLORS.splice(0, TRAIL_COLORS.length, ...skin2.trails);
      SHAPE = skin2.shape || "square";
      HOLLOW = !!skin2.hollow;
      BEND = skin2.bend ?? 0.12;
      LABEL_SIZE = skin2.labelSize || 15;
      WALKER = !!skin2.walker;
      gStrong.attr("filter", skin2.glow === false ? null : "url(#glow)");
      svg.attr("class", `edge-${skin2.edge || "plain"}${HOLLOW ? " hollow" : ""}`);
      paintNodes();
      tick();
      updateLabels();
      if (over) drawOverlay(true);
    }
    return { update, setPalette, setHighlight, setCursor, fit, focusOn, settleAndFit, hasNode: (t) => nodeBy.has(t) };
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
  var cur = null;
  var pinned = null;
  var hovered = null;
  var undoStack = [];
  var graph = createGraph($("svg"), {
    onHover: (t) => {
      hovered = t ? { kind: "article", id: t } : null;
      applyHighlight();
      statusFor(t);
      bannerFor(t);
    },
    onClick: (t) => clickArticle(t),
    onBackground: () => {
      const had = pinned;
      pinned = null;
      closeCard();
      applyHighlight();
      renderTrails();
      if (had) graph.fit(true);
    }
  });
  var colorOf = (trailId) => TRAIL_COLORS[(D.trailIndex.get(trailId)?.index ?? 0) % TRAIL_COLORS.length];
  var trailOf = (id) => state.trails.find((t) => t.id === id);
  var wikiUrl = (t) => `https://${state.lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;
  function snapshot() {
    undoStack.push(JSON.stringify({ state, cur }));
    if (undoStack.length > 100) undoStack.shift();
  }
  function commit({ refit = false } = {}) {
    saveLocal(state);
    D = derive(state);
    if (cur && !D.trailIndex.get(cur.trailId)?.byId.has(cur.visitId)) cur = null;
    if (pinned?.kind === "trail" && !D.trailIndex.has(pinned.id)) pinned = null;
    if (pinned?.kind === "article" && !D.articles.has(pinned.id)) {
      pinned = null;
      closeCard();
    }
    graph.update(D);
    graph.setCursor(cursorArticle());
    renderAll();
    applyHighlight();
    if (refit) graph.settleAndFit();
  }
  function cursorArticle() {
    return cur ? D.trailIndex.get(cur.trailId)?.byId.get(cur.visitId)?.article ?? null : null;
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
      const v = { id: uid(), article: title, parent: null };
      t.visits.push(v);
      state.trails.push(t);
      cur = { trailId: t.id, visitId: v.id };
    } else {
      const v = { id: uid(), article: title, parent: cur.visitId };
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
    state = o.state;
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
  function specFor(target) {
    if (!target) return null;
    if (target.kind === "trail") {
      const t = trailOf(target.id);
      if (!t) return null;
      const numbers2 = /* @__PURE__ */ new Map();
      t.visits.forEach((v, i) => {
        if (!numbers2.has(v.article)) numbers2.set(v.article, i + 1);
      });
      return { steps: trailSteps(D, [t.id]), colorOf, numbers: numbers2, focus: t.visits[0].article };
    }
    const a = D.articles.get(target.id);
    if (!a) return null;
    const steps = [...trailSteps(D, [...a.starts]), ...routesTo(D, a.title)];
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
    graph.focusOn(new Set(sp.steps.flatMap((s) => [s.from, s.to]).concat(sp.focus ? [sp.focus] : [])), pad2);
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
  }
  function statInfo() {
    const clicks = [...D.links.values()].reduce((s, l) => s + l.total, 0);
    let top = null;
    for (const l of D.links.values()) if (!top || l.total > top.total) top = l;
    return { articles: D.articles.size, clicks, trails: state.trails.length, top: top && top.total > 1 ? top : null };
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
    box.innerHTML = [...state.trails].reverse().map((t) => {
      const ends = t.visits.filter((v) => !t.visits.some((w) => w.parent === v.id)).length;
      const date = new Date(t.created).toLocaleDateString(void 0, { day: "numeric", month: "short" });
      const cls = ["tr", cur?.trailId === t.id ? "active" : "", pinned?.kind === "trail" && pinned.id === t.id ? "pinned" : ""].join(" ");
      return `<div class="${cls}" data-t="${t.id}">
      <span class="sw" style="background:${colorOf(t.id)};color:${colorOf(t.id)}"></span>
      <div class="tx"><div class="nm">${esc(trailLabel(t))}</div><div class="mt">${t.visits.length} pages \xB7 ${ends} end${ends === 1 ? "" : "s"} \xB7 ${date}</div></div>
      <button class="ic" data-act="rename" title="Rename">\u270E</button>
      <button class="ic${armed.has(t.id) ? " armed" : ""}" data-act="del" title="Delete">${armed.has(t.id) ? "Delete?" : "\xD7"}</button>
    </div>`;
    }).join("");
    box.querySelectorAll(".tr").forEach((row) => {
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
      if (cur && lastVisit(cur.trailId, title)) {
        $("next").focus();
        return;
      }
      snapshot();
      const t = { id: uid(), name: "", created: (/* @__PURE__ */ new Date()).toISOString(), visits: [{ id: uid(), article: title, parent: null }] };
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
  $("export").onclick = () => exportFile(state);
  $("import").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const s = await importFile(f);
      snapshot();
      state = s;
      cur = null;
      pinned = null;
      closeCard();
      commit({ refit: true });
      msg(`Imported ${s.trails.length} trails.`);
    } catch (err) {
      msg(`Could not import: ${err.message}`, true);
    }
  };
  var loadExample = () => {
    closeStart();
    snapshot();
    state = exampleState();
    cur = null;
    pinned = null;
    closeCard();
    commit({ refit: true });
  };
  function loadDataScript(src, name) {
    if (window[name]) return Promise.resolve(window[name]);
    return new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => window[name] ? res(window[name]) : rej(new Error("empty"));
      el.onerror = () => rej(new Error("not found"));
      document.head.appendChild(el);
    });
  }
  async function loadTestData() {
    closeStart();
    status("Loading synapses\u2026");
    try {
      const s = validate(await loadDataScript("data/wikispeedia-1000.js", "WIKI_TRAILS_TEST_DATA"));
      snapshot();
      state = s;
      cur = null;
      pinned = null;
      closeCard();
      commit({ refit: true });
      status(`Loaded ${s.trails.length} real human trails from Wikispeedia.`);
    } catch (err) {
      status(`Could not load test data (${err.message}).`);
    }
  }
  $("example").onclick = loadExample;
  $("testdata").onclick = loadTestData;
  $("example2").onclick = loadTestData;
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
    closeCard();
    commit({ refit: true });
  };
  var rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => graph.fit(false), 150);
  });
  (async () => {
    const booting = boot();
    state = await loadInitial();
    await (document.fonts?.ready ?? Promise.resolve());
    await booting;
    commit({ refit: true });
    window.__wikiTrails = { get state() {
      return state;
    } };
  })();
})();
