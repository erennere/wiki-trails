// Animated background layer behind the graph (one canvas, ~30 fps, pauses when hidden).
const rand = (a, b) => a + Math.random() * (b - a);

export function createEffects(canvas) {
  const ctx = canvas.getContext('2d');
  let fx = { type: 'none' }, parts = [], w = 0, h = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    draw(performance.now());
  }
  new ResizeObserver(resize).observe(canvas);

  function seed() {
    const n = (k) => Math.round(k * (w * h) / (1000 * 700));
    switch (fx.type) {
      case 'stars': case 'nebula':
        parts = Array.from({ length: n(fx.type === 'nebula' ? 260 : 170) }, () => ({ x: rand(0, w), y: rand(0, h), s: Math.random() < .12 ? 2 : 1, p: rand(0, 6.3), v: rand(.4, 1.6), c: Math.random() < .25 ? fx.c2 : fx.c1 }));
        break;
      case 'rain': parts = Array.from({ length: n(150) }, () => ({ x: rand(0, w), y: rand(-h, h), l: rand(8, 26), v: rand(260, 520), c: Math.random() < .2 ? fx.c2 : fx.c1 })); break;
      case 'bubbles': parts = Array.from({ length: n(45) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(3, 16), v: rand(12, 40), p: rand(0, 6.3) })); break;
      case 'sparkles': parts = Array.from({ length: n(34) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(4, 11), p: rand(0, 6.3), v: rand(.6, 1.4), c: Math.random() < .5 ? fx.c1 : fx.c2 })); break;
      case 'dust': parts = Array.from({ length: n(80) }, () => ({ x: rand(0, w), y: rand(0, h), r: rand(.8, 2.8), vx: rand(-6, 6), vy: rand(-5, 3), a: rand(.08, .3) })); break;
      case 'matrix': parts = Array.from({ length: Math.ceil(w / 18) }, (_, i) => ({ x: i * 18 + 4, y: rand(-h, h), v: rand(30, 90), on: Math.random() < .35 })); break;
      case 'clouds': parts = Array.from({ length: 7 }, () => ({ x: rand(-200, w), y: rand(0, h), rx: rand(70, 160), ry: rand(30, 60), v: rand(6, 16) })); break;
      default: parts = [];
    }
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    const c1 = fx.c1 || '#fff', c2 = fx.c2 || c1;
    switch (fx.type) {
      case 'nebula': {
        for (const [x, y, r, c, a] of [[.25, .3, .55, c2, .16], [.75, .65, .5, c1, .12], [.55, .15, .35, fx.c3 || c2, .1]]) {
          const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
          g.addColorStop(0, hexA(c, a)); g.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        }
      } // falls through to the stars
      case 'stars':
        for (const s of parts) { ctx.globalAlpha = .25 + .75 * Math.abs(Math.sin(t * s.v + s.p)); ctx.fillStyle = s.c; ctx.fillRect(s.x, s.y, s.s, s.s); }
        ctx.globalAlpha = 1; break;
      case 'rain':
        ctx.lineWidth = 1;
        for (const d of parts) {
          d.y += d.v / 30; if (d.y > h) { d.y = -d.l; d.x = rand(0, w); }
          ctx.strokeStyle = hexA(d.c, .35); ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + d.l); ctx.stroke();
        }
        break;
      case 'radar': {
        const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2, a = (t * .9) % (Math.PI * 2);
        ctx.strokeStyle = hexA(c1, .1); ctx.lineWidth = 1;
        for (let r = 80; r < R; r += 80) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        if (ctx.createConicGradient) {
          const g = ctx.createConicGradient(a - .7, cx, cy);
          g.addColorStop(0, hexA(c1, 0)); g.addColorStop(.07, hexA(c1, .13)); g.addColorStop(.072, hexA(c1, 0)); g.addColorStop(1, hexA(c1, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        }
        ctx.strokeStyle = hexA(c1, .5); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
        break;
      }
      case 'grid': {
        const hy = h * .64;
        const sun = ctx.createLinearGradient(0, hy - h * .3, 0, hy);
        sun.addColorStop(0, fx.c3 || '#ffcf3f'); sun.addColorStop(1, c2);
        ctx.save(); ctx.beginPath(); ctx.arc(w / 2, hy, h * .2, Math.PI, 0); ctx.closePath(); ctx.clip();
        ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 7; i++) { const yy = hy - i * i * 2.2 - 4; ctx.fillRect(0, yy, w, 1.5 + i * .6); }
        ctx.restore();
        ctx.strokeStyle = hexA(c1, .55); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(w, hy); ctx.stroke();
        for (let i = -24; i <= 24; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 14, hy); ctx.lineTo(w / 2 + i * w * .12, h); ctx.stroke(); }
        const off = (t * .35) % 1;
        for (let i = 0; i < 14; i++) { const z = (i + off) / 14, y = hy + (h - hy) * z * z; ctx.globalAlpha = z; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.globalAlpha = 1; break;
      }
      case 'bubbles':
        for (const b of parts) {
          b.y -= b.v / 30; b.x += Math.sin(t + b.p) * .3; if (b.y < -20) { b.y = h + 20; b.x = rand(0, w); }
          ctx.strokeStyle = hexA(c1, .55); ctx.fillStyle = hexA(c1, .08); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = hexA('#ffffff', .7); ctx.beginPath(); ctx.arc(b.x - b.r * .35, b.y - b.r * .35, b.r * .22, 0, 7); ctx.fill();
        }
        break;
      case 'sparkles':
        for (const s of parts) {
          const k = Math.max(0, Math.sin(t * s.v + s.p)); if (k < .05) { if (Math.random() < .02) { s.x = rand(0, w); s.y = rand(0, h); } continue; }
          const r = s.r * k; ctx.fillStyle = hexA(s.c, .85 * k);
          ctx.beginPath(); ctx.moveTo(s.x, s.y - r); ctx.quadraticCurveTo(s.x, s.y, s.x + r, s.y); ctx.quadraticCurveTo(s.x, s.y, s.x, s.y + r); ctx.quadraticCurveTo(s.x, s.y, s.x - r, s.y); ctx.quadraticCurveTo(s.x, s.y, s.x, s.y - r); ctx.fill();
        }
        break;
      case 'dust':
        for (const d of parts) {
          d.x += d.vx / 30; d.y += d.vy / 30;
          if (d.x < -5) d.x = w + 5; if (d.x > w + 5) d.x = -5; if (d.y < -5) d.y = h + 5; if (d.y > h + 5) d.y = -5;
          ctx.fillStyle = hexA(c1, d.a); ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
        }
        break;
      case 'matrix':
        ctx.font = '12px "JetBrains Mono", monospace';
        for (const c of parts) {
          if (!c.on) continue;
          c.y += c.v / 30; if (c.y > h + 200) { c.y = rand(-200, 0); c.on = Math.random() < .5; }
          for (let k = 0; k < 10; k++) { ctx.fillStyle = hexA(c1, .16 * (1 - k / 10)); ctx.fillText(((c.x * 7 + k * 13 + Math.floor(t * 4)) % 10).toString(), c.x, c.y - k * 14); }
        }
        if (Math.random() < .01) for (const c of parts) if (!c.on && Math.random() < .1) c.on = true;
        break;
      case 'scan': {
        const y = ((t * 60) % (h + 80)) - 40;
        const g = ctx.createLinearGradient(0, y - 40, 0, y + 4);
        g.addColorStop(0, hexA(c1, 0)); g.addColorStop(1, hexA(c1, .14));
        ctx.fillStyle = g; ctx.fillRect(0, y - 40, w, 44);
        break;
      }
      case 'vhs': {
        const y = ((t * 40) % (h + 120)) - 60;
        ctx.fillStyle = hexA(c1, .06); ctx.fillRect(0, y, w, 50);
        if ((t % 5) < .25) for (let i = 0; i < 6; i++) { ctx.fillStyle = hexA(i % 2 ? c1 : c2, .18); ctx.fillRect(rand(-40, 0), rand(0, h), w + 40, rand(2, 7)); }
        break;
      }
      case 'clouds':
        for (const c of parts) {
          c.x += c.v / 30; if (c.x - c.rx > w) { c.x = -c.rx * 2; c.y = rand(0, h); }
          ctx.fillStyle = hexA(c1, .1); ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.ellipse(c.x + c.rx * .5, c.y - c.ry * .4, c.rx * .6, c.ry * .8, 0, 0, 7); ctx.fill();
        }
        break;
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return;
    last = now; draw(now);
  }
  function start() { cancelAnimationFrame(raf); if (fx.type !== 'none' && !reduced && !document.hidden) raf = requestAnimationFrame(loop); }
  document.addEventListener('visibilitychange', start);

  return {
    set(next) { fx = next && next.type ? next : { type: 'none' }; resize(); start(); },
  };
}

function hexA(c, a) {
  if (!c) return `rgba(255,255,255,${a})`;
  if (c.startsWith('#')) {
    let x = c.slice(1); if (x.length === 3) x = [...x].map((ch) => ch + ch).join('');
    const n = parseInt(x.slice(0, 6), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  return c;
}
