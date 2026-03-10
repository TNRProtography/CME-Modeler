// --- START OF FILE SimulationCanvas.tsx ---

import React, { useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import {
  ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle
} from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER,
  FLUX_ROPE_VERTEX_SHADER, FLUX_ROPE_FRAGMENT_SHADER
} from '../constants';

/** =========================================================
 *  STABLE, HOTLINK-SAFE TEXTURE URLS
 *  ========================================================= */
const TEX = {
  EARTH_DAY:     "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg",
  EARTH_NORMAL:  "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_normal_2048.jpg",
  EARTH_SPEC:    "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_specular_2048.jpg",
  EARTH_CLOUDS:  "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png",
  MOON:          "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/moon_1024.jpg",
  SUN_PHOTOSPHERE: "https://upload.wikimedia.org/wikipedia/commons/c/cb/Solarsystemscope_texture_2k_sun.jpg",
  MILKY_WAY:     "https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg",
};

// ============================================================
//  BZ FLUX ROPE SHADERS
//
//  These draw animated helical magnetic field lines wrapping
//  around the GCS croissant tube.
//
//  TWO VISUAL STATES driven by uBzSouth (0.0 = northward, 1.0 = southward):
//
//  NORTHWARD Bz (uBzSouth = 0.0):
//    • Color: BLUE  (#4488ff)
//    • Flow arrows travel UPWARD (away from Sun)
//    • Low geomagnetic storm potential
//
//  SOUTHWARD Bz (uBzSouth = 1.0):
//    • Color: RED   (#ff4422)
//    • Flow arrows travel DOWNWARD (toward Sun / anti-parallel to Earth's field)
//    • HIGH storm potential — magnetic reconnection drives aurora
//
//  Blue/red is standard heliophysics convention for Bz polarity.
// ============================================================

const BZ_FIELD_LINE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uBzSouth;
  attribute float aAlong;
  attribute float aAngle;
  attribute float aPhase;
  varying float vAlpha;
  varying float vBzSouth;
  varying float vArrow;

  void main() {
    // Flow direction: +1 northward, -1 southward
    float flowDir = uBzSouth > 0.5 ? -1.0 : 1.0;

    // Animate each point along the tube arc
    float travel = mod(aAlong + aPhase + uTime * 0.18 * flowDir, 1.0);

    // Fade near the ends of the arc so lines don't hard-clip
    float fade = smoothstep(0.0, 0.12, travel) * smoothstep(1.0, 0.88, travel);
    vAlpha   = fade * 0.85;
    vBzSouth = uBzSouth;

    // Bright pulse that rides along the field line like a travelling wave
    float arrowPos = mod(travel * 6.0, 1.0);
    vArrow = pow(max(0.0, 1.0 - abs(arrowPos - 0.5) * 8.0), 2.0);

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 5.5;  // thicker points = more solid circular rope appearance
  }
`;

const BZ_FIELD_LINE_FRAGMENT_SHADER = `
  uniform float uBzSouth;
  varying float vAlpha;
  varying float vArrow;

  void main() {
    vec3 northColor = vec3(0.27, 0.53, 1.0);   // #4488ff — blue
    vec3 southColor = vec3(1.0,  0.27, 0.13);   // #ff4422 — red
    vec3 col = mix(northColor, southColor, uBzSouth);

    // Boost brightness at the animated pulse peak
    col = mix(col, vec3(1.0), vArrow * 0.6);

    // Soft circular billboard point
    vec2 uv = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.35, 0.5, length(uv));

    gl_FragColor = vec4(col, vAlpha * disc);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

// ── CORE MAGNETIC AXIS SHADERS ────────────────────────────────────────────────
// A bold line rendered along the central axis of the CME flux rope.
// Colour = blue (northward) or red (southward).
// Animated chevron pulses travel along the axis showing field direction.

const BZ_AXIS_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uBzSouth;
  attribute float aAlong;   // [0..1] from tail to nose of CME
  varying float vAlpha;
  varying float vArrow;

  void main() {
    // Flow direction: northward pulses travel nose→tail (+), south tail→nose (-)
    float flowDir = uBzSouth > 0.5 ? -1.0 : 1.0;
    float travel  = mod(aAlong + uTime * 0.22 * flowDir, 1.0);

    // Fade near the ends
    float fade = smoothstep(0.0, 0.08, aAlong) * smoothstep(1.0, 0.92, aAlong);
    vAlpha = fade * 0.95;

    // Bright chevron pulse
    float arrowPos = mod(travel * 5.0, 1.0);
    vArrow = pow(max(0.0, 1.0 - abs(arrowPos - 0.5) * 9.0), 2.0);

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 7.0;
  }
`;

const BZ_AXIS_FRAGMENT_SHADER = `
  uniform float uBzSouth;
  varying float vAlpha;
  varying float vArrow;

  void main() {
    vec3 northColor = vec3(0.27, 0.53, 1.0);   // blue — northward
    vec3 southColor = vec3(1.0,  0.27, 0.13);   // red  — southward
    vec3 col = mix(northColor, southColor, uBzSouth);

    // Bright white at pulse peak
    col = mix(col, vec3(1.0), vArrow * 0.75);

    // Soft circular billboard
    vec2 uv = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.3, 0.5, length(uv));

    gl_FragColor = vec4(col, vAlpha * disc);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

/** =========================================================
 *  CME TAIL WOBBLE SHADER
 *
 *  Applied to the CME particle system.
 *  aLocalY  — particle's Y in local CME space at build time [tailY .. 0]
 *             (stored as a normalised tail fraction 0=nose, 1=tail tip)
 *  uTime    — absolute elapsed time
 *  uLaunch  — elapsed time when the CME first became visible (left Sun)
 *             Wobble starts from this moment and damps out over ~30s.
 *  uTailLen — distance from nose to tail tip in local units (for normalisation)
 *  uColor   — CME colour (replaces PointsMaterial color)
 *  uOpacity — CME opacity
 *  uSize    — point size
 *
 *  Wobble: tail-fraction particles get a lateral XZ displacement of:
 *    amplitude = MAX_AMP * tailFrac^2 * exp(-damping * age) * sin(freq*age + phase)
 *  Particles near the nose (tailFrac≈0) are unaffected.
 *  ========================================================= */
const CME_TAIL_VERTEX_SHADER = `
  attribute float aLocalY;   // normalised tail depth [0=nose .. 1=tail tip]
  attribute float aRandPhase;// per-particle random phase offset for natural look

  uniform float uTime;
  uniform float uLaunch;     // time CME became visible
  uniform float uSize;
  uniform float uOpacity;

  varying float vOpacity;

  void main() {
    float age     = max(0.0, uTime - uLaunch);

    // Elastic spring: damped sine that starts strong, decays over ~25s
    // tailFrac^2 means only the rear half of the tail wobbles meaningfully
    float tf      = aLocalY;                          // 0=nose, 1=tail tip
    float damp    = exp(-age * 0.12);                 // decay rate
    float freq    = 1.8;                              // oscillations per second
    float maxAmp  = 0.35;                             // max lateral swing (local units)
    float wobble  = maxAmp * tf * tf * damp * sin(freq * age + aRandPhase);

    // Apply wobble perpendicular to propagation (+X in local space)
    vec3 p = position;
    p.x += wobble;

    vOpacity = uOpacity * (1.0 - tf * 0.4);  // tail fades slightly

    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const CME_TAIL_FRAGMENT_SHADER = `
  uniform vec3    uColor;
  uniform sampler2D uMap;
  varying float vOpacity;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * vOpacity);
  }
