// --- START OF FILE utils/heliosphericPropagation.ts ---
//
// ═══════════════════════════════════════════════════════════════════════
//  HELIOSPHERIC PROPAGATION ENGINE
//  Drag-Based Model (DBM) with CME–CME & CME–HSS Interactions
// ═══════════════════════════════════════════════════════════════════════
//
//  PHYSICS REFERENCES
//  ──────────────────
//  • Vršnak et al. 2013, Solar Phys. 285:295  — Quadratic drag-based model
//  • Vršnak & Žic 2007, A&A 472:937           — DBM foundations
//  • Cargill 2004, Solar Phys. 221:135        — Aerodynamic drag in MHD
//  • Temmer et al. 2017, ApJ 835:141          — Preconditioning by prior CMEs
//  • Werner et al. 2019, Space Weather 17:1    — CME–CME Sept 2017 event
//  • Gopalswamy et al. 2001, ApJ 548:L91      — CME cannibalism
//  • Skov & Nitta 2016, AGU SH13B-2294M       — Stealth CME–CH interaction
//  • Dumbović et al. 2018, ApJ 854:180        — DBEM ensemble approach
//  • Napoletano et al. 2018, SWSC 8:A19       — Probabilistic DBM
//
//  The engine runs client-side in <0.5ms per timestep, enabling real-time
//  animation at 60fps.  It uses the Vršnak quadratic drag formulation:
//
//    dv/dt = −γ · (v − w) · |v − w|
//
//  where:
//    v  = CME radial speed (km/s)
//    w  = ambient solar wind speed (km/s) — spatially & temporally varying
//    γ  = drag parameter (km⁻¹) — depends on CME cross-section, mass, SW density
//
//  The analytical solution (constant γ, constant w) is:
//
//    For v₀ > w  (fast CME, decelerating):
//      v(t) = w + (v₀ − w) / (1 + γ · (v₀ − w) · t)
//      r(t) = r₀ + w·t + ln(1 + γ·(v₀−w)·t) / γ
//
//    For v₀ < w  (slow CME, accelerating):
//      v(t) = w − (w − v₀) / (1 + γ · (w − v₀) · t)
//      r(t) = r₀ + w·t − ln(1 + γ·(w−v₀)·t) / γ
//
// ═══════════════════════════════════════════════════════════════════════

import { CoronalHole } from './coronalHoleData';

// ─── Physical Constants ────────────────────────────────────────────────
const AU_KM           = 149_597_870.7;       // 1 AU in km
const R_SUN_KM        = 695_700;             // Solar radius in km
const R_INNER_KM      = 21.5 * R_SUN_KM;    // DBM inner boundary (~0.1 AU)
const OMEGA_SUN       = 2.618e-6;            // Synodic angular velocity (rad/s)
const SLOW_WIND_DEFAULT = 380;               // Default slow solar wind speed (km/s)

// ─── DBM Drag Parameter Ranges (× 10⁻⁷ km⁻¹) ────────────────────────
// From Vršnak et al. 2013 and Dumbović et al. 2021:
//   Typical operational range: 0.2–2.0 × 10⁻⁷ km⁻¹
//   Fast CMEs (>1000 km/s): γ ≈ 0.1–0.5 × 10⁻⁷ (large mass, less drag)
//   Slow/moderate CMEs:     γ ≈ 0.5–2.0 × 10⁻⁷ (smaller, more affected)
//   In preconditioning:     γ reduced by 30–60% (rarefied medium)
const GAMMA_SCALE = 1e-7;    // Base scale factor (km⁻¹)

// ─── Exported Types ───────────────────────────────────────────────────

export interface PropagationState {
  /** Heliocentric distance in km */
  distanceKm: number;
  /** Current radial speed in km/s */
  speedKms: number;
  /** Current density enhancement factor (1.0 = ambient) */
  densityFactor: number;
  /** Whether this CME has merged with another */
  isMerged: boolean;
  /** ID of CME this merged with, if any */
  mergedWithId: string | null;
  /** Estimated Bz polarity weight: −1 fully south, +1 fully north */
  bzWeight: number;
  /** Time in seconds since eruption */
  elapsedSec: number;
}

export interface CMEInput {
  id: string;
  /** Eruption time (ms since epoch) */
  startTimeMs: number;
  /** Initial speed at 21.5 R☉ in km/s */
  initialSpeedKms: number;
  /** Propagation direction: longitude (deg, Stonyhurst) */
  longitude: number;
  /** Propagation direction: latitude (deg) */
  latitude: number;
  /** Angular half-width (deg) */
  halfAngleDeg: number;
  /** Source region hemisphere for Bothmer-Schwenn chirality */
  sourceHemisphere: 'N' | 'S' | 'unknown';
  /** Optional: linked flare class for mass estimation */
  flareClass?: string;
}

