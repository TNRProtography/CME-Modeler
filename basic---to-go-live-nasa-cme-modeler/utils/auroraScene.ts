// utils/auroraScene.ts
// The southern aurora as seen from New Zealand, drawn on a canvas: green base low on the
// southern horizon, magenta-red pillars above, the Southern Cross and Pointers, the Milky Way,
// an alpine ridge and a still lake reflection. Used by the milestone celebration screen and its share card.

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const R = rng(20261003);
const STARS = Array.from({ length: 900 }, () => { const x = R(), y = R(), m = R(); return { x, y, s: m < 0.96 ? 0.4 + R() * 0.8 : 1.2 + R() * 1.1, a: 0.25 + R() * 0.75, tw: R() * 6.28 }; });
// Milky Way: denser faint stars along a diagonal band
const MW = Array.from({ length: 1400 }, () => { const u = R(), off = (R() + R() + R() - 1.5) * 0.11; return { x: u, y: 0.05 + u * 0.55 + off, s: 0.3 + R() * 0.6, a: 0.12 + R() * 0.35 }; });
// Crux and the Pointers (relative layout, unit = cross height/2)
const CRUX: [number, number, number][] = [[0, -1, 2.6], [0.06, 1, 3.1], [-0.66, -0.05, 2.8], [0.6, -0.3, 2.2], [0.33, 0.42, 1.6]];
const POINTERS: [number, number, number][] = [[-1.75, 0.15, 2.9], [-2.6, 0.42, 3.4]];
const RAYS = Array.from({ length: 260 }, (_, i) => ({ x: (i + R() * 0.8) / 260, w: 1.2 + R() * 2.6, ph: R() * 6.28, sp: 0.6 + R() * 1.8, k: 0.55 + R() * 0.45, red: R() }));
const RIDGE = (() => { const r = rng(77), p: [number, number][] = []; let y = 0.0; for (let i = 0; i <= 120; i++) { const x = i / 120; const big = Math.sin(x * 9.2 + 1.3) * 0.45 + Math.sin(x * 23.0) * 0.18 + Math.sin(x * 4.1 + 0.4) * 0.6; y = big + (r() - 0.5) * 0.35; p.push([x, y]); } return p; })();

function noise(x: number, t: number) { return 0.5 + 0.22 * Math.sin(x * 11.0 + t * 0.21) + 0.16 * Math.sin(x * 27.0 - t * 0.47) + 0.12 * Math.sin(x * 61.0 + t * 0.9); }

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number, t: number, _I: number) {
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#010208'); g.addColorStop(0.6, '#040a16'); g.addColorStop(1, '#0a1c1c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  const sc = Math.min(w, h);
  for (const s of MW) { ctx.globalAlpha = s.a * 0.8; ctx.fillStyle = '#dfe8ff'; ctx.fillRect(s.x * w, s.y * horizon, s.s, s.s); }
  for (const s of STARS) { if (s.y * horizon > horizon - 4) continue; const tw = 0.75 + 0.25 * Math.sin(t * 1.7 + s.tw); ctx.globalAlpha = s.a * tw; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x * w, s.y * horizon * 0.98, s.s * (sc / 900), 0, 6.283); ctx.fill(); }
  // Southern Cross + pointers, upper left
  const cx = w * 0.3, cy = horizon * 0.28, u = sc * 0.06;
  for (const [x, y, m] of CRUX.concat(POINTERS)) {
    const px = cx + x * u, py = cy + y * u, r = m * (sc / 900);
    ctx.globalAlpha = 0.16; ctx.fillStyle = '#cfe0ff'; ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawAurora(ctx: CanvasRenderingContext2D, w: number, _h: number, horizon: number, t: number, I: number) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  // low green arc hugging the southern horizon
  const arcH = horizon * (0.16 + 0.06 * I);
  const ag = ctx.createLinearGradient(0, horizon - arcH, 0, horizon);
  ag.addColorStop(0, 'rgba(40,255,140,0)'); ag.addColorStop(0.6, `rgba(40,255,140,${0.18 + 0.22 * I})`); ag.addColorStop(1, `rgba(120,255,180,${0.25 + 0.3 * I})`);
  ctx.fillStyle = ag; ctx.fillRect(0, horizon - arcH, w, arcH);
  // rays / pillars
  for (const r of RAYS) {
    const n = noise(r.x, t), fl = 0.75 + 0.25 * Math.sin(t * r.sp + r.ph);
    const amp = Math.max(0, (n - 0.38) * 1.9) * r.k * fl * (0.35 + I * 0.95);
    if (amp < 0.02) continue;
    const x = r.x * w + Math.sin(t * 0.15 + r.ph) * w * 0.004;
    const top = horizon - horizon * (0.18 + 0.62 * Math.min(1.1, amp));
    const base = horizon - horizon * 0.01;
    const gr = ctx.createLinearGradient(0, top, 0, base);
    const red = 0.5 + 0.5 * r.red;
    gr.addColorStop(0, 'rgba(255,40,90,0)');
    gr.addColorStop(0.25, `rgba(230,40,${110 + 60 * red},${0.2 * amp})`);
    gr.addColorStop(0.55, `rgba(255,70,140,${0.38 * amp})`);
    gr.addColorStop(0.78, `rgba(140,140,170,${0.12 * amp})`);
    gr.addColorStop(0.88, `rgba(60,255,150,${0.42 * amp})`);
    gr.addColorStop(1, `rgba(150,255,190,${0.55 * amp})`);
    ctx.fillStyle = gr; ctx.fillRect(x, top, r.w * (w / 1000) * 2.2, base - top);
  }
  ctx.restore();
}