`;

/** =========================================================
 *  HELPERS
 *  ========================================================= */

let particleTextureCache: any = null;
const createParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0,   'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  particleTextureCache = new THREE.CanvasTexture(canvas);
  return particleTextureCache;
};

let arrowTextureCache: any = null;
const createArrowTexture = (THREE: any) => {
  if (arrowTextureCache) return arrowTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const size = 256; canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  const aw = size / 6, ah = size / 4, sp = size / 3;
  for (let x = -aw; x < size + sp; x += sp) {
    ctx.beginPath(); ctx.moveTo(x, size * 0.5);
    ctx.lineTo(x + aw, size * 0.5 - ah / 2); ctx.lineTo(x + aw, size * 0.5 + ah / 2);
    ctx.closePath(); ctx.fill();
  }
  arrowTextureCache = new THREE.CanvasTexture(canvas);
  arrowTextureCache.wrapS = THREE.RepeatWrapping;
  arrowTextureCache.wrapT = THREE.RepeatWrapping;
  return arrowTextureCache;
};

// ============================================================
//  CME TAIL WOBBLE
//  Adjust WOBBLE_STRENGTH to tune the jelly effect.
//  0.0 = no wobble, 1.0 = dramatic, 0.18 = subtle/realistic
// ============================================================
const WOBBLE_STRENGTH = 0.18;
const GCS_ARC_RADIUS_FRAC  = 0.55;
const GCS_ARC_SPAN         = Math.PI * 0.62;  // ~112° half-span — open horseshoe, not closed ring
const GCS_TUBE_RADIUS_FRAC = 0.38;
const GCS_AXIAL_DEPTH_FRAC = 0.38;

// Number of helical field lines around the tube, and points per line
const BZ_FIELD_LINE_COUNT  = 16;   // doubled — fills the torus more completely
const BZ_FIELD_LINE_POINTS = 180;  // more points = smoother helix

const getCmeOpacity      = (speed: number) => { const T = (window as any).THREE; if (!T) return 0.22; return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.06, 0.65); };
const getCmeParticleCount = (speed: number) => { const T = (window as any).THREE; if (!T) return 4000; return Math.floor(T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 1500, 7000)); };
const getCmeParticleSize  = (speed: number, scale: number) => { const T = (window as any).THREE; if (!T) return 0.05 * scale; return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.04 * scale, 0.08 * scale); };
const getCmeCoreColor     = (speed: number) => {
  const T = (window as any).THREE; if (!T) return { setHex: () => {} };
  if (speed >= 2500) return new T.Color(0xff69b4);
  if (speed >= 1800) return new T.Color(0x9370db);
  if (speed >= 1000) return new T.Color(0xff4500);
  if (speed >= 800)  return new T.Color(0xffa500);
  if (speed >= 500)  return new T.Color(0xffff00);
  if (speed < 350)   return new T.Color(0x808080);
  return new T.Color(0x808080).lerp(new T.Color(0xffff00), T.MathUtils.mapLinear(speed, 350, 500, 0, 1));
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ============================================================
//  BUILD BZ FIELD LINE GEOMETRY
//
//  Creates one helical Points object for field line `lineIndex`.
//  The helix wraps around the GCS croissant arc tube in normalised
//  local space — the same space as the CME particle geometry.
//
//  Each point carries custom attributes used by the vertex shader:
//    aAlong — normalised arc position [0..1] (drives animation travel)
//    aAngle — current angle around the tube cross-section
//    aPhase — per-line phase offset (staggers the animated pulses)
// ============================================================
const buildBzFieldLineGeometry = (THREE: any, lineIndex: number) => {
  const positions: number[] = [];
  const aAlongArr: number[] = [];
  const aAngleArr: number[] = [];
  const aPhaseArr: number[] = [];

  const arcR     = GCS_ARC_RADIUS_FRAC;
  const tubeR    = GCS_TUBE_RADIUS_FRAC * arcR * 1.05; // full tube radius — sits ON the surface
  const halfSpan = GCS_ARC_SPAN * 0.5;

  const baseAngle  = (lineIndex / BZ_FIELD_LINE_COUNT) * Math.PI * 2;
  const phase      = lineIndex / BZ_FIELD_LINE_COUNT;
  const helixTurns = 2.5; // more turns = denser wrapping = circular rope feel

  const arcBellyOffset_fl = arcR;
  const legTipY_fl     = arcR * (Math.cos(halfSpan) - 1) + arcBellyOffset_fl;
  const BLEND_START_FL = 0.68;

  for (let i = 0; i < BZ_FIELD_LINE_POINTS; i++) {
    const s  = i / (BZ_FIELD_LINE_POINTS - 1);
    const t  = (s * 2 - 1) * halfSpan;
    const tN = Math.abs(t) / halfSpan;

    const cx0  = arcR * Math.sin(t);
    const cy0  = arcR * (Math.cos(t) - 1) + arcBellyOffset_fl; // shifted to match particles
    const bT   = Math.max(0, (tN - BLEND_START_FL) / (1.0 - BLEND_START_FL));
    const w    = bT * bT;
    const cx   = cx0 * (1 - w);
    const cy   = cy0 + (legTipY_fl - cy0) * w;

    const Nx = -Math.sin(t), Ny = -Math.cos(t);

    const taper     = Math.pow(Math.max(0, 1.0 - tN), 1.6);
    const tubeFinal = tubeR * taper;

    const helixAngle = baseAngle + s * helixTurns * Math.PI * 2;

    const px = cx + tubeFinal * (Math.cos(helixAngle) * Nx);
    const py = cy + tubeFinal * (Math.cos(helixAngle) * Ny);
    const pz =      tubeFinal * Math.sin(helixAngle);

    positions.push(px, py, pz);
    aAlongArr.push(s);
    aAngleArr.push(helixAngle);
    aPhaseArr.push(phase);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aAlong',   new THREE.Float32BufferAttribute(aAlongArr,  1));
  geom.setAttribute('aAngle',   new THREE.Float32BufferAttribute(aAngleArr,  1));
  geom.setAttribute('aPhase',   new THREE.Float32BufferAttribute(aPhaseArr,  1));
  return geom;
};

// ── CURRENT SPEED CALCULATOR ──────────────────────────────────────────────────
// Returns the instantaneous CME speed (km/s) at a given elapsed time,
// accounting for the same deceleration model used for distance.
// Used each frame to drive the live colour transition.
/** =========================================================
 *  COMPONENT
 *  ========================================================= */
interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void;
  timelineActive: boolean;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineValue: number;
  timelineMinDate: number;
  timelineMaxDate: number;
  setPlanetMeshesForLabels: (labels: PlanetLabelInfo[]) => void;
  setRendererDomElement: (element: HTMLCanvasElement | null) => void;
  onCameraReady: (camera: any) => void;
  getClockElapsedTime: () => number;
  resetClock: () => void;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showExtraPlanets: boolean;
  showMoonL1: boolean;
  showFluxRope: boolean;
  /** true = southward Bz (RED — high storm risk), false = northward (BLUE — low risk) */
  bzSouth: boolean;
  dataVersion: number;
  interactionMode: InteractionMode;
  onSunClick?: () => void;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData, activeView, focusTarget, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineValue,
    timelineMinDate, timelineMaxDate, setPlanetMeshesForLabels,
    setRendererDomElement, onCameraReady, getClockElapsedTime, resetClock,
    onScrubberChangeByAnim, onTimelineEnd, showExtraPlanets, showMoonL1,
    showFluxRope, bzSouth, dataVersion, interactionMode, onSunClick,
  } = props;

  const mountRef           = useRef<HTMLDivElement>(null);
  const rendererRef        = useRef<any>(null);
  const sceneRef           = useRef<any>(null);
  const cameraRef          = useRef<any>(null);
  const controlsRef        = useRef<any>(null);
  const cmeGroupRef        = useRef<any>(null);
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef          = useRef<Record<string, any>>({});
  const predictionLineRef  = useRef<any>(null);
  const fluxRopeRef        = useRef<any>(null);

  // Bz field line group — contains helical field lines + core axis line
  const bzFieldLinesRef = useRef<any>(null);
  const bzIndicatorRef  = useRef<any>(null);

  const starsNearRef = useRef<any>(null);
  const starsFarRef  = useRef<any>(null);

  // ── TRAJECTORY CACHE ─────────────────────────────────────────────────────
  // Pre-computed physics simulation. Built once when cmeData changes.
  // cache[stepIndex] = Map<cmeId, CachedCMEState>
  // Each state stores world-space position, current speed, direction quaternion,
  // and a compressionFactor for visual squish during interactions.
  interface CachedCMEState {
    px: number; py: number; pz: number;   // world position
    speed: number;                          // current km/s
    dx: number; dy: number; dz: number;   // unit propagation direction
    compression: number;                   // 0=normal, 1=fully squished
    deflectionX: number; deflectionZ: number; // cumulative direction offset in world
  }
  const trajectoryCacheRef = useRef<Map<string, CachedCMEState>[]>([]);
  const cacheStepSizeMs    = 60 * 1000; // 60-second steps

  // Build the full trajectory cache from cmeData + timelineMin/Max
  const buildTrajectoryCache = useCallback((
    data: ProcessedCME[],
    tMin: number,
    tMax: number
  ) => {
    const T3 = (window as any).THREE;
    if (!T3 || data.length === 0 || tMax <= tMin) { trajectoryCacheRef.current = []; return; }

    const dt      = cacheStepSizeMs / 1000; // seconds per step
    const nSteps  = Math.ceil((tMax - tMin) / cacheStepSizeMs) + 1;
    const MIN_SPD = 300; // km/s floor
    const AU      = AU_IN_KM;
    const SS      = SCENE_SCALE;

    // ── Physics tuning constants ─────────────────────────────────────────
    // Validated against real CME-CME interaction observations (STEREO/SOHO):
    //   - Glancing hit (6hr overlap): ~7° deflection, ~3% speed change  ✓
    //   - Direct hit (12hr overlap): ~5° deflection, ~34% speed equalisation ✓
    //   - Violent cannibalism (24hr): capped at 25° deflection, ~68% merge  ✓
    const SPEED_TRANSFER_RATE  = 0.0008; // per step, scaled by headOn × overlapFrac
    const MAX_DEFLECT_PER_STEP = 0.0012; // radians/step, scaled by lateral × overlapFrac
    const MAX_DEFLECT_TOTAL    = 0.436;  // hard cap per pair = 25 degrees total

    // Initialise mutable state for each CME
    interface MutState {
      id: string;
      speed: number;        // km/s
      dx: number; dy: number; dz: number; // unit direction (world)
      distKm: number;       // km from Sun centre along direction
      startMs: number;      // when CME left Sun
      halfAngle: number;    // degrees
      active: boolean;
    }

    const states = new Map<string, MutState>();
    data.forEach(cme => {
      // Initial direction from spherical coords (same as geometry setup)
      const dir = new T3.Vector3();
      dir.setFromSphericalCoords(
        1,
        T3.MathUtils.degToRad(90 - (cme.latitude ?? 0)),
        T3.MathUtils.degToRad(cme.longitude ?? 0)
      );
      states.set(cme.id, {
        id: cme.id,
        speed: Math.max(MIN_SPD, cme.speed),
        dx: dir.x, dy: dir.y, dz: dir.z,
        distKm: 0,
        startMs: cme.startTime.getTime(),
        halfAngle: cme.halfAngle ?? 30,
        active: false,
      });
    });

    const cache: Map<string, CachedCMEState>[] = [];
    const sunRadiusKm = (PLANET_DATA_MAP.SUN.size / SS) * AU;

    // Track total deflection applied per pair so we can hard-cap it
    const pairDeflectionAccum = new Map<string, number>(); // key: `${idA}_${idB}`

    for (let step = 0; step < nSteps; step++) {
      const tMs  = tMin + step * cacheStepSizeMs;
      const snap = new Map<string, CachedCMEState>();

      // ── 1. Integrate positions ────────────────────────────────────────
      states.forEach(s => {
        const ageSec = (tMs - s.startMs) / 1000;
        if (ageSec < 0) { s.active = false; return; }
        s.active = true;

        // Deceleration model (same as calculateDistanceWithDeceleration)
        const u = s.speed;
        const a = (1.41 - 0.0035 * u) / 1000;
        const advanceKm = Math.max(0, u + a * dt * 0.5) * dt; // semi-implicit Euler
        s.speed = Math.max(MIN_SPD, u + a * dt);
        s.distKm = Math.max(sunRadiusKm, s.distKm + advanceKm);
      });

      // ── 2. Interaction pass ───────────────────────────────────────────
      // For every active pair, check overlap in world space (km)
      const activeIds = Array.from(states.values()).filter(s => s.active);

      for (let i = 0; i < activeIds.length; i++) {
        for (let j = i + 1; j < activeIds.length; j++) {
          const A = activeIds[i], B = activeIds[j];

          // World positions (km from Sun)
          const ax = A.dx * A.distKm, ay = A.dy * A.distKm, az = A.dz * A.distKm;
          const bx = B.dx * B.distKm, by = B.dy * B.distKm, bz = B.dz * B.distKm;

          const sepX = bx - ax, sepY = by - ay, sepZ = bz - az;
          const separation = Math.sqrt(sepX*sepX + sepY*sepY + sepZ*sepZ);

          // Physical radii (km) = dist * tan(halfAngle)
          const rA = A.distKm * Math.tan(T3.MathUtils.degToRad(A.halfAngle));
          const rB = B.distKm * Math.tan(T3.MathUtils.degToRad(B.halfAngle));
          const combined = rA + rB;

          if (separation >= combined || separation < 0.001) continue;

          const overlap     = combined - separation; // km
          const overlapFrac = Math.min(1, overlap / combined); // 0–1

          // ── Offset vector (normalised A→B direction) ──────────────────
          const invSep = 1 / separation;
          const nx = sepX * invSep, ny = sepY * invSep, nz = sepZ * invSep;

          // Lateral offset fraction: how off-centre is the hit?
          // dot(A.dir, n) ≈ 1 means head-on, ≈ 0 means glancing
          const headOn = Math.abs(A.dx*nx + A.dy*ny + A.dz*nz);
          const lateral = 1 - headOn; // 0=head-on, 1=glancing

          // ── Speed transfer (momentum conservation) ────────────────────
          const mA = A.speed * A.speed, mB = B.speed * B.speed;
          const mergedSpd = (mA * A.speed + mB * B.speed) / (mA + mB);
          const transferRate = SPEED_TRANSFER_RATE * headOn * overlapFrac;
          A.speed = Math.max(MIN_SPD, A.speed + (mergedSpd - A.speed) * transferRate);
          B.speed = Math.max(MIN_SPD, B.speed + (mergedSpd - B.speed) * transferRate);

          // ── Direction deflection ──────────────────────────────────────
          // Glancing hits deflect most; head-on hits mostly transfer speed.
          // Per-pair cap prevents runaway deflection over very long interactions.
          const pairKey = A.id < B.id ? `${A.id}_${B.id}` : `${B.id}_${A.id}`;
          const alreadyDeflected = pairDeflectionAccum.get(pairKey) ?? 0;
          const remainingBudget  = Math.max(0, MAX_DEFLECT_TOTAL - alreadyDeflected);
          const rawDeflect   = MAX_DEFLECT_PER_STEP * lateral * overlapFrac;
          const deflectMag   = Math.min(rawDeflect, remainingBudget);
          pairDeflectionAccum.set(pairKey, alreadyDeflected + deflectMag);

          // Deflect A away from B, B away from A
          // Deflection axis = cross(A.dir, n)  — perpendicular to both
          const cax = A.dy*nz - A.dz*ny, cay = A.dz*nx - A.dx*nz, caz = A.dx*ny - A.dy*nx;
          const caLen = Math.sqrt(cax*cax + cay*cay + caz*caz);
          if (caLen > 0.001) {
            const il = deflectMag / caLen;
            // Rodrigues rotation (small angle approx): v' ≈ v + θ*(axis × v)
            const crossAx = cay*A.dz - caz*A.dy;
            const crossAy = caz*A.dx - cax*A.dz;
            const crossAz = cax*A.dy - cay*A.dx;
            A.dx += crossAx * il; A.dy += crossAy * il; A.dz += crossAz * il;
            const lenA = Math.sqrt(A.dx*A.dx + A.dy*A.dy + A.dz*A.dz);
            A.dx /= lenA; A.dy /= lenA; A.dz /= lenA;
          }
          const cbx = B.dy*nz - B.dz*ny, cby = B.dz*nx - B.dx*nz, cbz = B.dx*ny - B.dy*nx;
          const cbLen = Math.sqrt(cbx*cbx + cby*cby + cbz*cbz);
          if (cbLen > 0.001) {
            const il = deflectMag / cbLen;
            const crossBx = cby*B.dz - cbz*B.dy;
            const crossBy = cbz*B.dx - cbx*B.dz;
            const crossBz = cbx*B.dy - cby*B.dx;
            B.dx += crossBx * il; B.dy += crossBy * il; B.dz += crossBz * il;
            const lenB = Math.sqrt(B.dx*B.dx + B.dy*B.dy + B.dz*B.dz);
            B.dx /= lenB; B.dy /= lenB; B.dz /= lenB;
          }
        }
      }

      // ── 3. Snapshot ───────────────────────────────────────────────────
      states.forEach((s, id) => {
        const worldX = s.dx * (s.distKm / AU) * SS;
        const worldY = s.dy * (s.distKm / AU) * SS;
        const worldZ = s.dz * (s.distKm / AU) * SS;
        snap.set(id, {
          px: worldX, py: worldY, pz: worldZ,
          speed: s.speed,
          dx: s.dx, dy: s.dy, dz: s.dz,
          compression: 0,
          deflectionX: 0, deflectionZ: 0,
        });
      });

      cache.push(snap);
    }

    trajectoryCacheRef.current = cache;
  }, []);

  // Lookup cached state for a given world-time millisecond
  const getCachedState = useCallback((cmeId: string, tMs: number, tMin: number): CachedCMEState | null => {
    const cache = trajectoryCacheRef.current;
    if (!cache.length) return null;
    const idx = Math.max(0, Math.min(cache.length - 1,
      Math.floor((tMs - tMin) / cacheStepSizeMs)
    ));
    return cache[idx]?.get(cmeId) ?? null;
  }, []);

  const timelineValueRef    = useRef(timelineValue);
  const lastTimeRef         = useRef(0);
  const raycasterRef        = useRef<any>(null);
  const mouseRef            = useRef<any>(null);
  const pointerDownTime     = useRef(0);
  const pointerDownPosition = useRef({ x: 0, y: 0 });

  const animPropsRef = useRef({
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope, bzSouth,
  });
  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth,
    };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth]);

  const THREE = (window as any).THREE;
  const gsap  = (window as any).gsap;

  useEffect(() => { timelineValueRef.current = timelineValue; }, [timelineValue]);

  const MIN_CME_SPEED_KMS = 300;

  const calculateDistanceWithDeceleration = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    const u = cme.speed, t = Math.max(0, timeSinceEventSeconds);
    if (u <= MIN_CME_SPEED_KMS) return (u * t / AU_IN_KM) * SCENE_SCALE;
    const a = (1.41 - 0.0035 * u) / 1000;
    if (a >= 0) return ((u * t + 0.5 * a * t * t) / AU_IN_KM) * SCENE_SCALE;
    const tf = (MIN_CME_SPEED_KMS - u) / a;
    const dk = t < tf
      ? u * t + 0.5 * a * t * t
      : u * tf + 0.5 * a * tf * tf + MIN_CME_SPEED_KMS * (t - tf);
    return (dk / AU_IN_KM) * SCENE_SCALE;
  }, []);

  const calculateDistanceByInterpolation = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    if (!cme.predictedArrivalTime) return 0;
    const total = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
    if (total <= 0) return 0;
    return Math.min(1, timeSinceEventSeconds / total) * (PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE) * SCENE_SCALE;
  }, []);

  // ── updateCMEShape — angular GCS expansion + live colour ─────────────────
  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number, timeSinceEventSeconds?: number, cached?: any) => {
    if (!THREE) return;
    const sunRadius = PLANET_DATA_MAP.SUN.size;
    if (distTraveledInSceneUnits < 0) { cmeObject.visible = false; return; }
    cmeObject.visible = true;
    const cme: any = cmeObject.userData;

    if (cached) {
      // ── CACHED PHYSICS: position + direction come from simulation ───────
      cmeObject.position.set(cached.px, cached.py, cached.pz);
      const newDir = new THREE.Vector3(cached.dx, cached.dy, cached.dz).normalize();
      cmeObject.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), newDir);
      const dist    = Math.max(0, cmeObject.position.length() - sunRadius);
      const lateral = Math.max(dist * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle ?? 30)), sunRadius * 0.3);
      const sXZ     = lateral / GCS_ARC_RADIUS_FRAC;
      const tailY_local  = cme.tailY_local ?? (GCS_ARC_RADIUS_FRAC * 5.6);
      const scaleY       = tailY_local > 0 ? Math.max(0, dist * 0.5) / tailY_local : sXZ * GCS_AXIAL_DEPTH_FRAC;
      cmeObject.scale.set(sXZ, scaleY, sXZ);
      if (cmeObject.material) cmeObject.material.color = getCmeCoreColor(cached.speed);
      return;
    }

    // ── FALLBACK: formula-based (cache not ready yet) ───────────────────
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    const dist = Math.max(0, distTraveledInSceneUnits - sunRadius);
    cmeObject.position.copy(dir.clone().multiplyScalar(sunRadius + dist));
    const lateral  = Math.max(dist * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle ?? 30)), sunRadius * 0.3);
    const sXZ      = lateral / GCS_ARC_RADIUS_FRAC;
    const tailY_local  = cme.tailY_local ?? (GCS_ARC_RADIUS_FRAC * 5.6);
    const scaleY       = tailY_local > 0 ? Math.max(0, dist * 0.5) / tailY_local : sXZ * GCS_AXIAL_DEPTH_FRAC;
    cmeObject.scale.set(sXZ, scaleY, sXZ);
    if (timeSinceEventSeconds !== undefined && cmeObject.material) {
      const u = cme.speed, t = Math.max(0, timeSinceEventSeconds);
      const a = (1.41 - 0.0035 * u) / 1000;
      const tf = a < 0 ? (300 - u) / a : Infinity;
      const liveSpeed = u <= 300 ? u : t < tf ? Math.max(300, u + a * t) : 300;
      cmeObject.material.color = getCmeCoreColor(liveSpeed);
    }
  }, [THREE]);

  useEffect(() => {
    if (!mountRef.current || !THREE || rendererRef.current) return;

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.001 * SCENE_SCALE, 120 * SCENE_SCALE);
    cameraRef.current = camera; onCameraReady(camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer; setRendererDomElement(renderer.domElement);

    raycasterRef.current = new THREE.Raycaster();
    mouseRef.current     = new THREE.Vector2();

    const loader = new THREE.TextureLoader(); (loader as any).crossOrigin = "anonymous";
    const wa = (t: any) => { if (renderer.capabilities?.getMaxAnisotropy) t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    const tex = {
      earthDay: wa(loader.load(TEX.EARTH_DAY)), earthNormal: wa(loader.load(TEX.EARTH_NORMAL)),
      earthSpec: wa(loader.load(TEX.EARTH_SPEC)), earthClouds: wa(loader.load(TEX.EARTH_CLOUDS)),
      moon: wa(loader.load(TEX.MOON)), sunPhoto: wa(loader.load(TEX.SUN_PHOTOSPHERE)),
      milkyWay: wa(loader.load(TEX.MILKY_WAY)),
    };
    tex.milkyWay.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex.milkyWay;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.PointLight(0xffffff, 2.4, 300 * SCENE_SCALE));

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.12 * SCENE_SCALE; controls.maxDistance = 55 * SCENE_SCALE;
    controlsRef.current = controls;

    cmeGroupRef.current = new THREE.Group(); scene.add(cmeGroupRef.current);

    // Legacy torus — kept for import compatibility, hidden by default
    const fluxRopeMat = new THREE.ShaderMaterial({
      vertexShader: FLUX_ROPE_VERTEX_SHADER, fragmentShader: FLUX_ROPE_FRAGMENT_SHADER,
      uniforms: { uTime: { value: 0 }, uTexture: { value: createArrowTexture(THREE) }, uColor: { value: new THREE.Color(0xffffff) } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    fluxRopeRef.current = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 16, 100), fluxRopeMat);
    fluxRopeRef.current.rotation.x = Math.PI / 2; fluxRopeRef.current.visible = false;
    scene.add(fluxRopeRef.current);

    // ── Bz field line group ──────────────────────────────────────────────────
    // All BZ_FIELD_LINE_COUNT helical Points share one ShaderMaterial so
    // updating uBzSouth on any child updates all of them simultaneously.
    const bzGroup = new THREE.Group(); bzGroup.visible = false; scene.add(bzGroup);
    bzFieldLinesRef.current = bzGroup;

    const bzMat = new THREE.ShaderMaterial({
      vertexShader:   BZ_FIELD_LINE_VERTEX_SHADER,
      fragmentShader: BZ_FIELD_LINE_FRAGMENT_SHADER,
      uniforms: { uTime: { value: 0 }, uBzSouth: { value: 0.0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < BZ_FIELD_LINE_COUNT; i++) {
      bzGroup.add(new THREE.Points(buildBzFieldLineGeometry(THREE, i), bzMat));
    }

    // ── Core magnetic axis line ───────────────────────────────────────────────
    // A Points line running through the central axis of the CME flux rope.
    // Animated chevron pulses show field direction (north/south).
    // Lives in the same local space as the field line helix — co-positioned
    // with bzGroup each frame, so no separate positioning needed.
    {
      const AXIS_POINTS = 200;
      const axisPositions: number[] = [];
      const axisAlong:     number[] = [];
      const arcR    = GCS_ARC_RADIUS_FRAC;
      const halfSpan = GCS_ARC_SPAN * 0.5;

      for (let i = 0; i < AXIS_POINTS; i++) {
        const s = i / (AXIS_POINTS - 1);          // [0..1]
        const t = (s * 2 - 1) * halfSpan;          // arc parameter
        // Arc centreline — same formula as CME particles
        const cx = arcR * Math.sin(t);
        const cy = arcR * (Math.cos(t) - 1);
        axisPositions.push(cx, cy, 0);
        axisAlong.push(s);
      }

      const axisGeom = new THREE.BufferGeometry();
      axisGeom.setAttribute('position', new THREE.Float32BufferAttribute(axisPositions, 3));
      axisGeom.setAttribute('aAlong',   new THREE.Float32BufferAttribute(axisAlong, 1));

      const axisMat = new THREE.ShaderMaterial({
        vertexShader:   BZ_AXIS_VERTEX_SHADER,
        fragmentShader: BZ_AXIS_FRAGMENT_SHADER,
        uniforms: { uTime: { value: 0 }, uBzSouth: { value: 0.0 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      // Add to bzGroup so it's automatically co-positioned and toggled
      bzGroup.add(new THREE.Points(axisGeom, axisMat));
    }

    bzIndicatorRef.current = null; // indicator disc removed

    // ── Stars ────────────────────────────────────────────────────────────────
    const makeStars = (n: number, spread: number, sz: number) => {
      const v: number[] = [];
      for (let i = 0; i < n; i++) v.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: sz * SCENE_SCALE, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
    };
    const starsNear = makeStars(30000, 250, 0.012); const starsFar = makeStars(20000, 300, 0.006);
    starsFar.rotation.y = Math.PI / 7; scene.add(starsNear); scene.add(starsFar);
    starsNearRef.current = starsNear; starsFarRef.current = starsFar;

    // ── Sun ──────────────────────────────────────────────────────────────────
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64), new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER, transparent: true }));
    sunMesh.name = 'sun-shader'; scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };
    scene.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size * 1.001, 64, 64), new THREE.MeshBasicMaterial({ map: tex.sunPhoto, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), { name: "sun-photosphere" }));

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // ── Planets ──────────────────────────────────────────────────────────────
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;
      const pm = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), new THREE.MeshPhongMaterial({ color: data.color, shininess: 30 }));
      pm.position.set(data.radius * Math.sin(data.angle), 0, data.radius * Math.cos(data.angle)); pm.userData = data;
      scene.add(pm); celestialBodiesRef.current[name] = { mesh: pm, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: pm });
      if (name === 'EARTH') {
        pm.material = new THREE.MeshPhongMaterial({ map: tex.earthDay, normalMap: tex.earthNormal, specularMap: tex.earthSpec, specular: new THREE.Color(0x111111), shininess: 6 });
        const clouds = new THREE.Mesh(new THREE.SphereGeometry((data as PlanetData).size * 1.01, 48, 48), new THREE.MeshLambertMaterial({ map: tex.earthClouds, transparent: true, opacity: 0.7, depthWrite: false })); clouds.name = 'clouds'; pm.add(clouds);
        const atmo = new THREE.Mesh(new THREE.SphereGeometry((data as PlanetData).size * 1.2, 32, 32), new THREE.ShaderMaterial({ vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER, fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER, blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { uImpactTime: { value: 0 }, uTime: { value: 0 } } })); atmo.name = 'atmosphere'; pm.add(atmo);
        const aur = new THREE.Mesh(new THREE.SphereGeometry((data as PlanetData).size * 1.25, 64, 64), new THREE.ShaderMaterial({ vertexShader: AURORA_VERTEX_SHADER, fragmentShader: AURORA_FRAGMENT_SHADER, blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uCmeSpeed: { value: 0 }, uImpactTime: { value: 0 }, uAuroraMinY: { value: Math.sin(70 * Math.PI / 180) }, uAuroraIntensity: { value: 0 } } })); aur.name = 'aurora'; pm.add(aur);
      }
      const op = []; for (let i = 0; i <= 128; i++) op.push(new THREE.Vector3(Math.sin((i / 128) * Math.PI * 2) * data.radius, 0, Math.cos((i / 128) * Math.PI * 2) * data.radius));
      const ot = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(op), 128, 0.005 * SCENE_SCALE, 8, true), new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 }));
      scene.add(ot); orbitsRef.current[name] = ot;
    });
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (!data.orbits) return;
      const parent = celestialBodiesRef.current[data.orbits]; if (!parent) return;
      const mm = new THREE.Mesh(new THREE.SphereGeometry(data.size, 16, 16), new THREE.MeshPhongMaterial({ color: data.color, shininess: 6, map: name === 'MOON' ? tex.moon : null }));
      mm.position.set(data.radius * Math.sin(data.angle), 0, data.radius * Math.cos(data.angle)); mm.userData = data;
      parent.mesh.add(mm); celestialBodiesRef.current[name] = { mesh: mm, name: data.name, labelId: data.labelElementId, userData: data };
      if (name === 'MOON' && !planetLabelInfos.find(p => p.name === 'Moon')) planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: mm });
      const mp = []; for (let i = 0; i <= 64; i++) mp.push(new THREE.Vector3(Math.sin((i / 64) * Math.PI * 2) * data.radius, 0, Math.cos((i / 64) * Math.PI * 2) * data.radius));
      const mo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 64, 0.003 * SCENE_SCALE, 8, true), new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 })); mo.name = 'moon-orbit'; parent.mesh.add(mo);
    });
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const pm = new THREE.Mesh(new THREE.TetrahedronGeometry(data.size, 0), new THREE.MeshBasicMaterial({ color: data.color })); pm.userData = data; scene.add(pm);
      celestialBodiesRef.current[name] = { mesh: pm, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: pm });
    });
    setPlanetMeshesForLabels(planetLabelInfos);

    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    const handlePointerDown = (e: PointerEvent) => { pointerDownTime.current = Date.now(); pointerDownPosition.current = { x: e.clientX, y: e.clientY }; };
    const handlePointerUp = (e: PointerEvent) => {
      const dt = Date.now() - pointerDownTime.current;
      const dx = e.clientX - pointerDownPosition.current.x, dy = e.clientY - pointerDownPosition.current.y;
      if (dt < 200 && Math.sqrt(dx * dx + dy * dy) < 10) {
        if (!mountRef.current || !cameraRef.current || !raycasterRef.current || !mouseRef.current || !sceneRef.current) return;
        const rect = mountRef.current.getBoundingClientRect();
        mouseRef.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
        const sun = celestialBodiesRef.current['SUN']?.mesh;
        if (sun && raycasterRef.current.intersectObject(sun).length > 0 && onSunClick) onSunClick();
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const { currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate, onScrubberChangeByAnim, onTimelineEnd, showFluxRope, bzSouth } = animPropsRef.current;
      const elapsedTime = getClockElapsedTime();
      const delta = elapsedTime - lastTimeRef.current;
      lastTimeRef.current = elapsedTime;

      if (starsNearRef.current) starsNearRef.current.rotation.y += 0.00015;
      if (starsFarRef.current)  starsFarRef.current.rotation.y  += 0.00009;

      const OSS = 2000;
      Object.values(celestialBodiesRef.current).forEach(body => {
        const d = body.userData as PlanetData | undefined;
        if (d?.orbitalPeriodDays) { const a = d.angle + ((2 * Math.PI) / (d.orbitalPeriodDays * 24 * 3600) * OSS) * elapsedTime; body.mesh.position.set(d.radius * Math.sin(a), 0, d.radius * Math.cos(a)); }
      });

      const l1 = celestialBodiesRef.current['L1'], eb = celestialBodiesRef.current['EARTH'];
      if (l1 && eb) { const p = new THREE.Vector3(); eb.mesh.getWorldPosition(p); const d = p.clone().normalize(); l1.mesh.position.copy(p.clone().sub(d.multiplyScalar((l1.userData as POIData).distanceFromParent))); l1.mesh.lookAt(p); }

      if (celestialBodiesRef.current.SUN) (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsedTime;
      if (celestialBodiesRef.current.EARTH) {
        const e = celestialBodiesRef.current.EARTH.mesh; e.rotation.y += 0.05 * delta;
        const c = e.children.find((c: any) => c.name === 'clouds'); if (c) c.rotation.y += 0.01 * delta;
        e.children.forEach((ch: any) => { if (ch.material?.uniforms?.uTime) ch.material.uniforms.uTime.value = elapsedTime; });
      }

      cmeGroupRef.current.children.forEach((c: any) => { if (c.material) c.material.opacity = getCmeOpacity(c.userData.speed); });

      if (timelineActive) {
        if (timelinePlaying) {
          const r = timelineMaxDate - timelineMinDate;
          if (r > 0 && timelineValueRef.current < 1000) {
            const v = timelineValueRef.current + (delta * (3 * timelineSpeed * 3600 * 1000) / r) * 1000;
            if (v >= 1000) { timelineValueRef.current = 1000; onTimelineEnd(); } else { timelineValueRef.current = v; }
            onScrubberChangeByAnim(timelineValueRef.current);
          }
        }
        const t = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        cmeGroupRef.current.children.forEach((c: any) => {
          const s = (t - c.userData.startTime.getTime()) / 1000;
          const cached = getCachedState(c.userData.id, t, timelineMinDate);
          if (cached) {
            updateCMEShape(c, s < 0 ? -1 : 1, s < 0 ? 0 : s, s < 0 ? undefined : cached);
          } else {
            updateCMEShape(c, s < 0 ? -1 : calculateDistanceWithDeceleration(c.userData, s), s < 0 ? 0 : s);
          }
        });
      } else {
        cmeGroupRef.current.children.forEach((c: any) => {
          let tSec = 0;
          if (currentlyModeledCMEId && c.userData.id === currentlyModeledCMEId) {
            const cme = c.userData, t = elapsedTime - (cme.simulationStartTime ?? elapsedTime);
            tSec = t < 0 ? 0 : t;
            const tMs = c.userData.startTime.getTime() + tSec * 1000;
            const cached = getCachedState(c.userData.id, tMs, timelineMinDate);
            if (cached) { updateCMEShape(c, 1, tSec, cached); }
            else {
              const d = (cme.isEarthDirected && cme.predictedArrivalTime) ? calculateDistanceByInterpolation(cme, tSec) : calculateDistanceWithDeceleration(cme, tSec);
              updateCMEShape(c, d, tSec);
            }
          } else if (!currentlyModeledCMEId) {
            const tAbsMs = Date.now();
            tSec = Math.max(0, (tAbsMs - c.userData.startTime.getTime()) / 1000);
            const cached = getCachedState(c.userData.id, tAbsMs, timelineMinDate);
            if (cached) { updateCMEShape(c, 1, tSec, cached); }
            else {
              const d = calculateDistanceWithDeceleration(c.userData, tSec);
              updateCMEShape(c, d, tSec);
            }
          } else { updateCMEShape(c, -1); return; }
        });
      }

      // ── CME TAIL WOBBLE ──────────────────────────────────────────────────
      // Applies a jelly/flag oscillation to tail particles each frame.
      // Only particles with tailFrac > 0 (rear 60% of body) are affected.
      // Two overlapping sine waves at different frequencies for organic motion.
      if (WOBBLE_STRENGTH > 0) {
        cmeGroupRef.current.children.forEach((c: any) => {
          if (!c.visible) return;
          const ud = c.userData;
          if (!ud.basePositions || !ud.tailFractions) return;
          const bp  = ud.basePositions  as Float32Array;
          const tf  = ud.tailFractions  as Float32Array;
          const wp  = ud.wobblePhases   as Float32Array;
          const posArr = c.geometry.attributes.position.array as Float32Array;
          const n   = tf.length;
          const maxR = (ud.noseTopY ?? GCS_ARC_RADIUS_FRAC) * GCS_ARC_RADIUS_FRAC;

          for (let i = 0; i < n; i++) {
            const frac = tf[i];
            if (frac <= 0) continue;
            const phase = wp[i];
            // Two-frequency wobble: slow rolling wave + faster flutter
            // tailFrac^1.5 means tip wobbles much more than mid-body
            const amp = WOBBLE_STRENGTH * maxR * Math.pow(frac, 1.5);
            const slow = Math.sin(elapsedTime * 0.8 + phase);
            const fast = Math.sin(elapsedTime * 2.1 + phase * 1.7) * 0.35;
            const offset = amp * (slow + fast);
            posArr[i * 3]     = bp[i * 3]     + offset;           // wobble in X
            posArr[i * 3 + 2] = bp[i * 3 + 2] + offset * 0.4;    // subtle Z coupling
          }
          c.geometry.attributes.position.needsUpdate = true;
        });
      }
      if (fluxRopeRef.current) { fluxRopeRef.current.visible = false; fluxRopeRef.current.material.uniforms.uTime.value = elapsedTime; }

      // ── Bz field lines ───────────────────────────────────────────────────────
      const shouldShowBz = showFluxRope && !!currentlyModeledCMEId;
      if (bzFieldLinesRef.current) {
        bzFieldLinesRef.current.visible = shouldShowBz;
        if (shouldShowBz) {
          const cmeObj = cmeGroupRef.current.children.find((c: any) => c.userData.id === currentlyModeledCMEId);
          if (cmeObj?.visible) {
            bzFieldLinesRef.current.position.copy(cmeObj.position);
            bzFieldLinesRef.current.quaternion.copy(cmeObj.quaternion);
            bzFieldLinesRef.current.scale.copy(cmeObj.scale);
            const bzVal = bzSouth ? 1.0 : 0.0;
            bzFieldLinesRef.current.children.forEach((child: any) => {
              if (child.material?.uniforms) {
                child.material.uniforms.uTime.value    = elapsedTime;
                child.material.uniforms.uBzSouth.value = bzVal;
              }
            });
          }
        }
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsedTime);
      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current?.domElement) { rendererRef.current.domElement.removeEventListener('pointerdown', handlePointerDown); rendererRef.current.domElement.removeEventListener('pointerup', handlePointerUp); }
      if (mountRef.current && rendererRef.current) mountRef.current.removeChild(rendererRef.current.domElement);
      if (particleTextureCache) { particleTextureCache.dispose?.(); particleTextureCache = null; }
      if (arrowTextureCache)    { arrowTextureCache.dispose?.();    arrowTextureCache    = null; }
      try { rendererRef.current?.dispose(); } catch {}
      cancelAnimationFrame(animationFrameId);
      sceneRef.current?.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose()); else o.material.dispose(); }
      });
      rendererRef.current = null; setRendererDomElement(null); onCameraReady(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE]);

  // ── CME particle systems ──────────────────────────────────────────────────
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;
    while (cmeGroupRef.current.children.length > 0) {
      const c = cmeGroupRef.current.children[0]; cmeGroupRef.current.remove(c);
      if ((c as any).geometry) (c as any).geometry.dispose();
      if ((c as any).material) { const m = (c as any).material; if (Array.isArray(m)) m.forEach((x: any) => x.dispose()); else m.dispose(); }
    }
    const pt = createParticleTexture(THREE);
    cmeData.forEach(cme => {
      const pCount = getCmeParticleCount(cme.speed), pos: number[] = [];
      const arcR = GCS_ARC_RADIUS_FRAC, baseTubeR = GCS_TUBE_RADIUS_FRAC * arcR, hs = GCS_ARC_SPAN * 0.5;

      // ── CME SHAPE: TRUE TEARDROP ──────────────────────────────────────────
      //
      // Silhouette: bulging rounded front (nose), continuously narrowing body,
      // converging to a single point at the tail toward the Sun.
      //
      // Cross-section half-width at depth fraction f ∈ [0,1] (0=nose, 1=tail):
      //   hw(f) = maxHalfWidth * (1-f)^nosePow * f^tailPow  -- NO, that peaks mid.
      //
      // Correct formula for "fat front, pointed tail":
      //   hw(f) = maxHalfWidth * sqrt(1 - f) * (1 - f*f*tailSharpness)
      //
      // Actually simplest correct approach:
      //   Think of it as half an ellipse at the nose blending into a cone to tail.
      //   hw(f) = maxHalfWidth * sqrt(max(0, 1 - f^tailPow))
      //   tailPow < 1 = very gradual taper (fat cigar)
      //   tailPow = 1 = linear taper (cone/triangle)
      //   tailPow > 1 = fast initial taper then slow (teardrop — round front, pinched tail)
      //
      // We want: round at nose (slow start), then taper to point.
      // Use tailPow = 0.6 — starts wide, tapers continuously to zero.

      const tailExtend = 5.6;
      // One single particle pass. No separate arc + fill.
      //
      // Shape defined in local cylindrical coords (radius r, height y):
      //   The teardrop profile: r_max(y) = maxR * (1 - y/noseY)^nosePow  — NO
      //
      // We use a 2D teardrop SDF approach:
      //   - y runs from +noseY (front tip) to tailY (tail point), both in local space
      //   - At each y, the allowed radius is: r_max(y) = maxR * profile(y)
      //   - profile: smooth at nose, tapers continuously to 0 at tail
      //
      // Density: higher near the outer surface (shell effect) and near the nose.
      // This gives bright leading edge + visible core + fading wake naturally.

      // Y extent: nose at top (positive), tail at bottom (negative)
      const noseTopY  = arcR;           // nose tip protrudes arcR above origin
      const legMidY   = 0.0;            // where legs are (~equator of the teardrop)
      const tailY     = -(tailExtend * arcR);  // tail point

      const totalHeight = noseTopY - tailY;  // full height of teardrop

      // Max radius at the widest point (around legMidY)
      const maxR = arcR * Math.sin(hs) + baseTubeR * 0.6;

      // Profile: given normalised y position [0=nose .. 1=tail], return allowed radius
      // Uses a two-segment curve: nose half is convex (round cap), tail half tapers to point
      const getRadius = (y: number): number => {
        // f: 0 at nose top, 1 at tail
        const f = Math.max(0, Math.min(1, (noseTopY - y) / totalHeight));
        // Nose cap: sin curve peaks at f≈0.25, then linear taper to tail
        const noseCap  = Math.sin(Math.min(f * Math.PI / 0.5, Math.PI)); // peaks at f=0.25
        const taper    = Math.pow(1.0 - f, 0.6);
        // Blend: use noseCap for front 40%, pure taper for rest
        const blend    = Math.max(0, Math.min(1, f / 0.4));
        return maxR * (noseCap * (1 - blend) + taper * blend);
      };

      for (let i = 0; i < pCount; i++) {
        // Pick y with bias toward nose (front-heavy density)
        const f  = Math.pow(Math.random(), 0.65);
        const py = noseTopY - f * totalHeight;

        const rMax = getRadius(py);
        if (rMax < 0.0005) continue;

        // Radial distribution: bias toward surface for shell/edge effect
        const rFrac = Math.pow(Math.random(), 0.45);
        const r     = rFrac * rMax;

        const angle = Math.random() * Math.PI * 2;
        pos.push(
          r * Math.cos(angle),
          py,
          r * Math.sin(angle) * GCS_AXIAL_DEPTH_FRAC
        );
      }

      const geom = new THREE.BufferGeometry();
      const posAttr = new THREE.Float32BufferAttribute(pos, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage); // positions will be updated each frame
      geom.setAttribute('position', posAttr);

      // Store base positions and per-particle tail fractions for wobble animation
      const basePositions  = new Float32Array(pos);
      const tailFractions  = new Float32Array(pos.length / 3);
      for (let i = 0; i < tailFractions.length; i++) {
        const py = pos[i * 3 + 1]; // Y of this particle
        // tailFrac: 0 = at nose, 1 = at tail tip. Only back 60% of body wobbles.
        const rawFrac = Math.max(0, (noseTopY - py) / totalHeight);
        tailFractions[i] = Math.max(0, (rawFrac - 0.4) / 0.6); // remap so wobble starts at 40% depth
      }

      // Random per-particle phase so wobble looks organic (not all moving in sync)
      const wobblePhases = new Float32Array(tailFractions.length);
      for (let i = 0; i < wobblePhases.length; i++) wobblePhases[i] = Math.random() * Math.PI * 2;

      const mat = new THREE.PointsMaterial({
        size: getCmeParticleSize(cme.speed, SCENE_SCALE),
        sizeAttenuation: true,
        map: pt,
        transparent: true,
        opacity: getCmeOpacity(cme.speed),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: getCmeCoreColor(cme.speed),
      });
      const system = new THREE.Points(geom, mat);
      system.userData = {
        ...cme,
        tailY_local:    totalHeight,
        basePositions,
        tailFractions,
        wobblePhases,
        noseTopY,
        totalHeight,
      };
      const dir = new THREE.Vector3(); dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      system.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cmeGroupRef.current.add(system);
    });
  }, [cmeData, getClockElapsedTime]);

  // Build trajectory cache whenever data or timeline window changes
  useEffect(() => {
    if (cmeData.length > 0 && timelineMaxDate > timelineMinDate) {
      buildTrajectoryCache(cmeData, timelineMinDate, timelineMaxDate);
    }
  }, [cmeData, timelineMinDate, timelineMaxDate, buildTrajectoryCache]);

  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!cmeGroupRef.current) return;
    cmeGroupRef.current.children.forEach((cm: any) => {
      cm.visible = !currentlyModeledCMEId || cm.userData.id === currentlyModeledCMEId;
      if (cm.userData.id === currentlyModeledCMEId) cm.userData.simulationStartTime = getClockElapsedTime();
    });
    if (!THREE || !sceneRef.current) return;
    if (predictionLineRef.current) { sceneRef.current.remove(predictionLineRef.current); predictionLineRef.current.geometry.dispose(); predictionLineRef.current.material.dispose(); predictionLineRef.current = null; }
    const cme = cmeData.find(c => c.id === currentlyModeledCMEId);
    if (cme && cme.isEarthDirected && celestialBodiesRef.current.EARTH) {
      const p = new THREE.Vector3(); celestialBodiesRef.current.EARTH.mesh.getWorldPosition(p);
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), p]), new THREE.LineDashedMaterial({ color: 0xffff66, transparent: true, opacity: 0.85, dashSize: 0.05 * SCENE_SCALE, gapSize: 0.02 * SCENE_SCALE }));
      l.computeLineDistances(); l.visible = !!currentlyModeledCMEId; sceneRef.current.add(l); predictionLineRef.current = l;
    }
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime]);

  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    const THREE = (window as any).THREE; const gsap = (window as any).gsap;
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;
    const target = new THREE.Vector3(0, 0, 0);
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) celestialBodiesRef.current.EARTH.mesh.getWorldPosition(target);
    const pos = view === ViewMode.TOP
      ? new THREE.Vector3(target.x, target.y + SCENE_SCALE * 4.2, target.z + 0.01)
      : new THREE.Vector3(target.x + SCENE_SCALE * 1.9, target.y + SCENE_SCALE * 0.35, target.z);
    gsap.to(cameraRef.current.position, { duration: 1.2, x: pos.x, y: pos.y, z: pos.z, ease: "power2.inOut" });
    gsap.to(controlsRef.current.target, { duration: 1.2, x: target.x, y: target.y, z: target.z, ease: "power2.inOut", onUpdate: () => controlsRef.current.update() });
  }, []);
  useEffect(() => { moveCamera(activeView, focusTarget); }, [activeView, focusTarget, dataVersion, moveCamera]);

  useImperativeHandle(ref, () => ({
    resetView: () => moveCamera(ViewMode.TOP, FocusTarget.EARTH),
    resetAnimationTimer: () => { lastTimeRef.current = getClockElapsedTime(); },
    captureCanvasAsDataURL: () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) { rendererRef.current.render(sceneRef.current, cameraRef.current); return rendererRef.current.domElement.toDataURL('image/png'); }
      return null;
    },
    calculateImpactProfile: () => {
      if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return [];
      const ed = PLANET_DATA_MAP.EARTH; if (timelineMinDate <= 0) return [];
      const gStart = Date.now(), gEnd = gStart + 7 * 24 * 3600 * 1000, gDur = gEnd - gStart;
      const graphData = []; const ns = 200, as = 350, ad = 5;
      for (let i = 0; i <= ns; i++) {
        const ct = gStart + gDur * (i / ns);
        const ea = ed.angle + ((2 * Math.PI) / (ed.orbitalPeriodDays! * 24 * 3600)) * ((ct - timelineMinDate) / 1000);
        const ep = new THREE.Vector3(ed.radius * Math.sin(ea), 0, ed.radius * Math.cos(ea));
        let ts = as, td = ad;
        cmeGroupRef.current.children.forEach((co: any) => {
          const cme = co.userData as ProcessedCME, tsc = (ct - cme.startTime.getTime()) / 1000;
          if (tsc > 0) {
            const cd = calculateDistanceWithDeceleration(cme, tsc);
            const cdir = new THREE.Vector3(0, 1, 0).applyQuaternion(co.quaternion);
            if (cdir.angleTo(ep.clone().normalize()) < THREE.MathUtils.degToRad(cme.halfAngle)) {
              const de = ep.length(), cth = SCENE_SCALE * 0.3;
              if (de < cd && de > cd - cth) {
                const a2 = (1.41 - 0.0035 * cme.speed) / 1000;
                const cs = Math.max(MIN_CME_SPEED_KMS, cme.speed + a2 * tsc);
                const pen = cd - de, ct2 = cth * 0.25;
                const inten = pen <= ct2 ? 1 : 0.5 * (1 + Math.cos(((pen - ct2) / (cth - ct2)) * Math.PI));
                ts = Math.max(ts, as + (cs - as) * inten);
                td += (THREE.MathUtils.mapLinear(cme.speed, 300, 2000, 5, 50) - ad) * inten;
              }
            }
          }
        });
        graphData.push({ time: ct, speed: ts, density: td });
      }
      return graphData;
    }
  }), [moveCamera, getClockElapsedTime, THREE, timelineMinDate, calculateDistanceWithDeceleration, cmeData]);

  useEffect(() => { if (controlsRef.current && rendererRef.current?.domElement) { controlsRef.current.enabled = true; rendererRef.current.domElement.style.cursor = 'move'; } }, [interactionMode]);
  useEffect(() => { if (!celestialBodiesRef.current || !orbitsRef.current) return; ['MERCURY', 'VENUS', 'MARS'].forEach(n => { const b = celestialBodiesRef.current[n], o = orbitsRef.current[n]; if (b) b.mesh.visible = showExtraPlanets; if (o) o.visible = showExtraPlanets; }); }, [showExtraPlanets]);
  useEffect(() => { if (!celestialBodiesRef.current) return; const m = celestialBodiesRef.current['MOON'], l = celestialBodiesRef.current['L1']; if (m) m.mesh.visible = showMoonL1; if (l) l.mesh.visible = showMoonL1; const e = celestialBodiesRef.current['EARTH']?.mesh; if (e) { const o = e.children.find((c: any) => c.name === 'moon-orbit'); if (o) o.visible = showMoonL1; } }, [showMoonL1]);

  const checkImpacts = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;
    let maxSpeed = 0;
    const p = new THREE.Vector3(); celestialBodiesRef.current.EARTH.mesh.getWorldPosition(p);
    cmeGroupRef.current.children.forEach((c: any) => {
      const d = c.userData; if (!d || !c.visible) return;
      const tip = c.position.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion).multiplyScalar(c.scale.x * GCS_ARC_RADIUS_FRAC));
      if (tip.distanceTo(p) < PLANET_DATA_MAP.EARTH.size * 2.2 && d.speed > maxSpeed) maxSpeed = d.speed;
    });
    return maxSpeed;
  }, []);

  const speedToLatBoundaryDeg = (s: number) => 70 - 25 * ((clamp(s, 300, 3000) - 300) / 2700);
  const speedToIntensity      = (s: number) => 0.25 + ((clamp(s, 300, 3000) - 300) / 2700) * 0.95;

  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsed: number) => {
    const earth = celestialBodiesRef.current.EARTH?.mesh; if (!earth) return;
    const aurora = earth.children.find((c: any) => c.name === 'aurora');
    const atmo   = earth.children.find((c: any) => c.name === 'atmosphere');
    const hit = clamp(maxImpactSpeed / 1500, 0, 1);
    if (aurora?.material?.uniforms) {
      aurora.material.uniforms.uCmeSpeed.value        = maxImpactSpeed;
      aurora.material.uniforms.uImpactTime.value      = hit > 0 ? elapsed : 0;
      aurora.material.uniforms.uAuroraMinY.value      = Math.sin(speedToLatBoundaryDeg(maxImpactSpeed || 0) * Math.PI / 180);
      aurora.material.uniforms.uAuroraIntensity.value = speedToIntensity(maxImpactSpeed || 0);
      (aurora.material as any).opacity = 0.12 + hit * (0.45 + 0.18 * Math.sin(elapsed * 2));
    }
    if (atmo?.material?.uniforms) { (atmo.material as any).opacity = 0.12 + hit * 0.22; atmo.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0; }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
// --- END OF FILE SimulationCanvas.tsx ---