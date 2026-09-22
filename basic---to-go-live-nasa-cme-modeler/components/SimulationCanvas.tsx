// --- START OF FILE SimulationCanvas.tsx ---

import { cmeDistanceAU } from '../utils/cmePropagation';
import React, { useRef, useEffect, useCallback, useImperativeHandle, useState, useMemo } from 'react';
import {
  ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle, ImpactDataPoint
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
  buildSunspotMarker,
  createGrowingStreamMesh,
  updateGrowingStreamMesh,
  GROWING_STREAM_RINGS,
  buildChLabelAnchor,
} from '../utils/coronalHoleGeometry';
import {
  processedCMEToCMEInput,
  createPropagationEngine,
  coronalHoleToHSSInput,
  type PropagationEngine,
} from '../utils/heliosphericPropagation';
import {
  type CHEvolution,
  chStateAtInFrame,
  chWasPresentAt,
  chMeasuredSpan,
  anchorEvolution,
  interpolateCHAtTimeMs,
  CH_PRESENCE_GRACE_MS,
} from '../utils/coronalHoleHistory';
import { streamParcels, unitsPerKmFor, type HoleState, type StreamSource } from '../utils/hssParcels';
import type { RegionInput } from '../utils/regionLabels';
import {
  barrierLimitsFor, barrierNote, streamSectorAt,
  type HssStreamSamples, type StreamSector,
} from '../utils/hssBarrier';
import { attachHssBarrierShader, bindHssBarrierView } from '../utils/hssBarrierShader';
import {
  resolveCmeInteractions, interactionNotes, shortCmeLabel,
  type CmeAdjustment, type CmeBody,
} from '../utils/cmeInteractions';
import type { SurfaceLabelInfo } from './SolarSurfaceLabels';
import {
  computeEclipticLongitude,
  computeGMST,
  computeMoonSceneAngle,
  EARTH_TILT_RAD,
} from '../utils/astronomicalPositions';

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

// Small empirical trim between SUVI longitudes and the photosphere texture.
// Main phase alignment is anchored to CH detection timestamp.
/**
 * How finely the CH shapes follow the timeline.
 *
 * The detector measures every couple of hours, so there is no information
 * between two frames to show. Anything finer just rebuilds the same Sun.
 */
const CH_SHAPE_QUANTUM_MS = 2 * 3600000;

/** Matches the palette the tracker numbers the holes in. */
const chLabelColour = (id: string): string => {
  const n = Number(String(id).replace(/\D/g, '')) || 0;
  return CH_LABEL_COLOURS[n % CH_LABEL_COLOURS.length];
};
const CH_LABEL_COLOURS = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', '#facc15', '#22d3ee', '#f472b6'];

const CH_HSS_LONGITUDE_VISUAL_OFFSET_DEG = -12;
const CH_HSS_LONGITUDE_VISUAL_OFFSET_RAD = CH_HSS_LONGITUDE_VISUAL_OFFSET_DEG * Math.PI / 180;

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
//    • HIGH storm potential - magnetic reconnection drives aurora
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
    vec3 northColor = vec3(0.27, 0.53, 1.0);   // #4488ff - blue
    vec3 southColor = vec3(1.0,  0.27, 0.13);   // #ff4422 - red
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

    // Arrowhead - points UP for north (+Y), DOWN for south (-Y)
    float arrowDir  = uBzSouth > 0.5 ? -1.0 : 1.0;
    float headY     = arrowDir * 0.58;
    float headDist  = arrowDir * (p.y - headY);
    float headWidth = 0.30 * headDist;
    float head = step(0.0, headDist) * step(abs(p.x), headWidth) * step(headDist, 0.38);

    float arrow = clamp(shaft + head, 0.0, 1.0);
    float pulse = 0.78 + 0.22 * sin(uTime * 2.5);

    // NO dark disc background - arrow only, fully transparent elsewhere
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
//  SPACECRAFT MARKER
// ============================================================
// The probes were single tetrahedra, which read as generic markers rather than
// as spacecraft. This builds a recognisable little satellite instead: a central
// bus, two solar panels on short booms, and a dish.
//
// Returned as a Group, which is a drop-in for the Mesh it replaces: the caller
// only sets .position and .name, attaches a PointLight, and hands it to the
// label system, all of which Object3D provides.
//
// Built around local +Z, because the animation loop calls lookAt(sun) on these,
// so +Z ends up pointing sunward. That puts the panel faces and the dish toward
// the Sun, which is how these actually fly.
const buildSpacecraftMarker = (THREE: any, size: number, color: number) => {
  const g = new THREE.Group();
  const flat = (c: number, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o });

  // Bus: the body of the spacecraft.
  const bus = new THREE.Mesh(new THREE.BoxGeometry(size * 1.1, size * 1.1, size * 1.6), flat(color));
  g.add(bus);

  // Solar panels either side, broad faces toward the Sun.
  const panelGeo = new THREE.BoxGeometry(size * 2.2, size * 1.25, size * 0.12);
  const panelMat = flat(0x2b3f6b);
  const boomGeo = new THREE.BoxGeometry(size * 0.55, size * 0.16, size * 0.16);
  const boomMat = flat(0x9aa6bb, 0.9);
  [-1, 1].forEach(sgn => {
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(sgn * size * 1.95, 0, 0);
    g.add(panel);
    const boom = new THREE.Mesh(boomGeo, boomMat);
    boom.position.set(sgn * size * 0.85, 0, 0);
    g.add(boom);
    // A couple of cell divisions so the panel does not read as a plain slab.
    for (let i = -1; i <= 1; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(size * 0.04, size * 1.25, size * 0.14), flat(0x6f7f9e, 0.8));
      rib.position.set(sgn * size * 1.95 + i * size * 0.62, 0, 0);
      g.add(rib);
    }
  });

  // Dish on the sunward face.
  const dish = new THREE.Mesh(new THREE.ConeGeometry(size * 0.62, size * 0.5, 12, 1, true), flat(0xdfe6f2, 0.95));
  dish.rotation.x = -Math.PI / 2;
  dish.position.set(0, 0, size * 1.05);
  g.add(dish);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(size * 0.1, size * 0.1, size * 0.5), boomMat);
  mast.position.set(0, 0, size * 0.85);
  g.add(mast);

  // The markers are already exaggerated relative to true scale so they are
  // visible at all. A detailed model spans far wider than the single
  // tetrahedron it replaces, so it is scaled back to sit closer to the old
  // footprint while still being readable as a spacecraft.
  g.scale.setScalar(0.55);
  return g;
};

// ============================================================
//  GCS GEOMETRY CONSTANTS
// ============================================================
const GCS_ARC_RADIUS_FRAC  = 0.55;
const GCS_ARC_SPAN         = Math.PI * 0.85;
const GCS_TUBE_RADIUS_FRAC = 0.52; // thicker cross-section for a bolder CME shape
const GCS_AXIAL_DEPTH_FRAC = 0.38;  // slightly deeper than before for teardrop body

// Number of helical field lines around the tube, and points per line
const BZ_FIELD_LINE_COUNT  = 8;
const BZ_FIELD_LINE_POINTS = 120;

