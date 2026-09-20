// --- START OF FILE utils/spaceScene.ts ---
//
// Shared visual language for the 2D canvas scenes: the magnetotail, the solar
// wind structure diagram and the flux rope analyser.
//
// These previously each drew their own particles and backdrops, so they read as
// three unrelated illustrations sitting next to the 3D CME visualisation. This
// module holds the pieces they share, and the particle sprite deliberately
// mirrors createParticleTexture in SimulationCanvas so the 2D scenes match the
// 3D one.

// Same textures the CME visualisation loads for its scene background and Earth.
export const MILKY_WAY_TEX = 'https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg';
export const EARTH_TEX     = 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg';

// ── Particle sprite ────────────────────────────────────────────────────────
// Soft radial falloff with the same gradient stops as the CME particle texture.
// Draw additively (globalCompositeOperation = 'lighter').
const SPRITE_PX = 64;
const spriteCache = new Map<string, HTMLCanvasElement>();
export function particleSprite(rgb: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const hit = spriteCache.get(rgb);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = SPRITE_PX; c.height = SPRITE_PX;
  const x = c.getContext('2d');
  if (!x) return null;
  const h = SPRITE_PX / 2;
  const g = x.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0,   `rgba(${rgb},1)`);
  g.addColorStop(0.2, `rgba(${rgb},0.8)`);
  g.addColorStop(1,   `rgba(${rgb},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  spriteCache.set(rgb, c);
  return c;
}

/** One particle, drawn as a short smeared streak along its travel vector. */
export function drawParticle(
  ctx: CanvasRenderingContext2D, rgb: string,
  x: number, y: number, px: number, py: number,
  radius: number, alpha: number, steps = 5,
) {
  const sp = particleSprite(rgb);
  if (!sp) return;
  const dx = x - px, dy = y - py;
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * 0.6;
    const rr = radius * (1 - t * 0.5);
    ctx.globalAlpha = alpha * (1 - t * 1.1);
    ctx.drawImage(sp, x - dx * t - rr, y - dy * t - rr, rr * 2, rr * 2);
  }
  ctx.globalAlpha = 1;
}

/** A single static glowing point, for field lines rather than moving plasma. */
export function drawGlow(
  ctx: CanvasRenderingContext2D, rgb: string,
  x: number, y: number, radius: number, alpha: number,
) {
  const sp = particleSprite(rgb);
  if (!sp) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

// ── Milky Way backdrop ─────────────────────────────────────────────────────
let mwImg: HTMLImageElement | null = null;
let mwReady = false;
/** Kick off the load once per page. Safe to call from every scene. */
export function loadMilkyWay(onReady?: () => void) {
  if (typeof Image === 'undefined' || mwImg) { if (mwReady) onReady?.(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { mwReady = true; onReady?.(); };
  img.src = MILKY_WAY_TEX;
  mwImg = img;
}
/** Cover-fit and tiled horizontally so a slow drift wraps seamlessly. */
export function drawMilkyWay(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  elapsed: number, alpha = 0.42, driftPxPerSec = 1.1,
) {
  if (!mwReady || !mwImg) return;
  const sc = Math.max(W / mwImg.width, H / mwImg.height) * 1.08;
  const dw = mwImg.width * sc, dh = mwImg.height * sc;
  const dy = (H - dh) * 0.5;
  const off = (elapsed * driftPxPerSec) % dw;
  ctx.globalAlpha = alpha;
  ctx.drawImage(mwImg, -off, dy, dw, dh);
  ctx.drawImage(mwImg, dw - off, dy, dw, dh);
  ctx.globalAlpha = 1;
}

// ── Earth ──────────────────────────────────────────────────────────────────
let earthImg: HTMLImageElement | null = null;
let earthReady = false;
export function loadEarthTexture(onReady?: () => void) {
  if (typeof Image === 'undefined' || earthImg) { if (earthReady) onReady?.(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { earthReady = true; onReady?.(); };
  img.src = EARTH_TEX;
  earthImg = img;
}
export function earthTexture(): HTMLImageElement | null { return earthReady ? earthImg : null; }

// Geographic <-> geomagnetic latitude, IGRF-13 dipole. renderGlobe needs these
// to place the auroral oval, so they travel with it.
const POLE_LAT_RAD = 80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;
function geoToGmag(latDeg: number, lonDeg: number): number {
  const p = latDeg * Math.PI / 180, l = lonDeg * Math.PI / 180;
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(p) * Math.sin(POLE_LAT_RAD) + Math.cos(p) * Math.cos(POLE_LAT_RAD) * Math.cos(l - POLE_LON_RAD)))) * 180 / Math.PI;
}
function gmagToGeoLat(gmagLat: number, lonDeg: number): number {
  let lo = -90, hi = 90;
  for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (geoToGmag(m, lonDeg) < gmagLat) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * Options for a globe that is scenery rather than the subject.
 *
 * The magnetotail scene's Earth is the thing being explained, so it carries the
 * live oval and the NZ marker. A globe drawn at 40px to anchor a geometry
 * diagram is not, and at that size the oval is a green smear and the NZ dot is
 * bigger than New Zealand. Turning them off keeps the same texture, the same
 * lighting and the same terminator, which is what makes the scenes look
 * related - without implying the small one is showing live data.
 */
export interface GlobeOptions {
  oval?: boolean;
  nzDot?: boolean;
}

export function renderGlobe(
  canvas: HTMLCanvasElement, tex: HTMLImageElement,
  centreLon: number, ovalBound: number, score: number, hot: boolean, sizePx: number,
  opts: GlobeOptions = {},
) {
  const { oval = true, nzDot = true } = opts;
  const size = sizePx;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const tmp = document.createElement('canvas');
  tmp.width = tex.naturalWidth; tmp.height = tex.naturalHeight;
  const tCtx = tmp.getContext('2d');
  if (!tCtx) return;
  tCtx.drawImage(tex, 0, 0);
  const texPx = tCtx.getImageData(0, 0, tmp.width, tmp.height);
  const out = ctx.createImageData(size, size);
  const half = size / 2, cLon = (centreLon * Math.PI) / 180;
  const tw = tex.naturalWidth, th = tex.naturalHeight;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half, ny = (py - half) / half;
      if (nx * nx + ny * ny > 1) continue;
      const lat = Math.asin(-ny), cosLat = Math.cos(lat);
      if (cosLat < 0.0001) continue;
      const sinDlon = nx / cosLat;
      if (Math.abs(sinDlon) > 1) continue;
      const lon = Math.asin(sinDlon) + cLon;
      let u = ((lon * 180 / Math.PI) + 180) / 360;
      u = ((u % 1) + 1) % 1;
      const v = (90 - lat * 180 / Math.PI) / 180;
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)));
      const si = (ty * tw + tx) * 4, di = (py * size + px) * 4;
      out.data[di] = texPx.data[si]; out.data[di+1] = texPx.data[si+1];
      out.data[di+2] = texPx.data[si+2]; out.data[di+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // Cinematic lighting: sun from the left, deep night limb on the right
  ctx.globalCompositeOperation = 'source-atop';
  const lightGrad = ctx.createRadialGradient(half * 0.5, half * 0.6, 0, half, half, half * 1.15);
  lightGrad.addColorStop(0, 'rgba(255,250,240,0.14)');
  lightGrad.addColorStop(0.4, 'rgba(255,255,255,0.02)');
  lightGrad.addColorStop(0.78, 'rgba(2,4,14,0.34)');
  lightGrad.addColorStop(1, 'rgba(2,4,14,0.7)');
  ctx.fillStyle = lightGrad; ctx.fillRect(0, 0, size, size);
  const term = ctx.createLinearGradient(half * 0.7, 0, size, 0);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.55, 'rgba(1,3,12,0.28)');
  term.addColorStop(1, 'rgba(1,3,12,0.62)');
  ctx.fillStyle = term; ctx.fillRect(0, 0, size, size);

  // Live aurora oval band
  if (oval) {
  const DR = Math.PI / 180;
  function ringPts(gmagLat: number) {
    const pts: { x: number; y: number; vis: boolean }[] = [];
    for (let lon = 0; lon <= 360; lon += 4) {
      const normLon = lon <= 180 ? lon : lon - 360;
      const geoLat = gmagToGeoLat(gmagLat, normLon);
      const latR = geoLat * DR;
      const dlonR = (normLon - centreLon) * DR;
      const cosC = Math.cos(latR) * Math.cos(dlonR);
      pts.push({ x: half + half * Math.cos(latR) * Math.sin(dlonR), y: half - half * Math.sin(latR), vis: cosC > 0 });
    }
    return pts;
  }
  function strokeVisible(pts: { x: number; y: number; vis: boolean }[]) {
    ctx!.beginPath();
    let on = false;
    for (const p of pts) {
      if (p.vis) { if (!on) { ctx!.moveTo(p.x, p.y); on = true; } else ctx!.lineTo(p.x, p.y); }
      else on = false;
    }
    ctx!.stroke();
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(half, half, half - 0.5, 0, Math.PI * 2); ctx.clip();
  const act = Math.min(1, score / 100);
  const widthDeg = 3.5 + act * 7 + (hot ? 2 : 0);
  const layers = 14;
  const base = 0.09 + act * 0.17 + (hot ? 0.1 : 0);
  const bandPx = (half * widthDeg) / 90;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < layers; i++) {
    const f = i / (layers - 1);
    const gmagLat = ovalBound - f * widthDeg;
    const prof = Math.pow(1 - f, 1.5);
    const alpha = base * (0.22 + 0.78 * prof);
    let r = 70, g = 215, bl = 130;
    if (f < 0.4 && act > 0.4) {
      const redMix = ((act - 0.4) / 0.6) * (1 - f / 0.4);
      r = Math.round(70 + redMix * 185); g = Math.round(215 - redMix * 95); bl = Math.round(130 - redMix * 55);
    }
    ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
    ctx.lineWidth = (bandPx / layers) * 2.6 + 0.6;
    ctx.filter = `blur(${(1 + f * 2.4).toFixed(1)}px)`;
    strokeVisible(ringPts(gmagLat));
  }
  ctx.filter = 'blur(0.5px)';
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = `rgba(160,255,195,${(0.45 + act * 0.4).toFixed(2)})`;
  strokeVisible(ringPts(ovalBound));
  ctx.filter = 'none';
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  }

  // NZ dot
  if (nzDot) {
  const nzLatR = (-43.5 * Math.PI) / 180, nzDlon = ((172 - centreLon) * Math.PI) / 180;
  const nzX = half + half * Math.cos(nzLatR) * Math.sin(nzDlon), nzY = half - half * Math.sin(nzLatR);
  ctx.globalAlpha = 0.9; ctx.fillStyle = '#5fb47a'; ctx.beginPath(); ctx.arc(nzX, nzY, size * 0.018, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.45; ctx.strokeStyle = '#5fb47a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(nzX, nzY, size * 0.036, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  }
}

/**
 * Blit a prepared globe sprite into a scene, with the atmosphere rim.
 *
 * The rim is what stops the globe reading as a sticker: it is a faint blue
 * halo just outside the disc, brightening a little when the scene is active.
 * Both the magnetotail and the Russell-McPherron diagram draw their Earth
 * through here, so the two cannot drift apart.
 *
 * `glow` is 0..1 and lifts the halo when something is happening. A sprite that
 * has not loaded yet falls back to the flat blue disc rather than a hole.
 */
export function drawEarthDisc(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  sprite: HTMLCanvasElement | null,
  glow = 0,
) {
  const atm = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.22);
  atm.addColorStop(0, 'rgba(80,150,255,0)');
  atm.addColorStop(0.75, `rgba(90,160,255,${(0.10 + glow * 0.06).toFixed(3)})`);
  atm.addColorStop(1, 'rgba(90,160,255,0)');
  ctx.fillStyle = atm;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill();

  if (sprite) {
    ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#14304f';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
}
// --- END OF FILE utils/spaceScene.ts ---

// ── Sun ────────────────────────────────────────────────────────────────────
// The CME visualisation's Sun is not an image, it is an animated Simplex-noise
// fragment shader. To put the same Sun in a 2D canvas scene we compile that
// exact shader (SUN_FRAGMENT_SHADER from constants) in a small offscreen WebGL
// canvas and blit the result. Same source, same noise, same colours.
//
// The original vertex shader is written for Three's sphere geometry, so this
// supplies a minimal full-quad one that feeds the same vUv varying.
const SUN_QUAD_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

let sunGl: WebGLRenderingContext | null = null;
let sunCanvas: HTMLCanvasElement | null = null;
let sunTimeLoc: WebGLUniformLocation | null = null;
let sunBroken = false;

function initSun(sizePx: number, fragSrc: string): boolean {
  if (sunBroken) return false;
  if (sunGl) return true;
  if (typeof document === 'undefined') return false;
  try {
    sunCanvas = document.createElement('canvas');
    sunCanvas.width = sizePx; sunCanvas.height = sizePx;
    const gl = sunCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) { sunBroken = true; return false; }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
      return sh;
    };
    // Three injects precision qualifiers for its own shaders. A raw WebGL
    // context does not, and a fragment shader without one fails to compile,
    // which is what silently dropped this to the gradient fallback.
    const frag = /precision\s+(low|medium|high)p\s+float/.test(fragSrc)
      ? fragSrc
      : 'precision mediump float;\n' + fragSrc;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, SUN_QUAD_VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    sunTimeLoc = gl.getUniformLocation(prog, 'uTime');
    sunGl = gl;
    return true;
  } catch (e) {
    console.warn('[spaceScene] Sun shader unavailable, using gradient fallback:', e);
    sunBroken = true; sunGl = null; sunCanvas = null;
    return false;
  }
}

/**
 * Draw the CME visualisation's Sun, centred at (cx, cy) with radius r.
 * `fragSrc` is SUN_FRAGMENT_SHADER. Falls back to a plain radial gradient if
 * WebGL is unavailable, so a scene never loses its Sun entirely.
 */
export function drawSun(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  timeSec: number, fragSrc: string,
) {
  // Corona first, underneath the disc.
  const corona = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 3.2);
  corona.addColorStop(0, 'rgba(255,186,74,0.28)');
  corona.addColorStop(0.35, 'rgba(255,150,50,0.10)');
  corona.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = corona;
  ctx.beginPath(); ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2); ctx.fill();

  const ok = initSun(128, fragSrc);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (ok && sunGl && sunCanvas) {
    if (sunTimeLoc) sunGl.uniform1f(sunTimeLoc, timeSec);
    sunGl.viewport(0, 0, sunCanvas.width, sunCanvas.height);
    sunGl.drawArrays(sunGl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(sunCanvas, cx - r, cy - r, r * 2, r * 2);
    // A little limb darkening, so a flat quad still reads as a sphere.
    const limb = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    limb.addColorStop(0, 'rgba(255,255,255,0.16)');
    limb.addColorStop(0.65, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(90,35,0,0.42)');
    ctx.fillStyle = limb;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  } else {
    const disc = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.25, r * 0.1, cx, cy, r);
    disc.addColorStop(0, '#fff6d8');
    disc.addColorStop(0.45, '#ffd166');
    disc.addColorStop(1, '#f59f2b');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
