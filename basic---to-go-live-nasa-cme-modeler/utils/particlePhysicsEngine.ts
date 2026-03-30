// --- START OF FILE utils/particlePhysicsEngine.ts ---
//
// ═══════════════════════════════════════════════════════════════════════════════
//  PER-PARTICLE CME / HSS PHYSICS ENGINE
//  Particle-Level Drag-Based Ensemble Model (DBEM) for Space Weather Forecasting
// ═══════════════════════════════════════════════════════════════════════════════
//
//  SCIENTIFIC BASIS
//  ────────────────
//  This engine extends the bulk Drag-Based Model (Vršnak et al. 2013) to the
//  particle level, treating each CME plasma parcel as an independent tracer
//  subject to its own drag-based equation of motion.
//
//  This mirrors the Drag-Based Ensemble Model (DBEM) philosophy from
//  Dumbović et al. (2018) and Čalogović et al. (2021), where an ensemble of
//  runs with varied γ and w inputs samples the forecast probability
//  distribution. Here, the ensemble IS the particle cloud: every particle in
//  the CME volume is an independent ensemble member.
//
//  KEY PHYSICS PER PARTICLE
//  ─────────────────────────
//  1. SPEED GRADIENT (Cone Model — Žic et al. 2015, Astrophys. J. Suppl. 218:32)
//     A CME is NOT a rigid body. The nose (θ=0) propagates at the measured
//     plane-of-sky speed v_nose. A flank element at angular offset α from the
//     nose propagates at:
//       v0(α) = v_nose · cos(α)
//     This differential propagation creates the observed "pancaking" deformation
//     where the radial extent shrinks relative to lateral extent (Riley & Crooker
//     2004; Savani et al. 2010; Hinterreiter et al. 2021).
//
//  2. DRAG PARAMETER ENSEMBLE (Dumbović et al. 2021, J. Geophys. Res.)
//     γ varies ~factor of 10 across real CMEs due to CME mass, cross-section,
//     and solar wind density. Each particle samples:
//       γᵢ = γ_base · exp(N(0, σ_γ))  where σ_γ = 0.3 (natural log)
//     This gives ±30% scatter in drag, consistent with Dumbović et al.'s
//     operational DBEM range and Napoletano et al. (2018, SWSC 8:A19).
//
//  3. AMBIENT SOLAR WIND VARIATION (Coronal Hole / HSS Corridors)
//     Particles whose angular propagation direction falls within an HSS
//     corridor (from detected coronal holes) receive wᵢ = w_HSS, while
//     particles outside the corridor receive wᵢ = w_slow. This models
//     the differential acceleration / deceleration across the CME body as
//     parts of it interact with fast-wind streams.
//     (Skov & Nitta 2016, AGU SH13B-2294M; Temmer et al. 2017 for CH-CME)
//
//  4. FLUX ROPE Bz STRUCTURE (Bothmer–Schwenn model, A&A 1998)
//     Each particle carries a Bz field value determined by:
//       • Its position in the GCS torus cross-section (azimuth φ)
//       • The source hemisphere chirality (N → right-handed SEN type;
//         S → left-handed NES type)
//       • A flux rope coherence factor reduced by interaction flags
//     The particle distribution of Bz gives an in-situ profile estimate at 1 AU.
//
//  5. PROPAGATION FORMULA (Vršnak & Žic 2007, A&A 472:937)
//     Analytical solution to dv/dt = -γ(v-w)|v-w|:
//       v(t) = w + (v₀-w) / (1 + γ·|v₀-w|·t)
//       r(t) = r₀ + w·t + sign(dv)·ln(1 + γ·|v₀-w|·t) / γ
//     Computed analytically per particle per frame — no numerical integration
//     required, enabling O(N) update at 60fps for N = 15,000 particles.
//
//  ARRIVAL STATISTICS
//  ──────────────────
//  The distribution of particle arrival times at 1 AU directly yields:
//    • P5/P50/P95 arrival time bounds
//    • Prediction uncertainty σ (hours) — directly comparable to DBEM's ~10h MAE
//    • Peak speed at 1 AU (from leading-edge particles)
//    • Bz profile: the ordered Bz values at arrival constitute the flux rope
//      in-situ measurement signature
//
// ═══════════════════════════════════════════════════════════════════════════════

import { CoronalHole } from './coronalHoleData';

// ─── Physical Constants ──────────────────────────────────────────────────────
export const AU_KM_PPE           = 149_597_870.7;  // 1 AU in km
export const R_SUN_KM_PPE        = 695_700;        // Solar radius (km)
export const R_INNER_KM_PPE      = 21.5 * R_SUN_KM_PPE; // DBM inner boundary (~0.1 AU)
const SLOW_WIND_DEFAULT_PPE      = 380;            // Default slow solar wind (km/s)
const GAMMA_SCALE_PPE            = 1e-7;           // Base drag scale factor (km⁻¹)

// ─── GCS Geometry Constants (must match SimulationCanvas) ────────────────────
const GCS_ARC_RADIUS_FRAC_PPE  = 0.55;
const GCS_ARC_SPAN_PPE         = Math.PI * 0.85;
const GCS_TUBE_RADIUS_FRAC_PPE = 0.52;
const GCS_ARC_HALF_SPAN_PPE    = GCS_ARC_SPAN_PPE * 0.5;

// ─── Particle Count Tuning ───────────────────────────────────────────────────
// Per-CME particle counts for physics mode — deliberately heavy per user request.
// More particles = higher ensemble diversity + more realistic visual texture.
const MIN_PARTICLES = 10_000;
const MAX_PARTICLES = 20_000;

