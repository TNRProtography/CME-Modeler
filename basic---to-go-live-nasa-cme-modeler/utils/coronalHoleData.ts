// --- START OF FILE utils/coronalHoleData.ts ---
//
// Data model and default simulation data for coronal holes.
//
// ARCHITECTURE NOTE
// The coronal holes defined here are *simulated* source regions embedded
// permanently in the CME visualisation scene.  They are not fetched from
// an external API.  The user never needs to interact with the CH data model
// directly — the only user-facing control is the HSS toggle in ControlsPanel.
//
// Adding a new coronal hole:
//   1. Add a new entry to DEFAULT_CORONAL_HOLES below.
//   2. Adjust lat/lon/widthDeg/polygon to match a real or hypothetical CH.
//   3. Call estimateHssSpeedFromChWidth() or set estimatedSpeedKms manually.

import { estimateHssSpeedFromChWidth } from './solarWindModel';

// ─── Data model ──────────────────────────────────────────────────────────────

export interface CoronalHole {
  /** Unique identifier used as Three.js userData key */
  id: string;

  /** Heliographic latitude of the CH centroid (degrees, +N) */
  lat: number;

  /** Heliographic longitude of the CH centroid (degrees, Carrington convention) */
  lon: number;

  /** Angular width (east-west extent, degrees).  Drives HSS speed estimate. */
  widthDeg: number;

  /** Angular height (north-south extent, degrees).  Defaults to widthDeg if omitted. */
  heightDeg?: number;

  /**
   * Optional polygon boundary in heliographic coordinates.
   * When present, geometry helpers will use this for the irregular CH outline.
   * When absent, an ellipse blob is generated from widthDeg / heightDeg.
   */
  polygon?: Array<{ lat: number; lon: number }>;

  /** Estimated stream speed derived from CH width.  Pre-computed on creation. */
  estimatedSpeedKms: number;

  // ── Propagation & rendering parameters ────────────────────────────────────

  /** Direction unit vector (heliographic) from which the HSS propagates.
   *  Derived from lat/lon; stored as { lat, lon } in degrees. */
  sourceDirectionDeg: { lat: number; lon: number };

  /**
   * Half-angle expansion rate of the HSS in degrees per AU.
   * Controls how rapidly the stream widens with heliocentric distance.
   * Typical range: 5–20 deg/AU.
   */
  expansionHalfAngleDeg: number;

  /**
   * Base opacity of the HSS volume mesh (0–1).
   * The material will modulate this with distance-based falloff.
   */
  opacity: number;

  /**
   * Whether the HSS graphic (the space-propagating stream) is currently visible.
   * Driven by the control-panel toggle.  The CH source geometry is always present.
   */
  hssVisible: boolean;

  /**
   * Animation phase offset [0..1].  Staggers ripple / pulse timing when multiple
   * CHs are shown simultaneously so they don't pulse in lockstep.
   */
  animPhase: number;
}

// ─── Default simulated coronal holes ─────────────────────────────────────────
//
// Two representative holes:
//   CH_NORTH — a polar-to-mid-latitude northern CH, roughly oriented sunward.
//   CH_SOUTH — a smaller equatorial southern CH offset ~120° in longitude.
//
// Polygon vertices approximate an irregular coronal hole boundary.
// Each vertex is in (lat, lon) degrees relative to the CH centroid.

export const DEFAULT_CORONAL_HOLES: CoronalHole[] = [
  {
    id: 'CH_NORTH',
    lat:  30,
    lon: -15,
    widthDeg:  38,
    heightDeg: 50,
    polygon: [
      // Clockwise boundary — irregular blob roughly 38° wide × 50° tall
      { lat:  25, lon:  0  },
      { lat:  22, lon:  14 },
      { lat:  10, lon:  22 },
      { lat: -10, lon:  18 },
      { lat: -25, lon:   8 },
      { lat: -25, lon: -12 },
      { lat: -12, lon: -22 },
      { lat:   5, lon: -20 },
      { lat:  18, lon: -14 },
      { lat:  25, lon:  -3 },
    ],
    estimatedSpeedKms:    estimateHssSpeedFromChWidth(38),
    sourceDirectionDeg:   { lat: 30, lon: -15 },
    expansionHalfAngleDeg: 14,
    opacity:               0.45,
    hssVisible:            true,
    animPhase:             0.0,
  },
  {
    id: 'CH_SOUTH',
    lat: -20,
    lon: 105,
    widthDeg:  22,
    heightDeg: 28,
    polygon: [
      { lat:  14, lon:   4 },
      { lat:   8, lon:  14 },
      { lat:  -8, lon:  12 },
      { lat: -14, lon:  -2 },
      { lat:  -8, lon: -14 },
      { lat:   6, lon: -12 },
    ],
    estimatedSpeedKms:    estimateHssSpeedFromChWidth(22),
    sourceDirectionDeg:   { lat: -20, lon: 105 },
    expansionHalfAngleDeg: 10,
    opacity:               0.35,
    hssVisible:            true,
    animPhase:             0.42,
  },
];

// --- END OF FILE utils/coronalHoleData.ts ---