function ridgePath(ctx: CanvasRenderingContext2D, w: number, horizon: number, scaleY: number, flip: boolean) {
  ctx.beginPath(); ctx.moveTo(0, horizon);
  for (const [x, y] of RIDGE) { const yy = horizon - (0.012 + Math.max(0, y + 0.9) * 0.05) * scaleY; ctx.lineTo(x * w, flip ? 2 * horizon - yy : yy); }
  ctx.lineTo(w, horizon); ctx.closePath();
}

let offscreen: HTMLCanvasElement | null = null;

/** Paint one frame. t = seconds, I = aurora intensity (0.25 quiet … 1.4 substorm onset). */
export function drawAuroraScene(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, I: number, opts: { horizon?: number } = {}) {
  const horizon = Math.round(h * (opts.horizon ?? 0.72));
  // sky + aurora into an offscreen buffer so it can be mirrored in the lake
  const off = offscreen || (offscreen = document.createElement('canvas'));
  if (off.width !== w || off.height !== horizon) { off.width = w; off.height = horizon; }
  const o = off.getContext('2d')!;
  o.clearRect(0, 0, w, horizon);
  drawSky(o, w, h, horizon, t, I); drawAurora(o, w, h, horizon, t, I);
  ctx.drawImage(off, 0, 0);
  // lake
  ctx.fillStyle = '#02050a'; ctx.fillRect(0, horizon, w, h - horizon);
  ctx.save(); ctx.globalAlpha = 0.42; ctx.translate(0, horizon * 2); ctx.scale(1, -1);
  ctx.drawImage(off, 0, 0, w, horizon, 0, 0, w, horizon); ctx.restore();
  const lg = ctx.createLinearGradient(0, horizon, 0, h); lg.addColorStop(0, 'rgba(2,5,10,0.15)'); lg.addColorStop(1, 'rgba(2,5,10,0.92)');
  ctx.fillStyle = lg; ctx.fillRect(0, horizon, w, h - horizon);
  ctx.globalAlpha = 0.07; ctx.fillStyle = '#9fffd0';
  for (let i = 0; i < 26; i++) { const y = horizon + 6 + i * i * (h - horizon) / 760; ctx.fillRect(((i * 97 + t * 8) % w) - w * 0.2, y, w * (0.25 + (i % 5) * 0.08), 1); }
  ctx.globalAlpha = 1;
  // alpine ridge and its reflection
  const sY = h * 0.9;
  ctx.fillStyle = '#010302'; ridgePath(ctx, w, horizon, sY, false); ctx.fill();
  ctx.fillStyle = 'rgba(1,3,2,0.85)'; ridgePath(ctx, w, horizon, sY * 0.8, true); ctx.fill();
  ctx.fillStyle = '#000'; ctx.fillRect(0, horizon - 1, w, 2);
}