const getCmeOpacity      = (speed: number) => { const T = (window as any).THREE; if (!T) return 0.22; return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.06, 0.65); };
const getCmeParticleCount = (speed: number) => { const T = (window as any).THREE; if (!T) return 4000; return Math.floor(T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 1500, 7000)); };
const getCmeParticleSize  = (speed: number, scale: number) => { const T = (window as any).THREE; if (!T) return 0.05 * scale; return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.04 * scale, 0.08 * scale); };
const getCmeCoreColor     = (speed: number) => {
  const T = (window as any).THREE; if (!T) return { setHex: () => {} };

  const clamped = T.MathUtils.clamp(speed, 0, 3000);
  const stops = [
    { speed: 0, color: new T.Color(0x808080) },
    { speed: 350, color: new T.Color(0x808080) },
    { speed: 500, color: new T.Color(0xffff00) },
    { speed: 800, color: new T.Color(0xffa500) },
    { speed: 1000, color: new T.Color(0xff4500) },
    { speed: 1800, color: new T.Color(0x9370db) },
    { speed: 2500, color: new T.Color(0xff69b4) },
    { speed: 3000, color: new T.Color(0xff69b4) },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];
    if (clamped <= end.speed) {
      const t = end.speed === start.speed
        ? 0
        : T.MathUtils.mapLinear(clamped, start.speed, end.speed, 0, 1);
      return start.color.clone().lerp(end.color, t);
    }
  }

  return stops[stops.length - 1].color.clone();
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ============================================================
//  BUILD BZ FIELD LINE GEOMETRY
//
//  Creates one helical Points object for field line `lineIndex`.
//  The helix wraps around the GCS croissant arc tube in normalised
//  local space - the same space as the CME particle geometry.
//
//  Each point carries custom attributes used by the vertex shader:
//    aAlong - normalised arc position [0..1] (drives animation travel)
//    aAngle - current angle around the tube cross-section
//    aPhase - per-line phase offset (staggers the animated pulses)
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

    // Arc centreline (identical formula to particle geometry - belly faces +Y)
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
  /** true = southward Bz (RED - high storm risk), false = northward (BLUE - low risk) */
  bzSouth?: boolean;
  /** Whether the Parker-spiral HSS stream arms are visible */
  showHss: boolean;
  /** Live coronal holes from SUVI detector - rebuilt whenever this changes */
  coronalHoles: CoronalHole[];
  /** SUVI analysis time for the current CH detections (ms since epoch) */
  chDetectedAtMs?: number | null;
  /**
   * CH evolution tracks, which now drive the shape rather than sitting unused.
   *
   * The holes used to be drawn at their latest measured size no matter where
   * the timeline sat, so scrubbing back three days showed today's hole over
   * Tuesday's Sun. They are sized from their own history now, which is the
   * same history the coronal hole tracker draws its width chart from.
   */
  chEvolutions?: CHEvolution[];
  dataVersion: number;
  interactionMode: InteractionMode;
  onSunClick?: () => void;
  /** Latest measured solar wind speed at L1 (km/s) for DBM drag model */
  measuredWindSpeedKms?: number;
  /** Increment to force a selected-CME simulation restart. */
  rerunToken?: number;
  /** Whether the re-run CME vs HSS interaction mode is active */
  rerunHssInteraction?: boolean;
  /**
   * Experimental interactions, 3D view only: HSS streams are walls to CME
   * spread, and CMEs that meet squeeze each other.
   */
  experimentalInteractions?: boolean;
  /** NOAA active regions, drawn on the Sun when showSunspots is on. */
  sunspotRegions?: RegionInput[];
  showSunspots?: boolean;
  /** Anchors for the labels of things ON the Sun, reported as they change. */
  setSurfaceLabels?: (labels: SurfaceLabelInfo[]) => void;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData, activeView, focusTarget, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineValue,
    timelineMinDate, timelineMaxDate, setPlanetMeshesForLabels,
    setRendererDomElement, onCameraReady, getClockElapsedTime, resetClock,
    onScrubberChangeByAnim, onTimelineEnd, showExtraPlanets, showMoonL1,
    showFluxRope, bzSouth = false, showHss, coronalHoles, chDetectedAtMs = null, chEvolutions = [], dataVersion, interactionMode, onSunClick,
    sunspotRegions = [], showSunspots = false, setSurfaceLabels,
    measuredWindSpeedKms, rerunToken = 0, rerunHssInteraction = false,
    experimentalInteractions = false,
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
  // chGroupRef  - parented to sunMesh; patches rotate with the sun for free
  // hssGroupRef - world-space Parker spiral arms; vertex shader rotates per frame
  const chGroupRef     = useRef<any>(null);
  const hssGroupRef    = useRef<any>(null);
  // The growing HSS streams, and the simulation time they were last laid at.
  const hssStreamsRef = useRef<{ source: StreamSource; mesh: any }[]>([]);
  const hssStreamClockRef = useRef<number>(NaN);
  // HSS barrier notes, per CME id, written each frame and read into state a
  // couple of times a second - React has no business re-rendering per frame.
  const barrierNotesRef = useRef<Map<string, string>>(new Map());
  // CME–CME meetings for the current frame, resolved for all CMEs at once.
  const cmeInteractionsRef = useRef<Map<string, CmeAdjustment>>(new Map());
  const [barrierNotes, setBarrierNotes] = useState<string[]>([]);
  useEffect(() => {
    if (!experimentalInteractions) {
      barrierNotesRef.current.clear();
      setBarrierNotes([]);
      return;
    }
    const id = window.setInterval(() => {
      const next = Array.from(barrierNotesRef.current.entries())
        .map(([cmeId, note]) => `${shortCmeLabel(cmeId)}: ${note}`)
        .sort();
      setBarrierNotes((prev) => (prev.join('\n') === next.join('\n') ? prev : next));
    }, 500);
    return () => window.clearInterval(id);
  }, [experimentalInteractions]);
  // Parented to sunMesh alongside chGroup, so the spots turn with the Sun for
  // free rather than needing their longitude advanced every frame.
  const spotGroupRef   = useRef<any>(null);
  const hssAuRingsRef  = useRef<any>(null);
  const sunMeshRef     = useRef<any>(null);
  const sunRotationRef = useRef<number>(0);
  // Fallback anchor when CH detection timestamp is unavailable.
  const chHssAnchorSunAngleRef = useRef<number>(0);
  const chHssAnchorEarthAngleRef = useRef<number>(0);
  const starsNearRef = useRef<any>(null);
  const starsFarRef  = useRef<any>(null);

  // ── Spacecraft markers (SolO, STEREO-A, ACE, DSCOVR, IMAP, SWFO-L1) ──────
  const spacecraftGroupRef = useRef<any>(null);
  const spacecraftPositionsRef = useRef<Record<string, {x:number;y:number;z:number;name:string;color:string}>>({});
  // For each spacecraft we also store (a) its offset from Earth in the scene frame
  // at snapshot time, and (b) Earth's ecliptic longitude at that same snapshot
  // time. Each frame we rotate the stored offset by (Earth_lon_now - Earth_lon_snap)
  // around the Y axis and add it to the current Earth position. This keeps L1
  // spacecraft (ACE, DSCOVR, SWFO-L1, IMAP) locked to the Sun–Earth line as the
  // user scrubs the timeline, instead of leaving them frozen in world space.
  // For heliocentric spacecraft (SolO, STEREO-A) this is an approximation that
  // degrades slowly - far better than keeping them stationary.
  const spacecraftOffsetsRef = useRef<Record<string, { dx:number; dy:number; dz:number; snapEarthLon:number; meshName:string; isL1?:boolean; l1Lateral?:number; l1Vertical?:number }>>({});

  // ── CME–CME collision tracking ───────────────────────────────────────────
  // Stores each CME's world position and propagation data from the previous frame.
  // Used by updateCMEShape to apply visual CME–CME non-penetration physics
  // (Lugaz et al. 2017; Gopalswamy et al. 2001 cannibalism).
  // Reading from previous frame avoids order-dependent artefacts.
  const cmeFrameStatesRef = useRef<Map<string, {
    position: any;      // THREE.Vector3 - world position
    dir: any;           // THREE.Vector3 - propagation unit direction
    dist: number;       // scene-units distance from Sun centre
    speed: number;      // km/s eruption speed
    halfAngle: number;  // degrees
    latitude: number;
    longitude: number;
    scale: any;         // THREE.Vector3 - current mesh scale
  }>>(new Map());

  const timelineValueRef    = useRef(timelineValue);
  const lastTimeRef         = useRef(0);
  const raycasterRef        = useRef<any>(null);
  const mouseRef            = useRef<any>(null);
  const pointerDownTime     = useRef(0);
  const pointerDownPosition = useRef({ x: 0, y: 0 });

  const animPropsRef = useRef({
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope, bzSouth, showHss, rerunHssInteraction,
  });
  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth, showHss, rerunHssInteraction,
    };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, bzSouth, showHss, rerunHssInteraction]);

  // --- Dynamic loader: only fetches Three.js + deps when the modeler first mounts ---
  const threeLoadedRef = useRef(false);
  const [threeReady, setThreeReady] = useState(!!(window as any).THREE);
  // The scene is built inside an async callback, so it does not exist during the
  // effect pass that mounts this component. Effects that add things to the scene
  // have to wait for this rather than just for Three, or they bail once and never
  // run again when their own data happens to arrive first.
  const [sceneReady, setSceneReady] = useState(false);
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

    // OrbitControls must come after Three.js - load sequentially
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'))
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js'))
      .then(() => { threeLoadedRef.current = true; setThreeReady(true); });
  }, []);

  useEffect(() => { timelineValueRef.current = timelineValue; }, [timelineValue]);

  /**
   * The moment the CH shapes are drawn for, quantised to the detector's own
   * cadence.
   *
   * Ten minutes was far too fine. Playing a week-long timeline through in a
   * minute ticks a ten-minute bucket about fifteen times a SECOND, and each
   * tick re-triangulated every patch and rebuilt every Parker spiral - which
   * are shader meshes. The frame rate collapsed and the whole scene appeared
   * to stop moving.
   *
   * Two hours is the interval the detector actually measures at, so nothing
   * is lost: there is no new information between two frames. A signature
   * check below then skips the rebuild entirely when the holes have not
   * visibly changed, which is most ticks.
   */
  const [chShapeTimeMs, setChShapeTimeMs] = useState<number>(() => Date.now());
  const chShapeBucketRef = useRef<number>(0);
  /** What was last built, so an unchanged Sun is not rebuilt. */
  const chSignatureRef = useRef<string>('');
  /**
   * The frame the sunspot markers are placed in, fixed for the session.
   *
   * See buildSunspotMarker: reports are carried into this epoch so a stale
   * bulletin lands where the regions actually are. It must not follow the
   * clock, or every refresh would advance the markers while the Sun advanced
   * underneath them.
   */
  const spotEpochRef = useRef<number>(Date.now());
  // The two surface-label sets are produced by different effects on different
  // triggers, so they are kept apart and merged on publish - otherwise
  // toggling the sunspots would silently drop the hole labels.
  const chLabelsRef = useRef<SurfaceLabelInfo[]>([]);
  const spotLabelsRef = useRef<SurfaceLabelInfo[]>([]);
  const publishSurfaceLabels = useCallback(() => {
    setSurfaceLabels?.([...chLabelsRef.current, ...spotLabelsRef.current]);
  }, [setSurfaceLabels]);

  const MIN_CME_SPEED_KMS = 300;

  // ═══════════════════════════════════════════════════════════════════════
  //  HELIOSPHERIC PROPAGATION ENGINE (Vršnak DBM + Interactions)
  // ═══════════════════════════════════════════════════════════════════════
  //
  //  This replaces the old linear deceleration model with:
  //    • Quadratic drag: a = −γ(v−w)|v−w|  (Vršnak et al. 2013)
  //    • Variable ambient wind from coronal holes
  //    • CME–CME preconditioning, compression, and cannibalism
  //    • CME–HSS interaction (modified drag in fast-wind corridors)
  //
  //  The engine is rebuilt whenever CME data or coronal holes change.
  //  Per-frame queries are O(1) via precomputed trajectory interpolation.


  const propagationEngineRef = useRef<PropagationEngine | null>(null);

  // Rebuild propagation engine when CME data or coronal holes change
  useMemo(() => {
    if (cmeData.length === 0) {
      propagationEngineRef.current = null;
      return;
    }
    const cmeInputs = cmeData.map(cme => processedCMEToCMEInput(cme));
    const hssInputs = coronalHoles.map(ch => coronalHoleToHSSInput(ch));
    propagationEngineRef.current = createPropagationEngine(cmeInputs, hssInputs, measuredWindSpeedKms);
  }, [cmeData, coronalHoles, measuredWindSpeedKms]);

  // ── Simple deceleration model (original) ─────────────────────────────────
  // Uses empirical formula: a (m/s²) = 1.41 - 0.0035 * speed_kms
  // CME decelerates until it reaches MIN_CME_SPEED_KMS, then coasts.
  const calculateDistanceWithDeceleration = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    // The maths lives in utils/cmePropagation so that anything quoting an
    // arrival time uses the same model the scene draws with.
    return cmeDistanceAU(cme.speed, timeSinceEventSeconds) * SCENE_SCALE;
  }, []);

  const calculateDistanceByInterpolation = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    if (!cme.predictedArrivalTime) return 0;
    const total = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
    if (total <= 0) return 0;
    return Math.min(1, timeSinceEventSeconds / total) * (PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE) * SCENE_SCALE;
  }, []);

  // ── updateCMEShape - angular GCS expansion + tail + live colour ───────────
  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number, _timeSinceEventSeconds?: number) => {
    const THREE = (window as any).THREE;
    if (!THREE) return;
    const sunRadius = PLANET_DATA_MAP.SUN.size;
    const tailMesh = cmeObject.userData?._tailMesh;

    if (distTraveledInSceneUnits < 0) {
      cmeObject.visible = false;
      if (tailMesh) tailMesh.visible = false;
      if (cmeObject.userData?.id) barrierNotesRef.current.delete(cmeObject.userData.id);
      return;
    }
    cmeObject.visible = true;
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    const dist = Math.max(0, distTraveledInSceneUnits - sunRadius);
    const cme: any = cmeObject.userData;

    // The old CME↔HSS squash lived here: a holdback and bend that only ever
    // reached the colour. It is replaced by the HSS barrier (below, after the
    // CME is placed), which acts on the drawn CME itself.
    let heldDist = dist;

    // The old CME↔CME holdback lived here and, like the old stream squash,
    // only ever reached the colour. CME–CME meetings are now resolved for all
    // CMEs together before any is drawn (layoutCmes) and applied below.
    const interaction = experimentalInteractions && cme.id
      ? cmeInteractionsRef.current.get(cme.id)
      : undefined;

    // Keep position physics simple and stable:
    // - location follows radial propagation distance
    // - no lateral deflection / non-penetration offsets
    const radialDist = Math.max(0, dist) + (interaction?.shift ?? 0);
    cmeObject.position.copy(dir.clone().multiplyScalar(sunRadius + radialDist));
    const lateral = Math.max(radialDist * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle ?? 30)), sunRadius * 0.3);
    const sXZ = lateral / GCS_ARC_RADIUS_FRAC;
    const totalAxialStretch = GCS_AXIAL_DEPTH_FRAC;
    cmeObject.scale.set(sXZ, sXZ * totalAxialStretch, sXZ);

    // ── Experimental interactions: stream walls + CME–CME squeeze ─────────
    // Streams are walls to the CME's spread. The centre and speed are left as
    // measured; a flank that would cross a stream is stopped at the stream's
    // edge and its particles pile up there, which the shader brightens. The
    // walls are read off the arms as drawn, at the CME's back and front
    // distances, so across the CME's depth they follow the spiral.
    //
    // Other CMEs are not walls: the caps worked out for this CME in
    // layoutCmes, where both sides of each meeting gave ground, are folded in
    // here - whichever of a stream or a CME holds a flank tighter wins.
    const hb = cmeObject.material?.userData?.hssBarrier;
    if (hb) {
      hb.uHbOn.value = 0;
      hb.uHbRadial.value.set(0, 1e9);
      const notes: string[] = [];
      if (experimentalInteractions) {
        const cmeAz = Math.atan2(dir.x, dir.z);
        const rFront = sunRadius + radialDist + lateral;
        const rBack = Math.max(sunRadius * 1.05, sunRadius + radialDist * 0.5);

        // Per flank, the cap at the front and at the back (null = free).
        let westF: number | null = null, westB: number | null = null;
        let eastF: number | null = null, eastB: number | null = null;

        const sun = sunMeshRef.current;
        const group = hssGroupRef.current;
        if (sun && group && group.visible && group.children.length > 0) {
          const groupAngle = sun.rotation.y + group.rotation.y;
          const streams: HssStreamSamples[] = group.children
            .map((m: any) => m.userData?.barrier)
            .filter(Boolean);
          const barrierCme = {
            az: cmeAz,
            lat: Math.asin(Math.max(-1, Math.min(1, dir.y))),
            halfAngle: THREE.MathUtils.degToRad(cme.halfAngle ?? 30),
          };
          const limitsAt = (R: number) => barrierLimitsFor(
            barrierCme,
            streams.map((st) => streamSectorAt(st, R, groupAngle)).filter((x): x is StreamSector => x != null),
          );
          const front = limitsAt(rFront);
          const back = limitsAt(rBack);
          if (front.westBy) westF = front.west;
          if (back.westBy) westB = back.west;
          if (front.eastBy) eastF = front.east;
          if (back.eastBy) eastB = back.east;
          const streamNote = barrierNote(front) ?? barrierNote(back);
          if (streamNote) notes.push(streamNote);
        }

        if (interaction) {
          const min = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.min(x, y));
          westF = min(westF, interaction.westCap); westB = min(westB, interaction.westCap);
          eastF = min(eastF, interaction.eastCap); eastB = min(eastB, interaction.eastCap);
          notes.push(...interactionNotes(interaction));
        }

        // A flank nothing holds is left unbounded - the shader must not trim
        // a CME that is merely wider than its nominal cone.
        const FREE = 10;
        const wallLine = (capF: number | null, capB: number | null) => {
          if (capF == null && capB == null) return [FREE, 0];
          if (capF == null || capB == null || rFront - rBack < 1e-6) return [(capF ?? capB) as number, 0];
          const slope = (capF - capB) / (rFront - rBack);
          return [capF - slope * rFront, slope];
        };
        const [wA, wB] = wallLine(westF, westB);
        const [eA, eB] = wallLine(eastF, eastB);
        const radialHeld = interaction && (interaction.frontCap != null || interaction.backCap != null);
        if (wA !== FREE || eA !== FREE || radialHeld) {
          hb.uHbOn.value = 1;
          hb.uHbAz.value = cmeAz;
          hb.uHbWest.value.set(wA, wB);
          hb.uHbEast.value.set(eA, eB);
          hb.uHbRadial.value.set(interaction?.backCap ?? 0, interaction?.frontCap ?? 1e9);
        }
      }
      if (cme.id) {
        if (notes.length) barrierNotesRef.current.set(cme.id, notes.join(' · '));
        else barrierNotesRef.current.delete(cme.id);
      }
    }

    // ── Store this CME's frame state for CME–CME checks next frame ───────
    if (rerunHssInteraction && cme.id) {
      cmeFrameStatesRef.current.set(cme.id, {
        position: cmeObject.position.clone(),
        dir: dir.clone(),
        dist: sunRadius + radialDist,
        speed: cme.speed ?? 400,
        halfAngle: cme.halfAngle ?? 30,
        latitude: Number.isFinite(cme.latitude) ? cme.latitude : 0,
        longitude: Number.isFinite(cme.longitude) ? cme.longitude : 0,
        scale: cmeObject.scale.clone(),
      });
    }

    // ── TAIL POSITIONING ─────────────────────────────────────────────────────
    // The tail back edge travels at half the front speed, so the CME elongates
    // as it propagates outward.  tailBackDist ≈ frontDist × 0.5.
    if (tailMesh) {
      const tailBackDist = radialDist * 0.5;
      const tailLength   = radialDist - tailBackDist;  // = radialDist * 0.5
      const minLen = sunRadius * 0.15;
      if (tailLength < minLen || radialDist < sunRadius * 0.3) {
        tailMesh.visible = false;
      } else {
        tailMesh.visible = cmeObject.visible;
        // Position at the tail back (closest to the sun)
        tailMesh.position.copy(dir.clone().multiplyScalar(sunRadius + tailBackDist));
        tailMesh.quaternion.copy(cmeObject.quaternion);
        // Scale: Y stretches along the propagation direction,
        // XZ 1.2× the front width so the tail spans the full croissant arc
        const tailW = sXZ * 1.2;
        tailMesh.scale.set(tailW, tailLength, tailW);
      }
    }

    // ── DISTANCE-BASED COLOUR TRANSITION ────────────────────────────────────
    // The CME starts at its eruption-speed colour near the Sun and gradually
    // shifts through lower speed tiers as it propagates outward.
    //
    // Floor speed scales with eruption speed (faster CMEs settle faster):
    //   300 km/s  → floor 300    (stays grey)
    //   500 km/s  → floor ~390   (yellow → grey-ish)
    //   1000 km/s → floor ~500   (red → orange → yellow)
    //   1800 km/s → floor ~680   (purple → red → orange)
    //   2500 km/s → floor ~800   (pink → purple → red → orange)
    //
    // By ~1 AU the front reaches its floor colour; the tail is further
    // along the deceleration curve so shows the intermediate tiers.
    if (cmeObject.material) {
      const earthDist = PLANET_DATA_MAP.EARTH.radius;
      // 0 at Sun → 1 at Earth orbit
      const distFrac = Math.min(1, heldDist / earthDist);
      // Floor speed: linear map from initial 300→2500 to floor 300→800
      const floorSpeed = 300 + (Math.min(cme.speed, 2500) - 300) / (2500 - 300) * 500;
      // Front lerps from initial speed → floor speed over Sun→Earth distance
      const frontVisualSpeed = cme.speed + (floorSpeed - cme.speed) * distFrac;
      const frontColor = getCmeCoreColor(Math.max(MIN_CME_SPEED_KMS, frontVisualSpeed));
      cmeObject.material.color.copy(frontColor);
      if (tailMesh?.material) {
        // Tail is further decelerated - 40% ahead of the front on the curve
        const tailFrac = Math.min(1, distFrac + 0.4);
        const tailVisualSpeed = cme.speed + (floorSpeed - cme.speed) * tailFrac;
        const tailColor = getCmeCoreColor(Math.max(MIN_CME_SPEED_KMS, tailVisualSpeed));
        tailMesh.material.color.copy(tailColor);
      }
    }
  }, [rerunHssInteraction, experimentalInteractions]);

  // ── layoutCmes - every CME's natural place first, then their meetings ────
  // A meeting has two sides, so it cannot be settled one CME at a time: each
  // CME's unhindered body is worked out, all the meetings are resolved
  // together, and only then is each CME drawn with its share of the squeeze.
  const layoutCmes = useCallback((placed: [any, number, number][]) => {
    const THREE = (window as any).THREE;
    if (!THREE) return;
    if (experimentalInteractions) {
      const sunRadius = PLANET_DATA_MAP.SUN.size;
      const bodies: CmeBody[] = [];
      for (const [c, d] of placed) {
        if (d < 0 || !c.visible || !c.userData?.id) continue;
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
        const radialDist = Math.max(0, d - sunRadius);
        const halfAngle = THREE.MathUtils.degToRad(c.userData.halfAngle ?? 30);
        const lateral = Math.max(radialDist * Math.tan(halfAngle), sunRadius * 0.3);
        bodies.push({
          id: c.userData.id,
          az: Math.atan2(dir.x, dir.z),
          lat: Math.asin(Math.max(-1, Math.min(1, dir.y))),
          halfAngle,
          speed: c.userData.speed ?? 400,
          rBack: sunRadius + radialDist,
          rFront: sunRadius + radialDist + lateral,
        });
      }
      cmeInteractionsRef.current = resolveCmeInteractions(bodies);
    } else if (cmeInteractionsRef.current.size) {
      cmeInteractionsRef.current = new Map();
    }
    for (const [c, d, tSec] of placed) updateCMEShape(c, d, tSec);
  }, [experimentalInteractions, updateCMEShape]);
  // The animation loop is set up once, when the scene is built, so it would
  // keep calling the layout from that first render - and never see the toggle
  // change. It calls through this ref instead, which always holds the latest.
  const layoutCmesRef = useRef(layoutCmes);
  layoutCmesRef.current = layoutCmes;

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
    // Initial camera - place directly behind Earth (Sun → Earth → Camera)
    // using today's Earth longitude. This matches the SIDE+EARTH view that
    // moveCamera animates to, avoiding a first-frame flash from the old
    // hard-coded position which could put the camera on the opposite side
    // of the Sun depending on the date.
    {
      const initLon = computeEclipticLongitude('EARTH', Date.now());
      const r = PLANET_DATA_MAP.EARTH.radius;
      const earthX = r * Math.sin(initLon);
      const earthZ = r * Math.cos(initLon);
      const behindLen = Math.hypot(earthX, earthZ) || 1;
      const behindX = earthX / behindLen; // unit vector pointing from Sun to Earth
      const behindZ = earthZ / behindLen;
      const backDistance = SCENE_SCALE * 0.22;
      camera.position.set(
        earthX + behindX * backDistance,
        SCENE_SCALE * 0.02,
        earthZ + behindZ * backDistance
      );
      camera.lookAt(0, 0, 0);
    }
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
    setSceneReady(true);

    // Legacy torus - kept for import compatibility, hidden by default
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

    // Photosphere overlay - child of sunMesh so it rotates with the sun
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
    const spotGroup = new THREE.Group(); spotGroup.name = 'sunspot-regions'; sunMesh.add(spotGroup);
    const hssAuRings = new THREE.Group(); hssAuRings.name = 'hss-au-rings'; scene.add(hssAuRings);
    chGroupRef.current  = chGroup;
    hssGroupRef.current = hssGroup;
    spotGroupRef.current = spotGroup;
    hssAuRingsRef.current = hssAuRings;
    chHssAnchorSunAngleRef.current = sunRotationRef.current;
    {
      const earth = celestialBodiesRef.current.EARTH?.mesh;
      if (earth) {
        const earthPos = new THREE.Vector3();
        earth.getWorldPosition(earthPos);
        chHssAnchorEarthAngleRef.current = Math.atan2(earthPos.x, earthPos.z);
      }
    }

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
    props.coronalHoles.forEach(ch => {
      chGroup.add(buildChSurfaceMesh(THREE, ch, sunR));
      chGroup.add(buildChOutlineLine(THREE, ch, sunR));
      // Streams are built from the holes' history in their own effect.
    });

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // ── Planets ──────────────────────────────────────────────────────────────
    // Initial placement uses NOW so the scene opens with today's real geometry.
    // The animation loop then updates positions every frame from simulationTimeMs.
    const initTimeMs = Date.now();
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;
      const pm = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), new THREE.MeshPhongMaterial({ color: data.color, shininess: 30 }));

      // ── Real ecliptic longitude from Keplerian elements ─────────────────
      const lon = computeEclipticLongitude(name, initTimeMs);
      pm.position.set(data.radius * Math.sin(lon), 0, data.radius * Math.cos(lon));
      pm.userData = { ...data, _initLon: lon };

      scene.add(pm); celestialBodiesRef.current[name] = { mesh: pm, name: data.name, labelId: data.labelElementId, userData: pm.userData };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: pm });
      if (name === 'EARTH') {
        pm.material = new THREE.MeshPhongMaterial({ map: tex.earthDay, normalMap: tex.earthNormal, specularMap: tex.earthSpec, specular: new THREE.Color(0x111111), shininess: 6 });
        // Axial tilt - Earth's spin axis tilts 23.44° toward ecliptic north.
        // We tilt the mesh around the X axis so the poles point in the right direction.
        pm.rotation.z = EARTH_TILT_RAD;
        // Initial sidereal rotation so prime meridian faces the correct direction.
        pm.rotation.y = computeGMST(initTimeMs);
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
      // Real Moon angle (geocentric, relative to Earth in scene ecliptic XZ plane)
      const moonInitAngle = name === 'MOON' ? computeMoonSceneAngle(initTimeMs) : (data.angle ?? 0);
      mm.position.set(data.radius * Math.sin(moonInitAngle), 0, data.radius * Math.cos(moonInitAngle));
      mm.userData = { ...data, _initAngle: moonInitAngle };
      parent.mesh.add(mm); celestialBodiesRef.current[name] = { mesh: mm, name: data.name, labelId: data.labelElementId, userData: mm.userData };
      if (name === 'MOON' && !planetLabelInfos.find(p => p.name === 'Moon')) planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: mm });
      const mp = []; for (let i = 0; i <= 64; i++) mp.push(new THREE.Vector3(Math.sin((i / 64) * Math.PI * 2) * data.radius, 0, Math.cos((i / 64) * Math.PI * 2) * data.radius));
      const mo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 64, 0.003 * SCENE_SCALE, 8, true), new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 })); mo.name = 'moon-orbit'; parent.mesh.add(mo);
    });
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const pm = new THREE.Mesh(new THREE.TetrahedronGeometry(data.size, 0), new THREE.MeshBasicMaterial({ color: data.color })); pm.userData = data; scene.add(pm);
      celestialBodiesRef.current[name] = { mesh: pm, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: pm });
    });

    // ── Spacecraft markers ────────────────────────────────────────────────────
    // SolO, STEREO-A, ACE, DSCOVR, IMAP, SWFO-L1 - small glowing tetrahedra.
    // Positions are fetched from the solo-worker and updated in a useEffect.
    const scGroup = new THREE.Group(); scGroup.name = 'spacecraft'; scene.add(scGroup);
    spacecraftGroupRef.current = scGroup;

    // Fetch spacecraft positions from the solo-worker (non-blocking).
    fetch('https://solo-worker.thenamesrock.workers.dev/solo/position')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ok || !data.positions) return;
        const { positions } = data;
        // Snapshot time - when the worker computed these positions. If the
        // worker returns a `time` field (ISO string or ms), use it; otherwise
        // fall back to now, which is what the worker normally computes for.
        const snapTimeMs = (() => {
          const t = data.time ?? data.timestamp ?? data.epoch;
          if (typeof t === 'number' && Number.isFinite(t)) {
            return t > 1e12 ? t : t * 1000; // seconds -> ms if needed
          }
          if (typeof t === 'string') {
            const parsed = Date.parse(t);
            if (!Number.isNaN(parsed)) return parsed;
          }
          return Date.now();
        })();
        // Earth's scene-frame position at the snapshot time. We need this to
        // convert each spacecraft's absolute scene-frame position into an
        // Earth-relative offset, so we can re-attach it to Earth each frame.
        const snapEarthLon = computeEclipticLongitude('EARTH', snapTimeMs);
        const snapEarthRadius = PLANET_DATA_MAP.EARTH.radius;
        const snapEarthX = snapEarthRadius * Math.sin(snapEarthLon);
        const snapEarthZ = snapEarthRadius * Math.cos(snapEarthLon);
        // Spacecraft definitions. `isL1` tags those that live at the Sun–Earth
        // L1 point; for those, we ignore the worker's absolute heliocentric
        // position and instead place them on the visual Earth-to-Sun line at
        // the same exaggerated distance used by the L1 POI marker (~15M km,
        // about 10× true L1 - chosen by the app for visibility). Each L1
        // spacecraft also gets a tiny lateral + vertical offset so their
        // markers and labels don't all stack on top of each other.
        // `l1Lateral` is in scene units, perpendicular to the Earth-Sun line
        // in the ecliptic plane. `l1Vertical` is in scene units, above/below
        // the ecliptic plane.
        const VISUAL_L1_DIST = (15e6 / AU_IN_KM) * SCENE_SCALE; // matches POI_DATA_MAP.L1
        const SPACECRAFT_DEF: Array<{key:string;name:string;color:number;size:number;isL1?:boolean;l1Lateral?:number;l1Vertical?:number}> = [
          { key:'solo',    name:'SolO',     color:0xf97316, size:0.018 * SCENE_SCALE },
          { key:'stereoA', name:'STEREO-A', color:0xa78bfa, size:0.014 * SCENE_SCALE },
          // L1 cluster - spread them slightly so labels are readable.
          { key:'ace',     name:'ACE',      color:0x34d399, size:0.012 * SCENE_SCALE, isL1:true, l1Lateral: -0.018 * SCENE_SCALE, l1Vertical:  0.010 * SCENE_SCALE },
          { key:'dscovr',  name:'DSCOVR',   color:0x67e8f9, size:0.012 * SCENE_SCALE, isL1:true, l1Lateral:  0.018 * SCENE_SCALE, l1Vertical:  0.010 * SCENE_SCALE },
          { key:'imap',    name:'IMAP',     color:0xf0abfc, size:0.012 * SCENE_SCALE, isL1:true, l1Lateral: -0.018 * SCENE_SCALE, l1Vertical: -0.010 * SCENE_SCALE },
          { key:'swfoL1',  name:'SWFO-L1',  color:0xfbbf24, size:0.012 * SCENE_SCALE, isL1:true, l1Lateral:  0.018 * SCENE_SCALE, l1Vertical: -0.010 * SCENE_SCALE },
        ];
        // Clear any previously-placed markers
        while (scGroup.children.length > 0) scGroup.remove(scGroup.children[0]);
        spacecraftOffsetsRef.current = {};
        planetLabelInfos.filter(l => l.id.startsWith('sc-')).length; // noop - labels added below
        const scLabelInfos: PlanetLabelInfo[] = [];
        SPACECRAFT_DEF.forEach(({ key, name, color, size, isL1, l1Lateral, l1Vertical }) => {
          const meshName = `sc-${key}`;

          if (isL1) {
            // L1 spacecraft - ignore worker absolute position. Place at the
            // visual L1 distance sunward of Earth with small lateral/vertical
            // offsets so the cluster doesn't collapse into one pixel. The
            // animation loop will re-anchor to Earth each frame.
            // Earth-relative offset at snapshot time, in the Earth→Sun frame:
            //   "sunward" unit vector = -Earth_position_hat
            //   "lateral" unit vector = perpendicular to sunward in the ecliptic (XZ) plane
            const earthDirX = Math.sin(snapEarthLon);
            const earthDirZ = Math.cos(snapEarthLon);
            const sunwardX = -earthDirX;
            const sunwardZ = -earthDirZ;
            // Perpendicular in the ecliptic plane (rotate sunward 90° about Y axis)
            const latX =  sunwardZ;
            const latZ = -sunwardX;
            const lat = l1Lateral ?? 0;
            const vert = l1Vertical ?? 0;
            const offX = sunwardX * VISUAL_L1_DIST + latX * lat;
            const offZ = sunwardZ * VISUAL_L1_DIST + latZ * lat;
            spacecraftOffsetsRef.current[key] = {
              dx: offX,
              dy: vert,
              dz: offZ,
              snapEarthLon,
              meshName,
              isL1: true,
              l1Lateral: lat,
              l1Vertical: vert,
            };
            // Initial absolute position (animation loop will correct per frame)
            const initX = snapEarthX + offX;
            const initZ = snapEarthZ + offZ;
            spacecraftPositionsRef.current[key] = { x: initX, y: vert, z: initZ, name, color: '#' + color.toString(16).padStart(6,'0') };
            const mesh = buildSpacecraftMarker(THREE, size, color);
            mesh.position.set(initX, vert, initZ);
            mesh.name = meshName;
            const light = new THREE.PointLight(color, 0.4, size * 80);
            mesh.add(light);
            scGroup.add(mesh);
            const labelId = `sc-${key}-label`;
            scLabelInfos.push({ id: labelId, name, mesh });
            celestialBodiesRef.current[`SC_${key.toUpperCase()}`] = { mesh, name, labelId };
            return;
          }

          // Non-L1 spacecraft (SolO, STEREO-A) - use the worker's heliocentric
          // position and rotate its Earth-relative offset with Earth's orbit
          // each frame.
          const pos = positions[key]; if (!pos?.x && pos?.x !== 0) return;
          // Horizons frame → scene frame: scene_x=hY, scene_y=hZ, scene_z=hX
          const [sx, sy, sz] = [pos.y * SCENE_SCALE, pos.z * SCENE_SCALE, pos.x * SCENE_SCALE];
          spacecraftPositionsRef.current[key] = { x: sx, y: sy, z: sz, name, color: '#' + color.toString(16).padStart(6,'0') };
          spacecraftOffsetsRef.current[key] = {
            dx: sx - snapEarthX,
            dy: sy,
            dz: sz - snapEarthZ,
            snapEarthLon,
            meshName,
          };
          const mesh = buildSpacecraftMarker(THREE, size, color);
          mesh.position.set(sx, sy, sz);
          mesh.name = meshName;
          const light = new THREE.PointLight(color, 0.4, size * 80);
          mesh.add(light);
          scGroup.add(mesh);
          const labelId = `sc-${key}-label`;
          scLabelInfos.push({ id: labelId, name, mesh });
          celestialBodiesRef.current[`SC_${key.toUpperCase()}`] = { mesh, name, labelId };
        });
        setPlanetMeshesForLabels([...planetLabelInfos, ...scLabelInfos]);
      })
      .catch(() => {/* worker unavailable - spacecraft markers silently absent */});

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

      // ── simulationTimeMs: the authoritative simulation epoch ─────────────
      // Used for planet positions, Earth rotation, Moon, and Sun rotation.
      const simulationTimeMs = (timelineActive && timelineMaxDate > timelineMinDate)
        ? timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000)
        : Date.now();

      // The CH shapes follow the same epoch, at the detector's cadence.
      const chBucket = Math.floor(simulationTimeMs / CH_SHAPE_QUANTUM_MS);
      if (chBucket !== chShapeBucketRef.current) {
        chShapeBucketRef.current = chBucket;
        setChShapeTimeMs(chBucket * CH_SHAPE_QUANTUM_MS);
      }

      // ── Real planet positions from simulationTimeMs ─────────────────────
      // All planets except Earth move per simulationTimeMs (timeline-synced
      // wall-clock epoch). Earth is driven separately below because it also
      // needs axial tilt and GMST sidereal rotation.
      // Moon is handled after Earth so it inherits Earth's world position.
      const PLANETS_TO_UPDATE = ['MERCURY','VENUS','MARS','JUPITER','SATURN','URANUS','NEPTUNE'];
      PLANETS_TO_UPDATE.forEach(name => {
        const body = celestialBodiesRef.current[name]; if (!body) return;
        const d = body.userData as PlanetData;
        const lon = computeEclipticLongitude(name, simulationTimeMs);
        body.mesh.position.set(d.radius * Math.sin(lon), 0, d.radius * Math.cos(lon));
      });

      const l1 = celestialBodiesRef.current['L1'], eb = celestialBodiesRef.current['EARTH'];
      if (l1 && eb) { const p = new THREE.Vector3(); eb.mesh.getWorldPosition(p); const d = p.clone().normalize(); l1.mesh.position.copy(p.clone().sub(d.multiplyScalar((l1.userData as POIData).distanceFromParent))); l1.mesh.lookAt(p); }

      if (celestialBodiesRef.current.SUN) (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsedTime;

      // ── Solar rotation / timeline sync ───────────────────────────────────
      // Use one absolute-time model in both live and timeline modes.
      // This avoids phase jumps when toggling timeline play/pause.
      sunRotationRef.current = SUN_ANGULAR_VELOCITY * (simulationTimeMs / 1000);
      if (sunMeshRef.current) sunMeshRef.current.rotation.y = sunRotationRef.current;

      // ── Coronal-hole patches follow solar rotation ────────────────────────
      // CH patches are children of sunMesh, so they should inherit the Sun's
      // rotation directly and move across the visible disk with the texture.
      //
      // CH longitudes from SUVI are Earth-facing at detection time.
      // Anchor CH/HSS using the CH detection timestamp to keep placement
      // stable when the timeline starts/plays from different epochs.
      // The CH patches are NOT re-anchored here any more.
      //
      // This line recomputed their rotation every frame from Earth's LIVE
      // orbital angle and the detection timestamp, so the group was being
      // counter-rotated against the Sun it is parented to - the holes hung in
      // space while the surface turned under them. The sunspot markers, which
      // do move correctly, are children of the same sunMesh and simply never
      // have their group rotation touched. The patches now work the same way:
      // a constant anchor set once at rebuild, plus whatever the Sun does.
      //
      // The HSS streams are anchored the same way now (see the streams
      // effect). They used to follow Earth's live orbital angle, which moves
      // with the timeline, so the whole spiral slid as the clock ran.

      // ── HSS streams - re-laid from their wind as the clock moves ─────────
      // A minute of simulation time moves the wind a few thousand km, which
      // is nothing on screen; re-laying every frame would be wasted work.
      if (showHss && hssStreamsRef.current.length > 0
          && !(Math.abs(simulationTimeMs - hssStreamClockRef.current) < 60000)) {
        hssStreamClockRef.current = simulationTimeMs;
        const sunR = PLANET_DATA_MAP.SUN.size;
        const reach = PLANET_DATA_MAP.EARTH.radius * 1.65;
        for (const { source, mesh } of hssStreamsRef.current) {
          updateGrowingStreamMesh(THREE, mesh, streamParcels(source, {
            nowMs: simulationTimeMs,
            count: GROWING_STREAM_RINGS,
            r0: sunR * 1.018,
            reach,
            unitsPerKm: unitsPerKmFor(SCENE_SCALE),
            omega: SUN_ANGULAR_VELOCITY,
          }), sunR, reach);
        }
      }

      // ── HSS - visibility + per-frame uniform updates ──────────────────────
      if (hssGroupRef.current) {
        hssGroupRef.current.visible = showHss;
        hssGroupRef.current.children.forEach((child: any) => {
          const u = child.material?.uniforms;
          if (!u) return;
          // hssGroup inherits the sun rotation, so shader rotation stays at 0.
          if (u.uSunAngle !== undefined) u.uSunAngle.value = 0;
          if (u.uTime    !== undefined) u.uTime.value    = elapsedTime;
        });
      }
      if (hssAuRingsRef.current) hssAuRingsRef.current.visible = showHss;

      if (celestialBodiesRef.current.EARTH) {
        const e = celestialBodiesRef.current.EARTH.mesh;
        // ── Real heliocentric orbital position (ecliptic longitude) ────────
        const earthLon = computeEclipticLongitude('EARTH', simulationTimeMs);
        const earthData = PLANET_DATA_MAP.EARTH;
        e.position.set(
          earthData.radius * Math.sin(earthLon),
          0,
          earthData.radius * Math.cos(earthLon)
        );
        // ── Real axial tilt (fixed - the tilt is baked into rotation.z at init)
        // ── Real sidereal rotation (GMST drives rotation.y) ─────────────────
        // Earth spins ~360° per sidereal day. GMST gives the absolute angle of
        // the prime meridian relative to the J2000 vernal equinox direction.
        // We freeze it when the timeline is paused so users can inspect.
        if (!timelineActive || timelinePlaying) {
          e.rotation.y = computeGMST(simulationTimeMs);
          const c = e.children.find((c: any) => c.name === 'clouds');
          if (c) c.rotation.y = computeGMST(simulationTimeMs) + (elapsedTime * 0.008);
        }
        e.children.forEach((ch: any) => { if (ch.material?.uniforms?.uTime) ch.material.uniforms.uTime.value = elapsedTime; });

        // ── Moon position - geocentric angle relative to Earth ───────────────
        const moon = celestialBodiesRef.current['MOON'];
        if (moon) {
          const moonAngle = computeMoonSceneAngle(simulationTimeMs);
          const moonData = moon.userData as PlanetData;
          moon.mesh.position.set(
            moonData.radius * Math.sin(moonAngle),
            0,
            moonData.radius * Math.cos(moonAngle)
          );
          // Tidally locked: Moon's rotation.y = moonAngle so same face always toward Earth
          moon.mesh.rotation.y = moonAngle + Math.PI;
        }
      }

      // ── Spacecraft position update ────────────────────────────────────────
      // The solo-worker gives us absolute heliocentric positions at a single
      // snapshot time. Leaving those positions frozen in world space causes
      // L1 spacecraft (ACE, DSCOVR, SWFO-L1, IMAP) to appear detached from
      // Earth whenever the user scrubs the timeline. To fix that, at snapshot
      // time we recorded each spacecraft's offset from Earth and Earth's
      // ecliptic longitude. Each frame we rotate that offset by the change in
      // Earth's longitude between snapshot time and simulation time, then
      // re-anchor it to Earth's current scene position.
      //
      // For L1 spacecraft this is essentially exact - L1 is on the Sun–Earth
      // line by construction, so rotating the offset with Earth's orbit keeps
      // them locked in place relative to Earth. For heliocentric spacecraft
      // (SolO, STEREO-A) it's an approximation, but far better than leaving
      // them stationary while Earth orbits around them.
      const scGroupLocal = spacecraftGroupRef.current;
      const earthForSc = celestialBodiesRef.current.EARTH?.mesh;
      const scOffsets = spacecraftOffsetsRef.current;
      if (scGroupLocal && earthForSc && scOffsets) {
        const earthLonNow = computeEclipticLongitude('EARTH', simulationTimeMs);
        const earthPosNow = new THREE.Vector3();
        earthForSc.getWorldPosition(earthPosNow);
        for (const key in scOffsets) {
          const off = scOffsets[key];
          const mesh = scGroupLocal.children.find((m: any) => m.name === off.meshName);
          if (!mesh) continue;
          // Rotate (dx, dz) in the XZ plane by Δlon around the Y axis. Earth is
          // placed via (sin(lon), 0, cos(lon)) so increasing longitude rotates
          // +X toward -Z. The rotation matrix for a vector (x, z) about the Y
          // axis by angle θ (using the same sin/cos convention) is:
          //     x' = x·cos(θ) + z·sin(θ)
          //     z' = -x·sin(θ) + z·cos(θ)
          const dLon = earthLonNow - off.snapEarthLon;
          const cosD = Math.cos(dLon);
          const sinD = Math.sin(dLon);
          const rx = off.dx * cosD + off.dz * sinD;
          const rz = -off.dx * sinD + off.dz * cosD;
          mesh.position.set(earthPosNow.x + rx, earthPosNow.y + off.dy, earthPosNow.z + rz);
          // Panels and dish face the Sun, which is where they point in reality.
          mesh.lookAt(0, 0, 0);
        }
      }

      cmeGroupRef.current.children.forEach((c: any) => {
        if (c.userData?._isTail) return; // tails are managed by updateCMEShape
        if (c.material) {
          const engine = propagationEngineRef.current;
          if (engine && engine.isCannibalized(c.userData.id)) {
            c.material.opacity = Math.max(0, c.material.opacity - 0.02);
            if (c.material.opacity <= 0.01) { c.visible = false; if (c.userData._tailMesh) c.userData._tailMesh.visible = false; return; }
            if (c.userData._tailMesh?.material) c.userData._tailMesh.material.opacity = c.material.opacity * 0.55;
          } else {
            c.material.opacity = getCmeOpacity(c.userData.speed);
            if (c.userData._tailMesh?.material) c.userData._tailMesh.material.opacity = getCmeOpacity(c.userData.speed) * 0.55;
          }
        }
      });

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
        const placed: [any, number, number][] = [];
        cmeGroupRef.current.children.forEach((c: any) => { if (c.userData?._isTail) return; const s = (t - c.userData.startTime.getTime()) / 1000; placed.push([c, s < 0 ? -1 : calculateDistanceWithDeceleration(c.userData, s), s < 0 ? 0 : s]); });
        layoutCmesRef.current(placed);
      } else {
        const placed: [any, number, number][] = [];
        cmeGroupRef.current.children.forEach((c: any) => {
          if (c.userData?._isTail) return; // tails are managed by updateCMEShape
          let d = 0; let tSec = 0;
          if (currentlyModeledCMEId && c.userData.id === currentlyModeledCMEId) {
            const cme = c.userData, t = elapsedTime - (cme.simulationStartTime ?? elapsedTime);
            tSec = t < 0 ? 0 : t;
            d = (cme.isEarthDirected && cme.predictedArrivalTime) ? calculateDistanceByInterpolation(cme, tSec) : calculateDistanceWithDeceleration(cme, tSec);
          } else if (!currentlyModeledCMEId) {
            const t = (Date.now() - c.userData.startTime.getTime()) / 1000;
            tSec = t < 0 ? 0 : t;
            d = calculateDistanceWithDeceleration(c.userData, tSec);
          } else { placed.push([c, -1, 0]); return; }
          placed.push([c, d, tSec]);
        });
        layoutCmesRef.current(placed);
      }

      // Legacy torus hidden - superseded by Bz field lines
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
        bzIndicatorRef.current.visible = false;
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
      rendererRef.current = null; setRendererDomElement(null); onCameraReady(null); setSceneReady(false);
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

      const backDepthFrac = 0.70; // tail extends only 70% of arcR behind the arc - prevents particles going through the sun
      // Split particles: ~65% in the main croissant arc, ~35% in the tail depth
      const mainCount = Math.floor(pCount * 0.65);
      const tailCount = pCount - mainCount;

      // Main arc particles - stadium/pill profile: full thickness body with rounded caps at the tips.
      for (let i = 0; i < mainCount; i++) {
        const t  = (Math.random() * 2 - 1) * hs;
        const cx = arcR * Math.sin(t), cy = arcR * (Math.cos(t) - 1);
        const Nx = -Math.sin(t), Ny = -Math.cos(t);

        // Stadium shape: hold near-full width through the body, then round off
        // the last ~30% of the arc into a smooth semicircular cap.
        const tNorm = Math.abs(t / hs);
        const capStart = 0.70; // body runs from 0→capStart at full width
        let taper: number;
        if (tNorm <= capStart) {
          // Slight front-to-back thickness gradient so it still reads as a CME
          taper = 1.0 - 0.18 * (tNorm / capStart);
        } else {
          // Semicircular cap - radius follows sqrt(1 - u²) for a true round end
          const u = (tNorm - capStart) / (1.0 - capStart);
          taper = 0.82 * Math.sqrt(Math.max(0, 1 - u * u));
        }
        taper = Math.max(taper, 0.06);

        const tubeR = baseTubeR * taper;
        const rho   = Math.sqrt(Math.random()) * tubeR;
        const phi   = Math.random() * 2 * Math.PI;
        pos.push(cx + rho * Math.cos(phi) * Nx, cy + rho * Math.cos(phi) * Ny, rho * Math.sin(phi));
      }

      // Tail particles - converge toward a single apex so whole CME reads teardrop.
      // Clamped so no particle travels back through the sun (local Y must stay >= 0).
      for (let i = 0; i < tailCount; i++) {
        const t  = (Math.random() * 2 - 1) * hs;
        const cx = arcR * Math.sin(t), cy = arcR * (Math.cos(t) - 1);
        const Nx = -Math.sin(t), Ny = -Math.cos(t);

        const depthFrac = Math.pow(Math.random(), 2.1); // strong front bias
        const depthCurve = Math.pow(depthFrac, 1.55);
        const depthY = -depthCurve * backDepthFrac * arcR;

        // As depth increases, collapse lateral span toward a centerline apex.
        const toApex = Math.pow(depthFrac, 1.15);
        const apexX = 0;
        const apexY = -arcR * 1.10;
        const tailCx = cx * (1 - toApex) + apexX * toApex;
        const tailCy = cy * (1 - toApex) + apexY * toApex;

        const arcTaper = 0.25 + 0.75 * Math.pow(1 - Math.abs(t / hs), 1.9);
        const depthTaper = Math.max(0.10, 1.0 - Math.pow(depthFrac, 0.72) * 0.90);
        const apexTaper = Math.max(0.08, 1.0 - toApex * 0.94);
        const tubeR = baseTubeR * arcTaper * depthTaper * apexTaper;
        const rho   = Math.sqrt(Math.random()) * tubeR;
        const phi   = Math.random() * 2 * Math.PI;

        const py = tailCy + rho * Math.cos(phi) * Ny + depthY;
        // Hard clamp - no particle goes behind the sun (local Y = 0 is the sun centre)
        if (py < 0) continue;
        pos.push(
          tailCx + rho * Math.cos(phi) * Nx,
          py,
          rho * Math.sin(phi)
        );
      }
      const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size: getCmeParticleSize(cme.speed, SCENE_SCALE), sizeAttenuation: true, map: pt, transparent: true, opacity: getCmeOpacity(cme.speed), blending: THREE.AdditiveBlending, depthWrite: false, color: getCmeCoreColor(cme.speed) });
      const barrierUniforms = attachHssBarrierShader(THREE, mat);
      const system = new THREE.Points(geom, mat); system.userData = { ...cme };
      bindHssBarrierView(system, barrierUniforms);

      // ── TAIL PARTICLE SYSTEM ─────────────────────────────────────────────
      // Particles distributed from Y=0 (back, near sun) to Y=1 (front, near CME head).
      // Conical taper: wider at the CME-head end, narrower toward the sun.
      // updateCMEShape scales/positions this so the tail back travels at half the front speed.
      const tailParticleCount = Math.floor(getCmeParticleCount(cme.speed) * 0.5);
      const tailPos: number[] = [];
      for (let i = 0; i < tailParticleCount; i++) {
        // Y from 0 (back) to 1 (front) with bias toward the front (near the CME head)
        const yNorm = Math.pow(Math.random(), 1.4);
        // Full-width spread matching the CME front arc extent (~0.82 in normalised space).
        // Tapers from ~0.15 at the sun-ward back to ~0.80 at the CME-head end.
        const spread = 0.15 + 0.65 * yNorm;
        const rho = Math.sqrt(Math.random()) * spread;
        const phi = Math.random() * 2 * Math.PI;
        tailPos.push(
          rho * Math.cos(phi),  // X
          yNorm,                // Y (0→1, stretched by scale in updateCMEShape)
          rho * Math.sin(phi)   // Z
        );
      }
      const tailGeom = new THREE.BufferGeometry();
      tailGeom.setAttribute('position', new THREE.Float32BufferAttribute(tailPos, 3));
      const tailMat = new THREE.PointsMaterial({
        size: getCmeParticleSize(cme.speed, SCENE_SCALE) * 0.72,
        sizeAttenuation: true, map: pt, transparent: true,
        opacity: getCmeOpacity(cme.speed) * 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
        color: getCmeCoreColor(cme.speed)
      });
      // The tail shares the front's walls, so the two cannot disagree.
      const tailUniforms = { ...barrierUniforms, uHbRadial: { value: new THREE.Vector2(0, 1e9) } };
      attachHssBarrierShader(THREE, tailMat, tailUniforms);
      const tailSystem = new THREE.Points(tailGeom, tailMat);
      bindHssBarrierView(tailSystem, tailUniforms);
      tailSystem.userData = { _isTail: true, _parentCmeId: cme.id };
      tailSystem.visible = false; // hidden until CME propagates far enough

      // Link the tail to the front so updateCMEShape can find it
      system.userData._tailMesh = tailSystem;

      // Stonyhurst longitude 0° = toward Earth at eruption time.
      // Offset by Earth's true ecliptic longitude so the CME points
      // in the correct absolute direction in the scene.
      const earthLonAtEruption = computeEclipticLongitude('EARTH', cme.startTime.getTime());
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - cme.latitude),
        earthLonAtEruption + THREE.MathUtils.degToRad(cme.longitude)
      );
      system.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tailSystem.quaternion.copy(system.quaternion);
      cmeGroupRef.current.add(system);
      cmeGroupRef.current.add(tailSystem);
    });
  }, [cmeData, getClockElapsedTime, threeReady, sceneReady]);

  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!cmeGroupRef.current) return;

    // ── Normal (non-staged) CME selection/reset ──────────────────────────────
    cmeGroupRef.current.children.forEach((cm: any) => {
      if (cm.userData?._isTail) {
        cm.visible = !currentlyModeledCMEId || cm.userData._parentCmeId === currentlyModeledCMEId;
        return;
      }
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
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime, threeReady, sceneReady, rerunToken, rerunHssInteraction]);

  // ── Reset staged rerun state when the mode is turned off ─────────────────
  useEffect(() => {
    if (!rerunHssInteraction) {
      // Clear CME–CME collision tracking state
      cmeFrameStatesRef.current.clear();
      // Restore CH/HSS opacities to full
      if (chGroupRef.current) {
        chGroupRef.current.children.forEach((child: any) => {
          if (child.material) {
            child.material.opacity = 1;
            child.material.transparent = false;
          }
        });
      }
      if (hssGroupRef.current) {
        hssGroupRef.current.children.forEach((child: any) => {
          if (child.material && !child.material.uniforms) {
            child.material.opacity = 1;
            child.material.transparent = true; // HSS shaders are always transparent
          }
        });
      }
    }
  }, [rerunHssInteraction]);

  // ── Rebuild CH/HSS geometry when fresh SUVI data arrives ─────────────────
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !chGroupRef.current || !hssGroupRef.current) return;

    // NOTE: the HSS fallback anchor used to be re-captured here.
    //
    // It belongs to fresh SUVI data, and this effect only ran on fresh SUVI
    // data - until the shape clock was added to its dependencies, at which
    // point a capture that happened a few times a day started happening every
    // two simulated hours of scrubbing. Each capture re-read the CURRENT sun
    // angle, so the fallback phase became "wherever the Sun is right now",
    // which cancels the Sun's own rotation: the holes reset their progress on
    // every tick and hung in space while the surface turned under them. It is
    // captured in its own effect below, on detection changes only.

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

    const sunR     = PLANET_DATA_MAP.SUN.size;
    // ── The Sun as it was at the moment on the scrubber ──────────────────
    //
    // Three separate things have to be true of a hole for the timeline to be
    // showing history rather than today's holes on an older Sun: it has to
    // have EXISTED then, be the SIZE it was then, and be WHERE it was then.
    // Only the second of those was true before this.
    //
    // Longitude needs care. The group is a child of sunMesh and its rotation
    // is anchored to chDetectedAtMs, so solar rotation is already applied -
    // what goes into the geometry has to be in that same anchor frame, or the
    // Sun's turn is counted twice. chStateAtInFrame carries every snapshot
    // into the anchor frame BEFORE interpolating, which is the part that has
    // to happen first: carrying the interpolated result instead has a seam
    // outside the track, where the longitude pins and stops advancing while
    // the correction keeps growing - and that froze the holes in space while
    // the Sun rotated underneath them.
    const anchorMs = chDetectedAtMs ?? Date.now();

    // The patch group's own rotation, set once here rather than every frame.
    //
    // It maps "Stonyhurst longitude at the anchor moment" into the Sun's own
    // frame at that moment, so a hole measured facing Earth is drawn facing
    // Earth. Being a constant, everything after it is the Sun's rotation and
    // nothing else - which is exactly how the sunspot markers behave, and
    // they turn correctly.
    if (chGroupRef.current) {
      chGroupRef.current.rotation.y =
        CH_HSS_LONGITUDE_VISUAL_OFFSET_RAD
        + computeEclipticLongitude('EARTH', anchorMs)
        - SUN_ANGULAR_VELOCITY * (anchorMs / 1000);
    }
    const baseById = new Map(coronalHoles.map((ch) => [ch.id, ch]));
    const drawn: { ch: any; scale: number }[] = [];

    for (const evolution of chEvolutions) {
      if (!chWasPresentAt(evolution, chShapeTimeMs)) continue;
      const at = chStateAtInFrame(evolution, chShapeTimeMs, anchorMs);
      if (!at) continue;

      // The outline comes from a live detection where there is one, because
      // only those carry a polygon; a hole that has since closed falls back
      // to the last shape the track kept.
      const base = baseById.get(evolution.trackId) ?? evolution.current;
      if (!base) continue;

      const measured = base.widthDeg || 1;
      drawn.push({
        ch: { ...base, lat: at.lat, lon: at.lon },
        // Scaled by width rather than area: width is what the detector
        // measures most reliably and what the speed model already keys off,
        // so the two cannot drift apart. Bounded, because one frame where the
        // detector merged two holes should not swallow the disk.
        scale: at.widthDeg > 0 ? Math.max(0.35, Math.min(2.5, at.widthDeg / measured)) : 1,
      });
    }

    // Holes the tracker has no history for yet - a first detection this
    // session - are drawn as measured. That is the old behaviour and the
    // honest one: there is nothing to interpolate.
    const haveHistory = new Set(chEvolutions.map((e) => e.trackId));
    for (const ch of coronalHoles) {
      if (!haveHistory.has(ch.id)) drawn.push({ ch, scale: 1 });
    }

    // Nothing visible changed? Then do not touch the scene.
    //
    // Rebuilding means re-triangulating every patch and rebuilding every
    // Parker spiral, which are shader meshes - far too expensive to do on a
    // tick that produces an identical Sun. Rounded, so floating-point noise
    // in an interpolation does not count as a change.
    const signature = drawn
      .map(({ ch, scale }) => `${ch.id}:${ch.lat.toFixed(1)}:${ch.lon.toFixed(1)}:${scale.toFixed(2)}`)
      .sort()
      .join('|');
    if (signature === chSignatureRef.current) return;
    chSignatureRef.current = signature;

    clearGroup(chGroupRef.current);

    const chLabels: SurfaceLabelInfo[] = [];
    drawn.forEach(({ ch, scale }) => {
      chGroupRef.current.add(buildChSurfaceMesh(THREE, ch, sunR, scale));
      chGroupRef.current.add(buildChOutlineLine(THREE, ch, sunR, scale));

      // The anchor is parented to the CH group, so it inherits the Sun's
      // rotation exactly as the patch does and the label cannot drift off it.
      const anchor = buildChLabelAnchor(THREE, ch, sunR);
      chGroupRef.current.add(anchor);
      chLabels.push({
        id: `ch-${ch.id}`,
        text: ch.id,
        mesh: anchor,
        color: chLabelColour(ch.id),
      });
    });
    chLabelsRef.current = chLabels;
    publishSurfaceLabels();
  }, [coronalHoles, chEvolutions, chShapeTimeMs, chDetectedAtMs, threeReady, sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HSS streams, grown from each hole's history ───────────────────────────
  //
  // One stream per hole the tracker has ever seen in its history, plus any
  // live hole it has no history for yet. Each starts at the hole's first
  // reading and is fed until its last (or for as long as it stays open), so
  // the animation loop can lay out exactly the wind that has been emitted by
  // the moment on the clock - see utils/hssParcels.ts.
  //
  // Anchored like the patches: positions in the fixed frame of anchorMs, and
  // the group turned so that frame faces the right way. Rebuilt only when the
  // holes or their history change; the clock just re-lays the same streams.
  useEffect(() => {
    const THREE = (window as any).THREE;
    const group = hssGroupRef.current;
    if (!THREE || !group) return;

    const anchorMs = chDetectedAtMs ?? Date.now();
    group.rotation.y =
      CH_HSS_LONGITUDE_VISUAL_OFFSET_RAD
      + computeEclipticLongitude('EARTH', anchorMs)
      - SUN_ANGULAR_VELOCITY * (anchorMs / 1000);

    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const toState = (s: ReturnType<typeof interpolateCHAtTimeMs>): HoleState | null => s && {
      lat: s.lat,
      lon: s.lon,
      widthDeg: s.widthDeg,
      heightDeg: s.heightDeg,
      darkness: s.darkness,
      // Every reading should carry one; a moderate stream if it does not.
      estimatedSpeedKms: Number.isFinite(s.estimatedSpeedKms) && s.estimatedSpeedKms > 0 ? s.estimatedSpeedKms : 550,
    };
    const opacityFor = (ch: any) => Math.min(0.85, (ch?.opacity ?? 0.5) + (ch?.darkness ?? 0) * 0.22);

    const liveIds = new Set(coronalHoles.map((ch) => ch.id));
    const streams: { source: StreamSource; mesh: any }[] = [];
    for (const evolution of chEvolutions) {
      const span = chMeasuredSpan(evolution);
      if (!span) continue;
      const anchored = anchorEvolution(evolution, anchorMs);
      streams.push({
        source: {
          firstMs: span.firstMs,
          lastMs: liveIds.has(evolution.trackId) ? null : span.lastMs + CH_PRESENCE_GRACE_MS,
          stateAt: (ms) => toState(interpolateCHAtTimeMs(anchored, ms)),
        },
        mesh: createGrowingStreamMesh(THREE, evolution.trackId, opacityFor(evolution.current)),
      });
    }
    const tracked = new Set(chEvolutions.map((e) => e.trackId));
    for (const ch of coronalHoles) {
      if (tracked.has(ch.id)) continue;
      // Measured once, at the anchor, so its longitude is already in frame.
      const state = toState({
        lat: ch.lat, lon: ch.lon, widthDeg: ch.widthDeg,
        heightDeg: ch.heightDeg ?? ch.widthDeg, darkness: ch.darkness,
        estimatedSpeedKms: ch.estimatedSpeedKms,
      });
      streams.push({
        source: { firstMs: anchorMs, lastMs: null, stateAt: () => state },
        mesh: createGrowingStreamMesh(THREE, ch.id, opacityFor(ch)),
      });
    }
    streams.forEach(({ mesh }) => group.add(mesh));
    hssStreamsRef.current = streams;
    hssStreamClockRef.current = NaN;   // lay them out on the next frame
  }, [coronalHoles, chEvolutions, chDetectedAtMs, threeReady, sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // The HSS fallback anchor, captured when a detection arrives and at no other
  // time. Anchoring is a statement about WHEN a measurement was taken, so it
  // must not be re-read on a clock that has nothing to do with measurements.
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !sceneReady) return;
    chHssAnchorSunAngleRef.current = sunRotationRef.current;
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    if (earth) {
      const earthPos = new THREE.Vector3();
      earth.getWorldPosition(earthPos);
      chHssAnchorEarthAngleRef.current = Math.atan2(earthPos.x, earthPos.z);
    }
  }, [chDetectedAtMs, coronalHoles, threeReady, sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sunspot regions ───────────────────────────────────────────────────────
  // Separate from the CH effect so toggling them does not rebuild every
  // coronal hole patch, which is the expensive half.
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !spotGroupRef.current) return;

    const group = spotGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    if (!showSunspots) {
      spotLabelsRef.current = [];
      publishSurfaceLabels();
      return;
    }

    const sunR = PLANET_DATA_MAP.SUN.size;
    const spotLabels: SurfaceLabelInfo[] = [];
    sunspotRegions.forEach((region) => {
      const marker = buildSunspotMarker(THREE, region, sunR, spotEpochRef.current);
      group.add(marker);
      spotLabels.push({
        id: `spot-${region.id}`,
        // NOAA numbers run 13000-odd but everyone says the last four.
        text: String(region.id).slice(-4),
        mesh: marker,
        color: region.color,
        minor: true,
      });
    });
    spotLabelsRef.current = spotLabels;
    publishSurfaceLabels();
  }, [sunspotRegions, showSunspots, threeReady, sceneReady]); // eslint-disable-line react-hooks/exhaustive-deps



  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    const THREE = (window as any).THREE; const gsap = (window as any).gsap;
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;
    const target = new THREE.Vector3(0, 0, 0);
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    const sun = celestialBodiesRef.current.SUN?.mesh;
    // On first mount this effect may fire before the THREE scene has had a
    // chance to add Earth and the Sun. In that case we synthesize Earth's
    // world position from today's ecliptic longitude so the initial camera
    // still lands correctly behind Earth looking toward the Sun, rather than
    // falling through to the generic side view (which would end up on the
    // far side of the Sun whenever Earth happens to be near -Z today).
    const getEarthPosFallback = (): any => {
      if (earth) { const p = new THREE.Vector3(); earth.getWorldPosition(p); return p; }
      const lon = computeEclipticLongitude('EARTH', Date.now());
      const r = PLANET_DATA_MAP.EARTH.radius;
      return new THREE.Vector3(r * Math.sin(lon), 0, r * Math.cos(lon));
    };
    const getSunPosFallback = (): any => {
      if (sun) { const p = new THREE.Vector3(); sun.getWorldPosition(p); return p; }
      return new THREE.Vector3(0, 0, 0);
    };
    if (focus === FocusTarget.EARTH) {
      // For side view, place camera behind Earth, looking toward Sun
      // (Sun -> Earth -> Camera) so CH/HSS positioning is easier to interpret.
      if (view === ViewMode.SIDE) {
        const earthPos = getEarthPosFallback();
        const sunPos = getSunPosFallback();
        target.copy(sunPos);

        const behindDir = earthPos.clone().sub(sunPos).normalize();
        const backDistance = SCENE_SCALE * 0.22;
        const pos = earthPos.clone()
          .addScaledVector(behindDir, backDistance)
          .add(new THREE.Vector3(0, SCENE_SCALE * 0.02, 0));

        gsap.to(cameraRef.current.position, { duration: 1.2, x: pos.x, y: pos.y, z: pos.z, ease: "power2.inOut" });
        gsap.to(controlsRef.current.target, { duration: 1.2, x: target.x, y: target.y, z: target.z, ease: "power2.inOut", onUpdate: () => controlsRef.current.update() });
        return;
      }
      target.copy(getEarthPosFallback());
    }
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
    calculateImpactProfile: (): ImpactDataPoint[] => {
      if (!cmeGroupRef.current) return [];

      // Always show from a few hours before now to 7 days ahead.
      // Independent of the timeline scrubber position.
      const now = Date.now();
      const gStart = now - 6 * 3600 * 1000;   // 6 hours ago
      const gEnd   = now + 7 * 24 * 3600 * 1000; // 7 days ahead
      const gDur   = gEnd - gStart;
      const ns     = 200;

      const BACKGROUND_SPEED   = 280; // km/s ambient solar wind
      const BACKGROUND_DENSITY = 5;   // cm⁻³ baseline
      const CME_PASSAGE_MS     = 18 * 3600 * 1000; // ~18h passage at 1 AU
      const earthDistScene     = PLANET_DATA_MAP.EARTH.radius;

      // ── Pre-compute CME arrival times and speeds ────────────────────────
      // For each CME, binary-search for the time it reaches Earth's distance,
      // then record the decelerated speed at that moment.
      interface CMEArrival {
        arrivalMs:  number;
        endMs:      number;
        speedKms:   number;
        name:       string;
      }

      const cmeArrivals: CMEArrival[] = [];
      cmeGroupRef.current.children.forEach((co: any) => {
        if (co.userData?._isTail) return;
        const cme = co.userData as ProcessedCME;
        if (!cme?.startTime || !cme.speed) return;

        // Binary search: find tSec when dist(tSec) = earthDistScene
        let lo = 0, hi = 14 * 24 * 3600; // search up to 14 days
        let arrivalSec: number | null = null;
        const distAtHi = calculateDistanceWithDeceleration(cme, hi);
        if (distAtHi < earthDistScene) return; // CME never reaches Earth

        for (let iter = 0; iter < 60; iter++) {
          const mid = (lo + hi) / 2;
          if (calculateDistanceWithDeceleration(cme, mid) < earthDistScene) {
            lo = mid;
          } else {
            hi = mid;
            arrivalSec = mid;
          }
        }
        if (arrivalSec === null) return;

        const arrivalMs = cme.startTime.getTime() + arrivalSec * 1000;
        if (arrivalMs > gEnd) return; // arrives after our window

        // Speed at arrival using drag model
        const engine = propagationEngineRef.current;
        const speedKms = engine
          ? Math.max(MIN_CME_SPEED_KMS, engine.getCurrentSpeed(cme.id, arrivalSec))
          : (() => {
              const u = cme.speed, w = 380, gamma = 0.5e-7, dv = u - w;
              return Math.max(MIN_CME_SPEED_KMS, u <= 300 ? u : w + dv / (1 + gamma * Math.abs(dv) * arrivalSec));
            })();

        cmeArrivals.push({
          arrivalMs,
          endMs: arrivalMs + CME_PASSAGE_MS,
          speedKms,
          name: cme.id,
        });
      });

      // ── Pre-compute HSS arrival windows ────────────────────────────────
      // Travel time from Sun to Earth at HSS speed.
      // Density (SIR) peaks 18h BEFORE the speed rise - the compressed slow
      // wind piles up ahead of the fast stream.
      interface HSSWindow {
        speedStartMs:   number; // when fast wind arrives
        speedEndMs:     number;
        densityPeakMs:  number; // SIR density peak (ahead of speed rise)
        densityEndMs:   number;
        peakSpeedKms:   number;
        peakDensity:    number;
      }

      const hssWindows: HSSWindow[] = coronalHoles.map(ch => {
        const sourceSpeedKms = Math.max(450, Math.min(900, ch.estimatedSpeedKms));
        const travelMs = (AU_IN_KM / sourceSpeedKms) * 1000;
        // HSS speed rise at Earth: centred on transit time from now
        const speedPeakMs   = now + travelMs;
        const speedStartMs  = speedPeakMs - 8  * 3600 * 1000;
        const speedEndMs    = speedPeakMs + 14 * 3600 * 1000;
        const densityPeakMs = speedStartMs - 18 * 3600 * 1000; // SIR leads the HSS
        const densityEndMs  = speedStartMs + 4  * 3600 * 1000; // density drops as speed rises

        const widthDeg   = Math.min(60, Math.max(5, ch.widthDeg ?? 20));
        const darkness   = Math.min(1, Math.max(0, ch.darkness ?? 0.35));
        const peakSpeedKms = Math.min(900, 500 + (widthDeg / 60) * 200 + darkness * 120);
        const peakDensity  = 10 + (widthDeg / 60) * 10 + darkness * 6;

        return { speedStartMs, speedEndMs, densityPeakMs, densityEndMs, peakSpeedKms, peakDensity };
      });

      // ── Build time series ───────────────────────────────────────────────
      const graphData: ImpactDataPoint[] = [];

      const smoothstep = (edge0: number, edge1: number, x: number) => {
        const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
        return t * t * (3 - 2 * t);
      };

      for (let i = 0; i <= ns; i++) {
        const ct = gStart + gDur * (i / ns);

        let ts = BACKGROUND_SPEED;
        let td = BACKGROUND_DENSITY;
        let disturbanceType: ImpactDataPoint['disturbanceType'] = undefined;
        let disturbanceName: string | undefined;

        // ── CME contribution ─────────────────────────────────────────────
        // Speed = arrival speed of fastest concurrent CME.
        // Density = compression from overlapping CMEs (each adds ~20 cm⁻³,
        // with an extra compression bonus per additional simultaneous CME).
        const activeCMEs = cmeArrivals.filter(a => ct >= a.arrivalMs && ct <= a.endMs);
        if (activeCMEs.length > 0) {
          const fastest = activeCMEs.reduce((a, b) => a.speedKms > b.speedKms ? a : b);
          ts = Math.max(ts, fastest.speedKms);

          // Density model:
          // 1 CME  → 5–10 cm⁻³ depending on speed (faster = denser ejecta)
          // 3 CMEs → ~20 cm⁻³ (compression from multiple events)
          // 5+     → capped at 50 cm⁻³
          // Single CME density scaled 5–10 by arrival speed (300→slow, 1500→fast)
          const n = activeCMEs.length;
          const singleDensity = 5 + Math.min(5, (fastest.speedKms - 300) / 240);
          // Each additional CME adds diminishing compression: 2nd adds ~7, 3rd ~5, etc.
          const compressionAdd = n > 1
            ? Array.from({ length: n - 1 }, (_, i) => 7 / (i * 0.4 + 1)).reduce((a, b) => a + b, 0)
            : 0;
          td = Math.max(td, Math.min(50, BACKGROUND_DENSITY + singleDensity + compressionAdd));

          disturbanceType = 'CME';
          disturbanceName = fastest.name;
        }

        // ── HSS contribution ─────────────────────────────────────────────
        // Density peaks in the SIR ahead of the speed rise, then drops.
        // Speed rises as the fast stream arrives.
        hssWindows.forEach(hss => {
          // SIR density - Gaussian-ish peak centred on densityPeakMs
          if (ct >= hss.densityPeakMs - 24 * 3600 * 1000 && ct <= hss.densityEndMs) {
            let densProfile = 0;
            if (ct < hss.densityPeakMs) {
              densProfile = smoothstep(hss.densityPeakMs - 24 * 3600 * 1000, hss.densityPeakMs, ct);
            } else {
              densProfile = 1 - smoothstep(hss.densityPeakMs, hss.densityEndMs, ct);
            }
            td = Math.max(td, BACKGROUND_DENSITY + hss.peakDensity * densProfile);
            if (!disturbanceType) { disturbanceType = 'Coronal Hole'; }
          }

          // HSS speed rise
          if (ct >= hss.speedStartMs && ct <= hss.speedEndMs) {
            let speedProfile = 0;
            const midpoint = (hss.speedStartMs + hss.speedEndMs) / 2;
            if (ct <= midpoint) {
              speedProfile = smoothstep(hss.speedStartMs, midpoint, ct);
            } else {
              speedProfile = 1 - smoothstep(midpoint, hss.speedEndMs, ct);
            }
            const hssSpeed = BACKGROUND_SPEED + (hss.peakSpeedKms - BACKGROUND_SPEED) * speedProfile;
            ts = Math.max(ts, hssSpeed);
            if (!disturbanceType) { disturbanceType = 'Coronal Hole'; }
          }
        });

        graphData.push({ time: ct, speed: Math.round(ts), density: parseFloat(td.toFixed(1)), disturbanceType, disturbanceName });
      }

      return graphData;
    }
  }), [moveCamera, getClockElapsedTime, calculateDistanceWithDeceleration, cmeData, coronalHoles]);

  useEffect(() => { if (controlsRef.current && rendererRef.current?.domElement) { controlsRef.current.enabled = true; rendererRef.current.domElement.style.cursor = 'move'; } }, [interactionMode]);
  useEffect(() => { if (!celestialBodiesRef.current || !orbitsRef.current) return; ['MERCURY', 'VENUS', 'MARS'].forEach(n => { const b = celestialBodiesRef.current[n], o = orbitsRef.current[n]; if (b) b.mesh.visible = showExtraPlanets; if (o) o.visible = showExtraPlanets; }); }, [showExtraPlanets]);
  useEffect(() => { if (!celestialBodiesRef.current) return; const m = celestialBodiesRef.current['MOON'], l = celestialBodiesRef.current['L1']; if (m) m.mesh.visible = showMoonL1; if (l) l.mesh.visible = showMoonL1; const e = celestialBodiesRef.current['EARTH']?.mesh; if (e) { const o = e.children.find((c: any) => c.name === 'moon-orbit'); if (o) o.visible = showMoonL1; } }, [showMoonL1]);

  const checkImpacts = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;
    let maxSpeed = 0;
    const p = new THREE.Vector3(); celestialBodiesRef.current.EARTH.mesh.getWorldPosition(p);
    cmeGroupRef.current.children.forEach((c: any) => {
      const d = c.userData; if (!d || d._isTail || !c.visible) return;
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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} className="w-full h-full" />
      {experimentalInteractions && barrierNotes.length > 0 && (
        <div className="pointer-events-none absolute left-3 bottom-24 z-10 max-w-[70vw] space-y-1">
          {barrierNotes.map((line) => (
            <div key={line} className="rounded-md border border-amber-400/30 bg-black/60 px-2 py-1 text-[11px] text-amber-200">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.forwardRef(SimulationCanvas);
// --- END OF FILE SimulationCanvas.tsx ---