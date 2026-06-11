// --- START OF FILE src/components/docs/DocCMEPhysics.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, Callout } from './DocPrimitives';

const DocCMEPhysics: React.FC = () => (
  <Section
    id="s06"
    number="06"
    title="CME Propagation Physics"
    subtitle="The CME Visualization uses two propagation models. The full physics engine (heliosphericPropagation.ts) handles speed queries and colour transitions. A simpler empirical model handles scene positioning. Both run entirely in the browser at 60 fps."
  >
    <SubHeading color="text-pink-400">Drag-Based Model (DBM) — Vršnak et al. 2013</SubHeading>
    <CardGrid cols={2}>
      <Card icon="📐" title="Governing Equation">
        <p>CMEs propagate through the heliosphere subject to aerodynamic-like drag from the ambient solar wind:</p>
        <Formula note="Inner boundary: 21.5 solar radii (≈0.1 AU) — DBM is only valid beyond the solar wind acceleration zone. Max propagation window: 10 days. Trajectory precomputed at 60 s timesteps; per-frame queries use O(log n) binary-search interpolation. Refs: Vršnak et al. 2013, Solar Phys. 285:295">
{`dv/dt = −γ · (v − w) · |v − w|

v = CME radial speed (km/s)
w = ambient solar wind speed (km/s)
γ = drag parameter (km⁻¹)

Analytical solution (decelerating CME, v₀ > w):
v(t) = w + (v₀ − w) / (1 + γ·(v₀−w)·t)
r(t) = r₀ + w·t + ln(1 + γ·(v₀−w)·t) / γ

Accelerating CME (v₀ < w):
v(t) = w − (w − v₀) / (1 + γ·(w−v₀)·t)
r(t) = r₀ + w·t − ln(1 + γ·(w−v₀)·t) / γ`}
        </Formula>
      </Card>
      <Card icon="🎛" title="Drag Parameter γ — Per-CME Estimation">
        <p>γ is estimated from the GCS cone parameters in the DONKI catalog. Exact formulas from <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">estimateGamma()</code>:</p>
        <Formula note="Operational range 0.1–2.0 × 10⁻⁷ km⁻¹ is consistent with the statistical distribution from Vršnak et al. 2013 and Dumbović et al. 2021. The speed exponent of −0.55 reflects that faster CMEs are empirically less drag-affected per unit distance.">
{`speedClamp  = clamp(speed, 200, 3000) km/s

speedFactor = 1.8 × (400 / speedClamp)^0.55
  → higher speed = lower drag (more massive)

halfAngle   = clamp(halfAngle, 10, 90) °
widthFactor = 0.7 + 0.6 × (halfAngle / 45)
  → wider CME = more drag (larger cross-section)

γ = speedFactor × widthFactor × 10⁻⁷ km⁻¹
  clamped to [0.05, 5.0] × 10⁻⁷ km⁻¹`}
        </Formula>
      </Card>
      <Card icon="💨" title="Ambient Wind Speed Model">
        <p>The background solar wind speed w is not a single constant — it is computed per-CME from three inputs in <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">getAmbientWindSpeed()</code>:</p>
        <Formula note="The Gaussian angular weighting means a CME propagating directly through a CH influence corridor sees the maximum HSS boost; those at the edge see proportionally less.">
{`1. Measured baseline: latest L1 speed from IMAP/DSCOVR
   (default 380 km/s if unavailable)

2. HSS contribution: for each detected coronal hole,
   compute angular separation to CME path.
   If within influenceRadius = max(15°, CH_width × 0.7):

   temporalProfile(dtHours):
     0–18h:   ramp up   (= dtHours / 18)
     18–54h:  plateau   (= 1.0)
     54–102h: decay     (= linear to 0)

   angularWeight = exp(−0.5 × (dLon / (r×0.5))²)
   hssBoost = (peakSpeed − 380) × profile × weight

3. Preconditioning correction applied separately`}
        </Formula>
      </Card>
      <Card icon="🌊" title="CME–CME Preconditioning & Compression">
        <p><strong className="text-green-400">Preconditioning</strong> — a leading CME creates a rarefied wake with reduced ambient density, reducing drag on a following CME:</p>
        <Formula note="A follower erupting 1 day after a leader sees ~40% drag reduction. 3.5 days later: ~18%. 7 days later: ~3%. Temmer et al. 2017 found preconditioning lasts 2–5 days. Refs: Temmer et al. 2017, ApJ 835:141">
{`preconditionDecay = exp(−dt_eruption / (3.5×86400))
  τ ≈ 3.5 days

precondFactor = 1.0 − 0.5 × preconditionDecay
  range [0.5, 1.0]; 0.5 = max 50% drag reduction

γ_effective = γ × precondFactor`}
        </Formula>
        <p className="mt-2"><strong className="text-amber-400">Compression</strong> — when a following CME is within 0.05 AU of a leading one:</p>
        <Formula>
{`gap_km = leader_dist − follower_dist

if 0 < gap_km < 0.05 AU (7.5M km):
  intensity   = 1 − gap_km / (0.05×AU)
  densityBoost = max(existing, 1.0 + 2.0 × intensity)`}
        </Formula>
      </Card>
    </CardGrid>

    <SubHeading color="text-pink-400">Scene Positioning — Simple Deceleration Model</SubHeading>
    <Card>
      <p>While the DBM engine handles speed queries, the actual 3D position of each CME mesh uses a simpler empirical formula from <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">calculateDistanceWithDeceleration()</code>:</p>
      <Formula note="For Earth-directed CMEs with a confirmed DONKI arrival time, scene position is interpolated directly between the start time and arrival time — the model is not used. This ensures confirmed Earth-directed events hit Earth exactly when NASA predicts.">
{`a (m/s²) = 1.41 − 0.0035 × speed_km/s
a (km/s²) = a_ms2 / 1000.0

If a ≥ 0 (no decel):
  dist = u·t + 0.5·a·t²

If a < 0 (decelerating):
  t_floor = (MIN_SPEED − u) / a    [time to reach 300 km/s]

  if t < t_floor:
    dist = u·t + 0.5·a·t²
  else:
    dist = (u·t_floor + 0.5·a·t_floor²) + 300×(t − t_floor)

Scene units = dist / AU_IN_KM × SCENE_SCALE
  AU_IN_KM   = 149,597,870.7
  SCENE_SCALE = 3.0`}
      </Formula>
    </Card>

    <SubHeading color="text-pink-400">GCS Flux-Rope Geometry</SubHeading>
    <Card>
      <p>Each CME is rendered as a particle cloud shaped like a GCS (Graduated Cylindrical Shell) flux rope. The geometry expands self-similarly as the CME propagates:</p>
      <Formula note="The propagation direction is set by the DONKI longitude and latitude values. Each CME is an oriented Three.js mesh — the GCS arc opens perpendicular to the propagation vector. Particle positions are laid out along helical paths on the arc with animated arrow textures showing the flux-rope structure.">
{`GCS_ARC_RADIUS_FRAC  = 0.55   (arc/scale ratio)
GCS_ARC_SPAN         = π × 0.85   (≈153° half-arc)
GCS_AXIAL_DEPTH_FRAC = 0.38   (depth vs lateral extent)

lateral = max(dist × tan(halfAngle°), sunRadius × 0.3)
sXZ     = lateral / GCS_ARC_RADIUS_FRAC
CME scale: (sXZ, sXZ × 0.38, sXZ)`}
      </Formula>
    </Card>
  </Section>
);

export default DocCMEPhysics;