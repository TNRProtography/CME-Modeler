// --- START OF FILE SimulationCanvas.tsx ---

import React, { useRef, useEffect, useCallback, useImperativeHandle, useState } from 'react';
import {
  ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle
} from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER,
  FLUX_ROPE_VERTEX_SHADER, FLUX_ROPE_FRAGMENT_SHADER,
  SUN_ANGULAR_VELOCITY,
} from '../constants';
import { CoronalHole } from '../utils/coronalHoleData';
import {
  buildChSurfaceMesh,
  buildChOutlineLine,
  buildChLabelAnchor,
  buildParkerSpiralMesh,
} from '../utils/coronalHoleGeometry';

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
    gl_PointSize = 3.5;
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

// ── Bz INDICATOR DISC SHADERS ─────────────────────────────────────────────────
// A camera-facing disc rendered at the front of the CME showing a bold up/down
// arrow so the Bz direction is immediately legible to the user.

const BZ_INDICATOR_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BZ_INDICATOR_FRAGMENT_SHADER = `
  uniform float uBzSouth;
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float dist = length(p);
    if (dist > 0.92) discard;

    vec3 northColor = vec3(0.27, 0.53, 1.0);
    vec3 southColor = vec3(1.0,  0.27, 0.13);
    vec3 col = mix(northColor, southColor, uBzSouth);

    // Arrow shaft (vertical centre strip)
    float shaft = step(abs(p.x), 0.10) * step(abs(p.y), 0.58);

    // Arrowhead — points UP for north (+Y), DOWN for south (-Y)
    float arrowDir  = uBzSouth > 0.5 ? -1.0 : 1.0;
    float headY     = arrowDir * 0.58;
    float headDist  = arrowDir * (p.y - headY);
    float headWidth = 0.30 * headDist;
    float head = step(0.0, headDist) * step(abs(p.x), headWidth) * step(headDist, 0.38);

    float arrow = clamp(shaft + head, 0.0, 1.0);
    float pulse = 0.78 + 0.22 * sin(uTime * 2.5);

    // NO dark disc background — arrow only, fully transparent elsewhere
    // Soft glow halo just behind the arrow so it reads against the CME
    float glow = smoothstep(0.5, 0.0, dist) * 0.18 * arrow;

    float finalAlpha = (arrow * 0.90 + glow) * pulse;
    finalAlpha *= 1.0 - smoothstep(0.80, 0.92, dist);

    gl_FragColor = vec4(col * pulse, finalAlpha);
    if (gl_FragColor.a < 0.01) discard;
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
//  GCS GEOMETRY CONSTANTS
// ============================================================
const GCS_ARC_RADIUS_FRAC  = 0.55;
const GCS_ARC_SPAN         = Math.PI * 0.85;
const GCS_TUBE_RADIUS_FRAC = 0.38;
const GCS_AXIAL_DEPTH_FRAC = 0.38;  // slightly deeper than before for teardrop body

// Number of helical field lines around the tube, and points per line
const BZ_FIELD_LINE_COUNT  = 8;
const BZ_FIELD_LINE_POINTS = 120;

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
  const tubeR    = GCS_TUBE_RADIUS_FRAC * arcR * 0.92; // sit just inside tube surface
  const halfSpan = GCS_ARC_SPAN * 0.5;

  const baseAngle  = (lineIndex / BZ_FIELD_LINE_COUNT) * Math.PI * 2;
  const phase      = lineIndex / BZ_FIELD_LINE_COUNT;
  const helixTurns = 1.5; // wraps around the tube 1.5 times along the arc

  for (let i = 0; i < BZ_FIELD_LINE_POINTS; i++) {
    const s = i / (BZ_FIELD_LINE_POINTS - 1);           // [0..1] along arc
    const t = (s * 2 - 1) * halfSpan;                   // arc parameter

    // Arc centreline (identical formula to particle geometry — belly faces +Y)
    const cx = arcR * Math.sin(t);
    const cy = arcR * (Math.cos(t) - 1);
    const cz = 0;

    // Frenet normal and binormal at t
    // N = (-sin(t), -cos(t), 0),  B = (0, 0, 1)
    const Nx = -Math.sin(t), Ny = -Math.cos(t);

    // Helical angle advances with arc position
    const helixAngle = baseAngle + s * helixTurns * Math.PI * 2;

    // Point on tube surface: centreline + tubeR*(cos*N + sin*B)
    const px = cx + tubeR * (Math.cos(helixAngle) * Nx);
    const py = cy + tubeR * (Math.cos(helixAngle) * Ny);
    const pz = cz + tubeR * Math.sin(helixAngle);       // B = +Z

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
  /** Whether the Parker-spiral HSS stream arms are visible */
  showHss: boolean;
  /** Live coronal holes from SUVI detector — rebuilt whenever this changes */
  coronalHoles: CoronalHole[];
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
    showFluxRope, bzSouth, showHss, coronalHoles, dataVersion, interactionMode, onSunClick,
  } = props;

  const mountRef           = useRef<HTMLDivElement>(null);
  const rendererRef        = useRef<any>(null);
  const sceneRef           = useRef<any>(null);
  const cameraRef          = useRef<any>(null);
  const controlsRef        = useRef<any>(null);
  const cmeGroupRef        = useRef<any>(null);
  const sceneCleanupRef    = useRef<(() => void) | null>(null);
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef          = useRef<Record<string, any>>({});
  const predictionLineRef  = useRef<any>(null);
  const fluxRopeRef        = useRef<any>(null);

  // Bz field line group (Points objects) and front-face indicator disc
  const bzFieldLinesRef = useRef<any>(null);
  const bzIndicatorRef  = useRef<any>(null);

  // ── Coronal Hole / HSS refs ───────────────────────────────────────────────
  // chGroupRef  — parented to sunMesh; patches rotate with the sun for free
  // hssGroupRef — world-space Parker spiral arms; vertex shader rotates per frame
  const chGroupRef     = useRef<any>(null);
  const hssGroupRef    = useRef<any>(null);
  const hssAuRingsRef  = useRef<any>(null);
  const sunMeshRef     = useRef<any>(null);
  const setPlanetLabelsRef = useRef(setPlanetMeshesForLabels);
  const sunRotationRef = useRef<number>(0);

  const starsNearRef = useRef<any>(null);
  const starsFarRef  = useRef<any>(null);

  const timelineValueRef    = useRef(timelineValue);
  const lastTimeRef         = useRef(0);
  const raycasterRef        = useRef<any>(null);
  const mouseRef            = useRef<any>(null);
  const pointerDownTime     = useRef(0);
  const pointerDownPosition = useRef({ x: 0, y: 0 });

  const animPropsRef = useRef({
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope, bzSouth, showHss,
  });
  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth, showHss,
    };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth, showHss]);

  // --- Dynamic loader: only fetches Three.js + deps when the modeler first mounts ---
  const threeLoadedRef = useRef(false);
  const [threeReady, setThreeReady] = useState(!!(window as any).THREE);
  const loadThreeLibs = useCallback((): Promise<void> => {
    if (threeLoadedRef.current && (window as any).THREE && (window as any).gsap) {
      return Promise.resolve();
    }
    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      });

    // OrbitControls must come after Three.js — load sequentially
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'))
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js'))
      .then(() => { threeLoadedRef.current = true; setThreeReady(true); });
  }, []);

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
  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number, timeSinceEventSeconds?: number) => {
    const THREE = (window as any).THREE;
    if (!THREE) return;
    const sunRadius = PLANET_DATA_MAP.SUN.size;
    if (distTraveledInSceneUnits < 0) {
      cmeObject.visible = false;
      return;
    }
    cmeObject.visible = true;
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    const dist = Math.max(0, distTraveledInSceneUnits - sunRadius);
    cmeObject.position.copy(dir.clone().multiplyScalar(sunRadius + dist));
    const cme: any = cmeObject.userData;
    const lateral = Math.max(dist * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle ?? 30)), sunRadius * 0.3);
    const sXZ = lateral / GCS_ARC_RADIUS_FRAC;
    cmeObject.scale.set(sXZ, sXZ * GCS_AXIAL_DEPTH_FRAC, sXZ);

    // ── LIVE COLOUR TRANSITION ───────────────────────────────────────────────
    // Calculate the CME's current speed at this moment in time.
    // As the CME decelerates, the colour shifts down through the speed key.
    if (timeSinceEventSeconds !== undefined && cmeObject.material) {
      const u = cme.speed, t = Math.max(0, timeSinceEventSeconds);
      const a = (1.41 - 0.0035 * u) / 1000;
      const tf = a < 0 ? (300 - u) / a : Infinity;
      const liveSpeed = u <= 300 ? u : t < tf ? Math.max(300, u + a * t) : 300;
      cmeObject.material.color = getCmeCoreColor(liveSpeed);
    }
  }, []);

  useEffect(() => {
    if (!mountRef.current || rendererRef.current) return;

    let cancelled = false;
    loadThreeLibs().then(() => {
      if (cancelled || !mountRef.current || rendererRef.current) return;
      const THREE = (window as any).THREE;
      if (!THREE) return;

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.001 * SCENE_SCALE, 120 * SCENE_SCALE);
    camera.position.set(SCENE_SCALE * -2.2, SCENE_SCALE * 1.8, SCENE_SCALE * 5.5); // Start at angled side view showing full inner solar system
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

    // ── Bz indicator disc ────────────────────────────────────────────────────
    const bzInd = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader:   BZ_INDICATOR_VERTEX_SHADER,
        fragmentShader: BZ_INDICATOR_FRAGMENT_SHADER,
        uniforms: { uBzSouth: { value: 0.0 }, uTime: { value: 0 } },
        transparent: true, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    bzInd.visible = false; scene.add(bzInd); bzIndicatorRef.current = bzInd;

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
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64),
      new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER })
    );
    sunMesh.name = 'sun-shader';
    scene.add(sunMesh);
    sunMeshRef.current = sunMesh;
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    // Photosphere overlay — child of sunMesh so it rotates with the sun
    const sunPhoto = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size * 1.001, 64, 64),
      new THREE.MeshBasicMaterial({ map: tex.sunPhoto, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    sunPhoto.name = 'sun-photosphere';
    sunMesh.add(sunPhoto);

    // ── Coronal Holes & Parker Spiral HSS ──────────────────────────────────
    // chGroup: child of sunMesh → patches rotate with the sun automatically
    // hssGroup: child of sunMesh so HSS roots are locked to CH/source rotation.
    const chGroup  = new THREE.Group(); chGroup.name  = 'coronal-holes';  sunMesh.add(chGroup);
    const hssGroup = new THREE.Group(); hssGroup.name = 'hss-streams';    sunMesh.add(hssGroup);
    const hssAuRings = new THREE.Group(); hssAuRings.name = 'hss-au-rings'; scene.add(hssAuRings);
    chGroupRef.current  = chGroup;
    hssGroupRef.current = hssGroup;
    hssAuRingsRef.current = hssAuRings;

    // WSA-ENLIL style heliocentric distance rings in the ecliptic plane.
    // Scene scale is 1 AU = SCENE_SCALE, so ring radii map directly.
    [0.25, 0.5, 0.75, 1.0, 1.25, 1.5].forEach((au) => {
      const ringPts = [];
      const r = au * SCENE_SCALE;
      for (let i = 0; i <= 192; i++) {
        const a = (i / 192) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
      }
      const color = Math.abs(au - 1.0) < 0.001 ? 0x6ec1ff : 0x315670;
      const opacity = Math.abs(au - 1.0) < 0.001 ? 0.65 : 0.35;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      );
      line.name = `hss-au-ring-${au.toFixed(2)}au`;
      hssAuRings.add(line);
    });
    const sunR     = PLANET_DATA_MAP.SUN.size;
    const hssReach = PLANET_DATA_MAP.EARTH.radius * 1.65;
    props.coronalHoles.forEach(ch => {
      chGroup.add(buildChSurfaceMesh(THREE, ch, sunR));
      chGroup.add(buildChOutlineLine(THREE, ch, sunR));
      hssGroup.add(buildParkerSpiralMesh(THREE, ch, sunR, hssReach, 0));
      const anchor = buildChLabelAnchor(THREE, ch, sunR);
      chGroup.add(anchor);
    });

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];
    // CH labels — added here so PlanetLabel can track world position via sunMesh parent
    props.coronalHoles.forEach(ch => {
      const anchor = chGroup.getObjectByName(`ch-label-anchor-${ch.id}`);
      if (anchor) planetLabelInfos.push({ id: `ch-label-${ch.id}`, name: 'Coronal Hole', mesh: anchor });
    });

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
      const { currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate, onScrubberChangeByAnim, onTimelineEnd, showFluxRope, bzSouth, showHss } = animPropsRef.current;
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

      // ── Solar rotation / timeline sync ───────────────────────────────────
      // Timeline mode: lock CH/HSS longitude to the scrubbed absolute time.
      // The red "now" line corresponds to Date.now(); at that point angle=0.
      if (timelineActive && timelineMaxDate > timelineMinDate) {
        const timelineNowMs = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        const dtSecFromNow = (timelineNowMs - Date.now()) / 1000;
        sunRotationRef.current = SUN_ANGULAR_VELOCITY * dtSecFromNow;
      } else {
        const sunAngularDelta = SUN_ANGULAR_VELOCITY * OSS * delta;
        sunRotationRef.current += sunAngularDelta;
      }
      if (sunMeshRef.current) sunMeshRef.current.rotation.y = sunRotationRef.current;

      // ── HSS Parker spiral — visibility + per-frame uniform updates ────────
      if (hssGroupRef.current) {
        hssGroupRef.current.visible = showHss;
        hssGroupRef.current.children.forEach((child: any) => {
          const u = child.material?.uniforms;
          if (!u) return;
          if (u.uSunAngle !== undefined) u.uSunAngle.value = 0;
          if (u.uTime    !== undefined) u.uTime.value    = elapsedTime;
        });
      }
      if (hssAuRingsRef.current) hssAuRingsRef.current.visible = showHss;

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
        cmeGroupRef.current.children.forEach((c: any) => { const s = (t - c.userData.startTime.getTime()) / 1000; updateCMEShape(c, s < 0 ? -1 : calculateDistanceWithDeceleration(c.userData, s), s < 0 ? 0 : s); });
      } else {
        cmeGroupRef.current.children.forEach((c: any) => {
          let d = 0; let tSec = 0;
          if (currentlyModeledCMEId && c.userData.id === currentlyModeledCMEId) {
            const cme = c.userData, t = elapsedTime - (cme.simulationStartTime ?? elapsedTime);
            tSec = t < 0 ? 0 : t;
            d = (cme.isEarthDirected && cme.predictedArrivalTime) ? calculateDistanceByInterpolation(cme, tSec) : calculateDistanceWithDeceleration(cme, tSec);
          } else if (!currentlyModeledCMEId) {
            const t = (Date.now() - c.userData.startTime.getTime()) / 1000;
            tSec = t < 0 ? 0 : t;
            d = calculateDistanceWithDeceleration(c.userData, tSec);
          } else { updateCMEShape(c, -1); return; }
          updateCMEShape(c, d, tSec);
        });
      }

      // Legacy torus hidden — superseded by Bz field lines
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

      // ── Bz indicator disc ────────────────────────────────────────────────────
      if (bzIndicatorRef.current) {
        bzIndicatorRef.current.visible = shouldShowBz;
        if (shouldShowBz) {
          const cmeObj = cmeGroupRef.current.children.find((c: any) => c.userData.id === currentlyModeledCMEId);
          if (cmeObj?.visible) {
            // Place disc at the front face of the croissant, offset slightly forward
            const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObj.quaternion);
            bzIndicatorRef.current.position.copy(cmeObj.position.clone().add(dir.multiplyScalar(cmeObj.scale.x * 0.18)));
            // Always face the camera
            bzIndicatorRef.current.quaternion.copy(cameraRef.current.quaternion);
            // Scale proportional to CME lateral width
            const ds = cmeObj.scale.x * 0.55;
            bzIndicatorRef.current.scale.set(ds, ds, ds);
            bzIndicatorRef.current.material.uniforms.uBzSouth.value = bzSouth ? 1.0 : 0.0;
            bzIndicatorRef.current.material.uniforms.uTime.value    = elapsedTime;
          }
        }
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsedTime);
      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    sceneCleanupRef.current = () => {
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
    }); // end loadThreeLibs().then()

    return () => {
      cancelled = true;
      sceneCleanupRef.current?.();
      sceneCleanupRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreeLibs]);

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

      // ── TEARDROP SHAPE ────────────────────────────────────────────────────
      // The leading edge (top of arc, t≈0) is fattest.
      // Tube radius tapers toward the trailing legs (t→±halfSpan).
      // taper(t) = 1.0 at t=0 (front), falls to ~0.35 at the tips.
      //
      // ── BACK DEPTH (60% extra) ───────────────────────────────────────────
      // A second pass distributes particles behind the arc centrepoint,
      // offset along the -Y (toward-Sun) axis.  This gives front-to-back
      // depth without going all the way back to the Sun.
      // 60% of lateral scale → backDepth = 0.60 * arcR in normalised units.
      // Density falls off toward the tail so it looks like a tear, not a box.

      const backDepthFrac = 3.00; // how far back the tail extends as fraction of arcR
      // Split particles: ~65% in the main croissant arc, ~35% in the tail depth
      const mainCount = Math.floor(pCount * 0.65);
      const tailCount = pCount - mainCount;

      // Main arc particles — tapered tube
      for (let i = 0; i < mainCount; i++) {
        const t  = (Math.random() * 2 - 1) * hs;
        const cx = arcR * Math.sin(t), cy = arcR * (Math.cos(t) - 1);
        const Nx = -Math.sin(t), Ny = -Math.cos(t);

        // Taper: cos²(t / halfSpan * π/2) gives 1.0 at t=0, 0.0 at t=±halfSpan
        // We floor it at 0.35 so the tips still have some body
        const taper    = 0.35 + 0.65 * Math.pow(Math.cos((t / hs) * (Math.PI / 2)), 2);
        const tubeR    = baseTubeR * taper;
        const rho      = Math.sqrt(Math.random()) * tubeR;
        const phi      = Math.random() * 2 * Math.PI;
        pos.push(cx + rho * Math.cos(phi) * Nx, cy + rho * Math.cos(phi) * Ny, rho * Math.sin(phi));
      }

      // Tail depth particles — fill behind the arc in the -Y direction
      // (toward Sun in local space, since +Y = propagation direction)
      for (let i = 0; i < tailCount; i++) {
        const t  = (Math.random() * 2 - 1) * hs;
        const cx = arcR * Math.sin(t), cy = arcR * (Math.cos(t) - 1);
        const Nx = -Math.sin(t), Ny = -Math.cos(t);

        // Depth offset: random penetration behind the arc surface in -Y local space
        // More particles near 0 depth (front), fewer at full backDepth (tail tip)
        // sqrt distribution biases toward front — gives the "rounded bullet" feel
        const depthFrac = Math.pow(Math.random(), 1.6); // bias toward front
        const depthY    = -depthFrac * backDepthFrac * arcR; // negative = toward Sun

        // Tube radius at this depth also tapers — narrower deeper in the tail
        // and narrower toward arc tips (same taper as main arc)
        const arcTaper   = 0.35 + 0.65 * Math.pow(Math.cos((t / hs) * (Math.PI / 2)), 2);
        const depthTaper = 1.0 - depthFrac * 0.65; // narrow toward tail tip
        const tubeR      = baseTubeR * arcTaper * depthTaper;
        const rho        = Math.sqrt(Math.random()) * tubeR;
        const phi        = Math.random() * 2 * Math.PI;

        // Offset the particle backward in Y (local propagation axis)
        pos.push(
          cx + rho * Math.cos(phi) * Nx,
          cy + rho * Math.cos(phi) * Ny + depthY,
          rho * Math.sin(phi)
        );
      }
      const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size: getCmeParticleSize(cme.speed, SCENE_SCALE), sizeAttenuation: true, map: pt, transparent: true, opacity: getCmeOpacity(cme.speed), blending: THREE.AdditiveBlending, depthWrite: false, color: getCmeCoreColor(cme.speed) });
      const system = new THREE.Points(geom, mat); system.userData = cme;
      const dir = new THREE.Vector3(); dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      system.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cmeGroupRef.current.add(system);
    });
  }, [cmeData, getClockElapsedTime, threeReady]);

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
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime, threeReady]);

  // ── Rebuild CH/HSS geometry when fresh SUVI data arrives ─────────────────
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !chGroupRef.current || !hssGroupRef.current) return;

    const clearGroup = (group: any) => {
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        child.geometry?.dispose?.();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose?.());
          else child.material.dispose?.();
        }
      }
    };

    clearGroup(chGroupRef.current);
    clearGroup(hssGroupRef.current);

    const sunR     = PLANET_DATA_MAP.SUN.size;
    const hssReach = PLANET_DATA_MAP.EARTH.radius * 1.65;
    coronalHoles.forEach(ch => {
      chGroupRef.current.add(buildChSurfaceMesh(THREE, ch, sunR));
      chGroupRef.current.add(buildChOutlineLine(THREE, ch, sunR));
      hssGroupRef.current.add(buildParkerSpiralMesh(THREE, ch, sunR, hssReach, 0));
      const anchor = buildChLabelAnchor(THREE, ch, sunR);
      chGroupRef.current.add(anchor);
    });

    // Re-emit updated label list including new CH anchors
    // Walk up to find the sunMesh (chGroup is a child of sunMesh)
    const sunMesh = chGroupRef.current.parent;
    if (sunMesh && setPlanetLabelsRef.current) {
      const existingLabels: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];
      // Re-add planet labels from celestialBodiesRef if accessible
      coronalHoles.forEach(ch => {
        const anchor = chGroupRef.current.getObjectByName(`ch-label-anchor-${ch.id}`);
        if (anchor) existingLabels.push({ id: `ch-label-${ch.id}`, name: 'Coronal Hole', mesh: anchor });
      });
      setPlanetLabelsRef.current(existingLabels);
    }
  }, [coronalHoles, threeReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const THREE = (window as any).THREE;
      if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return [];
      const ed = PLANET_DATA_MAP.EARTH; if (timelineMinDate <= 0) return [];
      const gStart = Date.now(), gEnd = gStart + 7 * 24 * 3600 * 1000, gDur = gEnd - gStart;
      const graphData = []; const ns = 200, as = 350, ad = 5;
      const wrapPi = (a: number) => {
        let v = a;
        while (v > Math.PI) v -= Math.PI * 2;
        while (v < -Math.PI) v += Math.PI * 2;
        return v;
      };
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

        // Add CH/HSS contribution when Earth intersects the rotating Parker stream.
        coronalHoles.forEach((ch) => {
          const sourceSpeed = Math.max(800, Math.min(1400, ch.estimatedSpeedKms));
          const travelSec = AU_IN_KM / sourceSpeed;
          const emissionTime = ct - travelSec * 1000;

          const sourceLon0 = THREE.MathUtils.degToRad(-ch.lon);
          const sourceAzAtEmission = sourceLon0 + SUN_ANGULAR_VELOCITY * ((emissionTime - gStart) / 1000);
          const earthAz = Math.atan2(ep.x, ep.z);

          const diff = Math.abs(wrapPi(earthAz - sourceAzAtEmission));
          const halfAngle = THREE.MathUtils.degToRad(Math.max(8, ch.expansionHalfAngleDeg ?? 10));
          const spread = halfAngle + 0.22; // stream broadens with radial distance
          if (diff < spread) {
            const x = diff / spread;
            const intensity = (1 - x * x) * (1 - x * x);
            const earthSpeed = THREE.MathUtils.mapLinear(sourceSpeed, 800, 1400, 520, 900);
            ts = Math.max(ts, as + (earthSpeed - as) * intensity);

            const densityPeak = THREE.MathUtils.mapLinear(sourceSpeed, 800, 1400, 8, 24)
              + ((ch.darkness ?? 0) * 10)
              + THREE.MathUtils.mapLinear(Math.min(60, Math.max(5, ch.widthDeg)), 5, 60, 1, 6);
            td += densityPeak * intensity;
          }
        });

        graphData.push({ time: ct, speed: ts, density: td });
      }
      return graphData;
    }
  }), [moveCamera, getClockElapsedTime, timelineMinDate, calculateDistanceWithDeceleration, cmeData, coronalHoles]);

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