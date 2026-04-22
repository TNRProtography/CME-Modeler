/**
 * utils/cmeVideoRenderer.ts
 *
 * Off-screen renderer that produces an animated GIF of CME propagation.
 *
 * Architecture notes:
 * - Runs entirely in the user's browser, on-demand. No server infrastructure.
 * - Uses a dedicated lightweight Three.js scene (NOT shared with SimulationCanvas)
 *   to avoid interfering with the main modeler view. Keeps the scene deliberately
 *   minimal — Sun + planets + CME cones — so rendering each frame is cheap.
 * - Two viewports rendered into one canvas: top-down (left) and side-on (right),
 *   à la NOAA WSA-Enlil's dual-view product.
 * - Walks simulation time from (now − 7 days) to (now + 5 days) in fixed steps,
 *   capturing one GIF frame per step.
 * - Uses gif.js loaded from CDN (same pattern as THREE in the rest of the app).
 *
 * Honest limitations:
 * - GCS / flux-rope geometry is simplified to an icon-like wedge. This video is
 *   a visualisation aid, not a peer-reviewed model — we label it as such in the
 *   UI and in the rendered overlay.
 * - Bz / rotation / deflection are not represented (DONKI doesn't publish them).
 * - On low-end phones, full render can take 60–90s; the caller should show a
 *   progress bar and allow cancellation.
 */

import { ProcessedCME } from '../types';
import {
  createPropagationEngine,
  processedCMEToCMEInput,
} from './heliosphericPropagation';
import type { PropagationEngine } from './heliosphericPropagation';
import { computeEclipticLongitude } from './astronomicalPositions';

// ─────────────────────────────────────────────────────────────────────────────
//  Script loading (same pattern used by SimulationCanvas)
// ─────────────────────────────────────────────────────────────────────────────

const GIF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js';
const GIF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

const loadScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });

/**
 * gif.js spawns a Web Worker from the URL given in `workerScript`. Browsers
 * refuse to run a Worker from a different origin than the page, so fetching
 * cdnjs directly as a Worker fails. Workaround: fetch the worker script as
 * text, wrap it in a Blob, and hand gif.js a same-origin blob: URL.
 *
 * Cached in a module-level promise so repeat calls don't re-fetch.
 */
