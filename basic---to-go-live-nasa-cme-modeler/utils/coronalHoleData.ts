// --- START OF FILE utils/coronalHoleData.ts ---
//
// Data model for coronal holes detected from live SUVI 195Å imagery.
//
// There are NO simulated/hardcoded coronal holes here.
// All coronal hole data comes from the SUVI 195 detector in
// suviCoronalHoleDetector.ts.  If detection fails, the scene simply
// shows no CH patches or HSS streams until the next successful fetch.

import { estimateHssSpeedFromChWidth } from './solarWindModel';

// Re-export so consumers can import from one place
export { estimateHssSpeedFromChWidth };

// ─── Data model ──────────────────────────────────────────────────────────────

export interface CoronalHole {
  /** Unique identifier — e.g. 'CH_SUVI_0' */
  id: string;

  /** Heliographic latitude of centroid (degrees, +N) */
  lat: number;

  /** Heliographic longitude of centroid (degrees, Carrington) */
  lon: number;

  /** Angular east-west width (degrees).  Drives HSS speed estimate. */
  widthDeg: number;

  /** Angular north-south height (degrees). */
  heightDeg?: number;

  /**
   * Boundary polygon in heliographic offset coordinates (relative to centroid).
   * Detected from SUVI pixel analysis; undefined → ellipse fallback in geometry.
   */
  polygon?: Array<{ lat: number; lon: number }>;

  /** Estimated solar wind stream speed (km/s) derived from widthDeg */
  estimatedSpeedKms: number;

  /** Source direction (same as centroid lat/lon) */
  sourceDirectionDeg: { lat: number; lon: number };

  /** HSS expansion half-angle (degrees) — scales with CH width */
  expansionHalfAngleDeg: number;

  /** Base opacity of the HSS Parker spiral (0–1) */
  opacity: number;

  /** Whether the HSS graphic in space is shown */
  hssVisible: boolean;

  /** Animation phase offset [0..1] to stagger ripple timing between CHs */
  animPhase: number;
}

// --- END OF FILE utils/coronalHoleData.ts ---