export interface HSSInput {
  /** Coronal hole source longitude (deg, disk-centre-relative) */
  longitude: number;
  /** Coronal hole source latitude (deg) */
  latitude: number;
  /** Estimated peak solar wind speed at 1 AU (km/s) */
  peakSpeedKms: number;
  /** CH angular width (deg) */
  widthDeg: number;
  /** Emission start time (ms since epoch) — when the CH first faces Earth */
  emissionStartMs: number;
}

export interface PropagationResult {
  cmeId: string;
  /** Current state at the requested time */
  state: PropagationState;
  /** Predicted arrival time at 1 AU (ms since epoch), or null if miss */
  arrivalTimeMs: number | null;
  /** Predicted impact speed at 1 AU (km/s) */
  arrivalSpeedKms: number;
  /** Effective drag parameter used */
  gammaUsed: number;
  /** Effective ambient wind speed used */
  ambientWindKms: number;
  /** Whether CME-CME interaction modified propagation */
  interactionFlag: 'none' | 'preconditioning' | 'compression' | 'cannibalism';
}

export interface ImpactProfilePoint {
  /** Absolute time (ms since epoch) */
  timeMs: number;
  /** Solar wind speed at Earth (km/s) */
  speedKms: number;
  /** Proton density (cm⁻³) */
  densityCm3: number;
  /** Estimated Bz component (nT) — negative = southward */
  bzNt: number;
  /** Dominant disturbance at this time */
  disturbanceType: 'ambient' | 'CME_sheath' | 'CME_ejecta' | 'HSS' | 'SIR' | 'complex_ejecta';
  /** ID of the responsible CME, if applicable */
  disturbanceId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  DRAG PARAMETER ESTIMATION
// ═══════════════════════════════════════════════════════════════════════
//
//  γ = C_d · A · ρ_sw / (M + M_v)
//
//  Where:
//    C_d   ≈ 1 (dimensionless drag coefficient for MHD case)
//    A     = π · (R_cme)² — cross-sectional area (self-similar expansion)
//    ρ_sw  = solar wind density (falls as r⁻²)
//    M     = CME mass (estimated from flare class / speed)
//    M_v   = virtual mass ≈ ρ_sw · V_cme / 2
//
//  For the analytical DBM, γ is treated as constant (validated by
//  Vršnak et al. 2014 comparison against WSA-ENLIL+Cone).
//
//  We estimate γ empirically from CME speed and half-angle:
//  - Wider CMEs (larger A) → higher γ → more drag
//  - Faster CMEs correlate with larger mass → lower γ
//  - This follows the statistical distribution from Dumbović et al. 2021

function estimateGamma(speedKms: number, halfAngleDeg: number): number {
  // Speed factor: faster CMEs are typically more massive → less drag
  // Empirical: γ ∝ speed^(-0.5) normalized to 0.2 at 2000 km/s, 1.5 at 400 km/s
  const speedClamp = Math.max(200, Math.min(3000, speedKms));
  const speedFactor = 1.8 * Math.pow(400 / speedClamp, 0.55);

  // Angular width factor: wider CMEs have larger cross-section → more drag
  // But also typically more massive, so the net effect is moderate
  const halfAngle = Math.max(10, Math.min(90, halfAngleDeg));
  const widthFactor = 0.7 + 0.6 * (halfAngle / 45);

  // Combined: typical range 0.1–2.5 × 10⁻⁷ km⁻¹
  const gamma = speedFactor * widthFactor * GAMMA_SCALE;

  // Clamp to physically reasonable bounds (Dumbović et al. 2021)
  return Math.max(0.05 * GAMMA_SCALE, Math.min(5.0 * GAMMA_SCALE, gamma));
}

// ═══════════════════════════════════════════════════════════════════════
//  AMBIENT SOLAR WIND SPEED MODEL
// ═══════════════════════════════════════════════════════════════════════
//
//  The ambient solar wind speed w determines the equilibrium speed
//  a CME asymptotically approaches. It varies with:
//
//  1. Ecliptic longitude — slow wind from streamer belt, fast from CHs
//  2. Time — solar rotation sweeps different structures past Earth
//  3. Prior disturbances — preconditioning by earlier CMEs/HSSs
//
//  We combine:
//  (a) A measured baseline from L1 data (DSCOVR/ACE) when available
//  (b) An HSS contribution from detected coronal holes
//  (c) A preconditioning correction from prior CME passages

function getAmbientWindSpeed(
  longitudeDeg: number,
  timeMs: number,
  hssInputs: HSSInput[],
  measuredWindKms?: number,
): number {
  // Start with measured or default slow wind
  let w = measuredWindKms ?? SLOW_WIND_DEFAULT;

  // Add HSS contribution along the CME's propagation path
  for (const hss of hssInputs) {
    const dtSec = (timeMs - hss.emissionStartMs) / 1000;
    if (dtSec < 0) continue;  // HSS hasn't started emitting yet

    // Compute angular separation between CME path and HSS source
    const dLon = Math.abs(longitudeDeg - hss.longitude);
    const dLonWrap = Math.min(dLon, 360 - dLon);

    // HSS influence angular radius based on CH width
    const influenceRadius = Math.max(15, hss.widthDeg * 0.7);
    if (dLonWrap > influenceRadius) continue;

    // Radial profile: HSS speed ramps up over ~1 day from CH, peaks for ~2 days
    const rampHours = 18;
    const plateauHours = 36;
    const decayHours = 48;
    const dtHours = dtSec / 3600;

    let profile = 0;
    if (dtHours < rampHours) {
      profile = dtHours / rampHours;
    } else if (dtHours < rampHours + plateauHours) {
      profile = 1.0;
    } else if (dtHours < rampHours + plateauHours + decayHours) {
      profile = 1.0 - (dtHours - rampHours - plateauHours) / decayHours;
    }

    // Angular falloff: Gaussian-like drop with distance from CH center
    const angularWeight = Math.exp(-0.5 * Math.pow(dLonWrap / (influenceRadius * 0.5), 2));

    // Effective HSS boost at this point
    const hssBoost = (hss.peakSpeedKms - SLOW_WIND_DEFAULT) * profile * angularWeight;
    w = Math.max(w, SLOW_WIND_DEFAULT + hssBoost);
  }

  return w;
}

// ═══════════════════════════════════════════════════════════════════════
//  CME–CME INTERACTION ENGINE
// ═══════════════════════════════════════════════════════════════════════
//
//  Three interaction modes (Werner et al. 2019, Lugaz et al. 2017):
//
//  1. PRECONDITIONING — a prior CME has swept through the same corridor,
//     leaving a rarefied wake (lower ρ_sw → reduced γ). The following
//     CME experiences 30–60% less drag and arrives earlier than expected.
//     (Temmer et al. 2017: preconditioning lasts 2–5 days)
//
//  2. COMPRESSION — the following CME's sheath compresses against the
//     preceding CME's trailing edge. Enhanced density at the interface.
//     Not yet a full merger; distinct structures still identifiable.
//
//  3. CANNIBALISM — the fast CME overtakes and engulfs the slow one.
//     The result is a "complex ejecta" with disordered magnetic field,
//     enhanced density, and a speed intermediate between the two.
//     (Burlaga et al. 2002: weak/disordered Bz, higher plasma beta)
//

interface CMETrajectory {
  cme: CMEInput;
  gamma: number;
  ambientW: number;
  /** distance(t) in km, speed(t) in km/s — precomputed at coarse timesteps */
  trajectory: { tSec: number; distKm: number; speedKms: number }[];
  /** Flags set by interaction analysis */
  preconditioningFactor: number;  // 1.0 = normal, 0.4–0.7 = reduced drag
  isCannibalised: boolean;
  cannibaliserID: string | null;
  compressionDensityBoost: number;  // multiplier on sheath density
}

/**
 * Compute a coarse trajectory for one CME using the analytical DBM.
 * Resolution: 60s timesteps, which is more than enough for real-time display.
 */
function computeTrajectory(
  cme: CMEInput,
  gamma: number,
  w: number,
  maxTimeSec: number,
  dtSec: number = 60,
): { tSec: number; distKm: number; speedKms: number }[] {
  const v0 = cme.initialSpeedKms;
  const points: { tSec: number; distKm: number; speedKms: number }[] = [];

  // Analytical DBM solution (Vršnak et al. 2013, eq. 6–8)
  const dv = v0 - w;

  if (Math.abs(dv) < 1.0) {
    // CME speed ≈ ambient wind — no significant drag, linear propagation
    for (let t = 0; t <= maxTimeSec; t += dtSec) {
      points.push({
        tSec: t,
        distKm: R_INNER_KM + w * t,
        speedKms: w,
      });
    }
    return points;
  }

  const sign = dv > 0 ? 1 : -1;
  const absDv = Math.abs(dv);

  for (let t = 0; t <= maxTimeSec; t += dtSec) {
    const denominator = 1 + gamma * absDv * t;

    // v(t) = w + sign * absDv / denominator
    const v = w + sign * absDv / denominator;

    // r(t) = r₀ + w·t + sign · ln(denominator) / γ
    const dist = R_INNER_KM + w * t + sign * Math.log(denominator) / gamma;

    points.push({ tSec: t, distKm: dist, speedKms: v });
  }

  return points;
}

/**
 * Find the distance and speed of a CME trajectory at arbitrary time t
 * by linear interpolation of precomputed points.
 */
function sampleTrajectory(
  traj: { tSec: number; distKm: number; speedKms: number }[],
  tSec: number,
): { distKm: number; speedKms: number } {
  if (traj.length === 0) return { distKm: R_INNER_KM, speedKms: 0 };
  if (tSec <= traj[0].tSec) return { distKm: traj[0].distKm, speedKms: traj[0].speedKms };
  if (tSec >= traj[traj.length - 1].tSec) {
    const last = traj[traj.length - 1];
    // Linear extrapolation at final speed
    const dt = tSec - last.tSec;
    return { distKm: last.distKm + last.speedKms * dt, speedKms: last.speedKms };
  }

  // Binary search for bracketing interval
  let lo = 0, hi = traj.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (traj[mid].tSec <= tSec) lo = mid; else hi = mid;
  }

