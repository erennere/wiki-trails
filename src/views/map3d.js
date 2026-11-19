// The map in 3D: every article is a node in one brain-like network, and connections you use
// often are brighter and thicker. Selecting something draws its threads on top: each in its own
// colour, thin where you started and bold where you ended, with a light running from start to end.
// The camera then turns to where the threads spread out best and fills the window with them.
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

const d3 = window.d3;
const UP = new THREE.Vector3(0, 1, 0);

export function createGraph(el, handlers) {
  const stage = el.parentElement;
  const labelBox = document.createElement('div');
  labelBox.className = 'labels3d';
  stage.appendChild(labelBox);

  /* ---------- state ---------- */
  let nodes = [], links = [], nodeBy = new Map(), adj = new Map();
  const posCache = new Map();          // title → [x, y, z], survives updates
  let vis = null, visLinks = null;     // what the time lens shows (null = everything)
  let budget = new Set();              // connections drawn in the overview
  let maxVisits = 1, maxTotal = 1, scale = 1;
  let settling = false, framed = 0, framing = false, lastTouch = -1e9;
  let threads = null, pin = null, cursor = null, plan = null, unit = 0.3; // unit: map distance per screen pixel where the threads are framed
  const view = { density: 1, fade: true, ageFade: 0.85, rotate: true, colourBy: 'reading' };
  let style = { link: '#8a94a6', label: '#222', labelBg: '#fff', cursor: '#e8641c', anchor: '#222', bg: '#ffffff', read: '#2b59c3', skim: '#c5cfe6' };
  let hub = d3.interpolateRgbBasis(['#d3d8e0', '#38404d']);

  const G = new ForceGraph3D(el, { controlType: 'orbit' })
    .backgroundColor('rgba(0,0,0,0)').showNavInfo(false).enableNodeDrag(false)
    .nodeId('id').nodeLabel(() => '').linkLabel(() => '')
    .nodeResolution(10).nodeOpacity(1).linkOpacity(1)
    .cooldownTime(40000)
    .onNodeHover((n) => { el.style.cursor = n ? 'pointer' : ''; handlers.onHover?.(n ? n.id : null); })
    // connections aren't clickable; while threads are drawn, a click on a thread focuses it
    .onNodeClick((n, ev) => { if (!layerClick(ev)) handlers.onClick?.(n.id); })
    .onLinkClick((l, ev) => { if (!layerClick(ev)) handlers.onBackground?.(); })
    .onBackgroundClick((ev) => { if (!layerClick(ev)) handlers.onBackground?.(); })
    .onEngineStop(() => {
      if (!settling) return;
      settling = false;
      for (const n of nodes) if (Number.isFinite(n.x)) { n.fx = n.x; n.fy = n.y; n.fz = n.z; posCache.set(n.id, [n.x, n.y, n.z]); }
      measure();
      drawThreads(); placeLabels(true);
      handlers.onSettled?.();
    });
  G.d3Force('charge').strength(-34);
  G.d3Force('link').distance((l) => 18 + 26 / Math.sqrt(l.total || 1));
  const cam = G.camera(); cam.fov = 30; cam.updateProjectionMatrix();
  const ctl = G.controls();
  ctl.autoRotateSpeed = 0.04; ctl.rotateSpeed = 0.55; ctl.enableDamping = true; ctl.dampingFactor = 0.08;
  ctl.addEventListener('start', () => { lastTouch = performance.now(); ctl.autoRotate = false; });
  ctl.addEventListener('change', () => {
    // zooming far out of the threads goes back to the whole history
    if (threads && framed && !framing && cam.position.distanceTo(ctl.target) > framed * 2.3) handlers.onZoomedOut?.();
  });
  const scene = G.scene();
  const layer = new THREE.Group();
  scene.add(layer);

  /* ---------- colours and styling of the network ---------- */
  const rgba = (c, a) => { const k = d3.color(c) || d3.color('#888'); k.opacity = a; return k.formatRgb(); };
  function nodeColor(n) {
    if (threads) return threads.on.has(n.id) ? rgba(style.link, 0.55) : rgba(style.link, 0.07);
    // pages you read are strong, pages you skimmed pale; pages without either keep the plain colour
    const known = (n.read || 0) + (n.skim || 0);
    if (view.colourBy === 'reading' && known) return d3.interpolateRgb(style.skim, style.read)(n.read / known);
    return hub(Math.sqrt(n.visits / maxVisits));
  }
  const nodeSize = (n) => 0.35 + 5 * Math.sqrt(n.visits / maxVisits);
  function linkStrength(l) { return Math.sqrt(l.total / maxTotal) * (view.fade ? recencyOf(l.last) : 1); }
  let now = Date.now(), span = 1;
  const recencyOf = (t) => 0.08 + 0.92 * Math.exp(-Math.max(0, now - t) / Math.max(14 * 864e5, span / 6));
  function linkColor(l) {
    if (threads) return rgba(style.link, 0.035);
    return rgba(style.link, 0.07 + 0.5 * linkStrength(l));
  }
  const linkWidth = (l) => (threads ? 0 : (l.strong ? 0.25 + 1.1 * linkStrength(l) * scale : 0));
  function restyle() {
    // while threads are drawn, their pages are shown as the threads' own beads instead
    G.nodeColor(nodeColor).nodeVal((n) => (threads ? nodeSize(n) * 0.5 : nodeSize(n)))
      .nodeVisibility((n) => (!vis || vis.has(n.id)) && !(threads && threads.on.has(n.id)))
      .linkVisibility((l) => budget.has(l.key) && (!visLinks || visLinks.has(l.key)))
      .linkColor(linkColor).linkWidth(linkWidth);
  }
  function rebudget() {
    // only the strongest connections are drawn, so years of history stay calm
    const pool = links.filter((l) => !visLinks || visLinks.has(l.key));
    pool.sort((p, q) => linkStrength(q) - linkStrength(p));
    const max = Math.round(1400 * view.density);
    budget = new Set(pool.slice(0, max).map((l) => l.key));
    const strongCut = pool[Math.min(pool.length - 1, Math.round(pool.length * 0.04))];
    for (const l of links) l.strong = !!strongCut && pool.length > 20 && linkStrength(l) >= linkStrength(strongCut);
  }
  function readStyle() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    const dark = document.documentElement.dataset.theme === 'dark';
    style = {
      link: v('--link', dark ? '#9aa3b2' : '#6b778b'), label: v('--label', dark ? '#e6e9ef' : '#1d2330'),
      labelBg: v('--label-bg', dark ? '#1b1e24' : '#ffffff'), cursor: v('--cursor', '#e8641c'),
      anchor: v('--label', dark ? '#f1f1f1' : '#1d2330'), bg: v('--screen-bg', dark ? '#16181d' : '#fafbfc'),
    };
    const c = d3.color(style.bg); if (!c || c.opacity === 0) style.bg = dark ? '#16181d' : '#fafbfc';
    style.read = d3.color(v('--read', '')) ? v('--read', '') : (d3.color(v('--accent', '')) ? v('--accent', '') : '#2b59c3');
    style.skim = d3.color(v('--skim', '')) ? v('--skim', '') : d3.interpolateRgb(style.read, style.bg)(0.6);
  }

  /* ---------- data ---------- */
  /** Show this history. Returns true when the map was empty before. */
  function update(D, DV, layout) {
    const first = nodes.length === 0;
    if (layout) {
      const entries = Object.entries(layout);
      const is3d = entries.length && entries.every(([, p]) => Array.isArray(p) && p.length === 3);
      if (is3d) for (const [t, p] of entries) if (!posCache.has(t)) posCache.set(t, p);
    }
    const old = nodeBy;
    nodeBy = new Map(); nodes = [];
    let fresh = 0;
    for (const a of D.articles.values()) {
      let n = old.get(a.title);
      if (!n) {
        n = { id: a.title };
        const p = posCache.get(a.title);
        if (p) { [n.x, n.y, n.z] = p; n.fx = n.x; n.fy = n.y; n.fz = n.z; } else fresh++;
      }
      n.visits = a.visits; n.last = a.last; n.read = a.read; n.skim = a.skim;
      nodeBy.set(a.title, n); nodes.push(n);
    }
    links = [...D.links.values()].map((l) => ({ key: l.key, source: l.a, target: l.b, total: l.total, last: l.last }));
    adj = new Map();
    for (const l of links) { (adj.get(l.source) || adj.set(l.source, []).get(l.source)).push(l.target); (adj.get(l.target) || adj.set(l.target, []).get(l.target)).push(l.source); }
    // new pages start next to a page they're connected to, then settle; everything else stays put
    const placed = nodes.filter((n) => Number.isFinite(n.x)).length;
    for (const n of nodes) {
      if (Number.isFinite(n.x)) continue;
      const nb = (adj.get(n.id) || []).map((t) => nodeBy.get(t)).find((m) => m && Number.isFinite(m.x));
      if (nb && placed) { n.x = nb.x + (Math.random() - 0.5) * 16; n.y = nb.y + (Math.random() - 0.5) * 16; n.z = nb.z + (Math.random() - 0.5) * 16; }
    }
    maxVisits = Math.max(1, ...nodes.map((n) => n.visits));
    maxTotal = Math.max(1, ...links.map((l) => l.total));
    now = Date.now();
    const ts = nodes.map((n) => n.last).filter(Boolean); span = ts.length ? Math.max(...ts) - Math.min(...ts) : 1;
    G.nodeRelSize(nodes.length < 60 ? 3.2 : nodes.length < 600 ? 2.4 : 1.9);
    setVisible(DV, false);
    restyle();
    settling = fresh > 0;
    // most of the first layout is worked out up front; the last part settles on screen
    const warm = fresh === nodes.length ? Math.round(Math.min(300, 120000 / Math.max(1, nodes.length))) : fresh ? 30 : 0;
    G.warmupTicks(warm).cooldownTicks(fresh ? Math.max(60, 360 - warm) : 0);
    G.graphData({ nodes, links });
    if (!settling) measure();
    drawThreads();
    return first;
  }
  function measure() {
    // typical distance between connected pages, so strands and markers scale with the map
    const ds = [];
    for (const l of links) { const a = nodeBy.get(l.source.id || l.source), b = nodeBy.get(l.target.id || l.target); if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) ds.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); }
    ds.sort((p, q) => p - q);
    scale = ds.length ? Math.max(0.4, ds[Math.floor(ds.length / 2)] / 30) : 1;
  }
  function setVisible(DV, apply = true) {
    vis = DV && DV.articles.size !== nodeBy.size ? new Set(DV.articles.keys()) : null;
    visLinks = vis ? new Set(DV.links.keys()) : null;
    rebudget();
    if (apply) { restyle(); placeLabels(true); }
  }
  function reset() { posCache.clear(); nodeBy = new Map(); nodes = []; links = []; }
  function relayout() {
    posCache.clear();
    for (const n of nodes) { n.fx = n.fy = n.fz = undefined; }
    settling = true;
    G.warmupTicks(Math.round(Math.min(300, 120000 / Math.max(1, nodes.length)))).cooldownTicks(200); G.graphData({ nodes, links });
  }
  function getPositions() {
    const out = {};
    for (const n of nodes) if (Number.isFinite(n.x)) out[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, Math.round(n.z * 10) / 10];
    return out;
  }

  /* ---------- threads ---------- */
  let strands = [], fans = new Map();
  const sphere = new THREE.SphereGeometry(1, 16, 12), cone = new THREE.ConeGeometry(1, 2.6, 10);
  function disposeLayer() {
    for (const o of [...layer.children]) { layer.remove(o); if (o.geometry && o.geometry !== sphere && o.geometry !== cone) o.geometry.dispose(); o.material?.dispose(); }
    strands = [];
  }
  const posOf = (t) => { const n = nodeBy.get(t); return n && Number.isFinite(n.x) ? new THREE.Vector3(n.x, n.y, n.z) : null; };
  function ball(pos, r, color, opacity = 1, data = null) {
    const m = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
    m.position.copy(pos); m.scale.setScalar(r); if (data) Object.assign(m.userData, data); layer.add(m); return m;
  }
  // Start and end markers: flat badges that always face you, keep their size on screen and sit on top
  // of everything, so where a thread starts and ends stands out at a glance.
  const textures = new Map();
  function badge(kind, color) {
    const k = kind + color; if (textures.has(k)) return textures.get(k);
    const c = document.createElement('canvas'); c.width = 128; c.height = 160;
    const g = c.getContext('2d'), col = d3.color(color).formatHex();
    g.lineJoin = 'round';
    if (kind === 'start') { // a ring: where you set off
      g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 20; g.strokeStyle = col; g.stroke();
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(64, 64, 57, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(64, 64, 14, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    } else if (kind === 'bead-read') { // a page you read: a solid dot
      g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      g.lineWidth = 12; g.strokeStyle = '#ffffff'; g.stroke();
    } else if (kind === 'bead-skim') { // a page you skimmed: an open ring
      g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.lineWidth = 26; g.strokeStyle = '#ffffff'; g.stroke();
      g.lineWidth = 13; g.strokeStyle = col; g.stroke();
    } else { // a pin: where you ended up
      g.beginPath(); g.moveTo(64, 156);
      g.bezierCurveTo(40, 112, 12, 92, 12, 60); g.arc(64, 60, 52, Math.PI, 0); g.bezierCurveTo(116, 92, 88, 112, 64, 156); g.closePath();
      g.fillStyle = col; g.fill(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke();
      g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
      g.beginPath(); g.arc(64, 60, 19, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    textures.set(k, tex); return tex;
  }
  function marker(kind, color, pos, px, opacity, data, fan = 0) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge(kind, color), sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity }));
    const s = px * 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, H);
    m.scale.set(s, kind.startsWith('bead') ? s : s * 1.25, 1);
    // several threads ending (or starting) on one page fan out side by side, so you can count them
    m.center.set(0.5 - fan * 0.8, kind === 'end' ? 0.02 : 0.5); // the pin's tip sits on the page
    m.position.copy(pos); m.renderOrder = 100 + (data?.order || 0); Object.assign(m.userData, data || {});
    layer.add(m); return m;
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickLayer(ev) {
    const r = el.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(layer.children.filter((o) => o.userData.key), false);
    // markers first, then the most visible thread
    hits.sort((a, b) => (b.object.isSprite ? 1 : 0) - (a.object.isSprite ? 1 : 0) || (b.object.userData.op || 0) - (a.object.userData.op || 0) || a.distance - b.distance);
    return hits[0]?.object.userData || null;
  }
  function layerClick(ev) {
    const u = threads && ev && pickLayer(ev);
    if (u?.key) { handlers.onThreadClick?.(u.key); return true; }
    return false;
  }
  let hoverKey = null;
  el.addEventListener('pointermove', (ev) => {
    if (!threads) return;
    const u = pickLayer(ev), k = u ? u.key + '|' + (u.title || '') : null;
    if (u) el.style.cursor = 'pointer';
    if (k !== hoverKey) { hoverKey = k; handlers.onThreadHover?.(u ? { key: u.key, title: u.title || null } : null); }
  });
  /** Draw (or clear) the threads of the selection. */
  function setHighlight(spec, pinKey = null) {
    threads = spec && spec.threads.length ? { ...spec, on: new Set() } : null;
    pin = pinKey;
    if (threads) for (const th of spec.threads) { th.path.forEach((t) => threads.on.add(t)); th.sides.forEach((b) => b.forEach((t) => threads.on.add(t))); }
    if (threads && spec.anchor) threads.on.add(spec.anchor);
    ctl.autoRotate = false;
    // decide the camera first, so strands can be sized in screen pixels for that view
    plan = threads ? bestFrame([...threads.on].map(posOf).filter(Boolean)) : null;
    unit = unitAt(plan ? plan.d : cam.position.distanceTo(ctl.target));
    restyle();
    drawThreads();
    placeLabels(true);
  }
  function unitAt(d) { return 2 * d * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, H); }
  /** Focus one thread: it's drawn in full, the others step back. */
  function setPin(key) { pin = key; drawThreads(); placeLabels(true); }
  function drawThreads() {
    disposeLayer();
    drawCursor();
    if (!threads) return;
    const bg = new THREE.Color(style.bg), white = new THREE.Color('#ffffff');
    // where several threads share a connection, give each its own lane so they read as separate strands
    const lanes = new Map();
    const pk = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
    threads.threads.forEach((th, i) => th.path.forEach((t, k) => { if (k) { const key = pk(th.path[k - 1], t); if (!lanes.has(key)) lanes.set(key, []); if (!lanes.get(key).includes(i)) lanes.get(key).push(i); } }));
    const n = threads.threads.length, minOp = 0.5 - 0.38 * view.ageFade, k = 0.5 + 1.5 * view.ageFade;
    // how many drawn threads start / end on each page, and each thread's place in that row
    fans = new Map(); const fanIdx = new Map();
    threads.threads.forEach((th) => {
      const last = th.path.length - 1;
      for (const [kind, t] of [['start', th.path[0]], ['end', th.path[last]]]) {
        if (t === threads.anchor || (kind === 'end' && last === 0)) continue;
        const k = kind + '\u0000' + t; fanIdx.set(th.key + kind, fans.get(k) || 0); fans.set(k, (fans.get(k) || 0) + 1);
      }
    });
    const fanOf = (th, kind, t) => { const m = fans.get(kind + '\u0000' + t) || 1; return (fanIdx.get(th.key + kind) || 0) - (m - 1) / 2; };
    // oldest first, so newer threads (and the focused one) are drawn on top
    const order = threads.threads.map((th, i) => i).sort((a, b) => (threads.threads[a].key === pin) - (threads.threads[b].key === pin) || b - a);
    for (const i of order) {
      const th = threads.threads[i], focused = pin === th.key;
      // the older the thread, the fainter (how much is a setting); the one you clicked on is shown in full
      const ageOp = minOp + (1 - minOp) * Math.pow(th.rec, k);
      const op = pin ? (focused ? 1 : Math.min(0.14, ageOp)) : ageOp;
      const w = focused ? 1.35 : pin ? 0.55 : 0.45 + 0.55 * th.rec;
      const col = new THREE.Color(th.color), pale = col.clone().lerp(bg, 0.55);
      const data = { key: th.key, op, order: focused ? 50 : n - i };
      const pts = th.path.map(posOf);
      if (pts.some((p) => !p)) continue;
      if (pts.length > 1) {
        const ctrl = [];
        for (let k = 0; k < pts.length; k++) {
          ctrl.push(pts[k]);
          if (k === pts.length - 1) break;
          const a = th.path[k], b = th.path[k + 1], ln = lanes.get(pk(a, b));
          const p = pts[k], q = pts[k + 1], dir = (a < b ? q.clone().sub(p) : p.clone().sub(q)).normalize();
          const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
          const j = ln.indexOf(i), off = ln.length > 1 ? (j - (ln.length - 1) / 2) * 9 * unit : 0;
          ctrl.push(p.clone().add(q).multiplyScalar(0.5).addScaledVector(side, off + 0.06 * p.distanceTo(q)));
        }
        const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
        const L = curve.getLength(), segs = Math.min(600, Math.max(24, Math.round(L / (4 * unit)))), rad = 7;
        const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false);
        // taper: thin and pale where you started, bold where you ended
        const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), c = new THREE.Vector3(), v = new THREE.Vector3(), tmp = new THREE.Color();
        const r0 = 1 * unit * w, r1 = 5 * unit * w;
        for (let sI = 0; sI <= segs; sI++) {
          const u = sI / segs; curve.getPointAt(u, c);
          const r = r0 + (r1 - r0) * Math.pow(u, 0.8);
          tmp.copy(pale).lerp(col, Math.min(1, u * 1.2));
          for (let q = 0; q <= rad; q++) {
            const idx = sI * (rad + 1) + q;
            v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
            pos.setXYZ(idx, v.x, v.y, v.z);
            colors[idx * 3] = tmp.r; colors[idx * 3 + 1] = tmp.g; colors[idx * 3 + 2] = tmp.b;
          }
        }
        pos.needsUpdate = true;
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const tube = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: op < 1, opacity: op, depthWrite: op >= 1 }));
        tube.renderOrder = 10 + data.order; Object.assign(tube.userData, data);
        layer.add(tube);
        // arrowheads along the way, pointing from start to end
        const stepLen = 90 * unit, count = Math.floor(L / stepLen), tan = new THREE.Vector3();
        for (let a = 1; a <= count; a++) {
          const u = (a - 0.5) / count; if (u < 0.08 || u > 0.94) continue;
          const m = new THREE.Mesh(cone, new THREE.MeshLambertMaterial({ color: tmp.copy(pale).lerp(col, Math.min(1, u * 1.2)).clone(), transparent: op < 1, opacity: op, depthWrite: op >= 1 }));
          curve.getPointAt(u, m.position); curve.getTangentAt(u, tan);
          m.quaternion.setFromUnitVectors(UP, tan);
          m.scale.setScalar((2.2 + 3.2 * u) * unit * w);
          m.renderOrder = tube.renderOrder; Object.assign(m.userData, data);
          layer.add(m);
        }
        // the light that runs from start to end: on the newest thread, or on the one you clicked
        if (pin ? focused : th.rank === 0) {
          const comet = [];
          for (let k = 0; k < 5; k++) comet.push(ball(pts[0], (5 - k * 0.75) * unit * w, col.clone().lerp(white, 0.4 - k * 0.07), Math.min(1, op + 0.1) * (0.95 - k * 0.17)));
          comet.forEach((m) => { m.renderOrder = 60; });
          strands.push({ curve, L, comet, phase: -i * 0.35, pause: 0.6 + 2.2 * (1 - th.rec), gap: 7 * unit, speed: 220 * unit });
        }
      }
      // the pages in between: a solid dot if you read it, an open ring if you skimmed it
      const last = th.path.length - 1, tmpc = new THREE.Color();
      th.path.forEach((t, k) => {
        if (k === 0 || k === last || threads.anchor === t) return;
        const d = th.depths?.[k];
        if (d) marker(d === 'read' ? 'bead-read' : 'bead-skim', th.color, pts[k], (d === 'read' ? 17 : 16) * (focused ? 1.15 : 0.85 + 0.15 * th.rec), Math.max(0.18, op), { ...data, title: t });
        else ball(pts[k], (1.8 + 1.2 * k / last) * unit * w, tmpc.copy(pale).lerp(col, k / last), op, { ...data, title: t });
      });
      // start: a ring; end: a pin (unless the thread starts or ends on the page you clicked)
      const big = focused ? 1.25 : 0.8 + 0.2 * th.rec, fade = pin && !focused ? 0.3 : Math.max(0.2, op);
      if (th.path[0] !== threads.anchor || last === 0) marker('start', th.color, pts[0], 24 * big, fade, { ...data, title: th.path[0] }, fanOf(th, 'start', th.path[0]));
      if (last > 0 && th.path[last] !== threads.anchor) marker('end', th.color, pts[last], 34 * big, fade, { ...data, title: th.path[last] }, fanOf(th, 'end', th.path[last]));
      // side trips of a single trail: thin strands in the same colour
      for (const b of th.sides) {
        const bp = b.map(posOf); if (bp.some((p) => !p) || bp.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(bp, false, 'centripetal');
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, bp.length * 10), 0.9 * unit, 6, false), new THREE.MeshLambertMaterial({ color: pale, transparent: true, opacity: 0.75 * op, depthWrite: false }));
        Object.assign(tube.userData, data); layer.add(tube);
      }
    }
    // the page you selected
    if (threads.anchor) {
      const p = posOf(threads.anchor);
      if (p) { const r = 7 * unit; ball(p, r, style.anchor); const halo = ball(p, r * 1.9, style.anchor, 0.14); halo.renderOrder = 5; }
    }
  }
  function drawCursor() {
    if (!cursor) return;
    const p = posOf(cursor); if (!p) return;
    const m = ball(p, 9 * unit, style.cursor, 0.35); m.userData.cursor = true; m.userData.r = 9 * unit;
  }
  function setCursor(title) { if (title === cursor) return; cursor = title; if (!threads) unit = unitAt(cam.position.distanceTo(ctl.target)); drawThreads(); placeLabels(true); }

  /* ---------- labels ---------- */
  const pool = new Map(); // title → { el, kind, w }
  let wanted = [];
  function placeLabels(rebuild) {
    if (rebuild) {
      wanted = [];
      if (threads) {
        const seen = new Set();
        const push = (t, kind, prio) => { if (!seen.has(t)) { seen.add(t); wanted.push({ t, kind, prio }); } };
        if (threads.anchor) push(threads.anchor, 'anchor', 1000);
        const pth = pin && threads.threads.find((x) => x.key === pin);
        if (pth) { push(pth.path[pth.path.length - 1], 'end', 900); push(pth.path[0], 'start', 880); pth.path.forEach((t, k) => push(t, 'step', 700 - k)); }
        if (!pth) threads.threads.forEach((th) => { const e = th.path[th.path.length - 1], s = th.path[0]; push(e, 'end', 500 + th.rec * 100); push(s, 'start', 300 + th.rec * 100); });
        // a single trail: name every page on it
        if (threads.kind === 'trail' && !pth) threads.threads[0].path.forEach((t, k) => push(t, 'step', 200 - k));
      } else {
        const list = nodes.filter((n) => !vis || vis.has(n.id)).sort((p, q) => q.visits - p.visits);
        list.slice(0, Math.max(5, Math.min(16, Math.round(list.length / 20)))).forEach((n, i) => wanted.push({ t: n.id, kind: 'hub', prio: 100 - i }));
      }
      if (cursor) wanted.push({ t: cursor, kind: 'cursor', prio: 900 });
      wanted.sort((p, q) => q.prio - p.prio);
      const keep = new Set(wanted.map((w) => w.t));
      for (const [t, o] of pool) if (!keep.has(t)) { o.el.remove(); pool.delete(t); }
      for (const w of wanted) {
        let o = pool.get(w.t);
        if (!o) { const e = document.createElement('div'); e.textContent = w.t; labelBox.appendChild(e); o = { el: e, w: 0 }; pool.set(w.t, o); }
        if (o.kind !== w.kind) { o.kind = w.kind; o.el.className = 'lbl3d ' + w.kind; o.w = 0; }
      }
    }
    // greedy: the most important labels first; skip any that would overlap
    const boxes = [], fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const tmp = new THREE.Vector3();
    for (const w of wanted) {
      const o = pool.get(w.t), n = nodeBy.get(w.t);
      if (!o || !n || !Number.isFinite(n.x)) { if (o) o.el.style.display = 'none'; continue; }
      tmp.set(n.x, n.y, n.z).sub(cam.position);
      const p = G.graph2ScreenCoords(n.x, n.y, n.z);
      if (!o.w) { o.el.style.display = ''; o.w = o.el.offsetWidth || 60; o.h = o.el.offsetHeight || 18; }
      const fixed = w.kind === 'anchor' || w.kind === 'cursor';
      // above the dot if there's room, else below, right or left of it; beside a start ring or an end pin
      const half = ((fans.get(w.kind + '\u0000' + w.t) || 1) - 1) * 0.4 * (w.kind === 'end' ? 34 : 24); // room for fanned-out markers
      const spots = w.kind === 'end' ? [[18 + half, -30 - o.h / 2], [-o.w - 18 - half, -30 - o.h / 2], [-o.w / 2, 8]]
        : w.kind === 'start' ? [[18 + half, -o.h / 2], [-o.w - 18 - half, -o.h / 2], [-o.w / 2, 16], [-o.w / 2, -o.h - 16]]
          : [[-o.w / 2, -o.h - 10], [-o.w / 2, 10], [12, -o.h / 2], [-o.w - 12, -o.h / 2]];
      let bx = null;
      for (const [dx, dy] of fixed ? spots.slice(0, 1) : spots) {
        const c = [p.x + dx, p.y + dy, p.x + dx + o.w, p.y + dy + o.h];
        const inside = c[0] >= 2 && c[2] <= W - 2 && c[1] >= 2 && c[3] <= H - 2;
        if (fixed || (inside && !boxes.some((b) => c[0] < b[2] && c[2] > b[0] && c[1] < b[3] && c[3] > b[1]))) { bx = c; break; }
      }
      const off = tmp.dot(fwd) < 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H;
      if (off || !bx) { if (o.el.style.display !== 'none') o.el.style.display = 'none'; continue; }
      boxes.push(bx);
      if (o.el.style.display === 'none') o.el.style.display = '';
      o.el.style.transform = `translate(${Math.round(bx[0])}px, ${Math.round(bx[1])}px)`;
    }
  }

  /* ---------- camera ---------- */
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  /** Where the camera must be, looking along `back`, so these points fill `fill` of the window. */
  function frame(pts, back, fill) {
    const tv = Math.tan(cam.fov * Math.PI / 360), th = tv * (W / Math.max(1, H));
    const right = new THREE.Vector3().crossVectors(UP, back).normalize(), up = new THREE.Vector3().crossVectors(back, right);
    const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3());
    const need = () => {
      let m = 60 * scale;
      for (const p of pts) {
        tmpA.copy(p).sub(c); const z = tmpA.dot(back);
        m = Math.max(m, z + Math.abs(tmpA.dot(up)) / (tv * fill), z + Math.abs(tmpA.dot(right)) / (th * fill), z / 0.3);
      }
      return m;
    };
    for (let it = 0; it < 4; it++) {
      const d = need();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of pts) {
        tmpA.copy(p).sub(c); const k = d - tmpA.dot(back);
        const px = tmpA.dot(right) / (k * th), py = tmpA.dot(up) / (k * tv);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      c.addScaledVector(right, (x0 + x1) / 2 * d * th).addScaledVector(up, (y0 + y1) / 2 * d * tv);
    }
    return { c, d: need(), back };
  }
  function moveTo(f, ms, isThreads) {
    framing = true; framed = 0;
    const p = f.c.clone().addScaledVector(f.back, f.d);
    G.cameraPosition({ x: p.x, y: p.y, z: p.z }, { x: f.c.x, y: f.c.y, z: f.c.z }, ms);
    clearTimeout(moveTo.t);
    moveTo.t = setTimeout(() => { framing = false; if (isThreads) framed = cam.position.distanceTo(ctl.target); }, ms + 80);
  }
  const currentBack = () => tmpB.copy(cam.position).sub(ctl.target).normalize().clone();
  function visiblePoints() {
    const list = nodes.filter((n) => (!vis || vis.has(n.id)) && Number.isFinite(n.x));
    if (list.length < 200) return list.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    // ignore the few far-flung pages so the bulk of the map fills the window
    const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
    const xs = list.map((n) => n.x).sort((a, b) => a - b), ys = list.map((n) => n.y).sort((a, b) => a - b), zs = list.map((n) => n.z).sort((a, b) => a - b);
    const lo = [q(xs, 0.02), q(ys, 0.02), q(zs, 0.02)], hi = [q(xs, 0.98), q(ys, 0.98), q(zs, 0.98)];
    return list.filter((n) => n.x >= lo[0] && n.x <= hi[0] && n.y >= lo[1] && n.y <= hi[1] && n.z >= lo[2] && n.z <= hi[2]).map((n) => new THREE.Vector3(n.x, n.y, n.z));
  }
  /** The whole (visible) history. */
  function fit(animate = true) {
    const pts = visiblePoints(); if (!pts.length) return;
    moveTo(frame(pts, currentBack(), 0.9), animate ? 2000 : 0, false);
  }
  /** The camera for these points: the angle where they spread out best, filling the window. */
  function bestFrame(pts) {
    if (!pts.length) return null;
    const cur = currentBack();
    let best = frame(pts, cur, 0.8), bestScore = best.d;
    if (pts.length > 2) {
      for (let yaw = 0; yaw < 360; yaw += 15) for (const pitch of [-40, -20, 0, 20, 40]) {
        const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
        const back = new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
        const f = frame(pts, back, 0.8), score = f.d * (1 + 0.45 * (1 - back.dot(cur))); // prefer small turns
        if (score < bestScore) { best = f; bestScore = score; }
      }
    }
    return best;
  }
  /** Show these pages, from the angle where they spread out best. */
  function focusOn(titles) {
    const pts = [...titles].map(posOf).filter(Boolean); if (!pts.length) return;
    if (pts.length === 1) { for (const m of adj.get([...titles][0]) || []) { const p = posOf(m); if (p) pts.push(p); } }
    const f = bestFrame(pts); if (f) moveTo(f, 2600, true);
  }
  /** Move the camera to the view the threads were drawn for. */
  function frameThreads() { if (plan) moveTo(plan, 2600, true); }
  function zoomBy(f) {
    const d = cam.position.distanceTo(ctl.target) / f, back = currentBack();
    const p = ctl.target.clone().addScaledVector(back, d);
    G.cameraPosition({ x: p.x, y: p.y, z: p.z }, { x: ctl.target.x, y: ctl.target.y, z: ctl.target.z }, 300);
  }
  function ensureVisible(title) {
    const n = nodeBy.get(title); if (!n || !Number.isFinite(n.x)) return;
    const p = G.graph2ScreenCoords(n.x, n.y, n.z);
    if (p.x < 40 || p.y < 40 || p.x > W - 40 || p.y > H - 40) fit(true);
  }
  function settleAndFit() { fit(false); }

  /* ---------- the loop: running lights, labels, the slow turn ---------- */
  let W = el.clientWidth || 800, H = el.clientHeight || 600, lastT = performance.now(), frameMs = 16;
  function tick(t) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (t - lastT) / 1000); frameMs = frameMs * 0.95 + (t - lastT) * 0.05; lastT = t;
    for (const s of strands) {
      s.phase += dt * s.speed / s.L;
      if (s.phase > 1 + s.pause) s.phase = -0.05;
      s.comet.forEach((m, k) => {
        const u = s.phase - k * s.gap / s.L;
        m.visible = u >= 0 && u <= 1;
        if (m.visible) s.curve.getPointAt(u, m.position);
      });
    }
    for (const o of layer.children) if (o.userData.cursor) o.scale.setScalar(o.userData.r * (1 + 0.25 * Math.sin(t / 300)));
    if (!threads && view.rotate && !ctl.autoRotate && t - lastTouch > 45000 && !settling) ctl.autoRotate = true;
    placeLabels(false);
  }
  requestAnimationFrame(tick);
  new ResizeObserver(() => {
    W = el.clientWidth || W; H = el.clientHeight || H;
    G.width(W).height(H);
    handlers.onResize?.();
  }).observe(el);
  G.width(W).height(H);

  function setPalette(s) {
    readStyle();
    const dark = document.documentElement.dataset.theme === 'dark';
    hub = d3.interpolateRgbBasis((dark && s.dark?.hub) || s.hub || ['#d3d8e0', '#38404d']);
    restyle(); drawThreads();
  }
  function setView(v) {
    Object.assign(view, v);
    if ('rotate' in v) { ctl.autoRotate = !!v.rotate && !threads; lastTouch = v.rotate ? -1e9 : lastTouch; }
    if ('density' in v || 'fade' in v) { rebudget(); restyle(); }
    if ('ageFade' in v && threads) drawThreads();
    if ('colourBy' in v) restyle();
  }
  function neighbourhood(title, hops = 1) {
    const s = new Set([title]); let frontier = [title];
    for (let h = 0; h < hops; h++) { const next = []; for (const t of frontier) for (const m of adj.get(t) || []) if (!s.has(m)) { s.add(m); next.push(m); } frontier = next; }
    return s;
  }

  return {
    update, reset, relayout, setVisible, setPalette, setHighlight, setPin, setCursor, setView,
    fit, focusOn, frameThreads, settleAndFit, ensureVisible, zoomBy, getPositions, neighbourhood,
    nodeCount: () => nodes.length,
    isSettling: () => settling,
    hasNode: (t) => nodeBy.has(t),
    screenOf: (t) => { const n = nodeBy.get(t); if (!n || !Number.isFinite(n.x)) return null; const p = G.graph2ScreenCoords(n.x, n.y, n.z); return [p.x, p.y]; },
    edgeMid: (i = 0) => {
      const keys = [...budget]; const l = links.find((x) => x.key === keys[i]); if (!l) return null;
      const a = nodeBy.get(l.source.id || l.source), b = nodeBy.get(l.target.id || l.target);
      const p = G.graph2ScreenCoords((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return [p.x, p.y];
    },
    stats: () => ({ nodes: vis ? vis.size : nodes.length, links: budget.size, drawn: budget.size, strands: strands.length, labels: wanted.length }),
    drawMs: () => Math.round(frameMs * 10) / 10,
    pause: (p) => (p ? G.pauseAnimation() : G.resumeAnimation()),
  };
}
