// The map in 3D: every article is a node in one brain-like network, and connections you use
// often are brighter and thicker. Selecting something draws its threads on top: each in its own
// colour, thin where you started and bold where you ended, with a light running from start to end.
// The camera then turns to where the threads spread out best and fills the window with them.
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

const d3 = window.d3;
const UP = new THREE.Vector3(0, 1, 0);
// the side the map is first seen from (and the "home" view): a little from the right and above, so
// depth reads at once instead of a flat face-on sheet
const VIEW = new THREE.Vector3(0.52, 0.34, 0.78).normalize();
// groups sit round the newest in a ball that's wider than deep and deeper than high, turned to face the
// home view, so it fills a wide window and still has real depth from every side
const SHAPE = [1, 1, 1]; // a ball: the newest exploration in the middle, older ones round it on every side
const VIEW_H = new THREE.Vector3(VIEW.x, 0, VIEW.z).normalize(), RIGHT_H = new THREE.Vector3().crossVectors(UP, VIEW_H).normalize();
const HIDPI = (window.devicePixelRatio || 1) >= 1.5;

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
  const view = { density: 1, fade: true, ageFade: 0.85, rotate: true, mark: 'ends', show: 1, depth: true };
  // groups of pages joined by links (newest first), the newest visit, and the pages shown when not all are
  let groups = [], newest = 0, spanDays = 1, keep = null, repacked = false;
  const LAYOUT_V = '\u0001groups-ball';
  let style = { link: '#8a94a6', label: '#222', labelBg: '#fff', cursor: '#e8641c', anchor: '#222', bg: '#ffffff', read: '#2b59c3', skim: '#c5cfe6', node: '#9aa0aa' };

  const G = new ForceGraph3D(el, { controlType: 'orbit', rendererConfig: { antialias: !HIDPI } })
    .backgroundColor('rgba(0,0,0,0)').showNavInfo(false).enableNodeDrag(false)
    .nodeId('id').nodeLabel(() => '').linkLabel(() => '')
    .nodeResolution(10).nodeOpacity(1).linkOpacity(1)
    .cooldownTime(40000)
    .onNodeHover((n) => { hoverNode = n; el.style.cursor = n ? 'pointer' : ''; handlers.onHover?.(n ? n.id : null); })
    // connections aren't clickable; while threads are drawn, a click on a thread focuses it
    .onNodeClick((n, ev) => { if (!layerClick(ev)) handlers.onClick?.(n.id); })
    .onLinkClick((l, ev) => { if (!layerClick(ev)) handlers.onBackground?.(); })
    .onBackgroundClick((ev) => { if (!layerClick(ev)) handlers.onBackground?.(); })
    .onEngineStop(() => {
      if (!settling) return;
      if (!repacked) {
        // now that each group has its real size, give them their places again so none touch, then
        // one more (still) tick so the spheres follow
        repacked = true;
        repack();
        for (const n of nodes) if (Number.isFinite(n.x)) { n.fx = n.x; n.fy = n.y; n.fz = n.z; }
        G.cooldownTicks(1); G.d3ReheatSimulation();
        return;
      }
      settling = false;
      for (const n of nodes) if (Number.isFinite(n.x)) { n.fx = n.x; n.fy = n.y; n.fz = n.z; posCache.set(n.id, [n.x, n.y, n.z]); }
      measure(); wake(1000);
      drawThreads(); placeLabels(true);
      handlers.onSettled?.();
    });
  G.d3Force('charge').strength(-34).distanceMax(220);
  G.d3Force('center', null);
  G.d3Force('group', groupForce());
  G.d3Force('link').distance((l) => 18 + 26 / Math.sqrt(l.total || 1));
  const cam = G.camera(); cam.fov = 40; cam.updateProjectionMatrix();
  cam.position.copy(VIEW).multiplyScalar(1000);
  const renderer = G.renderer();
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  const ctl = G.controls();
  // damping per frame made the camera trail the pointer longer the slower the frames; DAMP is per 1/60 s
  // and is rescaled every frame (see tick), so it settles in the same time at any frame rate
  const DAMP = 0.25;
  ctl.autoRotateSpeed = 0.3; ctl.rotateSpeed = 0.6; ctl.enableDamping = true; ctl.dampingFactor = DAMP;
  ctl.zoomToCursor = true; // the wheel zooms towards what's under the pointer
  ctl.addEventListener('start', () => {
    lastTouch = performance.now(); ctl.autoRotate = false;
    // grabbing the map stops a camera move under way, instead of the move winning over your hand
    if (framing) { const p = cam.position, q = ctl.target; G.cameraPosition({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z }, 1); framing = false; }
  });
  ctl.addEventListener('change', () => {
    // zooming far out of the threads goes back to the whole history
    if (threads && framed && !framing && cam.position.distanceTo(ctl.target) > framed * 2.3) handlers.onZoomedOut?.();
  });
  const scene = G.scene();
  const layer = new THREE.Group();
  scene.add(layer);
  const key = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);
  G.lights([new THREE.AmbientLight(0xffffff, 0.5 * Math.PI), key]);
  scene.add(key.target);
  /* the shell: a faint glass ball round the whole map, brighter at its rim, so the eye reads it as a sphere */
  const shellMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#888') }, strength: { value: 0.4 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV; void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(color, pow(f, 4.0) * strength); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), shellMat);
  shell.renderOrder = 10; shell.visible = false;
  scene.add(shell);
  // depth: what's further away fades towards the background (set per frame from the camera, see depthCue)
  const fog = new THREE.Fog(0x000000, 1, 2);
  let sceneR = 300; const sceneC = new THREE.Vector3();
  /* ---------- drawing only when something changed ----------
     The library draws every frame, even when nothing moves; on a high-DPI laptop that keeps the GPU
     busy all the time. A frame is drawn when the camera moved, something animates, or the map changed. */
  // the library draws through its post-processing composer (which clears the canvas first), so a frame
  // is skipped there, as a whole
  const composer = G.postProcessingComposer(), rawRender = composer.render.bind(composer), camSig = new Float64Array(17);
  let renderUntil = 0, lastDraw = 0;
  const wake = (ms = 300) => { renderUntil = Math.max(renderUntil, performance.now() + ms); };
  const RSTAT = { drawn: 0, skipped: 0 };
  function camChanged(sig) {
    const e = cam.matrixWorld.elements; let ch = false;
    for (let i = 0; i < 16; i++) if (sig[i] !== e[i]) { sig[i] = e[i]; ch = true; }
    if (sig[16] !== cam.projectionMatrix.elements[0] + W * 1e-7) { sig[16] = cam.projectionMatrix.elements[0] + W * 1e-7; ch = true; }
    return ch;
  }
  /* ---------- every page in one draw call ----------
     The library makes one sphere mesh per page; with thousands of pages that's thousands of draw calls a
     frame. They stay (hidden) for hovering and clicking; one instanced mesh draws them all. A faded page is
     mixed towards the background instead of being see-through, so no sorting is needed either. */
  const ballGeo = new THREE.SphereGeometry(1, 12, 9), ballMat = new THREE.MeshLambertMaterial();
  let inst = null, cyl = null, segs = null;
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const segMat = new THREE.LineBasicMaterial({ vertexColors: true }), _ms = new THREE.Matrix4();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _bg = new THREE.Color();
  function syncInstances() {
    let count = 0;
    for (const n of nodes) { const o = n.__threeObj; if (o && o.parent && o.__graphDefaultObj) count++; }
    if (!inst || inst.instanceMatrix.count < count) {
      if (inst) { scene.remove(inst); inst.dispose(); }
      inst = new THREE.InstancedMesh(ballGeo, ballMat, Math.max(64, Math.ceil(count * 1.3)));
      inst.frustumCulled = false; inst.raycast = () => {}; scene.add(inst);
    }
    _bg.set(style.bg);
    let i = 0;
    for (const n of nodes) {
      const o = n.__threeObj; if (!o || !o.parent || !o.__graphDefaultObj) continue;
      o.visible = false;
      if (threads && o.material.opacity < 0.15) continue; // all but invisible behind the threads: not drawn
      _m.compose(o.position, _q, _s.setScalar(o.geometry.parameters?.radius || 1)); inst.setMatrixAt(i, _m);
      _c.copy(o.material.color).lerp(_bg, 1 - o.material.opacity); inst.setColorAt(i, _c); i++;
    }
    inst.count = i; inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    // connections: the strong ones (tubes) as instances, the thin ones as one set of line segments
    let nc = 0, nl = 0;
    for (const l of links) { const o = l.__lineObj; if (!o || !o.parent) continue; if (o.isMesh) nc++; else if (o.isLine) nl++; }
    if (!cyl || cyl.instanceMatrix.count < nc) {
      if (cyl) { scene.remove(cyl); cyl.dispose(); }
      cyl = new THREE.InstancedMesh(cylGeo, ballMat, Math.max(32, Math.ceil(nc * 1.3)));
      cyl.frustumCulled = false; cyl.raycast = () => {}; scene.add(cyl);
    }
    if (!segs || segs.geometry.attributes.position.count < nl * 2) {
      if (segs) { scene.remove(segs); segs.geometry.dispose(); }
      const cap = Math.max(64, Math.ceil(nl * 1.3)) * 2, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      segs = new THREE.LineSegments(g, segMat); segs.frustumCulled = false; segs.raycast = () => {}; scene.add(segs);
    }
    const P = segs.geometry.attributes.position, C = segs.geometry.attributes.color;
    let j = 0, k = 0;
    for (const l of links) {
      const o = l.__lineObj; if (!o || !o.parent) continue;
      o.visible = false;
      if (threads && o.material.opacity < 0.15) continue;
      _c.copy(o.material.color).lerp(_bg, 1 - o.material.opacity);
      if (o.isMesh) {
        const r = o.geometry.parameters?.radiusTop || 0.5;
        o.updateMatrixWorld(); _m.copy(o.matrixWorld).multiply(_ms.makeScale(r, r, 1));
        cyl.setMatrixAt(j, _m); cyl.setColorAt(j, _c); j++;
      } else if (o.isLine) {
        const a = o.geometry.attributes.position; if (!a || a.count < 2) continue;
        P.setXYZ(k, a.getX(0), a.getY(0), a.getZ(0)); P.setXYZ(k + 1, a.getX(a.count - 1), a.getY(a.count - 1), a.getZ(a.count - 1));
        C.setXYZ(k, _c.r, _c.g, _c.b); C.setXYZ(k + 1, _c.r, _c.g, _c.b); k += 2;
      }
    }
    cyl.count = j; cyl.instanceMatrix.needsUpdate = true; if (cyl.instanceColor) cyl.instanceColor.needsUpdate = true;
    segs.geometry.setDrawRange(0, k); P.needsUpdate = true; C.needsUpdate = true;
  }
  // an object the library made (or remade) since the last sync is still visible: sync again
  const stray = () => { for (const n of nodes) if (n.__threeObj?.visible && n.__threeObj.__graphDefaultObj) return true; for (const l of links) if (l.__lineObj?.visible) return true; return false; };
  composer.render = (dt) => {
    const t = performance.now(), moved = camChanged(camSig);
    if (settling || t < renderUntil || stray()) syncInstances();
    const anim = settling || strands.length > 0 || ctl.autoRotate;
    const pulse = !!cursor && t - lastDraw > 66; // the marker of the current page pulses gently, 15 times a second is enough
    if (moved || anim || pulse || t < renderUntil) { if (moved) depthCue(); rawRender(dt); lastDraw = t; RSTAT.drawn++; } else RSTAT.skipped++;
  };

  /* ---------- colours and styling of the network ---------- */
  const rgba = (c, a) => { const k = d3.color(c) || d3.color('#888'); k.opacity = a; return k.formatRgb(); };
  function nodeColor(n) {
    if (threads) return threads.on.has(n.id) ? rgba(style.link, 0.55) : rgba(style.link, 0.07);
    const op = groupOp(n), c = baseColor(n);
    return op < 0.99 ? rgba(c, op) : c;
  }
  function baseColor(n) {
    // colour only where it says something: where explorations began and ended (cool before, warm after,
    // as on the trails), or read against skimmed; every other page is the same plain colour
    if (view.mark === 'ends') {
      const R = roleColors();
      if (n.begins) return R.up;
      if (n.ends) return R.down[0];
    } else if (view.mark === 'reading' && (n.read || n.skim)) return n.read ? style.read : style.skim;
    return style.node;
  }
  const nodeSize = (n) => 0.35 + 5 * Math.sqrt(n.visits / maxVisits);
  function linkStrength(l) { return Math.sqrt(l.total / maxTotal) * (view.fade ? recencyOf(l.last) : 1); }
  let now = Date.now(), span = 1;
  const recencyOf = (t) => 0.08 + 0.92 * Math.exp(-Math.max(0, now - t) / Math.max(14 * 864e5, span / 6));
  function linkColor(l) {
    if (threads) return rgba(style.link, 0.035);
    return rgba(style.link, (0.07 + 0.5 * linkStrength(l)) * groupOp(nodeBy.get(l.source.id ?? l.source)));
  }
  const linkWidth = (l) => (threads ? 0 : (l.strong ? 0.25 + 1.1 * linkStrength(l) * scale : 0));
  function restyle() {
    wake(600);
    for (const n of nodes) n._op = undefined; labelsDirty = true;
    // while threads are drawn, their pages are shown as the threads' own beads instead
    G.nodeColor(nodeColor).nodeVal((n) => (threads ? nodeSize(n) * 0.5 : nodeSize(n)))
      .nodeVisibility((n) => isShown(n) && !(threads && threads.on.has(n.id)))
      .linkVisibility((l) => budget.has(l.key) && (!visLinks || visLinks.has(l.key)) && (!keep || (keep.has(l.source.id ?? l.source) && keep.has(l.target.id ?? l.target))))
      .linkColor(linkColor).linkWidth(linkWidth);
  }
  function rebudget() {
    // only the strongest connections are drawn, so years of history stay calm
    const pool = links.filter((l) => (!visLinks || visLinks.has(l.key)) && (!keep || (keep.has(l.source.id ?? l.source) && keep.has(l.target.id ?? l.target))));
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
    // a gradient background counts as its first colour; the map's fades and palette depend on it
    if (!d3.color(style.bg)) style.bg = (style.bg.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i) || [])[0] || v('--label-bg', '');
    const c = d3.color(style.bg); if (!c || c.opacity === 0) style.bg = dark ? '#16181d' : '#fafbfc';
    style.bg = d3.color(style.bg).formatHex();
    style.read = d3.color(v('--read', '')) ? v('--read', '') : (d3.color(v('--accent', '')) ? v('--accent', '') : '#2b59c3');
    style.skim = d3.color(v('--skim', '')) ? v('--skim', '') : d3.interpolateRgb(style.read, style.bg)(0.6);
    style.node = d3.interpolateRgb(style.bg, style.label)(0.5);
  }

  /* ---------- data ---------- */
  /** Show this history. Returns true when the map was empty before. */
  function update(D, DV, layout) {
    const first = nodes.length === 0;
    if (layout) {
      const entries = Object.entries(layout);
      const is3d = entries.length && entries.every(([, p]) => Array.isArray(p) && p.length === 3);
      // layouts from before pages were kept in groups are laid out again
      if (is3d && layout[LAYOUT_V]) for (const [t, p] of entries) if (t !== LAYOUT_V && !posCache.has(t)) posCache.set(t, p);
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
      n.visits = a.visits; n.last = a.last; n.read = a.read; n.skim = a.skim; n.begins = a.begins; n.ends = a.ends; n.depth = a.depth || 0;
      nodeBy.set(a.title, n); nodes.push(n);
    }
    links = [...D.links.values()].map((l) => ({ key: l.key, source: l.a, target: l.b, total: l.total, last: l.last }));
    adj = new Map();
    for (const l of links) { (adj.get(l.source) || adj.set(l.source, []).get(l.source)).push(l.target); (adj.get(l.target) || adj.set(l.target, []).get(l.target)).push(l.source); }
    const regroup = arrange();
    maxVisits = Math.max(1, ...nodes.map((n) => n.visits));
    maxTotal = Math.max(1, ...links.map((l) => l.total));
    now = Date.now();
    const ts = nodes.map((n) => n.last).filter(Boolean); span = ts.length ? Math.max(...ts) - Math.min(...ts) : 1;
    G.nodeRelSize(nodes.length < 60 ? 4.4 : nodes.length < 600 ? 3.6 : 2.4);
    setVisible(DV, false);
    restyle();
    settling = fresh > 0 || regroup > 0;
    repacked = false;
    // most of the first layout is worked out up front; the last part settles on screen
    const warm = fresh === nodes.length ? Math.round(Math.min(300, 120000 / Math.max(1, nodes.length))) : settling ? 30 : 0;
    G.warmupTicks(warm).cooldownTicks(settling ? Math.max(60, 360 - warm) : 0);
    G.graphData({ nodes, links });
    if (!settling) measure();
    drawThreads(); wake(1500);
    return first;
  }
  function measure() {
    // typical distance between connected pages, so strands and markers scale with the map
    const ds = [];
    for (const l of links) { const a = nodeBy.get(l.source.id || l.source), b = nodeBy.get(l.target.id || l.target); if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) ds.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); }
    ds.sort((p, q) => p - q);
    scale = ds.length ? Math.max(0.4, ds[Math.floor(ds.length / 2)] / 30) : 1;
    const pts = nodes.filter((n) => isShown(n) && Number.isFinite(n.x));
    if (pts.length) {
      sceneC.set(0, 0, 0); for (const n of pts) sceneC.add(tmpA.set(n.x, n.y, n.z)); sceneC.divideScalar(pts.length);
      const ds2 = pts.map((n) => Math.hypot(n.x - sceneC.x, n.y - sceneC.y, n.z - sceneC.z)).sort((p, q) => p - q);
      sceneR = Math.max(60, ds2[Math.floor(ds2.length * 0.95)]);
      shell.position.copy(sceneC); shell.scale.setScalar(ds2[ds2.length - 1] + 20);
    }
    shellLook();
  }
  function shellLook() {
    shell.visible = !!view.depth && nodes.length > 2;
    shellMat.uniforms.color.value.set(d3.color(style.link) ? style.link : '#888');
    const dark = (d3.hsl(style.bg).l || 1) < 0.5;
    shellMat.uniforms.strength.value = (threads ? 0.3 : 1) * (dark ? 0.2 : 0.16);
  }
  /** Fog from just in front of the map's middle to well behind it: the far side is dimmer than the near one. */
  function depthCue() {
    if (threads || !view.depth) { scene.fog = null; return; }
    const d = cam.position.distanceTo(sceneC);
    fog.color.set(style.bg); fog.near = Math.max(1, d - 0.25 * sceneR); fog.far = d + 1.9 * sceneR;
    scene.fog = fog;
    // the key light comes from over the viewer's left shoulder, whichever way the map is turned
    tmpB.set(-0.5, 0.8, 0.3).applyQuaternion(cam.quaternion);
    key.position.copy(cam.position).addScaledVector(tmpB, cam.position.distanceTo(ctl.target)); key.target.position.copy(ctl.target);
  }
  function setVisible(DV, apply = true) {
    vis = DV && DV.articles.size !== nodeBy.size ? new Set(DV.articles.keys()) : null;
    // where explorations began and ended within the period shown
    if (DV) for (const n of nodes) { const a = DV.articles.get(n.id); n.begins = a?.begins || 0; n.ends = a?.ends || 0; if (a) n.depth = a.depth || 0; }
    visLinks = vis ? new Set(DV.links.keys()) : null;
    computeKeep();
    rebudget();
    if (apply) { restyle(); placeLabels(true); }
  }
  function reset() { posCache.clear(); nodeBy = new Map(); nodes = []; links = []; }
  /* ---------- groups: pages joined by links stay together, apart from everything else ----------
     Explorations that share no page get places of their own: the newest in the middle, older ones
     further out, each where there's room. Older groups are fainter. */
  const DAY = 864e5;
  const isPlaced = (n) => !!n && Number.isFinite(n.x);
  function arrange() {
    const seen = new Set(); groups = [];
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      const g = { nodes: [], last: 0, first: Infinity, key: n.id }; seen.add(n.id);
      for (let i = 0, q = [n]; i < q.length; i++) {
        const m = q[i]; g.nodes.push(m); m.group = g;
        if ((m.last || 0) > g.last) g.last = m.last || 0;
        if (m.last && m.last < g.first) g.first = m.last;
        if (m.id < g.key) g.key = m.id;
        for (const t of adj.get(m.id) || []) if (!seen.has(t) && nodeBy.has(t)) { seen.add(t); q.push(nodeBy.get(t)); }
      }
      groups.push(g);
    }
    for (const g of groups) { g.span = Number.isFinite(g.first) ? g.last - g.first : 0; g.r0 = roomFor(g.nodes.length, 0); }
    groups.sort((a, b) => b.last - a.last || b.nodes.length - a.nodes.length || (a.key < b.key ? -1 : 1));
    newest = groups[0]?.last || 0;
    const oldest = groups.length ? Math.min(...groups.map((g) => g.last || newest)) : newest;
    spanDays = Math.max(1, (newest - oldest) / DAY);
    let regroup = 0;
    for (const g of groups) {
      const at = g.nodes.filter(isPlaced);
      // a new trail that joins two groups makes them one: it settles again as a whole
      g.merged = new Set(at.map((n) => n.gkey).filter(Boolean)).size > 1;
      if (g.merged) for (const n of g.nodes) if (n.fx != null) { n.fx = n.fy = n.fz = undefined; regroup++; }
      g.c = at.length ? [0, 1, 2].map((k) => at.reduce((s, n) => s + [n.x, n.y, n.z][k], 0) / at.length) : null;
      const spread = at.length ? Math.max(...at.map((n) => Math.hypot(n.x - g.c[0], n.y - g.c[1], n.z - g.c[2]))) : 0;
      // how much room it needs: measured once it's laid out, guessed from its size before
      g.r = roomFor(g.nodes.length, !g.merged && at.length >= g.nodes.length * 0.7 ? spread : 0);
    }
    pack(groups);
    for (const g of groups) {
      // a group already laid out moves to its place as a whole, keeping its shape
      if (g.c) {
        const d = [0, 1, 2].map((k) => g.anchor[k] - g.c[k]);
        if (Math.hypot(...d) > 14 || g.merged) for (const n of g.nodes) if (isPlaced(n)) {
          n.x += d[0]; n.y += d[1]; n.z += d[2];
          if (n.fx != null) { n.fx = n.x; n.fy = n.y; n.fz = n.z; }
          if (posCache.has(n.id)) posCache.set(n.id, [n.x, n.y, n.z]);
        }
      }
      // new pages start next to a page they're linked to, or in their group's place
      for (const n of g.nodes) {
        if (isPlaced(n)) continue;
        const nb = (adj.get(n.id) || []).map((t) => nodeBy.get(t)).find(isPlaced);
        const b = nb ? [nb.x, nb.y, nb.z] : g.anchor, j = nb ? 16 : 8;
        n.x = b[0] + (Math.random() - 0.5) * j; n.y = b[1] + (Math.random() - 0.5) * j; n.z = b[2] + (Math.random() - 0.5) * j;
      }
      for (const n of g.nodes) n.gkey = g.key;
    }
    return regroup;
  }
  /* Places for the groups: the newest at the middle, each next one at the nearest spot outward where
     it doesn't touch any other, round the middle and a little wider than high. */
  function pack(gs) {
    const GAP = 26, CELL = 140, grid = new Map(), golden = Math.PI * (3 - Math.sqrt(5));
    const cells = (p, r) => {
      const out = [], lo = p.map((v) => Math.floor((v - r) / CELL)), hi = p.map((v) => Math.floor((v + r) / CELL));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) out.push(x + ',' + y + ',' + z);
      return out;
    };
    const free = (p, r) => {
      for (const k of cells(p, r + GAP)) for (const o of grid.get(k) || []) if (Math.hypot(p[0] - o.anchor[0], p[1] - o.anchor[1], p[2] - o.anchor[2]) < r + o.r + GAP) return false;
      return true;
    };
    const put = (g, p) => { g.anchor = p; for (const k of cells(p, g.r + GAP)) (grid.get(k) || grid.set(k, []).get(k)).push(g); };
    const mean = [0, 0, 0];
    gs.forEach((g, i) => {
      if (i) {
        const step = Math.max(10, g.r * 0.5), mlen = Math.hypot(...mean) || 1;
        let best = null, bestS = Infinity, tries = 0;
        // shells round the newest group, each place on a shell tried (an even spread over the sphere):
        // the nearest shell with room wins, on it the place least hidden and on the emptier side
        for (let R = gs[0].r + g.r + GAP; ; R += step) {
          const K = Math.min(500, Math.max(16, Math.round(4 * R * R / ((g.r + GAP) * (g.r + GAP)))));
          for (let k = 0; k < K; k++) {
            const y = 1 - 2 * (k + 0.5) / K, rr = Math.sqrt(1 - y * y), th = k * golden + i * 2.39996;
            const a = R * rr * Math.cos(th) * SHAPE[0], b = R * y * SHAPE[1], c = R * rr * Math.sin(th) * SHAPE[2];
            const p = [a * RIGHT_H.x + c * VIEW_H.x, b, a * RIGHT_H.z + c * VIEW_H.z];
            if (!free(p, g.r)) continue;
            // on the emptier side, so the whole stays round (whether it hides another from the front doesn't matter: you turn it)
            const s = 0.5 * (p[0] * mean[0] + p[1] * mean[1] + p[2] * mean[2]) / (mlen * R);
            if (s < bestS) { bestS = s; best = p; }
          }
          if (best) break;
        }
        put(g, best);
      } else put(g, [0, 0, 0]);
      for (let k = 0; k < 3; k++) mean[k] += g.anchor[k] * g.nodes.length;
    });
  }
  /* Room a group needs: from its number of pages, or more in coarse steps if it has spread further. Coarse,
     so the places don't change when a layout is saved and read back a hair different. */
  const roomFor = (count, spread) => Math.max(count === 1 ? 12 : 8 + 30 * Math.sqrt(count), Math.ceil((spread + 12) / 20) * 20);
  function repack() {
    for (const g of groups) {
      const at = g.nodes.filter(isPlaced); if (!at.length) continue;
      g.c = [0, 1, 2].map((k) => at.reduce((s, n) => s + [n.x, n.y, n.z][k], 0) / at.length);
      g.r = roomFor(g.nodes.length, Math.max(...at.map((n) => Math.hypot(n.x - g.c[0], n.y - g.c[1], n.z - g.c[2]))));
    }
    pack(groups);
    for (const g of groups) {
      if (!g.c) continue;
      const d = [0, 1, 2].map((k) => g.anchor[k] - g.c[k]);
      if (Math.hypot(...d) > 0.5) for (const n of g.nodes) if (isPlaced(n)) { n.x += d[0]; n.y += d[1]; n.z += d[2]; }
    }
  }
  /* Holds each group round its place while it settles, moving it as a whole so its shape is its own. */
  function groupForce() {
    const f = (alpha) => {
      for (const g of groups) {
        if (!g.anchor) continue;
        let sx = 0, sy = 0, sz = 0, c = 0, loose = 0;
        for (const n of g.nodes) { if (!isPlaced(n)) continue; sx += n.x; sy += n.y; sz += n.z; c++; if (n.fx == null) loose++; }
        if (!c || !loose) continue;
        const k = 0.1 * alpha * (loose / c);
        const dx = (g.anchor[0] - sx / c) * k, dy = (g.anchor[1] - sy / c) * k, dz = (g.anchor[2] - sz / c) * k;
        for (const n of g.nodes) if (n.fx == null && isPlaced(n)) { n.vx += dx; n.vy += dy; n.vz += dz; }
        // a group read over several days: newer pages towards its middle, older ones further out
        if (g.span > 2 * DAY) {
          const k2 = 0.04 * alpha;
          for (const n of g.nodes) {
            if (n.fx != null || !isPlaced(n)) continue;
            const ox = n.x - g.anchor[0], oy = n.y - g.anchor[1], oz = n.z - g.anchor[2], d = Math.hypot(ox, oy, oz) || 1;
            const want = g.r0 * (0.12 + 0.8 * Math.min(1, (g.last - (n.last || g.first)) / g.span));
            const f = (want - d) / d * k2;
            n.vx += ox * f; n.vy += oy * f; n.vz += oz * f;
          }
        }
      }
    };
    f.initialize = () => {};
    return f;
  }
  /** How clearly a page's group shows: the newest fully, older ones fainter (Settings → fade older). */
  function groupOp(n) {
    if (!n || !view.fade || !newest || threads) return 1;
    // a group from one sitting fades as a whole; in one read over many days, each page by when you saw it
    const g = n.group, t = g ? Math.max(n.last || g.last, g.last - DAY) : (n.last ?? newest);
    const age = Math.max(0, newest - t) / DAY;
    return 1 - view.ageFade * 0.85 * (1 - Math.exp(-age / Math.max(1.5, spanDays / 5)));
  }
  /** Fewer pages: the ones you saw longest ago and deepest into their trails go first. */
  function computeKeep() {
    keep = null;
    if (!(view.show < 0.999)) return;
    const pool = nodes.filter((n) => !vis || vis.has(n.id));
    const want = Math.max(3, Math.round(pool.length * view.show));
    if (want >= pool.length) return;
    const tau = Math.max(1.5, spanDays / 5) * DAY;
    const score = (n) => Math.exp(-Math.max(0, newest - (n.last || 0)) / tau) - 0.12 * (n.depth || 0);
    pool.sort((a, b) => score(b) - score(a) || b.visits - a.visits);
    keep = new Set(pool.slice(0, want).map((n) => n.id));
  }
  const isShown = (n) => (!vis || vis.has(n.id)) && (!keep || keep.has(n.id));
  function shownCount() { const pool = nodes.filter((n) => !vis || vis.has(n.id)); return { shown: keep ? keep.size : pool.length, total: pool.length }; }

  function relayout() {
    posCache.clear();
    for (const n of nodes) { n.fx = n.fy = n.fz = undefined; n.x = n.y = n.z = undefined; n.gkey = undefined; }
    arrange();
    settling = true; repacked = false;
    G.warmupTicks(Math.round(Math.min(300, 120000 / Math.max(1, nodes.length)))).cooldownTicks(200); G.graphData({ nodes, links });
  }
  function getPositions() {
    const out = { [LAYOUT_V]: [2, 0, 0] };
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
    // a page on a thread (its start ring, end pin or a bead) opens that page; the line itself focuses the thread
    if (u?.title) { handlers.onClick?.(u.title); return true; }
    if (u?.key) { handlers.onThreadClick?.(u.key); return true; }
    return false;
  }
  let hoverNode = null;
  el.addEventListener('dblclick', () => { if (!hoverNode && !threads) home(); });
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
    const near = new Set();
    if (threads) for (const th of spec.threads) for (const c of th.chains) c.path.forEach((t, k) => { threads.on.add(t); if (c.dist[k] <= 3) near.add(t); });
    if (threads && spec.anchor) { threads.on.add(spec.anchor); near.add(spec.anchor); }
    ctl.autoRotate = false;
    // decide the camera first, so strands can be sized in screen pixels for that view. The view fits the
    // pages within three clicks of what you selected; pages further out may run off the edge, faded.
    const framed = threads && threads.on.size > 40 ? near : threads?.on;
    // the page you clicked goes in the middle of the window
    plan = threads ? bestFrame([...framed].map(posOf).filter(Boolean), spec.anchor ? posOf(spec.anchor) : null) : null;
    unit = unitAt(plan ? plan.d : cam.position.distanceTo(ctl.target));
    restyle();
    drawThreads();
    placeLabels(true);
  }
  /**
   * Colours with a meaning: what came before the selected page is cool, what came after is warm.
   *  up    the way here: blue
   *  side  branches off the way here: teal, lighter the further back they leave it
   *  down  each way on from the page: its own warm colour (orange, then the others)
   * Two sets, for light and dark map backgrounds; checked so that every pair stays apart, also for
   * red-green colour blindness (OKLab ΔE ≥ 15 normal, ≥ 9 simulated). Labels name every branch end.
   */
  function roleColors() {
    let dark = false;
    try { dark = new THREE.Color(style.bg).getHSL({}).l < 0.45; } catch { /* keep light */ }
    return dark
      ? { up: '#6ea8fe', side: ['#2fbfae', '#a3e3da'], down: ['#ff8a3d', '#ee3341', '#c74fb3', '#f2cf3b'] }
      : { up: '#1d4ed8', side: ['#0d9488', '#7ccfc4'], down: ['#e8590c', '#8e107e', '#8e3412', '#d974c5'] };
  }
  function unitAt(d) { return 2 * d * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, H); }
  /** Focus one thread: it's drawn in full, the others step back. */
  function setPin(key) { pin = key; drawThreads(); placeLabels(true); }
  function drawThreads() {
    shellLook();
    wake(); depthCue();
    disposeLayer();
    drawCursor();
    if (!threads) return;
    const bg = new THREE.Color(style.bg), white = new THREE.Color('#ffffff');
    const pk = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
    // where several trails share a connection, each gets its own lane so they read as separate strands
    // (one trail never shares: its branches split from a single line)
    const lanes = new Map();
    threads.threads.forEach((th, i) => th.chains.forEach((c) => c.path.forEach((t, k) => {
      if (!k) return;
      const key = pk(c.path[k - 1], t);
      if (!lanes.has(key)) lanes.set(key, []);
      if (!lanes.get(key).includes(i)) lanes.get(key).push(i);
    })));
    const n = threads.threads.length, minOp = 0.5 - 0.38 * view.ageFade, kExp = 0.5 + 1.5 * view.ageFade;
    // recency sets how strong a whole trail is; distance (clicks from the page you selected) makes the
    // far parts of it thinner and fade into the background, so the near part reads first
    const far = (d) => (d <= 1 ? 0 : Math.min(0.82, 1 - Math.pow(0.7, d - 1)));
    const thin = (d) => (d <= 1 ? 1 : Math.max(0.3, Math.pow(0.8, d - 1)));
    // colour of a part of a trail (see threadsFor in app.js): the way here in ink, each way on and
    // each branch off the way here in its own colour
    const R = roleColors();
    const hexOf = (th, g) => {
      if (!g || g === 'all') return th.color;
      if (g === 'up') return R.up;
      if (g.startsWith('side:')) return R.side[Math.max(0, Math.min(R.side.length, +g.slice(5) || 1) - 1)];
      const downs = (th.groups || []).filter((x) => x.startsWith('down:'));
      return R.down[Math.max(0, downs.indexOf(g)) % R.down.length];
    };
    const shade = (out, d) => out.lerp(bg, far(d));
    // where a trail starts (ring) and where each of its branches ends (pin)
    const endsOf = (th) => {
      const c0 = th.chains[0], out = [['start', c0.path[0], c0.dist[0], c0.grp[0], c0.path.length === 1]];
      for (const c of th.chains) { const L = c.path.length - 1; if (L > 0 && !c.extra) out.push(['end', c.path[L], c.dist[L], c.grp[L], false]); }
      return out;
    };
    fans = new Map(); const fanIdx = new Map();
    threads.threads.forEach((th) => {
      for (const [kind, t, , , alone] of endsOf(th)) {
        if (t === threads.anchor && !alone) continue;
        const key = kind + '\u0000' + t; fanIdx.set(th.key + kind + t, fans.get(key) || 0); fans.set(key, (fans.get(key) || 0) + 1);
      }
    });
    const fanOf = (th, kind, t) => { const m = fans.get(kind + '\u0000' + t) || 1; return (fanIdx.get(th.key + kind + t) || 0) - (m - 1) / 2; };
    // oldest first, so newer threads (and the focused one) are drawn on top
    const order = threads.threads.map((th, i) => i).sort((a, b) => (threads.threads[a].key === pin) - (threads.threads[b].key === pin) || b - a);
    const tmp = new THREE.Color();
    for (const i of order) {
      const th = threads.threads[i], focused = pin === th.key;
      // the older the trail, the fainter (how much is a setting); the one you clicked on is shown in full
      const ageOp = minOp + (1 - minOp) * Math.pow(th.rec, kExp);
      const op = pin ? (focused ? 1 : Math.min(0.14, ageOp)) : ageOp;
      const w = focused ? 1.3 : pin ? 0.55 : 0.55 + 0.45 * th.rec;
      const col = new THREE.Color(th.color);
      const data = { key: th.key, op, order: focused ? 50 : n - i };
      th.chains.forEach((c, ci) => {
        const pts = c.path.map(posOf);
        if (pts.length < 2 || pts.some((p) => !p)) return;
        const ctrl = [], at = []; // control points, and where each sits along the chain's pages
        for (let k = 0; k < pts.length; k++) {
          ctrl.push(pts[k]); at.push(k);
          if (k === pts.length - 1) break;
          const a = c.path[k], b = c.path[k + 1], ln = lanes.get(pk(a, b));
          const p = pts[k], q = pts[k + 1], dir = (a < b ? q.clone().sub(p) : p.clone().sub(q)).normalize();
          const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
          const j = ln.indexOf(i), off = ln.length > 1 ? (j - (ln.length - 1) / 2) * 9 * unit : 0;
          ctrl.push(p.clone().add(q).multiplyScalar(0.5).addScaledVector(side, off + 0.06 * p.distanceTo(q))); at.push(k + 0.5);
        }
        // how many clicks from the selected page each point of the strand is
        const cum = [0];
        for (let m = 1; m < ctrl.length; m++) cum.push(cum[m - 1] + ctrl[m].distanceTo(ctrl[m - 1]));
        const total = cum[cum.length - 1] || 1;
        const along = (arr) => (u) => {
          const x = u * total; let m = 1;
          while (m < cum.length - 1 && cum[m] < x) m++;
          const f = Math.max(0, Math.min(1, (x - cum[m - 1]) / ((cum[m] - cum[m - 1]) || 1)));
          const kk = at[m - 1] + (at[m] - at[m - 1]) * f, lo = Math.floor(kk), hi = Math.min(arr.length - 1, lo + 1);
          return +arr[lo] + (+arr[hi] - +arr[lo]) * (kk - lo);
        };
        const dAt = along(c.dist);
        // each stretch between two pages takes the colour of the page it leads to
        const cols = c.grp.map((g) => new THREE.Color(hexOf(th, g)));
        const colAt = (u) => {
          const x = u * total; let m = 1;
          while (m < cum.length - 1 && cum[m] < x) m++;
          const f = Math.max(0, Math.min(1, (x - cum[m - 1]) / ((cum[m] - cum[m - 1]) || 1)));
          const kk = at[m - 1] + (at[m] - at[m - 1]) * f;
          return cols[Math.min(cols.length - 1, Math.floor(kk) + 1)];
        };
        const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
        const L = curve.getLength(), segs = Math.min(600, Math.max(24, Math.round(L / (4 * unit)))), rad = 7;
        const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false);
        const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), cv = new THREE.Vector3(), v = new THREE.Vector3();
        for (let sI = 0; sI <= segs; sI++) {
          const u = sI / segs; curve.getPointAt(u, cv);
          const d = dAt(u), r = 3.4 * unit * w * thin(d);
          shade(tmp.copy(colAt(u)), d);
          for (let q = 0; q <= rad; q++) {
            const idx = sI * (rad + 1) + q;
            v.fromBufferAttribute(pos, idx).sub(cv).multiplyScalar(r).add(cv);
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
        // arrowheads along the way, pointing the way you went
        const stepLen = 90 * unit, count = Math.floor(L / stepLen), tan = new THREE.Vector3();
        for (let a = 1; a <= count; a++) {
          const u = (a - 0.5) / count; if (u < 0.08 || u > 0.94) continue;
          const d = dAt(u);
          const m = new THREE.Mesh(cone, new THREE.MeshLambertMaterial({ color: shade(colAt(u).clone(), d), transparent: op < 1, opacity: op, depthWrite: op >= 1 }));
          curve.getPointAt(u, m.position); curve.getTangentAt(u, tan);
          m.quaternion.setFromUnitVectors(UP, tan);
          m.scale.setScalar(4.2 * unit * w * thin(d));
          m.renderOrder = tube.renderOrder; Object.assign(m.userData, data);
          layer.add(m);
        }
        // the light that runs along the main line: on the newest trail, or on the one you clicked
        if (ci === 0 && (pin ? focused : th.rank === 0)) {
          const comet = [];
          for (let k = 0; k < 5; k++) comet.push(ball(pts[0], (5 - k * 0.75) * unit * w, cols[cols.length - 1].clone().lerp(white, 0.4 - k * 0.07), Math.min(1, op + 0.1) * (0.95 - k * 0.17)));
          comet.forEach((m) => { m.renderOrder = 60; });
          strands.push({ curve, L, comet, phase: -i * 0.35, pause: 0.6 + 2.2 * (1 - th.rec), gap: 7 * unit, speed: 220 * unit });
        }
      });
      // the pages in between: a solid dot if you read it, an open ring if you skimmed it
      const ends = endsOf(th), endPages = new Set(ends.map((e) => e[1])), done = new Set();
      th.chains.forEach((c, ci) => c.path.forEach((t, k) => {
        if ((ci > 0 && k === 0) || t === threads.anchor || endPages.has(t) || done.has(t)) return;
        done.add(t);
        const p = posOf(t); if (!p) return;
        const d = c.dist[k], hex = hexOf(th, c.grp[k]), dd = c.depths?.[k], fo = Math.max(0.12, op * (1 - 0.8 * far(d)));
        const sz = (dd === 'read' ? 17 : 16) * (focused ? 1.15 : 0.85 + 0.15 * th.rec) * Math.max(0.6, thin(d));
        if (dd) marker(dd === 'read' ? 'bead-read' : 'bead-skim', hex, p, sz, Math.max(0.18, fo), { ...data, title: t });
        else ball(p, 2.6 * unit * w * thin(d), shade(new THREE.Color(hex), d), fo, { ...data, title: t });
      }));
      // start: a ring; the end of every branch: a pin (not on the page you clicked)
      const big = focused ? 1.25 : 0.8 + 0.2 * th.rec;
      for (const [kind, t, d, g, alone] of ends) {
        if (t === threads.anchor && !alone) continue;
        const p = posOf(t); if (!p) continue;
        const fo = pin && !focused ? 0.3 : Math.max(0.15, op * (1 - 0.75 * far(d)));
        marker(kind, hexOf(th, g), p, (kind === 'end' ? 34 : 24) * big * Math.max(0.55, thin(d)), fo, { ...data, title: t }, fanOf(th, kind, t));
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
    const m = ball(p, 9 * unit, style.label, 0.3); m.userData.cursor = true; m.userData.r = 9 * unit;
  }
  function setCursor(title) { if (title === cursor) return; cursor = title; if (!threads) unit = unitAt(cam.position.distanceTo(ctl.target)); drawThreads(); placeLabels(true); }

  /* ---------- labels ---------- */
  const pool = new Map(); // title → { el, kind, w }
  let wanted = [], labelsDirty = true;
  const labelSig = new Float64Array(17), pv = new THREE.Vector3();
  const LSTAT = { placed: 0, skipped: 0 };
  /** Where a point lands on the screen (CSS pixels) and how deep it is, without allocating. */
  function project(x, y, z, out) {
    pv.set(x, y, z).project(cam);
    out.x = (pv.x + 1) * W / 2; out.y = (1 - pv.y) * H / 2; out.z = pv.z;
    return out;
  }
  function placeLabels(rebuild) {
    // nothing moved and nothing changed: the names stay where they are
    if (!rebuild && !labelsDirty && !settling && !camChanged(labelSig)) { LSTAT.skipped++; return; }
    if (rebuild) camChanged(labelSig);
    labelsDirty = false; LSTAT.placed++;
    if (rebuild) {
      wanted = [];
      if (threads) {
        const seen = new Map();
        const push = (t, kind, prio, op = 1) => {
          const o = seen.get(t);
          if (!o) { const w = { t, kind, prio, op }; seen.set(t, w); wanted.push(w); }
          else if (prio > o.prio) Object.assign(o, { kind, prio, op: Math.max(op, o.op) });
        };
        if (threads.anchor) push(threads.anchor, 'anchor', 1000);
        // every page on the drawn trails gets a name if there's room: the nearest to what you selected
        // first, then the newest trails; the focused trail before all others
        // with many trails drawn, only the pages near the selection (keeps the map readable)
        const reach = threads.threads.length > 10 ? 2 : 99;
        for (const th of threads.threads) {
          const boost = pin ? (th.key === pin ? 400 : -400) : 0;
          th.chains.forEach((c, ci) => c.path.forEach((t, k) => {
            if (c.dist[k] > reach && th.key !== pin) return;
            const d = Math.min(c.dist[k], 9), last = k === c.path.length - 1 && c.path.length > 1 && !c.extra, first = ci === 0 && k === 0;
            const kind = last ? 'end' : first ? 'start' : 'step';
            const sd = c.side[k] ? 1 : 0;
            push(t, kind, 700 - 65 * d + 90 * th.rec + (last ? 25 : first ? 15 : 0) - 120 * sd + boost, (d <= 1 ? 1 : Math.max(0.45, 1 - 0.12 * (d - 1))) * (1 - 0.3 * sd));
          }));
        }
      }
      if (cursor) wanted.push({ t: cursor, kind: 'cursor', prio: 900 });
      wanted.sort((p, q) => q.prio - p.prio);
      if (wanted.length > 60) wanted.length = 60;
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
    if (!threads) return overviewLabels(boxes, fwd);
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
      const lo = String(w.op ?? 1); if (o.el.style.opacity !== lo) o.el.style.opacity = lo;
      o.el.style.transform = `translate(${Math.round(bx[0])}px, ${Math.round(bx[1])}px)`;
    }
  }

  /*
   * Names in the overview come and go with zoom: of the pages on screen, the most visited ones get a
   * name where there's room. Zoomed out that's the big hubs; zoomed in, nearly every page you can see.
   */
  let shownLast = new Set(), cand = [];
  /** 0 at the front of the map, 1 at its back (the same span the fog uses). */
  function depthOf(viewDepth) {
    if (!view.depth) return 0;
    const d = cam.position.distanceTo(sceneC), near = d - sceneR, far = d + sceneR;
    return Math.max(0, Math.min(1, (viewDepth - near) / (far - near)));
  }
  function overviewLabels(boxes, fwd) {
    const tmp = new THREE.Vector3();
    let c = 0;
    for (const n of nodes) {
      if (!isShown(n) || !Number.isFinite(n.x)) continue;
      tmp.set(n.x, n.y, n.z).sub(cam.position);
      const vd = tmp.dot(fwd);
      if (vd <= 0) continue;
      const e = cand[c] || (cand[c] = { n: null, p: { x: 0, y: 0, z: 0 }, prio: 0, k: 0 });
      project(n.x, n.y, n.z, e.p);
      if (e.p.x < 0 || e.p.x > W || e.p.y < 0 || e.p.y > H) continue;
      // newer groups' names first, nearer ones before those behind; a name already shown stays a
      // while, so names don't flicker
      if (n._op === undefined) n._op = groupOp(n) ** 1.5;
      e.n = n; e.k = depthOf(vd);
      e.prio = (n.visits + 1) * n._op * (1.25 - 0.6 * e.k) + (shownLast.has(n.id) ? 2.5 : 0) + (n.id === cursor ? 1e6 : 0);
      c++;
    }
    const list = cand.slice(0, c).sort((a, b) => b.prio - a.prio);
    // a couple of dozen names over the whole map; zoomed in, as many as fit
    const room = Math.max(8, Math.round((W * H) / 16000));
    const budget = Math.min(room, 50, Math.round(22 + 900 / Math.max(cand.length, 30)));
    const shown = new Set();
    for (const { n, p, k } of list) {
      if (shown.size >= budget) break;
      // names further back are a little smaller and fainter
      const sc = 1.1 - 0.3 * k;
      const w = (n.lw || (n.lw = 7 * n.id.length + 14)) * sc, h = 18 * sc;
      // above the dot if there's room, else below, right or left of it
      for (const [dx, dy] of [[-w / 2, -h - 10], [-w / 2, 10], [12, -h / 2], [-w - 12, -h / 2]]) {
        const c = [p.x + dx, p.y + dy, p.x + dx + w, p.y + dy + h];
        if (c[0] < 2 || c[2] > W - 2 || c[1] < 2 || c[3] > H - 2) continue;
        if (boxes.some((b) => c[0] < b[2] && c[2] > b[0] && c[1] < b[3] && c[3] > b[1])) continue;
        boxes.push(c); shown.add(n.id);
        let o = pool.get(n.id);
        if (!o) { const e = document.createElement('div'); e.textContent = n.id; labelBox.appendChild(e); o = { el: e }; pool.set(n.id, o); }
        const kind = n.id === cursor ? 'cursor' : 'hub';
        if (o.kind !== kind) { o.kind = kind; o.el.className = 'lbl3d ' + kind; }
        if (o.el.style.display === 'none') o.el.style.display = '';
        const op = Math.max(0.45, groupOp(n)) * (1 - 0.5 * k);
        const lo = op < 0.99 ? op.toFixed(2) : '';
        if (o.el.style.opacity !== lo) o.el.style.opacity = lo;
        o.el.style.transform = `translate(${Math.round(c[0])}px, ${Math.round(c[1])}px) scale(${sc.toFixed(2)})`;
        break;
      }
    }
    for (const [t, o] of pool) if (!shown.has(t) && o.el.style.display !== 'none') o.el.style.display = 'none';
    if (pool.size > 300) for (const [t, o] of pool) if (!shown.has(t)) { o.el.remove(); pool.delete(t); }
    shownLast = shown;
  }

  /* ---------- camera ---------- */
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  /** Where the camera must be, looking along `back`, so these points fill `fill` of the window. */
  function frame(pts, back, fill, center) {
    const tv = Math.tan(cam.fov * Math.PI / 360), th = tv * (W / Math.max(1, H));
    const right = new THREE.Vector3().crossVectors(UP, back).normalize(), up = new THREE.Vector3().crossVectors(back, right);
    const box = new THREE.Box3().setFromPoints(pts), c = center ? center.clone() : box.getCenter(new THREE.Vector3());
    const need = () => {
      let m = 60 * scale;
      for (const p of pts) {
        tmpA.copy(p).sub(c); const z = tmpA.dot(back);
        m = Math.max(m, z + Math.abs(tmpA.dot(up)) / (tv * fill), z + Math.abs(tmpA.dot(right)) / (th * fill), z / 0.3);
      }
      return m;
    };
    for (let it = 0; it < (center ? 0 : 4); it++) {
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
    const list = nodes.filter((n) => isShown(n) && Number.isFinite(n.x));
    if (list.length < 200) return list.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    // ignore the few far-flung pages so the bulk of the map fills the window
    const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
    const xs = list.map((n) => n.x).sort((a, b) => a - b), ys = list.map((n) => n.y).sort((a, b) => a - b), zs = list.map((n) => n.z).sort((a, b) => a - b);
    const lo = [q(xs, 0.02), q(ys, 0.02), q(zs, 0.02)], hi = [q(xs, 0.98), q(ys, 0.98), q(zs, 0.98)];
    return list.filter((n) => n.x >= lo[0] && n.x <= hi[0] && n.y >= lo[1] && n.y <= hi[1] && n.z >= lo[2] && n.z <= hi[2]).map((n) => new THREE.Vector3(n.x, n.y, n.z));
  }
  /** The whole (visible) history. */
  function fit(animate = true, back = null) {
    let pts = visiblePoints(); if (!pts.length) return;
    // with the shell, the whole ball is what's framed, round its middle
    if (shell.visible && !threads) {
      const R = shell.scale.x, out = [];
      for (let k = 0; k < 26; k++) { const y = 1 - 2 * (k + 0.5) / 26, r = Math.sqrt(1 - y * y), th = k * 2.39996; out.push(new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th)).multiplyScalar(R).add(shell.position)); }
      return moveTo(frame(out, back || currentBack(), 0.94, shell.position.clone()), animate ? 900 : 0, false);
    }
    // the newest group you can see in the middle, the older ones round it
    const g = groups.find((x) => x.anchor && x.nodes.some((n) => isShown(n) && isPlaced(n)));
    let mid = null;
    if (g) { const at = g.nodes.filter(isPlaced); mid = new THREE.Vector3(...[0, 1, 2].map((k) => at.reduce((s, n) => s + [n.x, n.y, n.z][k], 0) / at.length)); }
    // the layout already has the newest group in its middle; centring what's on screen uses the window best
    moveTo(frame(pts, back || currentBack(), 0.9, null), animate ? 900 : 0, false);
  }
  /** The whole map from the side it's first seen from. */
  function home() { fit(true, VIEW.clone()); }
  /** The camera for these points: the angle where they spread out best, filling the window. */
  function bestFrame(pts, center) {
    if (!pts.length) return null;
    const cur = currentBack();
    let best = frame(pts, cur, 0.8, center), bestScore = best.d;
    if (pts.length > 2) {
      for (let yaw = 0; yaw < 360; yaw += 15) for (const pitch of [-40, -20, 0, 20, 40]) {
        const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
        const back = new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
        const f = frame(pts, back, 0.8, center), score = f.d * (1 + 0.45 * (1 - back.dot(cur))); // prefer small turns
        if (score < bestScore) { best = f; bestScore = score; }
      }
    }
    return best;
  }
  /** Show these pages, from the angle where they spread out best. */
  function focusOn(titles) {
    const pts = [...titles].map(posOf).filter(Boolean); if (!pts.length) return;
    if (pts.length === 1) { for (const m of adj.get([...titles][0]) || []) { const p = posOf(m); if (p) pts.push(p); } }
    const f = bestFrame(pts); if (f) moveTo(f, 1200, true);
  }
  /** Move the camera to the view the threads were drawn for. */
  function frameThreads() { if (plan) moveTo(plan, 1200, true); }
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
  let W = el.clientWidth || 800, H = el.clientHeight || 600, lastT = performance.now(), frameMs = 16, prevT = performance.now();
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
    // the same damping per second whatever the frame rate
    ctl.dampingFactor = 1 - Math.pow(1 - DAMP, Math.min(6, Math.max(0.25, (t - prevT) / (1000 / 60)))); prevT = t;
    if (!threads && (view.rotate || exploring) && !ctl.autoRotate && t - lastTouch > (exploring ? 5000 : 30000) && !settling) ctl.autoRotate = true;
    if (exploring && keys.size) fly(dt);
    placeLabels(false);
  }
  /* ---------- exploring: the brain on the whole screen, turning slowly, and flying through it ----------
     W/S or ↑/↓ fly forwards and back, A/D or ←/→ sideways, Q/E or PageUp/PageDown up and down (Shift: faster).
     Camera and the point it turns round move together, so you fly through the map, not just towards it. */
  let exploring = false;
  const keys = new Set();
  const FLY = { KeyW: [0, 0, 1], ArrowUp: [0, 0, 1], KeyS: [0, 0, -1], ArrowDown: [0, 0, -1], KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
    KeyD: [1, 0, 0], ArrowRight: [1, 0, 0], KeyE: [0, 1, 0], PageUp: [0, 1, 0], KeyQ: [0, -1, 0], PageDown: [0, -1, 0] };
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(), step = new THREE.Vector3();
  function fly(dt) {
    fwd.subVectors(ctl.target, cam.position).normalize();
    side.crossVectors(fwd, cam.up).normalize(); upv.crossVectors(side, fwd).normalize();
    step.set(0, 0, 0);
    for (const k of keys) { const d = FLY[k]; if (d) step.addScaledVector(side, d[0]).addScaledVector(upv, d[1]).addScaledVector(fwd, d[2]); }
    if (!step.lengthSq()) return;
    const speed = sceneR * 0.45 * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
    step.normalize().multiplyScalar(speed * dt);
    cam.position.add(step); ctl.target.add(step); ctl.update();
    lastTouch = performance.now(); ctl.autoRotate = false; framing = false; wake(); labelsDirty = true;
  }
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable;
  window.addEventListener('keydown', (e) => {
    if (!exploring || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (FLY[e.code] || e.code.startsWith('Shift')) { keys.add(e.code); if (FLY[e.code]) e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  /** Exploring on or off: the whole map, then a slow turn (faster than when idle) until you take over. */
  function explore(on) {
    exploring = !!on; keys.clear();
    ctl.autoRotateSpeed = exploring ? 1.1 : 0.3;
    if (exploring && !threads) { home(); lastTouch = performance.now() - 3000; }
    if (!exploring) ctl.autoRotate = !!view.rotate && !threads && performance.now() - lastTouch > 30000;
    wake(); labelsDirty = true;
  }
  requestAnimationFrame(tick);
  new ResizeObserver(() => {
    W = el.clientWidth || W; H = el.clientHeight || H;
    G.width(W).height(H); wake(); labelsDirty = true;
    handlers.onResize?.();
  }).observe(el);
  G.width(W).height(H);

  function setPalette() {
    readStyle(); wake(); labelsDirty = true;
    restyle(); drawThreads();
  }
  function setView(v) {
    Object.assign(view, v); wake(); labelsDirty = true;
    if ('rotate' in v) { ctl.autoRotate = !!v.rotate && !threads; lastTouch = v.rotate ? -1e9 : lastTouch; }
    if ('density' in v || 'fade' in v) { rebudget(); restyle(); }
    if ('ageFade' in v && threads) drawThreads();
    if ('mark' in v) restyle();
    if ('show' in v) { computeKeep(); rebudget(); restyle(); placeLabels(true); }
    if ('ageFade' in v || 'fade' in v) { restyle(); placeLabels(true); }
  }
  function neighbourhood(title, hops = 1) {
    const s = new Set([title]); let frontier = [title];
    for (let h = 0; h < hops; h++) { const next = []; for (const t of frontier) for (const m of adj.get(t) || []) if (!s.has(m)) { s.add(m); next.push(m); } frontier = next; }
    return s;
  }

  return {
    update, reset, relayout, setVisible, setPalette, setHighlight, setPin, setCursor, setView, roleColors, shownCount,
    fit, home, focusOn, frameThreads, settleAndFit, ensureVisible, zoomBy, getPositions, neighbourhood, explore, exploring: () => exploring,
    nodeCount: () => nodes.length,
    camInfo: () => ({ pos: cam.position.toArray(), target: ctl.target.toArray(), auto: ctl.autoRotate }),
    look: (t) => { const n = nodeBy.get(t); return n ? { color: nodeColor(n), shown: isShown(n), op: groupOp(n) } : null; },
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