  const a = traj[lo], b = traj[hi];
  const frac = (tSec - a.tSec) / (b.tSec - a.tSec);
  return {
    distKm: a.distKm + frac * (b.distKm - a.distKm),
    speedKms: a.speedKms + frac * (b.speedKms - a.speedKms),
  };
}

/**
 * Detect and resolve CME–CME interactions across a set of CMEs.
 *
 * This modifies trajectories in-place to account for:
 *  - Preconditioning (reduced drag for follower CMEs)
 *  - Cannibalism (merger when fast CME overtakes slow one)
 *  - Compression (enhanced sheath when CMEs approach each other)
 */
function resolveInteractions(
  trajectories: CMETrajectory[],
  maxTimeSec: number,
  dtCheckSec: number = 300,  // Check every 5 minutes
): void {
  if (trajectories.length < 2) return;

  // Sort by eruption time (earliest first)
  const sorted = [...trajectories].sort(
    (a, b) => a.cme.startTimeMs - b.cme.startTimeMs
  );

  for (let i = 1; i < sorted.length; i++) {
    const follower = sorted[i];
    if (follower.isCannibalised) continue;

    for (let j = 0; j < i; j++) {
      const leader = sorted[j];
      if (leader.isCannibalised) continue;

      // Check if follower is on a similar trajectory (angular proximity)
      const dLon = Math.abs(follower.cme.longitude - leader.cme.longitude);
      const dLat = Math.abs(follower.cme.latitude - leader.cme.latitude);
      const angularSep = Math.sqrt(dLon * dLon + dLat * dLat);
      const interactionCone = (follower.cme.halfAngleDeg + leader.cme.halfAngleDeg) * 0.6;
      if (angularSep > interactionCone) continue;

      // Time offset between eruptions
      const dtEruptionSec = (follower.cme.startTimeMs - leader.cme.startTimeMs) / 1000;
      if (dtEruptionSec < 0 || dtEruptionSec > 7 * 86400) continue;  // Max 7 day window

      // ── PRECONDITIONING ─────────────────────────────────────────────
      // Leader CME has swept through, reducing ambient density.
      // Effect: reduce follower's effective γ by 30–60%
      // (Temmer et al. 2017: disturbance lasts 2–5 days)
      const preconditioningDecay = Math.exp(-dtEruptionSec / (3.5 * 86400));  // τ ≈ 3.5 days
      const preconditionFactor = 1.0 - 0.5 * preconditioningDecay;
      follower.preconditioningFactor = Math.min(follower.preconditioningFactor, preconditionFactor);

      // Recompute follower trajectory with reduced drag
      const newGamma = follower.gamma * follower.preconditioningFactor;
      follower.trajectory = computeTrajectory(
        follower.cme, newGamma, follower.ambientW, maxTimeSec,
      );

      // ── OVERTAKING CHECK (CANNIBALISM) ──────────────────────────────
      // Check if the follower catches the leader at any point
      for (let t = dtEruptionSec; t < maxTimeSec; t += dtCheckSec) {
        const tFollower = t - dtEruptionSec;
        if (tFollower < 0) continue;

        const leaderState = sampleTrajectory(leader.trajectory, t);
        const followerState = sampleTrajectory(follower.trajectory, tFollower);

        if (followerState.distKm >= leaderState.distKm && leaderState.distKm > R_INNER_KM) {
          // ── CANNIBALISM EVENT ──────────────────────────────────────
          // Fast CME has caught up with slow CME
          //
          // Physics of merger (Lugaz et al. 2017):
          // - Momentum conservation: v_merged = (M1·v1 + M2·v2) / (M1+M2)
          // - Since we don't know masses precisely, use speed-weighted average
          //   with the faster CME dominating (it has more kinetic energy)
          // - Density enhanced at collision site
          // - Magnetic field becomes disordered → weaker Bz coherence

          const mergeDistKm = followerState.distKm;
          const v1 = leaderState.speedKms;
          const v2 = followerState.speedKms;

          // Momentum-weighted merge: faster CME dominates
          // Approximation: M ∝ v² (kinetic energy proxy)
          const w1 = v1 * v1, w2 = v2 * v2;
          const vMerged = (w1 * v1 + w2 * v2) / (w1 + w2);

          // Enhanced half-angle (combined structure is wider)
          const mergedHalfAngle = Math.min(90,
            Math.max(follower.cme.halfAngleDeg, leader.cme.halfAngleDeg) * 1.3
          );

          // Mark leader as cannibalized
          leader.isCannibalised = true;
          leader.cannibaliserID = follower.cme.id;

          // Follower continues with merged properties
          // Rebuild its trajectory from the merge point with new speed
          const mergedCme: CMEInput = {
            ...follower.cme,
            initialSpeedKms: vMerged,
            halfAngleDeg: mergedHalfAngle,
          };

          // Higher density in the merged structure → more drag going forward
          const mergedGamma = estimateGamma(vMerged, mergedHalfAngle) * 1.3;
          const tFromMerge = maxTimeSec - tFollower;
          const mergedTraj = computeTrajectory(
            { ...mergedCme, startTimeMs: follower.cme.startTimeMs + tFollower * 1000 },
            mergedGamma, follower.ambientW, tFromMerge,
          );

          // Stitch: keep follower's trajectory up to merge, then append merged
          const premerge = follower.trajectory.filter(p => p.tSec < tFollower);
          const postmerge = mergedTraj.map(p => ({
            tSec: p.tSec + tFollower,
            distKm: p.distKm - R_INNER_KM + mergeDistKm,  // Offset from merge point
            speedKms: p.speedKms,
          }));
          follower.trajectory = [...premerge, ...postmerge];

          // Density boost at the collision interface
          follower.compressionDensityBoost = 2.5 + 1.5 * (v2 / v1 - 1);

          break;  // Done with this leader
        }

        // ── COMPRESSION CHECK ───────────────────────────────────────
        // Follower is close behind leader but hasn't caught up yet
        const gapKm = leaderState.distKm - followerState.distKm;
        if (gapKm > 0 && gapKm < 0.05 * AU_KM) {
          // Within 0.05 AU — significant compression of intervening plasma
          const compressionIntensity = 1.0 - gapKm / (0.05 * AU_KM);
          follower.compressionDensityBoost = Math.max(
            follower.compressionDensityBoost,
            1.0 + 2.0 * compressionIntensity,
          );
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Propagate a set of CMEs through the heliosphere, accounting for
 * interactions with each other and with high-speed streams.
 *
 * Call this once when data changes; it returns a function you call
 * per-frame with a timestamp to get each CME's current state.
 *
 * @param cmeInputs     Array of CME eruption parameters from DONKI
 * @param hssInputs     Array of HSS parameters from coronal hole detection
 * @param measuredWindKms  Latest measured solar wind speed at L1 (km/s)
 * @returns             A propagation engine with query methods
 */
export function createPropagationEngine(
  cmeInputs: CMEInput[],
  hssInputs: HSSInput[],
  measuredWindKms?: number,
) {
  const MAX_PROPAGATION_SEC = 10 * 86400;  // 10 days max

  // ── Build individual trajectories ───────────────────────────────────
  const trajectories: CMETrajectory[] = cmeInputs.map(cme => {
    const gamma = estimateGamma(cme.initialSpeedKms, cme.halfAngleDeg);
    const w = getAmbientWindSpeed(cme.longitude, cme.startTimeMs, hssInputs, measuredWindKms);

    return {
      cme,
      gamma,
      ambientW: w,
      trajectory: computeTrajectory(cme, gamma, w, MAX_PROPAGATION_SEC),
      preconditioningFactor: 1.0,
      isCannibalised: false,
      cannibaliserID: null,
      compressionDensityBoost: 1.0,
    };
  });

  // ── Resolve multi-CME interactions ──────────────────────────────────
  resolveInteractions(trajectories, MAX_PROPAGATION_SEC);

  // ── Precompute arrival times ────────────────────────────────────────
  const arrivals = new Map<string, { arrivalTimeSec: number; arrivalSpeedKms: number }>();
  for (const t of trajectories) {
    if (t.isCannibalised) continue;
    for (let i = 1; i < t.trajectory.length; i++) {
      if (t.trajectory[i].distKm >= AU_KM && t.trajectory[i - 1].distKm < AU_KM) {
        // Interpolate exact crossing
        const a = t.trajectory[i - 1], b = t.trajectory[i];
        const frac = (AU_KM - a.distKm) / (b.distKm - a.distKm);
        const arrSec = a.tSec + frac * (b.tSec - a.tSec);
        const arrSpd = a.speedKms + frac * (b.speedKms - a.speedKms);
        arrivals.set(t.cme.id, { arrivalTimeSec: arrSec, arrivalSpeedKms: arrSpd });
        break;
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  QUERY FUNCTIONS (called per-frame or per-chart-point)
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Get a single CME's propagation state at a given absolute time.
   */
  function getCMEState(cmeId: string, absoluteTimeMs: number): PropagationResult | null {
    const traj = trajectories.find(t => t.cme.id === cmeId);
    if (!traj) return null;

    const elapsedSec = (absoluteTimeMs - traj.cme.startTimeMs) / 1000;
    if (elapsedSec < 0) {
      return {
        cmeId,
        state: {
          distanceKm: 0, speedKms: 0, densityFactor: 1.0,
          isMerged: false, mergedWithId: null, bzWeight: 0, elapsedSec: 0,
        },
        arrivalTimeMs: null, arrivalSpeedKms: 0,
        gammaUsed: traj.gamma, ambientWindKms: traj.ambientW,
        interactionFlag: 'none',
      };
    }

    const { distKm, speedKms } = sampleTrajectory(traj.trajectory, elapsedSec);
    const arrival = arrivals.get(cmeId);
    const arrivalTimeMs = arrival
      ? traj.cme.startTimeMs + arrival.arrivalTimeSec * 1000
      : null;

    // Determine interaction flag
    let flag: PropagationResult['interactionFlag'] = 'none';
    if (traj.isCannibalised) flag = 'cannibalism';
    else if (traj.preconditioningFactor < 0.95) flag = 'preconditioning';
    else if (traj.compressionDensityBoost > 1.1) flag = 'compression';

    // Bz estimation based on Bothmer-Schwenn pattern
    // Northern hemisphere eruptions → right-handed flux rope → Bz starts south
    // Southern hemisphere → left-handed → Bz starts north
    // (This is a statistical tendency, not deterministic)
    let bzWeight = 0;
    if (traj.cme.sourceHemisphere === 'N') bzWeight = -0.6;  // Likely southward leading
    else if (traj.cme.sourceHemisphere === 'S') bzWeight = 0.6;  // Likely northward leading
    // Cannibalized → disordered → weakened Bz
    if (traj.cannibaliserID) bzWeight *= 0.3;

    return {
      cmeId,
      state: {
        distanceKm: distKm,
        speedKms,
        densityFactor: traj.compressionDensityBoost,
        isMerged: traj.isCannibalised || traj.cannibaliserID !== null,
        mergedWithId: traj.cannibaliserID,
        bzWeight,
        elapsedSec,
      },
      arrivalTimeMs,
      arrivalSpeedKms: arrival?.arrivalSpeedKms ?? speedKms,
      gammaUsed: traj.gamma * traj.preconditioningFactor,
      ambientWindKms: traj.ambientW,
      interactionFlag: flag,
    };
  }

  /**
   * Get the distance of a CME in SCENE UNITS for the 3D visualization.
   * Drop-in replacement for `calculateDistanceWithDeceleration`.
   */
  function getSceneDistance(cmeId: string, timeSinceEventSec: number, sceneScale: number): number {
    const traj = trajectories.find(t => t.cme.id === cmeId);
    if (!traj || timeSinceEventSec < 0) return 0;

    const { distKm } = sampleTrajectory(traj.trajectory, timeSinceEventSec);
    return (distKm / AU_KM) * sceneScale;
  }

  /**
   * Get the current speed of a CME (km/s) for live color transitions.
   * Drop-in replacement for the inline speed calculation in updateCMEShape.
   */
  function getCurrentSpeed(cmeId: string, timeSinceEventSec: number): number {
    const traj = trajectories.find(t => t.cme.id === cmeId);
    if (!traj || timeSinceEventSec < 0) return 0;

    return sampleTrajectory(traj.trajectory, timeSinceEventSec).speedKms;
  }

  /**
   * Generate a 7-day impact profile at Earth for the forecast charts.
   * Drop-in replacement for `calculateImpactProfile`.
   *
   * This is the key output for space weather forecasters: what will
   * the solar wind look like at Earth over the next 7 days?
   */
  function calculateImpactProfile(
    startTimeMs: number,
    durationMs: number = 7 * 86400 * 1000,
    numPoints: number = 200,
  ): ImpactProfilePoint[] {
    const points: ImpactProfilePoint[] = [];

    for (let i = 0; i <= numPoints; i++) {
      const t = startTimeMs + (durationMs * i) / numPoints;

      // Start with ambient conditions
      let speed = measuredWindKms ?? SLOW_WIND_DEFAULT;
      let density = 5.0;  // Ambient proton density ~5 cm⁻³
      let bz = 0;
      let distType: ImpactProfilePoint['disturbanceType'] = 'ambient';
      let distId: string | undefined;
      let dominantContribution = 0;

      // ── HSS contributions ──────────────────────────────────────────
      for (const hss of hssInputs) {
        const dtSec = (t - hss.emissionStartMs) / 1000;
        if (dtSec < -12 * 3600 || dtSec > 120 * 3600) continue;

        // HSS arrival at 1 AU: travel time from Sun to Earth
        const travelTimeSec = AU_KM / hss.peakSpeedKms;
        const hoursSinceArrival = (dtSec - travelTimeSec) / 3600;

        // Stream Interaction Region (SIR) ahead of HSS
        // SIR: compressed slow wind + interface heating
        // Density peaks at the SIR, then drops in the HSS proper
        if (hoursSinceArrival > -18 && hoursSinceArrival < 0) {
          // SIR: density enhancement 2–4× ambient, speed gradually rising
          const sirPhase = (hoursSinceArrival + 18) / 18;  // 0→1
          const sirDensity = density * (1.0 + 3.0 * Math.sin(sirPhase * Math.PI));
          const sirSpeed = speed + (hss.peakSpeedKms - speed) * 0.3 * sirPhase;
          if (sirSpeed - speed > dominantContribution) {
            dominantContribution = sirSpeed - speed;
            speed = sirSpeed;
            density = Math.max(density, sirDensity);
            distType = 'SIR';
          }
        } else if (hoursSinceArrival >= 0 && hoursSinceArrival < 72) {
          // HSS proper: high speed, LOW density, fluctuating Bz
          const hssPhase = hoursSinceArrival / 72;
          const speedProfile = hss.peakSpeedKms - (hss.peakSpeedKms - speed) * hssPhase * hssPhase;
          // HSS density drops below ambient (rarefaction)
          const hssDensity = density * (0.4 + 0.6 * hssPhase);

          if (speedProfile - speed > dominantContribution) {
            dominantContribution = speedProfile - speed;
            speed = speedProfile;
            density = hssDensity;
            // HSS Bz: Alfvénic fluctuations — alternating N/S, moderate amplitude
            bz = 3.0 * Math.sin(hoursSinceArrival * 0.4) * (1 - hssPhase);
            distType = 'HSS';
          }
        }
      }

      // ── CME contributions ──────────────────────────────────────────
      for (const traj of trajectories) {
        if (traj.isCannibalised) continue;

        const cme = traj.cme;
        const elapsedSec = (t - cme.startTimeMs) / 1000;
        if (elapsedSec < 0) continue;

        // Check if this CME is Earth-directed
        if (Math.abs(cme.longitude) > cme.halfAngleDeg + 15) continue;

        const { distKm, speedKms } = sampleTrajectory(traj.trajectory, elapsedSec);

        // Distance from Earth (at 1 AU) to the CME leading edge
        const distFromEarthKm = AU_KM - distKm;

        // Sheath region: compressed solar wind AHEAD of the CME
        // Thickness ~0.05 AU, arrives before ejecta
        const sheathWidthKm = 0.05 * AU_KM;
        if (distFromEarthKm > -sheathWidthKm && distFromEarthKm < 0) {
          // Earth is inside the sheath
          const sheathPhase = 1.0 + distFromEarthKm / sheathWidthKm;  // 0→1

          // Sheath density: 3–6× ambient, peaks at the leading edge
          const sheathDensity = density * (1 + 5 * Math.sin(sheathPhase * Math.PI));

          // Sheath speed: moderately elevated (compressed slow wind)
          const sheathSpeed = speed + (speedKms - speed) * 0.25 * Math.sin(sheathPhase * Math.PI);

          // Sheath Bz: draped IMF — can be strongly southward
          // This is often MORE geoeffective than the ejecta itself!
          const sheathBz = -4.0 * Math.sin(sheathPhase * Math.PI) * (speedKms / 800);

          if (sheathSpeed - speed > dominantContribution) {
            dominantContribution = sheathSpeed - speed;
            speed = sheathSpeed;
            density = sheathDensity;
            bz = sheathBz;
            distType = traj.compressionDensityBoost > 1.5 ? 'complex_ejecta' : 'CME_sheath';
            distId = cme.id;
          }
        }

        // Ejecta body: magnetic cloud / flux rope
        // Width ~0.2 AU, arrives after sheath
        const ejectaWidthKm = 0.2 * AU_KM;
        if (distFromEarthKm >= 0 && distFromEarthKm < ejectaWidthKm) {
          const ejectaPhase = distFromEarthKm / ejectaWidthKm;  // 0 (leading) → 1 (trailing)

          // Ejecta speed: gradual decline from leading to trailing edge
          const ejectaSpeed = speedKms * (1.0 - 0.15 * ejectaPhase);

          // Ejecta density: enhanced relative to ambient, but lower than sheath
          const ejectaDensity = density * (1 + 2 * (1 - ejectaPhase))
            * traj.compressionDensityBoost;

          // Ejecta Bz: COHERENT rotation through the flux rope
          // This is the critical parameter for geomagnetic storm intensity
          // Flux rope rotation: Bz goes from one polarity to the other over ~24h
          const rotationAngle = ejectaPhase * Math.PI;
          const bzAmplitude = 8 + 12 * (speedKms / 1500);  // 8–20 nT for typical CMEs

          // Apply Bothmer-Schwenn chirality
          let ejectaBz: number;
          if (cme.sourceHemisphere === 'N') {
            // Northern: SEN type — Bz starts south, rotates to north
            ejectaBz = -bzAmplitude * Math.cos(rotationAngle);
          } else if (cme.sourceHemisphere === 'S') {
            // Southern: NES type — Bz starts north, rotates to south
            ejectaBz = bzAmplitude * Math.cos(rotationAngle);
          } else {
            // Unknown hemisphere — assume worst case (50% south)
            ejectaBz = -bzAmplitude * 0.5 * Math.cos(rotationAngle);
          }

          // Cannibalized → disordered field, reduced Bz coherence
          if (traj.cannibaliserID !== null) {
            ejectaBz *= 0.4;
            ejectaDensity *= 1.5;  // Complex ejecta are denser
          }

          if (ejectaSpeed - speed > dominantContribution || Math.abs(ejectaBz) > Math.abs(bz)) {
            dominantContribution = Math.max(dominantContribution, ejectaSpeed - speed);
            speed = Math.max(speed, ejectaSpeed);
            density = Math.max(density, ejectaDensity);
            bz = ejectaBz;
            distType = traj.compressionDensityBoost > 1.5 ? 'complex_ejecta' : 'CME_ejecta';
            distId = cme.id;
          }
        }
      }

      points.push({
        timeMs: t,
        speedKms: speed,
        densityCm3: density,
        bzNt: bz,
        disturbanceType: distType,
        disturbanceId: distId,
      });
    }

    return points;
  }

  /**
   * Get all active CME states at a given time (for the 3D scene).
   */
  function getAllStates(absoluteTimeMs: number): PropagationResult[] {
    return trajectories
      .filter(t => !t.isCannibalised)
      .map(t => getCMEState(t.cme.id, absoluteTimeMs))
      .filter((r): r is PropagationResult => r !== null);
  }

  /**
   * Check if a CME has been cannibalized (for hiding its mesh).
   */
  function isCannibalized(cmeId: string): boolean {
    return trajectories.find(t => t.cme.id === cmeId)?.isCannibalised ?? false;
  }

  /**
   * Get arrival prediction for a specific CME.
   */
  function getArrival(cmeId: string): { arrivalTimeMs: number; arrivalSpeedKms: number } | null {
    const a = arrivals.get(cmeId);
    if (!a) return null;
    const traj = trajectories.find(t => t.cme.id === cmeId);
    if (!traj) return null;
    return {
      arrivalTimeMs: traj.cme.startTimeMs + a.arrivalTimeSec * 1000,
      arrivalSpeedKms: a.arrivalSpeedKms,
    };
  }

  /**
   * Get all arrival predictions (for dashboard display).
   */
  function getAllArrivals(): Map<string, { arrivalTimeMs: number; arrivalSpeedKms: number; interactionFlag: string }> {
    const result = new Map<string, { arrivalTimeMs: number; arrivalSpeedKms: number; interactionFlag: string }>();
    for (const traj of trajectories) {
      if (traj.isCannibalised) continue;
      const a = arrivals.get(traj.cme.id);
      if (!a) continue;
      let flag = 'none';
      if (traj.preconditioningFactor < 0.95) flag = 'preconditioning';
      if (traj.compressionDensityBoost > 1.1) flag = 'compression';
      if (traj.cannibaliserID) flag = 'cannibalism';
      result.set(traj.cme.id, {
        arrivalTimeMs: traj.cme.startTimeMs + a.arrivalTimeSec * 1000,
        arrivalSpeedKms: a.arrivalSpeedKms,
        interactionFlag: flag,
      });
    }
    return result;
  }

  return {
    getCMEState,
    getSceneDistance,
    getCurrentSpeed,
    calculateImpactProfile,
    getAllStates,
    isCannibalized,
    getArrival,
    getAllArrivals,
    // Expose internals for debugging / UI display
    _trajectories: trajectories,
    _arrivals: arrivals,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CONVENIENCE: Convert ProcessedCME → CMEInput
// ═══════════════════════════════════════════════════════════════════════

export function processedCMEToCMEInput(cme: {
  id: string;
  startTime: Date;
  speed: number;
  longitude: number;
  latitude: number;
  halfAngle: number;
  sourceLocation?: string;
}): CMEInput {
  // Parse hemisphere from sourceLocation (e.g., "N23W15" → 'N', "S10E30" → 'S')
  let hemisphere: 'N' | 'S' | 'unknown' = 'unknown';
  if (cme.sourceLocation) {
    const match = cme.sourceLocation.match(/^([NS])/i);
    if (match) hemisphere = match[1].toUpperCase() as 'N' | 'S';
  }

  return {
    id: cme.id,
    startTimeMs: cme.startTime.getTime(),
    initialSpeedKms: cme.speed,
    longitude: cme.longitude,
    latitude: cme.latitude,
    halfAngleDeg: cme.halfAngle,
    sourceHemisphere: hemisphere,
  };
}

/**
 * Convert coronal hole data to HSSInput for the propagation engine.
 */
export function coronalHoleToHSSInput(ch: CoronalHole): HSSInput {
  return {
    longitude: ch.lon,
    latitude: ch.lat,
    peakSpeedKms: Math.max(450, Math.min(900, ch.estimatedSpeedKms ?? 550)),
    widthDeg: ch.widthDeg ?? 20,
    // Approximate: CH faces Earth when its longitude ≈ 0
    // Use current time minus the rotational offset
    emissionStartMs: Date.now() - (ch.lon / 360) * 27.27 * 86400 * 1000,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  SCENE INTEGRATION HELPER
// ═══════════════════════════════════════════════════════════════════════
//
//  This is the bridge between the propagation engine and SimulationCanvas.
//  It mirrors the API of the old calculateDistanceWithDeceleration but
//  uses the full DBM with interactions.

export type PropagationEngine = ReturnType<typeof createPropagationEngine>;

// --- END OF FILE utils/heliosphericPropagation.ts ---