function getPhysicsParticleCount(speedKms: number): number {
  // Scale with CME speed: faster CMEs are more energetic and deserve finer resolution.
  // Range: 10K (slow, 300 km/s) → 20K (extreme, 3000 km/s)
  const t = Math.min(1, Math.max(0, (speedKms - 300) / 2700));
  return Math.floor(MIN_PARTICLES + t * (MAX_PARTICLES - MIN_PARTICLES));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-particle fixed data. Set at initialization, never mutated.
 * Packed as two flat Float32Arrays for cache-efficient iteration.
 */
export interface ParticlePhysicsData {
  // GCS local space position (normalized, in arc units where arcR = 0.55)
  // These are the raw (x,y,z) from the GCS particle generator
  nx: number;       // lateral (cross-arc)
  ny: number;       // radial depth (ny < 0 = trailing)
  nz: number;       // out-of-plane
  arcT: number;     // GCS arc parameter (for speed gradient computation)
  tubePhi: number;  // cross-section azimuth (for Bz)
  tubeRhoNorm: number; // normalized tube radius fraction [0,1]
  isTrailing: boolean;
  trailingDepth: number; // 0 = leading, 1 = deep trailing (for speed reduction)

  // DBM physics (per-particle, immutable after init)
  v0Kms: number;    // initial speed (km/s) at R_INNER
  gammaKm1: number; // drag parameter (km⁻¹)
  wKms: number;     // ambient solar wind speed (km/s)

  // Pre-derived for O(1) per frame
  dv: number;       // v0 - w
  signDv: number;   // sign of (v0 - w)
  absDv: number;    // |v0 - w|
  gammaDvProduct: number; // gamma * absDv (used in denominator)

  // Bz contribution from flux rope topology
  bzNorm: number;   // normalized ∈ [-1, 1]; sign = polarity direction
}

export interface ArrivalStats {
  /** Arrival time percentiles (ms since epoch) — null if CME misses Earth */
  p05Ms: number | null;
  p25Ms: number | null;
  p50Ms: number | null;
  p75Ms: number | null;
  p95Ms: number | null;
  /** Predicted arrival speed at 1 AU (km/s) — from median particle */
  medianArrivalSpeedKms: number;
  /** 1-sigma uncertainty on arrival time (hours) */
  sigmaHours: number;
  /** Fraction of particles reaching 1 AU (Earth-impact fraction) */
  impactFraction: number;
  /** Peak southward Bz estimate (nT) — negative = storm potential */
  peakBzNt: number;
  /** Integrated Bz-south exposure (nT·hr) — proxy for Dst depression */
  bzSouthIntegral: number;
  /** Predicted Kp range [min, max] based on speed + Bz */
  kpRange: [number, number];
}

export interface CMEPhysicsSystemInput {
  id: string;
  startTimeMs: number;
  initialSpeedKms: number;
  longitude: number;    // Stonyhurst longitude (deg)
  latitude: number;     // Heliographic latitude (deg)
  halfAngleDeg: number;
  sourceHemisphere: 'N' | 'S' | 'unknown';
  /** From existing propagation engine interactions */
  preconditioningFactor?: number;
  /** Density enhancement (compression/cannibalism) */
  densityBoost?: number;
  /** Is this CME part of a merged complex ejecta? */
  isComplex?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAG PARAMETER ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════

function estimateBaseGamma(speedKms: number, halfAngleDeg: number): number {
  const speedClamp = Math.max(200, Math.min(3000, speedKms));
  const speedFactor = 1.8 * Math.pow(400 / speedClamp, 0.55);
  const halfAngle = Math.max(10, Math.min(90, halfAngleDeg));
  const widthFactor = 0.7 + 0.6 * (halfAngle / 45);
  const gamma = speedFactor * widthFactor * GAMMA_SCALE_PPE;
  return Math.max(0.05 * GAMMA_SCALE_PPE, Math.min(5.0 * GAMMA_SCALE_PPE, gamma));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AMBIENT SOLAR WIND (particle-level)
// ═══════════════════════════════════════════════════════════════════════════════

function getParticleAmbientWind(
  particleLonDeg: number,
  startTimeMs: number,
  hssInputs: HSSInput[],
  measuredWindKms: number | undefined,
): number {
  let w = measuredWindKms ?? SLOW_WIND_DEFAULT_PPE;

  for (const hss of hssInputs) {
    const dtSec = (startTimeMs - hss.emissionStartMs) / 1000;
    if (dtSec < 0) continue;

    const dLon = Math.abs(particleLonDeg - hss.longitude);
    const dLonWrap = Math.min(dLon, 360 - dLon);
    const influenceRadius = Math.max(15, hss.widthDeg * 0.7);
    if (dLonWrap > influenceRadius) continue;

    // Time profile (same as bulk engine)
    const rampHours = 18, plateauHours = 36, decayHours = 48;
    const dtHours = dtSec / 3600;
    let profile = 0;
    if (dtHours < rampHours) {
      profile = dtHours / rampHours;
    } else if (dtHours < rampHours + plateauHours) {
      profile = 1.0;
    } else if (dtHours < rampHours + plateauHours + decayHours) {
      profile = 1.0 - (dtHours - rampHours - plateauHours) / decayHours;
    }

    const angularWeight = Math.exp(-0.5 * Math.pow(dLonWrap / (influenceRadius * 0.5), 2));
    const hssBoost = (hss.peakSpeedKms - SLOW_WIND_DEFAULT_PPE) * profile * angularWeight;
    w = Math.max(w, SLOW_WIND_DEFAULT_PPE + hssBoost);
  }

  return w;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FLUX ROPE Bz PER PARTICLE
//  Bothmer–Schwenn (1998), refined by Mulligan & Russell (2001).
//  Flux rope type depends on source hemisphere and tilt angle.
//  Right-handed (NES/ENS/SEN): typical for northern-hemisphere eruptions.
//  Left-handed (SEN/NES/ENW): typical for southern-hemisphere eruptions.
// ═══════════════════════════════════════════════════════════════════════════════

function computeParticleBz(
  tubePhi: number,           // azimuth in flux rope cross-section [0, 2π]
  ejectaPhaseNorm: number,   // 0 = leading edge, 1 = trailing edge
  sourceHemisphere: 'N' | 'S' | 'unknown',
  isComplex: boolean,
): number {
  // Flux rope field: Lundquist solution gives B_z(r) ∝ J_0(α·r)
  // For a cross-section point at azimuth φ and normalized radius ρ:
  //   B_axial(φ, ρ) ≈ cos(ρ·π/2)           (axial field, peaks at center)
  //   B_toroidal(φ, ρ) ≈ sin(ρ·π/2)·sin(φ)  (toroidal wind component)
  //
  // The in-situ Bz signature is primarily the axial field component
  // modulated by the spacecraft's impact parameter through the flux rope.
  // We model it as a coherent rotation through the ejecta:

  // Rotation angle from leading to trailing edge
  const rotAngle = ejectaPhaseNorm * Math.PI;

  // Base amplitude: flux rope azimuth modulates the coherent Bz contribution
  // (spacecraft cuts through different parts of the flux rope)
  const azimuthalWeight = 0.5 + 0.5 * Math.cos(tubePhi);

  // Chirality-dependent rotation direction
  let bzNorm: number;
  if (sourceHemisphere === 'N') {
    // SEN type: Bz starts southward (negative), rotates north
    bzNorm = -Math.cos(rotAngle) * azimuthalWeight;
  } else if (sourceHemisphere === 'S') {
    // NES type: Bz starts northward (positive), rotates south
    bzNorm = Math.cos(rotAngle) * azimuthalWeight;
  } else {
    // Unknown: statistical mixture, slight south bias (more often geoeffective)
    bzNorm = -0.6 * Math.cos(rotAngle) * azimuthalWeight;
  }

  // Complex ejecta: field is disordered → reduce coherence
  if (isComplex) bzNorm *= 0.35;

  return bzNorm;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FAST COLOR LOOKUP
//  Mirrors getCmeCoreColor from SimulationCanvas but returns [r, g, b] floats
//  for direct insertion into the THREE.js vertex color buffer.
// ═══════════════════════════════════════════════════════════════════════════════

const COLOR_STOPS = [
  { speed: 0,    r: 0.502, g: 0.502, b: 0.502 }, // grey
  { speed: 350,  r: 0.502, g: 0.502, b: 0.502 }, // grey
  { speed: 500,  r: 1.000, g: 1.000, b: 0.000 }, // yellow
  { speed: 800,  r: 1.000, g: 0.647, b: 0.000 }, // orange
  { speed: 1000, r: 1.000, g: 0.271, b: 0.000 }, // orangered
  { speed: 1800, r: 0.576, g: 0.439, b: 0.859 }, // purple
  { speed: 2500, r: 1.000, g: 0.412, b: 0.706 }, // hotpink
  { speed: 3000, r: 1.000, g: 0.412, b: 0.706 }, // hotpink
];

function speedToRGB(speedKms: number, out: Float32Array, base: number): void {
  const clamped = Math.max(0, Math.min(3000, speedKms));
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const start = COLOR_STOPS[i - 1];
    const end   = COLOR_STOPS[i];
    if (clamped <= end.speed) {
      const t = end.speed === start.speed
        ? 0
        : (clamped - start.speed) / (end.speed - start.speed);
      out[base]     = start.r + t * (end.r - start.r);
      out[base + 1] = start.g + t * (end.g - start.g);
      out[base + 2] = start.b + t * (end.b - start.b);
      return;
    }
  }
  out[base] = 1.0; out[base + 1] = 0.412; out[base + 2] = 0.706;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARTICLE GENERATOR
//  Produces a physically motivated ensemble of particles filling the GCS volume.
//  Uses the same GCS geometry as SimulationCanvas for visual consistency.
// ═══════════════════════════════════════════════════════════════════════════════

function generatePhysicsParticles(
  cme: CMEPhysicsSystemInput,
  hssInputs: HSSInput[],
  measuredWindKms: number | undefined,
  nParticles: number,
  seed: number,  // deterministic random seed for reproducibility
): ParticlePhysicsData[] {
  const halfAngleRad = cme.halfAngleDeg * Math.PI / 180;
  const arcR         = GCS_ARC_RADIUS_FRAC_PPE;
  const baseTubeR    = GCS_TUBE_RADIUS_FRAC_PPE * arcR;
  const halfSpan     = GCS_ARC_HALF_SPAN_PPE;
  const backDepthFrac = 0.70;

  const baseGamma = estimateBaseGamma(cme.initialSpeedKms, cme.halfAngleDeg)
    * (cme.preconditioningFactor ?? 1.0);
  const densityBoost = cme.densityBoost ?? 1.0;

  // Seeded PRNG (xoshiro128** variant — fast, good distribution)
  let s0 = (seed ^ 0xdeadbeef) >>> 0;
  let s1 = (seed * 1664525 + 1013904223) >>> 0;
  let s2 = (s1 ^ (s1 >> 13)) >>> 0;
  let s3 = (s2 + s0) >>> 0;
  const rand = (): number => {
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t; s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return (s0 >>> 0) / 0x100000000;
  };
  const randNorm = (): number => {
    // Box-Muller for normal distribution
    const u1 = Math.max(1e-10, rand()), u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const particles: ParticlePhysicsData[] = [];
  const mainCount = Math.floor(nParticles * 0.65);
  const tailCount = nParticles - mainCount;

  // ── Main arc particles (GCS croissant body) ─────────────────────────────
  for (let i = 0; i < mainCount; i++) {
    const t   = (rand() * 2 - 1) * halfSpan;
    const cx  = arcR * Math.sin(t);
    const cy  = arcR * (Math.cos(t) - 1);  // ≤ 0
    const Nx  = -Math.sin(t);
    const Ny  = -Math.cos(t);

    // Taper: stadium cap profile
    const tNorm = Math.abs(t / halfSpan);
    const capStart = 0.70;
    let taper: number;
    if (tNorm <= capStart) {
      taper = 1.0 - 0.18 * (tNorm / capStart);
    } else {
      const u = (tNorm - capStart) / (1.0 - capStart);
      taper = 0.82 * Math.sqrt(Math.max(0, 1 - u * u));
    }
    taper = Math.max(taper, 0.06);

    const tubeR     = baseTubeR * taper;
    const rhoNorm   = rand();
    const rho       = Math.sqrt(rhoNorm) * tubeR;
    const phi       = rand() * 2 * Math.PI;

    const nx_gcs = cx + rho * Math.cos(phi) * Nx;
    const ny_gcs = cy + rho * Math.cos(phi) * Ny;
    const nz_gcs = rho * Math.sin(phi);

    // ── Physical parameters ─────────────────────────────────────────────
    // Angular offset from nose → speed gradient (cone model)
    const alpha = Math.abs(t) / halfSpan * halfAngleRad;
    const v0base = cme.initialSpeedKms * Math.cos(alpha);

    // Drag parameter ensemble scatter
    const gammaScatter = Math.exp(randNorm() * 0.30);  // ±30% log-normal (DBEM)
    // Higher density boost → more drag at the enhanced interface
    const densityGammaFactor = densityBoost > 1.0 ? 1.0 + 0.3 * Math.log(densityBoost) : 1.0;
    const gamma = baseGamma * gammaScatter * densityGammaFactor;

    // Angular offset of this particle's propagation direction in Stonyhurst longitude
    const particleLon = cme.longitude + Math.sign(t) * (alpha * 180 / Math.PI);
    const w = getParticleAmbientWind(particleLon, cme.startTimeMs, hssInputs, measuredWindKms);

    // Small v0 scatter (initial speed uncertainty from coronagraph measurement ±5%)
    const v0 = v0base * (1.0 + randNorm() * 0.05);

    // Bz: azimuthal position in cross-section
    const bzNorm = computeParticleBz(phi, 0.0, cme.sourceHemisphere, cme.isComplex ?? false);

    const dv = v0 - w;
    const absDv = Math.abs(dv);
    particles.push({
      nx: nx_gcs, ny: ny_gcs, nz: nz_gcs,
      arcT: t, tubePhi: phi, tubeRhoNorm: rhoNorm,
      isTrailing: false, trailingDepth: 0,
      v0Kms: v0, gammaKm1: gamma, wKms: w,
      dv, signDv: Math.sign(dv) || 1, absDv,
      gammaDvProduct: gamma * absDv,
      bzNorm,
    });
  }

  // ── Tail particles (trailing ejecta body, converging toward apex) ────────
  for (let i = 0; i < tailCount; i++) {
    const t  = (rand() * 2 - 1) * halfSpan;
    const cx = arcR * Math.sin(t);
    const cy = arcR * (Math.cos(t) - 1);
    const Nx = -Math.sin(t);
    const Ny = -Math.cos(t);

    const depthFrac  = Math.pow(rand(), 2.1);  // strong front bias
    const depthCurve = Math.pow(depthFrac, 1.55);
    const depthY     = -depthCurve * backDepthFrac * arcR;

    const toApex    = Math.pow(depthFrac, 1.15);
    const tailCx    = cx * (1 - toApex);
    const tailCy    = cy * (1 - toApex) + (-arcR * 1.10) * toApex;

    const arcTaper   = 0.25 + 0.75 * Math.pow(1 - Math.abs(t / halfSpan), 1.9);
    const depthTaper = Math.max(0.10, 1.0 - Math.pow(depthFrac, 0.72) * 0.90);
    const apexTaper  = Math.max(0.08, 1.0 - toApex * 0.94);
    const tubeR      = baseTubeR * arcTaper * depthTaper * apexTaper;

    const rhoNorm  = rand();
    const rho      = Math.sqrt(rhoNorm) * tubeR;
    const phi      = rand() * 2 * Math.PI;

    const nx_gcs = tailCx + rho * Math.cos(phi) * Nx;
    const ny_gcs_raw = tailCy + rho * Math.cos(phi) * Ny + depthY;
    if (ny_gcs_raw < -arcR * backDepthFrac * 1.05) continue; // clamp tail

    const nz_gcs = rho * Math.sin(phi);

    // Trailing particles propagate slower:
    // depth > 0 means the plasma was further back in the ejection process
    // Initial speed reduced proportionally (Démoulin & Dasso 2009)
    const alpha = Math.abs(t) / halfSpan * halfAngleRad;
    const v0base = cme.initialSpeedKms * Math.cos(alpha) * (1.0 - 0.30 * depthFrac);
    const v0 = v0base * (1.0 + randNorm() * 0.05);

    const gammaScatter = Math.exp(randNorm() * 0.30);
    const densityGammaFactor = densityBoost > 1.0 ? 1.0 + 0.3 * Math.log(densityBoost) : 1.0;
    const gamma = baseGamma * gammaScatter * densityGammaFactor;

    const particleLon = cme.longitude + Math.sign(t) * (alpha * 180 / Math.PI);
    const w = getParticleAmbientWind(particleLon, cme.startTimeMs, hssInputs, measuredWindKms);

    // Bz: trailing particles carry flux rope field of later ejecta passage
    const ejectaPhase = 0.3 + 0.7 * depthFrac; // trailing: phi 0.3→1.0
    const bzNorm = computeParticleBz(phi, ejectaPhase, cme.sourceHemisphere, cme.isComplex ?? false);

    const dv = v0 - w;
    const absDv = Math.abs(dv);
    particles.push({
      nx: nx_gcs, ny: ny_gcs_raw, nz: nz_gcs,
      arcT: t, tubePhi: phi, tubeRhoNorm: rhoNorm,
      isTrailing: true, trailingDepth: depthFrac,
      v0Kms: v0, gammaKm1: gamma, wKms: w,
      dv, signDv: Math.sign(dv) || 1, absDv,
      gammaDvProduct: gamma * absDv,
      bzNorm,
    });
  }

  return particles;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  HSS INPUT TYPE (same as heliosphericPropagation.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export interface HSSInput {
  longitude: number;
  latitude: number;
  peakSpeedKms: number;
  widthDeg: number;
  emissionStartMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CMEParticlePhysics CLASS
//  The main object per CME in physics mode.
//  Created once per CME when physics mode activates; updated every frame.
// ═══════════════════════════════════════════════════════════════════════════════

export class CMEParticlePhysics {
  readonly cmeId: string;
  readonly startTimeMs: number;
  readonly halfAngleRad: number;
  readonly particles: ParticlePhysicsData[];
  readonly particleCount: number;

  // Pre-extracted rotation matrix components (3x3, from CME eruption quaternion)
  // Computed once when the CME quaternion is known.
  private m00 = 1; private m01 = 0; private m02 = 0;
  private m10 = 0; private m11 = 1; private m12 = 0;
  private m20 = 0; private m21 = 0; private m22 = 1;
  private dirX = 0; private dirY = 1; private dirZ = 0;

  // Pre-allocated work arrays for the arrival distribution (computed lazily)
  private _arrivalTimesCache: Float64Array | null = null;
  private _arrivalSpeedsCache: Float32Array | null = null;
  private _arrivalStatsDirty = true;
  private _cachedStats: ArrivalStats | null = null;

  constructor(
    cme: CMEPhysicsSystemInput,
    hssInputs: HSSInput[],
    measuredWindKms: number | undefined,
  ) {
    this.cmeId       = cme.id;
    this.startTimeMs = cme.startTimeMs;
    this.halfAngleRad = cme.halfAngleDeg * Math.PI / 180;
    const n = getPhysicsParticleCount(cme.initialSpeedKms);
    this.particles   = generatePhysicsParticles(cme, hssInputs, measuredWindKms, n, cme.startTimeMs & 0xffffffff);
    this.particleCount = this.particles.length;
  }

  /**
   * Set the CME eruption quaternion (called once from Three.js world).
   * Extracts the 3x3 rotation matrix and eruption direction.
   * qx/qy/qz/qw: THREE.Quaternion components.
   */
  setQuaternion(qx: number, qy: number, qz: number, qw: number): void {
    // Rotation matrix from quaternion
    this.m00 = 1 - 2 * (qy * qy + qz * qz);
    this.m01 = 2 * (qx * qy - qw * qz);
    this.m02 = 2 * (qx * qz + qw * qy);
    this.m10 = 2 * (qx * qy + qw * qz);
    this.m11 = 1 - 2 * (qx * qx + qz * qz);
    this.m12 = 2 * (qy * qz - qw * qx);
    this.m20 = 2 * (qx * qz - qw * qy);
    this.m21 = 2 * (qy * qz + qw * qx);
    this.m22 = 1 - 2 * (qx * qx + qy * qy);
    // Eruption direction = rotation * (0, 1, 0) = second column
    this.dirX = this.m01;
    this.dirY = this.m11;
    this.dirZ = this.m21;
    this._arrivalStatsDirty = true;
  }

  /**
   * Core per-frame update. Computes all particle positions and colors.
   *
   * @param elapsedSec   Seconds since CME eruption (from propagation engine clock)
   * @param sceneScale   Scene scale factor (SCENE_SCALE constant, default 3.0)
   * @param sunRadiusScene  Physical sun radius in scene units
   * @param outPositions  Pre-allocated Float32Array, length = particleCount * 3
   * @param outColors     Pre-allocated Float32Array, length = particleCount * 3 (RGB floats)
   */
  computeAll(
    elapsedSec: number,
    sceneScale: number,
    sunRadiusScene: number,
    outPositions: Float32Array,
    outColors: Float32Array,
  ): void {
    if (elapsedSec < 0) return;

    const {
      m00, m01, m02,
      m10, m11, m12,
      m20, m21, m22,
      dirX, dirY, dirZ,
    } = this;

    const arcR = GCS_ARC_RADIUS_FRAC_PPE;
    const tanHA = Math.tan(this.halfAngleRad);

    const n = this.particleCount;
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];

      // ── Analytical DBM: position at elapsedSec ──────────────────────────
      // r(t) = r0 + w·t + sign(dv)·ln(1 + γ·|dv|·t) / γ
      let r_km: number;
      if (p.absDv < 1.0) {
        // Speed ≈ ambient wind — negligible drag, linear propagation
        r_km = R_INNER_KM_PPE + p.wKms * elapsedSec;
      } else {
        const denominator = 1.0 + p.gammaDvProduct * elapsedSec;
        r_km = R_INNER_KM_PPE + p.wKms * elapsedSec
             + p.signDv * Math.log(denominator) / p.gammaKm1;
      }
      r_km = Math.max(R_INNER_KM_PPE, r_km);

      // ── Current speed (for color) ───────────────────────────────────────
      let v_kms: number;
      if (p.absDv < 1.0) {
        v_kms = p.wKms;
      } else {
        const denom = 1.0 + p.gammaDvProduct * elapsedSec;
        v_kms = p.wKms + p.signDv * p.absDv / denom;
      }
      v_kms = Math.max(p.wKms * 0.9, v_kms); // don't overshoot below wind

      // ── Self-similar scale (same formula as updateCMEShape) ─────────────
      // lateral = max(dist * tan(halfAngle), sunRadius * 0.3)
      // sXZ = lateral / GCS_ARC_RADIUS_FRAC
      // sY  = lateral
      const r_scene = (r_km / AU_KM_PPE) * sceneScale;
      const dist_scene = Math.max(0, r_scene - sunRadiusScene);
      const lateral = Math.max(dist_scene * tanHA, sunRadiusScene * 0.3);
      const sXZ = lateral / arcR;
      const sY  = lateral;

      // ── Scale GCS normalized position ────────────────────────────────────
      const lx = p.nx * sXZ;
      const ly = p.ny * sY;
      const lz = p.nz * sXZ;

      // ── Rotate by CME quaternion (3x3 matrix multiply) ──────────────────
      // world = M * [lx, ly, lz]^T + dir * r_scene
      const wx = m00 * lx + m01 * ly + m02 * lz + dirX * r_scene;
      const wy = m10 * lx + m11 * ly + m12 * lz + dirY * r_scene;
      const wz = m20 * lx + m21 * ly + m22 * lz + dirZ * r_scene;

      const base = i * 3;
      outPositions[base]     = wx;
      outPositions[base + 1] = wy;
      outPositions[base + 2] = wz;

      // ── Per-particle color from current speed ────────────────────────────
      speedToRGB(v_kms, outColors, base);
    }
  }

  /**
   * Compute arrival time distribution at 1 AU.
   * Called lazily; cached until quaternion changes.
   * This is the key forecast output: it gives the uncertainty bounds
   * on arrival time, matching DBEM's probabilistic forecast approach.
   */
  getArrivalStats(nowMs?: number): ArrivalStats {
    if (!this._arrivalStatsDirty && this._cachedStats) return this._cachedStats;

    const arrivalTimesMs: number[] = [];
    const arrivalSpeeds:  number[] = [];
    const bzAtArrival:    number[] = [];

    const earthDist = AU_KM_PPE;
    const maxTimeSec = 10 * 86400;
    const dtSec = 60; // 60-second timesteps for arrival search

    for (const p of this.particles) {
      // Find when this particle crosses 1 AU analytically
      let arrivalSec: number | null = null;
      let arrivalSpeed = p.wKms;

      if (p.absDv < 1.0) {
        // Linear: r = R_INNER + w * t → t_arr = (1AU - R_INNER) / w
        const tArr = (earthDist - R_INNER_KM_PPE) / p.wKms;
        if (tArr > 0 && tArr < maxTimeSec) {
          arrivalSec = tArr;
          arrivalSpeed = p.wKms;
        }
      } else {
        // Use Newton's method to find crossing (analytical DBM has no closed-form inverse)
        // Since r(t) is monotonically increasing (mostly), bisection works reliably
        let lo = 0, hi = maxTimeSec;
        // Check if it actually reaches 1 AU
        const rHi = R_INNER_KM_PPE + p.wKms * hi
          + p.signDv * Math.log(1.0 + p.gammaDvProduct * hi) / p.gammaKm1;
        if (rHi < earthDist) continue; // this particle misses 1 AU in 10 days

        // Bisection to 1-minute accuracy
        for (let iter = 0; iter < 20; iter++) {
          const mid = (lo + hi) * 0.5;
          const rMid = R_INNER_KM_PPE + p.wKms * mid
            + p.signDv * Math.log(1.0 + p.gammaDvProduct * mid) / p.gammaKm1;
          if (rMid < earthDist) lo = mid; else hi = mid;
        }
        arrivalSec = (lo + hi) * 0.5;
        // Speed at arrival
        const denom = 1.0 + p.gammaDvProduct * arrivalSec;
        arrivalSpeed = p.wKms + p.signDv * p.absDv / denom;
      }

      if (arrivalSec !== null) {
        arrivalTimesMs.push(this.startTimeMs + arrivalSec * 1000);
        arrivalSpeeds.push(arrivalSpeed);
        bzAtArrival.push(p.bzNorm);
      }
    }

    if (arrivalTimesMs.length === 0) {
      this._cachedStats = {
        p05Ms: null, p25Ms: null, p50Ms: null, p75Ms: null, p95Ms: null,
        medianArrivalSpeedKms: 0, sigmaHours: 0, impactFraction: 0,
        peakBzNt: 0, bzSouthIntegral: 0, kpRange: [0, 0],
      };
      this._arrivalStatsDirty = false;
      return this._cachedStats;
    }

    // Sort arrival times
    arrivalTimesMs.sort((a, b) => a - b);
    const N = arrivalTimesMs.length;
    const pctile = (p: number): number =>
      arrivalTimesMs[Math.floor(Math.min(0.9999, p) * N)];

    const p50Ms = pctile(0.50);
    const p05Ms = pctile(0.05);
    const p25Ms = pctile(0.25);
    const p75Ms = pctile(0.75);
    const p95Ms = pctile(0.95);

    // 1-sigma: (p84 - p16) / 2
    const p16 = pctile(0.16), p84 = pctile(0.84);
    const sigmaHours = ((p84 - p16) / 2) / (3600 * 1000);

    // Median arrival speed
    const sortedSpeeds = [...arrivalSpeeds].sort((a, b) => a - b);
    const medianSpeed = sortedSpeeds[Math.floor(N / 2)];

    // Bz analysis: compute nT amplitudes from normalized values
    // Amplitude scales with speed (faster CME → stronger field)
    const bzAmplitudeNt = 8 + 12 * (medianSpeed / 1500); // 8–20 nT
    const sortedBz = bzAtArrival.map(bz => bz * bzAmplitudeNt).sort((a, b) => a - b);
    const peakBzNt = sortedBz[0]; // most negative = strongest southward

    // Bz integral (nT·hr): proxy for Dst depression
    // Integrated over flux rope passage assuming 24h duration
    let bzSouthIntegral = 0;
    for (const bz of sortedBz) {
      if (bz < 0) bzSouthIntegral += Math.abs(bz) * (24 / N);
    }

    // Kp prediction (empirical, based on Menvielle & Berthelier 1991 + Newell et al. 2007)
    // Kp scales with V·Bs (southward component of B × solar wind speed)
    const vBs = medianSpeed * Math.abs(Math.min(0, peakBzNt));
    const kpMedian = Math.min(9, 0.01 * Math.pow(vBs, 0.5) * 2.0);
    const kpSigma  = kpMedian * 0.25 * sigmaHours / 12;
    const kpRange: [number, number] = [
      Math.max(0, Math.round((kpMedian - kpSigma) * 3) / 3),
      Math.min(9, Math.round((kpMedian + kpSigma + 1) * 3) / 3),
    ];

    this._cachedStats = {
      p05Ms, p25Ms, p50Ms, p75Ms, p95Ms,
      medianArrivalSpeedKms: medianSpeed,
      sigmaHours,
      impactFraction: N / this.particleCount,
      peakBzNt,
      bzSouthIntegral,
      kpRange,
    };
    this._arrivalStatsDirty = false;
    return this._cachedStats;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HSS PARTICLE PHYSICS
//  Models the High-Speed Stream as an ensemble of solar wind plasma parcels.
//  Each parcel propagates along the Parker spiral at its own speed, creating
//  a realistic velocity gradient across the SIR/HSS boundary.
// ═══════════════════════════════════════════════════════════════════════════════

export interface HSSParticleData {
  // Spiral parameters
  spiralLonOffset: number;  // angular offset from CH center (deg)
  latOffset: number;        // latitudinal offset (deg)
  speedKms: number;         // individual parcel speed
  phaseFrac: number;        // 0 = SIR leading edge, 1 = deep HSS
  // Visual
  nx: number; ny: number; nz: number;  // local Parker arm position
}

export class HSSParticlePhysics {
  readonly chId: string;
  readonly sourceLonDeg: number;
  readonly sourceLatDeg: number;
  readonly peakSpeedKms: number;
  readonly widthDeg: number;
  readonly emissionStartMs: number;
  readonly particles: HSSParticleData[];
  readonly particleCount: number;

  private static readonly N_HSS_PARTICLES = 6000;

  constructor(ch: CoronalHole) {
    this.chId            = ch.id ?? `ch-${Date.now()}`;
    this.sourceLonDeg    = ch.lon;
    this.sourceLatDeg    = ch.lat;
    this.peakSpeedKms    = Math.max(450, Math.min(900, ch.estimatedSpeedKms ?? 550));
    this.widthDeg        = ch.widthDeg ?? 20;
    this.emissionStartMs = Date.now() - (ch.lon / 360) * 27.27 * 86400 * 1000;

    this.particles = this._generateHSSParticles();
    this.particleCount = this.particles.length;
  }

  private _generateHSSParticles(): HSSParticleData[] {
    const N = HSSParticlePhysics.N_HSS_PARTICLES;
    const half = this.widthDeg * 0.5;
    const slowWind = SLOW_WIND_DEFAULT_PPE;
    const particles: HSSParticleData[] = [];

    // Parker spiral: at r_AU, the spiral angle θ = Ω_sun * (r_AU * AU_KM) / v_sw
    // We generate particles distributed along the spiral from r=0.1 AU to 1.2 AU

    for (let i = 0; i < N; i++) {
      const rand01 = (Math.sin(i * 1.618033988749895 * 1234.5) * 0.5 + 0.5); // golden ratio hash
      const rand02 = (Math.sin(i * 2.718281828 * 876.5) * 0.5 + 0.5);
      const rand03 = (Math.sin(i * 3.14159265 * 543.2) * 0.5 + 0.5);

      // Longitudinal spread across CH width (±half)
      const lonFrac = (rand01 * 2 - 1);  // -1 to +1
      const spiralLon = lonFrac * half;

      // Latitudinal spread
      const latFrac = (rand02 * 2 - 1);
      const latSpread = this.widthDeg * 0.4;
      const latOff = latFrac * latSpread;

      // Phase in stream: 0 = SIR (compressed slow wind, leading), 1 = deep HSS
      const phase = rand03;

      // Speed profile: SIR < HSS
      // SIR: slow → peak over ~0.3 of stream width (compression region)
      // HSS: peak sustained, then decays at trailing edge
      let speedKms: number;
      if (phase < 0.20) {
        // SIR: ramps from slow wind to ~0.7 × peak
        speedKms = slowWind + (this.peakSpeedKms * 0.7 - slowWind) * (phase / 0.20);
      } else if (phase < 0.75) {
        // Main HSS body
        speedKms = this.peakSpeedKms * (0.7 + 0.3 * ((phase - 0.20) / 0.55));
      } else {
        // Trailing edge decay
        speedKms = this.peakSpeedKms * (1.0 - 0.25 * ((phase - 0.75) / 0.25));
      }

      // Add small random scatter
      speedKms *= 1.0 + (rand01 - 0.5) * 0.06;

      // Parker spiral radial position (uniform distribution 0.1→1.3 AU along arm)
      const r_au_norm = 0.1 + rand03 * 1.2;

      // Parker spiral angle (in corotating frame):
      // θ_parker = Ω_sun * r_au_norm * AU_KM / speedKms  (rad)
      const omegaSun = 2.618e-6; // rad/s
      const spiralAngle = omegaSun * r_au_norm * AU_KM_PPE / speedKms; // rad (trailing outward)

      // Local position along Parker arm:
      // x (lateral) = r_au_norm * sin(spiralAngle + spiralLon*π/180)
      // y (radial)  = r_au_norm * cos(spiralAngle)
      const lonRad = spiralLon * Math.PI / 180;
      const nx = r_au_norm * Math.sin(spiralAngle + lonRad);
      const ny = r_au_norm * Math.cos(spiralAngle);
      const nz = r_au_norm * Math.sin(latOff * Math.PI / 180);

      particles.push({
        spiralLonOffset: spiralLon,
        latOffset: latOff,
        speedKms,
        phaseFrac: phase,
        nx, ny, nz,
      });
    }
    return particles;
  }

  /**
   * Update HSS particle positions into a pre-allocated Float32Array.
   * The stream's phase offset changes with simulation time as the Sun rotates.
   *
   * @param sunRotationAngle  Current solar rotation angle (radians)
   * @param sceneScale        SCENE_SCALE constant
   * @param earthLonRad       Earth's current ecliptic longitude (radians)
   * @param outPositions      Float32Array, length = particleCount * 3
   * @param outColors         Float32Array, length = particleCount * 3
   */
  computeAll(
    sunRotationAngle: number,
    sceneScale: number,
    earthLonRad: number,
    outPositions: Float32Array,
    outColors: Float32Array,
  ): void {
    // HSS source is at CH longitude (Stonyhurst, relative to Earth)
    // Convert to world-space angle: world_lon = earthLon + sourceLon * π/180
    const chWorldLon = earthLonRad + this.sourceLonDeg * Math.PI / 180;

    // Sun rotation offset applied to the stream
    const phaseOffset = sunRotationAngle;

    const scaleToScene = sceneScale; // 1 AU = sceneScale units

    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];

      // World-space angle for this arm position
      const worldAngle = chWorldLon + phaseOffset;

      // Rotate normalized position by worldAngle around Y axis
      const cosA = Math.cos(worldAngle), sinA = Math.sin(worldAngle);
      const wx = (p.nx * cosA - p.ny * sinA) * scaleToScene;
      const wy = p.nz * scaleToScene;
      const wz = (p.nx * sinA + p.ny * cosA) * scaleToScene;

      const base = i * 3;
      outPositions[base]     = wx;
      outPositions[base + 1] = wy;
      outPositions[base + 2] = wz;

      // Color: SIR = yellow/orange, HSS = cyan/blue (fast, low-density)
      const phase = p.phaseFrac;
      if (phase < 0.20) {
        // SIR: orange-yellow (compressed, denser plasma)
        const t = phase / 0.20;
        outColors[base]     = 1.0;
        outColors[base + 1] = 0.5 + 0.4 * t;
        outColors[base + 2] = 0.0;
      } else {
        // HSS: teal-cyan (fast, rarefied)
        const t = Math.min(1.0, (phase - 0.20) / 0.55);
        outColors[base]     = 0.0 + 0.1 * t;
        outColors[base + 1] = 0.7 + 0.3 * t;
        outColors[base + 2] = 0.8 + 0.2 * t;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create one CMEParticlePhysics object from a ProcessedCME-compatible input.
 * Call this when physics mode activates for a given CME.
 */
export function createCMEParticlePhysics(
  cme: CMEPhysicsSystemInput,
  coronalHoles: CoronalHole[],
  measuredWindKms: number | undefined,
): CMEParticlePhysics {
  const hssInputs: HSSInput[] = coronalHoles.map(ch => ({
    longitude: ch.lon,
    latitude: ch.lat,
    peakSpeedKms: Math.max(450, Math.min(900, ch.estimatedSpeedKms ?? 550)),
    widthDeg: ch.widthDeg ?? 20,
    emissionStartMs: Date.now() - (ch.lon / 360) * 27.27 * 86400 * 1000,
  }));
  return new CMEParticlePhysics(cme, hssInputs, measuredWindKms);
}

/**
 * Create HSSParticlePhysics from a CoronalHole object.
 */
export function createHSSParticlePhysics(ch: CoronalHole): HSSParticlePhysics {
  return new HSSParticlePhysics(ch);
}

/**
 * Convert ProcessedCME to CMEPhysicsSystemInput.
 */
export function processedCMEToPhysicsInput(cme: {
  id: string;
  startTime: Date;
  speed: number;
  longitude: number;
  latitude: number;
  halfAngle: number;
  sourceLocation?: string;
  preconditioningFactor?: number;
  densityBoost?: number;
  isComplex?: boolean;
}): CMEPhysicsSystemInput {
  let hemisphere: 'N' | 'S' | 'unknown' = 'unknown';
  if (cme.sourceLocation) {
    const match = cme.sourceLocation.match(/^([NS])/i);
    if (match) hemisphere = match[1].toUpperCase() as 'N' | 'S';
  }
  return {
    id:                   cme.id,
    startTimeMs:          cme.startTime.getTime(),
    initialSpeedKms:      cme.speed,
    longitude:            cme.longitude,
    latitude:             cme.latitude,
    halfAngleDeg:         cme.halfAngle || 30,
    sourceHemisphere:     hemisphere,
    preconditioningFactor: cme.preconditioningFactor,
    densityBoost:         cme.densityBoost,
    isComplex:            cme.isComplex,
  };
}