let workerBlobUrlPromise: Promise<string> | null = null;
function getGifWorkerBlobUrl(): Promise<string> {
  if (workerBlobUrlPromise) return workerBlobUrlPromise;
  workerBlobUrlPromise = fetch(GIF_WORKER_URL)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to fetch gif.worker (${r.status})`);
      return r.blob();
    })
    .then(blob => URL.createObjectURL(blob));
  return workerBlobUrlPromise;
}

async function ensureLibrariesLoaded(): Promise<string> {
  if (!(window as any).THREE) {
    await loadScript(THREE_URL);
  }
  if (!(window as any).GIF) {
    await loadScript(GIF_JS_URL);
  }
  return getGifWorkerBlobUrl();
}

/**
 * Load the brand watermark image. Returns null if the fetch fails — the
 * render is allowed to continue without a watermark in that case.
 */
const WATERMARK_URL = '/icons/icon-default.png';
function loadWatermark(): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = WATERMARK_URL;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scene constants — tuned for the dual-view product look
// ─────────────────────────────────────────────────────────────────────────────

const AU_SCENE_UNITS = 5;   // 1 AU == 5 scene units (gives a comfortable framing)
const AU_KM = 149_597_870.7;

// Video dimensions — 2:1 aspect because we're drawing two square panels side
// by side. Bumped up from the original 800×400 for a more detailed product.
// Note: area scales with the square — 1200×600 is ~2.25× the pixels of 800×400,
// so encoding will be proportionally slower on low-end devices.
const FRAME_WIDTH  = 1200;
const FRAME_HEIGHT = 600;
const PANEL_SIZE   = 600; // each viewport is square

// Sun / Earth visual sizes — these are deliberately NOT to scale, they're
// readability-driven so users can see the bodies clearly at this zoom.
const SUN_VISUAL_RADIUS   = 0.28;
const SUN_CORONA_RADIUS   = 0.46;
const EARTH_VISUAL_RADIUS = 0.16;
const EARTH_ORBIT_AU      = 1.0;

// GCS "croissant" geometry for CMEs. Ratios chosen so the leading edge sits
// at ~1.0 × scale (so when scale = Earth distance, bulge hits Earth).
// Full-π arc (180°) so the legs land exactly on the X axis at y=0 — i.e.,
// anchored near the Sun, which matches the GCS flux-rope topology.
const GCS_ARC_RADIUS_FRAC = 0.95;   // bulge distance from Sun, relative to scale
const GCS_ARC_SPAN        = Math.PI; // half-torus, legs at y=0 (at the Sun)
const GCS_TUBE_RADIUS_FRAC = 0.35;  // tube thickness, relative to arc radius

// Timeline: last 7 days + next 5 days, 3-hour steps = 96 frames
const HISTORY_DAYS = 7;
const FORECAST_DAYS = 5;
const HOURS_PER_FRAME = 3;
const TOTAL_HOURS = (HISTORY_DAYS + FORECAST_DAYS) * 24;
const FRAME_COUNT = TOTAL_HOURS / HOURS_PER_FRAME;           // 96
const MS_PER_FRAME = HOURS_PER_FRAME * 3600 * 1000;
const GIF_FRAME_DELAY_MS = 120;                              // ~8.3 fps playback

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderProgress {
  phase: 'init' | 'rendering' | 'encoding' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface RenderOptions {
  cmes: ProcessedCME[];
  onProgress?: (p: RenderProgress) => void;
  /** Caller can set this to true to request cancellation */
  cancelRef?: { cancelled: boolean };
}

export interface RenderResult {
  blob: Blob;
  objectUrl: string;
  frameCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function renderCmeForecastGif(opts: RenderOptions): Promise<RenderResult> {
  const { cmes, onProgress, cancelRef } = opts;
  const report = (p: RenderProgress) => { onProgress?.(p); };

  report({ phase: 'init', current: 0, total: FRAME_COUNT, message: 'Loading libraries...' });
  const [workerBlobUrl, watermarkImg] = await Promise.all([
    ensureLibrariesLoaded(),
    loadWatermark(),
  ]);
  if (cancelRef?.cancelled) throw new Error('cancelled');

  const THREE = (window as any).THREE;
  const GIF = (window as any).GIF;

  // ── Build propagation engine from the same CME inputs used by the modeler ──
  const cmeInputs = cmes
    .filter(c => c.speed > 0) // guard against sentinel records
    .map(c => processedCMEToCMEInput(c));
  const engine: PropagationEngine = createPropagationEngine(cmeInputs, [], undefined);

  // ── Build scene ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);

  // Stars (subtle) — plain points, no shader
  {
    const starGeo = new THREE.BufferGeometry();
    const starCount = 400;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Random sphere shell, radius 40 units
      const u = Math.random(); const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 40;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.35 }));
    scene.add(stars);
  }

  // Sun — bigger and with a softer corona halo
  {
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 }),
    );
    scene.add(sun);
    // Inner corona
    const coronaInner = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_CORONA_RADIUS * 0.7, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa84a, transparent: true, opacity: 0.25 }),
    );
    scene.add(coronaInner);
    // Outer corona
    const coronaOuter = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_CORONA_RADIUS, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.12 }),
    );
    scene.add(coronaOuter);
  }

  // Earth — bigger, with its orbit ring so users can see where it is
  // relative to the CME propagation.
  const earthOrbitR = EARTH_ORBIT_AU * AU_SCENE_UNITS;
  {
    const ringGeo = new THREE.RingGeometry(earthOrbitR - 0.01, earthOrbitR + 0.01, 192);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a5278, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; // lay flat in ecliptic
    scene.add(ring);
  }
  const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_VISUAL_RADIUS, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x4da6ff }),
  );
  // Soft glow so Earth reads at the low pixel sizes the side-view panel puts
  // it at. Additive-ish look via extra opaque sphere one layer out.
  const earthGlow = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.8, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.18 }),
  );
  scene.add(earthMesh);
  scene.add(earthGlow);

  // ── CME meshes (one per CME, GCS croissant oriented from DONKI lat/lon) ──
  //
  // We use a partial torus (half-donut shape) to approximate the GCS / flux-
  // rope "croissant" shape that forms the canonical CME visualisation. The
  // two feet of the arc sit near the Sun and the bulge points outward along
  // the propagation axis. As the CME propagates, we uniformly scale the whole
  // group, mirroring GCS self-similar expansion.
  //
  // Geometry orientation (in the group's local frame):
  //   - Local +Y is the propagation direction (set by setFromUnitVectors below).
  //   - Torus is built in the XY plane with bulge on +Y and feet straddling +X/-X.
  //   - This places the arc in the plane that contains the propagation axis,
  //     so the top-down camera sees the characteristic arc shape.
  interface CmeMesh {
    cme: ProcessedCME;
    group: any;    // THREE.Group rooted at the Sun, oriented along CME axis
    arc: any;      // the croissant mesh — scaled uniformly each frame
  }
  const cmeMeshes: CmeMesh[] = cmes
    .filter(c => c.speed > 0)
    .map(cme => {
      const group = new THREE.Group();

      // DONKI's halfAngle drives how "fat" the arc looks (wider angle → thicker
      // tube). Cap to sensible visual bounds to avoid halo CMEs looking absurd.
      const cappedHalfAngleDeg = Math.min(55, Math.max(10, cme.halfAngle || 30));
      const tubeFrac = GCS_TUBE_RADIUS_FRAC * (cappedHalfAngleDeg / 30);

      // Torus: radius = arc radius (distance Sun→bulge), tube radius from above.
      // Default torus lies in XY plane, arc starting at (+R, 0, 0) going CCW
      // through (0, +R, 0) to (-R, 0, 0). With span = π, this gives us exactly
      // the shape we want: legs anchored on the X axis at y=0 (at the Sun),
      // bulge at +Y (outward along propagation). No rotation needed.
      const torusGeo = new THREE.TorusGeometry(
        GCS_ARC_RADIUS_FRAC,
        GCS_ARC_RADIUS_FRAC * tubeFrac,
        10,                // radial segments (tube cross-section)
        36,                // tubular segments (along the arc) — a touch denser for smoothness
        GCS_ARC_SPAN,      // arc length — half torus (π)
      );

      const arcMat = new THREE.MeshBasicMaterial({
        color: cme.isEarthDirected ? 0xff6b4a : 0xffb86b,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const arc = new THREE.Mesh(torusGeo, arcMat);
      arc.visible = false;
      group.add(arc);

      // Orient group axis to match CME lat/lon.
      // Stonyhurst lon 0° = toward Earth at eruption time — same convention as
      // SimulationCanvas, so we rotate by Earth's ecliptic longitude at startTime.
      const earthLonAtEruption = computeEclipticLongitude('EARTH', cme.startTime.getTime());
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(
        1,
        ((90 - cme.latitude) * Math.PI) / 180,
        earthLonAtEruption + (cme.longitude * Math.PI) / 180,
      );
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      scene.add(group);
      return { cme, group, arc };
    });

  // ── Cameras ──
  // Top-down: looking along -Y. We set up = +Z so that +X renders to the right
  // of the frame, matching NOAA/ESA heliospheric-view convention.
  const topCam = new THREE.OrthographicCamera(-AU_SCENE_UNITS * 1.8, AU_SCENE_UNITS * 1.8, AU_SCENE_UNITS * 1.8, -AU_SCENE_UNITS * 1.8, 0.1, 100);
  topCam.position.set(0, 20, 0);
  topCam.up.set(0, 0, 1);
  topCam.lookAt(0, 0, 0);

  // Side view: looking along +X toward origin, ecliptic pole up. The vertical
  // frustum is narrower than the top-down view because the ecliptic is almost
  // flat — we only need enough room for moderate-latitude CME bulges.
  const sideCam = new THREE.OrthographicCamera(-AU_SCENE_UNITS * 1.8, AU_SCENE_UNITS * 1.8, AU_SCENE_UNITS * 1.2, -AU_SCENE_UNITS * 1.2, 0.1, 100);
  sideCam.position.set(20, 0, 0);
  sideCam.up.set(0, 1, 0);
  sideCam.lookAt(0, 0, 0);

  // ── Renderer (offscreen) ──
  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = FRAME_WIDTH;
  renderCanvas.height = FRAME_HEIGHT;
  const renderer = new THREE.WebGLRenderer({ canvas: renderCanvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(FRAME_WIDTH, FRAME_HEIGHT, false);
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);

  // ── Overlay canvas for text (composited over the webgl canvas per frame) ──
  const overlay = document.createElement('canvas');
  overlay.width = FRAME_WIDTH;
  overlay.height = FRAME_HEIGHT;
  const octx = overlay.getContext('2d')!;

  // Composite canvas that we hand to gif.js
  const composite = document.createElement('canvas');
  composite.width = FRAME_WIDTH;
  composite.height = FRAME_HEIGHT;
  const cctx = composite.getContext('2d')!;

  // ── GIF encoder ──
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    workerScript: workerBlobUrl,
    // Dithering adds file size; the flat colours in this render compress well without it.
    dither: false,
  });

  // ── Frame loop ──
  const nowMs = Date.now();
  const startMs = nowMs - HISTORY_DAYS * 86_400_000;

  try {
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      if (cancelRef?.cancelled) throw new Error('cancelled');

      const tMs = startMs + frame * MS_PER_FRAME;

      // Update Earth position for this instant. We render only the Sun and
      // Earth per the spec — other planets would clutter this narrow-zoom view.
      const earthLon = computeEclipticLongitude('EARTH', tMs);
      const ex = earthOrbitR * Math.sin(earthLon);
      const ez = earthOrbitR * Math.cos(earthLon);
      earthMesh.position.set(ex, 0, ez);
      earthGlow.position.set(ex, 0, ez);

      // Update CME croissants
      for (const { cme, arc } of cmeMeshes) {
        if (tMs < cme.startTime.getTime()) {
          arc.visible = false;
          continue;
        }
        const result = engine.getCMEState(cme.id, tMs);
        if (!result || result.state.distanceKm <= 0) {
          arc.visible = false;
          continue;
        }
        // Distance in scene units — this is the Sun→leading-edge distance we
        // get back from the propagation engine. Because the croissant's bulge
        // sits at GCS_ARC_RADIUS_FRAC in local units, and we scale the whole
        // group by `scale`, the bulge lands at (scale × GCS_ARC_RADIUS_FRAC).
        // We want the bulge at `lengthUnits`, so scale = lengthUnits / arcFrac.
        const distAu = result.state.distanceKm / AU_KM;
        const lengthUnits = distAu * AU_SCENE_UNITS;
        if (lengthUnits < 0.05) {
          arc.visible = false;
          continue;
        }
        const scale = Math.min(lengthUnits, 1.9 * AU_SCENE_UNITS) / GCS_ARC_RADIUS_FRAC;
        arc.scale.set(scale, scale, scale);
        arc.visible = true;

        // Fade opacity as the CME ages — visual hint that the ejecta is
        // getting diffuse / dispersed as it moves through the heliosphere.
        const elapsedDays = (tMs - cme.startTime.getTime()) / 86_400_000;
        const freshness = Math.max(0.2, 1 - elapsedDays / 6);
        arc.material.opacity = 0.2 + 0.4 * freshness;
      }

      // ── Render both viewports ──
      // Clear the full canvas first — temporarily disable scissor so clear
      // covers the entire framebuffer, not just the last scissor region.
      renderer.setScissorTest(false);
      renderer.setClearColor(0x050510, 1);
      renderer.clear();
      renderer.setScissorTest(true);

      // Left panel — top-down
      renderer.setViewport(0, 0, PANEL_SIZE, PANEL_SIZE);
      renderer.setScissor(0, 0, PANEL_SIZE, PANEL_SIZE);
      renderer.render(scene, topCam);

      // Right panel — side
      renderer.setViewport(PANEL_SIZE, 0, PANEL_SIZE, PANEL_SIZE);
      renderer.setScissor(PANEL_SIZE, 0, PANEL_SIZE, PANEL_SIZE);
      renderer.render(scene, sideCam);

      // ── Draw overlay (labels, timestamp, attribution) ──
      octx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

      // Panel titles
      octx.fillStyle = 'rgba(255,255,255,0.85)';
      octx.font = 'bold 18px system-ui, sans-serif';
      octx.textAlign = 'left';
      octx.fillText('Top-down (ecliptic)', 14, 26);
      octx.fillText('Side view', PANEL_SIZE + 14, 26);

      // Panel divider
      octx.strokeStyle = 'rgba(255,255,255,0.22)';
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(PANEL_SIZE, 0);
      octx.lineTo(PANEL_SIZE, FRAME_HEIGHT);
      octx.stroke();

      // Timestamp (UTC) — bottom-left
      const d = new Date(tMs);
      const iso = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      octx.fillStyle = 'rgba(255,255,255,0.92)';
      octx.font = 'bold 17px ui-monospace, Menlo, Consolas, monospace';
      octx.fillText(iso, 14, FRAME_HEIGHT - 38);

      // "Now" indicator if we're at the present moment
      const hoursFromNow = (tMs - nowMs) / 3_600_000;
      const tag =
        Math.abs(hoursFromNow) < HOURS_PER_FRAME / 2
          ? 'NOW'
          : hoursFromNow < 0
            ? `T${Math.round(hoursFromNow)}h`
            : `T+${Math.round(hoursFromNow)}h`;
      octx.fillStyle = Math.abs(hoursFromNow) < HOURS_PER_FRAME / 2
        ? 'rgba(255, 200, 90, 1)'
        : 'rgba(180,200,255,0.85)';
      octx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
      octx.fillText(tag, 14, FRAME_HEIGHT - 16);

      // Attribution — bottom-right, small. Watermark image (if loaded) sits
      // just above it and is the main brand element.
      octx.fillStyle = 'rgba(255,255,255,0.5)';
      octx.font = '12px system-ui, sans-serif';
      octx.textAlign = 'right';
      octx.fillText(
        'Spot The Aurora · NASA DONKI · drag-based propagation',
        FRAME_WIDTH - 12,
        FRAME_HEIGHT - 12,
      );
      octx.textAlign = 'left';

      // Earth marker text on side view so you can tell which dot is which
      octx.fillStyle = 'rgba(180,210,255,0.9)';
      octx.font = '13px system-ui, sans-serif';
      octx.fillText('Earth 1 AU', PANEL_SIZE + 14, FRAME_HEIGHT - 16);

      // Watermark: bottom-right corner, ~10% of frame width. Follows the same
      // pattern as the coronagraph-diff watermark in SolarActivityDashboard.
      if (watermarkImg && watermarkImg.naturalWidth > 0 && watermarkImg.naturalHeight > 0) {
        const targetW = Math.round(FRAME_WIDTH * 0.075);
        const ratio = watermarkImg.naturalHeight / watermarkImg.naturalWidth;
        const targetH = Math.round(targetW * ratio);
        const pad = 16;
        const wx = FRAME_WIDTH - targetW - pad;
        const wy = FRAME_HEIGHT - targetH - pad - 20; // leave room for attribution text
        octx.save();
        octx.globalAlpha = 0.85;
        octx.drawImage(watermarkImg, wx, wy, targetW, targetH);
        octx.restore();
      }

      // ── Composite ──
      cctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      cctx.drawImage(renderCanvas, 0, 0);
      cctx.drawImage(overlay, 0, 0);

      // gif.js copies pixel data synchronously when given a canvas, so we can
      // reuse the composite canvas for the next frame.
      gif.addFrame(composite, { copy: true, delay: GIF_FRAME_DELAY_MS });

      report({
        phase: 'rendering',
        current: frame + 1,
        total: FRAME_COUNT,
        message: `Rendering frame ${frame + 1}/${FRAME_COUNT}`,
      });

      // Yield to the event loop so the UI stays responsive and
      // the user can click Cancel.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    // ── Encode ──
    report({ phase: 'encoding', current: 0, total: 1, message: 'Encoding GIF...' });

    const blob: Blob = await new Promise((resolve, reject) => {
      let cancelPoll: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (cancelPoll !== null) { clearInterval(cancelPoll); cancelPoll = null; }
      };
      gif.on('finished', (b: Blob) => { cleanup(); resolve(b); });
      gif.on('abort', () => { cleanup(); reject(new Error('cancelled')); });
      gif.on('progress', (p: number) => {
        report({
          phase: 'encoding',
          current: Math.round(p * 100),
          total: 100,
          message: `Encoding GIF (${Math.round(p * 100)}%)`,
        });
      });
      gif.render();

      // Poll the cancel flag so the user can abort encoding mid-way.
      if (cancelRef) {
        cancelPoll = setInterval(() => {
          if (cancelRef.cancelled) {
            cleanup();
            try { gif.abort(); } catch { /* no-op */ }
            reject(new Error('cancelled'));
          }
        }, 100);
      }
    });

    const objectUrl = URL.createObjectURL(blob);
    report({ phase: 'done', current: FRAME_COUNT, total: FRAME_COUNT, message: 'Done' });

    return { blob, objectUrl, frameCount: FRAME_COUNT };
  } finally {
    // Tear down GPU resources regardless of success/failure
    try { renderer.dispose(); } catch { /* no-op */ }
    try {
      scene.traverse((obj: any) => {
        if (obj.geometry) { try { obj.geometry.dispose(); } catch { /* no-op */ } }
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) { try { m.dispose(); } catch { /* no-op */ } }
        }
      });
    } catch { /* no-op */ }
  }
}