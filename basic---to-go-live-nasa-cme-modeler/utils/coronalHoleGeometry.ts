// --- START OF FILE utils/coronalHoleGeometry.ts ---
//
// Three.js geometry for Coronal Hole surface patches and
// Parker-spiral High-Speed Stream arms.
//
// ═══════════════════════════════════════════════════════════════
// ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════════════════════════
//
//  1. CH SURFACE PATCHES  (buildChSurfaceMesh / buildChOutlineLine)
//     ─────────────────────────────────────────────────────────────
//     Live in *sunMesh local space* — chGroup is a child of sunMesh,
//     so patches rotate automatically as sunMesh.rotation.y is driven
//     each frame. No per-frame update needed.
//
//     Heliographic coordinates from the SUVI detector are in
//     *disk-centre-relative* space (what's facing Earth right now),
//     NOT full Carrington longitude. We treat them as offsets from
//     the Sun's current facing direction — which is correct because
//     the SUVI image always shows the Earth-facing hemisphere.
//
//  2. PARKER SPIRAL HSS ARMS  (buildParkerSpiralMesh)
//     ─────────────────────────────────────────────────
//     Live in *world space*. The arm backbone is built with φ=0
//     pointing along +Z (the reference direction). The CH's Carrington
//     longitude offset (heliographic lon from SUVI, in radians) and
//     the accumulated solar rotation angle are combined in the vertex
//     shader as a single Y-rotation:
//
//         totalAngle = uChLon + uSunAngle
//
//     where:
//       uChLon    = ch.lon converted to radians (fixed at build time, updated as uniform)
//       uSunAngle = accumulated solar rotation since scene init (updated every frame)
//
//     The Parker spiral formula: r(φ) = r₀ + k·φ
//       k = v_sw / ω_sun  (scene-units per radian of solar rotation)
//
//     The arm bends backward (negative φ direction) because the solar
//     wind outpaces the sun's rotation at 1 AU. Wider CHs → faster
//     wind → tighter spiral pitch.
//
// ═══════════════════════════════════════════════════════════════
// TUNING CONSTANTS
// ═══════════════════════════════════════════════════════════════
//   SPIRAL_POINTS          backbone sample resolution
//   SPIRAL_TUBE_SIDES      tube cross-section polygon sides
//   SPIRAL_TUBE_RADIUS_FAC tube radius as fraction of SCENE_SCALE
//   SPIRAL_TURNS           how many full wraps the arm makes before ending

import { CoronalHole } from './coronalHoleData';

// ─── Tuning ───────────────────────────────────────────────────────────────────
const SPIRAL_POINTS          = 220;
const SPIRAL_TUBE_SIDES      = 8;
const SPIRAL_TUBE_RADIUS_FAC = 0.032;  // boosted so streams read in full-system view
const SPIRAL_TURNS           = 0.32;   // ~1/3 of a revolution — looser, more open spiral
// CH_OVEREMPHASIS: scaling factor for coronal hole visual patches on the Sun.
//
// Previously 1.22 (inflating CHs by 22%) to make them easier to see.
// This caused the HSS spiral to appear offset — launching from the "gap"
// between the inflated CH edge rather than from the CH itself.
//
// Now set to 1.0 (true size). The CH patches show their actual detected
// boundary from SUVI, and the HSS spiral root aligns correctly with the
// CH centroid. If CHs look too small at full zoom-out, consider a subtle
// outline glow rather than inflating the geometry.
const CH_OVEREMPHASIS        = 1.0;

// Physical constants (replicated to avoid circular dep on constants.ts)
const SCENE_SCALE       = 3.0;           // 1 scene unit ≈ 1 AU

// ─── Coordinate helper ────────────────────────────────────────────────────────

/** Heliographic (lat, lon) degrees → unit Cartesian.
 *  Scene: +Y = north pole, +Z = lon 0 toward Earth.
 *  Positive lon = East on the solar disk = positive X in scene. */
function hgToVec(THREE: any, lat: number, lon: number): any {
  const phi   = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon);  // positive lon → East → +X
  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
}

// ─── CH footprint points ──────────────────────────────────────────────────────

/** Boundary polygon on the solar sphere in sunMesh local space. */
export function buildChFootprintPoints(
  THREE: any, ch: CoronalHole, sunRadius: number
): any[] {
  const r = sunRadius * 1.003;
  const cenVec = hgToVec(THREE, ch.lat, ch.lon).normalize();
  const north = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(north, cenVec);
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(cenVec, right).normalize();

  if (ch.polygon && ch.polygon.length >= 3) {
    const pts = ch.polygon.map((v: any) => {
      const p = hgToVec(THREE, ch.lat + v.lat, ch.lon + v.lon).normalize();
      // Inflate each point slightly away from the CH centroid — do NOT re-sort.
      // buildPolygon already sorts by angle in pixel space; re-sorting here from
      // a different origin destroys all concavities and produces a convex hull
      // that looks like a perfect circle for large irregular CHs.
      return cenVec.clone().lerp(p, CH_OVEREMPHASIS).normalize().multiplyScalar(r);
    });
    pts.push(pts[0].clone()); // close the loop
    return pts;
  }

  // Ellipse fallback
  const N    = 24;
  const hw   = THREE.MathUtils.degToRad((ch.widthDeg ?? 20) / 2) * CH_OVEREMPHASIS;
  const hh   = THREE.MathUtils.degToRad((ch.heightDeg ?? ch.widthDeg ?? 20) / 2) * CH_OVEREMPHASIS;
  const cen  = hgToVec(THREE, ch.lat, ch.lon);

  const pts: any[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(
      cen.clone()
        .addScaledVector(right, Math.cos(a) * hw)
        .addScaledVector(up,    Math.sin(a) * hh)
        .normalize().multiplyScalar(r)
    );
  }
  return pts;
}

// ─── CH surface mesh ──────────────────────────────────────────────────────────

/**
 * Project a 3D sphere-surface point to 2D tangent-plane coordinates
 * centred on `cen` with basis vectors `right` and `up`.
 */
function projectTo2D(
  p: any, cen: any, right: any, up: any
): { x: number; y: number } {
  const d = p.clone().sub(cen);
  return { x: d.dot(right), y: d.dot(up) };
}

/**
 * Ear-clipping triangulation of a 2D polygon (array of {x,y}).
 * Returns flat array of triangle indices into the original vertex array.
 * Handles concave polygons correctly — unlike a fan from centre.
 */
function earClip(poly: Array<{ x: number; y: number }>): number[] {
  const n = poly.length;
  if (n < 3) return [];

  // Compute signed area to determine winding
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  // Ensure counter-clockwise winding
  const verts = area < 0 ? [...poly].reverse() : [...poly];

  const indices: number[] = [];
  const idx = Array.from({ length: n }, (_, i) => i);

  const isEar = (prev: number, curr: number, next: number): boolean => {
    const a = verts[prev], b = verts[curr], c = verts[next];
    // Must be a left turn (convex at this vertex)
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross <= 0) return false;
    // No other vertex inside this triangle
    for (const i of idx) {
      if (i === prev || i === curr || i === next) continue;
      const p = verts[i];
      // Point-in-triangle test
      const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
      const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
      const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
      const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      if (!(hasNeg && hasPos)) return false; // point is inside
    }
    return true;
  };

  let remaining = [...idx];
  let safety = n * n * 2;
  while (remaining.length > 3 && safety-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i + remaining.length - 1) % remaining.length];
      const curr = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (isEar(prev, curr, next)) {
        // Map back to original (pre-reversal) indices if needed
        const origPrev = area < 0 ? (n - 1 - prev) : prev;
        const origCurr = area < 0 ? (n - 1 - curr) : curr;
        const origNext = area < 0 ? (n - 1 - next) : next;
        indices.push(origPrev, origCurr, origNext);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break; // degenerate polygon, abort
  }
  if (remaining.length === 3) {
    const [a, b, c] = remaining;
    const origA = area < 0 ? (n - 1 - a) : a;
    const origB = area < 0 ? (n - 1 - b) : b;
    const origC = area < 0 ? (n - 1 - c) : c;
    indices.push(origA, origB, origC);
  }
  return indices;
}

/**
 * Smooth a closed polygon using a simple Gaussian-weighted moving average.
 * Reduces jagged pixel-detection artifacts while preserving the overall shape.
 * `passes` controls how many smoothing rounds to apply.
 */
function smoothPolygon(
  pts: Array<{ x: number; y: number }>,
  passes = 3,
  sigma = 1.8
): Array<{ x: number; y: number }> {
  // Build a small Gaussian kernel (5-tap)
  const ks = 5;
  const half = Math.floor(ks / 2);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = 0; i < ks; i++) {
    const d = i - half;
    const w = Math.exp(-(d * d) / (2 * sigma * sigma));
    kernel.push(w);
    ksum += w;
  }
  const k = kernel.map(w => w / ksum);

  let result = [...pts];
  for (let p = 0; p < passes; p++) {
    const n = result.length;
    const next: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0;
      for (let j = 0; j < ks; j++) {
        const idx = ((i + j - half) % n + n) % n;
        sx += result[idx].x * k[j];
        sy += result[idx].y * k[j];
      }
      next.push({ x: sx, y: sy });
    }
    result = next;
  }
  return result;
}


/** Dark patch on the solar surface. Uses ear-clipping triangulation so concave
 *  CH shapes (X, lightning-bolt, irregular blobs) render correctly without
 *  filling their convex hull. Parented to sunMesh → rotates with the sun. */
export function buildChSurfaceMesh(
  THREE: any, ch: CoronalHole, sunRadius: number
): any {
  const fp = buildChFootprintPoints(THREE, ch, sunRadius);
  // Drop the closing duplicate for triangulation
  const pts = fp[fp.length - 1] &&
    fp[0].distanceToSquared(fp[fp.length - 1]) < 1e-10
    ? fp.slice(0, -1) : fp;

  if (pts.length < 3) return new THREE.Object3D();

  // Build tangent-plane basis at the CH centroid for 2D projection
  const PATCH_R = sunRadius * 1.018;   // raised well above sun surface to avoid z-fight
  const cenVec = new THREE.Vector3();
  pts.forEach((p: any) => cenVec.add(p));
  cenVec.divideScalar(pts.length).normalize();
  const cen = cenVec.clone().multiplyScalar(PATCH_R);

  const north = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(north, cenVec);
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(cenVec, right).normalize();

  // Project polygon to 2D tangent plane, smooth, triangulate, unproject back to 3D
  const poly2d_raw = pts.map((p: any) => projectTo2D(p, cen, right, up));
  const poly2d = smoothPolygon(poly2d_raw, 1, 1.2);
  const triIdx = earClip(poly2d);

  if (triIdx.length === 0) return new THREE.Object3D();

  // Unproject smoothed 2D points back onto the sphere surface at PATCH_R
  const pts3d = poly2d.map(({ x, y }: { x: number; y: number }) =>
    cen.clone()
      .addScaledVector(right, x)
      .addScaledVector(up, y)
      .normalize()
      .multiplyScalar(PATCH_R)
  );

  const pos: number[] = [];
  for (let i = 0; i < triIdx.length; i += 3) {
    const a = pts3d[triIdx[i]], b = pts3d[triIdx[i + 1]], c = pts3d[triIdx[i + 2]];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x020204, transparent: false, opacity: 1.0,
    side: THREE.FrontSide, depthWrite: true, depthTest: true,
    blending: THREE.NormalBlending,
    polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10,
  });
  const mesh    = new THREE.Mesh(geom, mat);
  mesh.name     = `ch-surface-${ch.id}`;
  mesh.userData = { coronalHoleId: ch.id };
  mesh.renderOrder = 3;
  return mesh;
}

// ─── CH outline ───────────────────────────────────────────────────────────────

/** Bright border around the dark coronal hole patch. Also in sunMesh local space. */
export function buildChOutlineLine(
  THREE: any, ch: CoronalHole, sunRadius: number
): any {
  const fp   = buildChFootprintPoints(THREE, ch, sunRadius * 1.020);

  // Smooth the outline in 2D tangent space then unproject back to sphere
  const cenVec = new THREE.Vector3();
  fp.forEach((p: any) => cenVec.add(p));
  cenVec.divideScalar(fp.length).normalize();
  const cen = cenVec.clone().multiplyScalar(sunRadius * 1.020);
  const north = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(north, cenVec);
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(cenVec, right).normalize();

  const raw2d = fp.slice(0, -1).map((p: any) => projectTo2D(p, cen, right, up));
  const smooth2d = smoothPolygon(raw2d, 1, 1.2);
  const smoothPts = smooth2d.map(({ x, y }: { x: number; y: number }) =>
    cen.clone().addScaledVector(right, x).addScaledVector(up, y)
      .normalize().multiplyScalar(sunRadius * 1.020)
  );
  smoothPts.push(smoothPts[0].clone()); // close loop

  const geom = new THREE.BufferGeometry().setFromPoints(smoothPts);
  const mat  = new THREE.LineBasicMaterial({
    color: 0x55ddff, transparent: true, opacity: 0.90,
    depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
  });
  const line    = new THREE.Line(geom, mat);
  line.name     = `ch-outline-${ch.id}`;
  line.userData = { coronalHoleId: ch.id };
  line.renderOrder = 4;
  return line;
}

/**
 * Returns a tiny invisible Object3D positioned at the CH centroid on the solar
 * surface (in sunMesh local space).  Used as the mesh anchor for PlanetLabel.
 */
export function buildChLabelAnchor(
  THREE: any, ch: CoronalHole, sunRadius: number
): any {
  const pos = hgToVec(THREE, ch.lat, ch.lon).normalize().multiplyScalar(sunRadius * 1.012);
  const obj = new THREE.Object3D();
  obj.position.copy(pos);
  obj.name = `ch-label-anchor-${ch.id}`;
  return obj;
}

// ─── Parker Spiral Shaders ────────────────────────────────────────────────────
//
// KEY DESIGN DECISION
// ────────────────────
// The spiral backbone is built with φ=0 pointing along +Z.
// uChLon (radians) = the CH's longitude from SUVI (disk-centre-relative).
// uSunAngle (radians) = accumulated solar rotation since scene init.
//
// The vertex shader rotates every point by (uChLon + uSunAngle) about Y.
// This means:
//   - At t=0: arm starts at the CH's initial SUVI longitude.
//   - As the sun rotates: uSunAngle increases, arm sweeps with it.
//   - When SUVI refreshes and a new CH lon arrives: uChLon is updated,
//     instantly re-anchoring the arm to the new detected position.

const VERT = /* glsl */`
  uniform float uChLon;    // CH longitude from SUVI (radians, updated on refresh)
  uniform float uSunAngle; // Accumulated solar rotation (radians, updated each frame)
  uniform float uTime;

  attribute float aFlow;   // [0..1] = distance along spiral from Sun
  attribute float aEdge;   // [0..1] = edge distance in tube cross-section

  varying float vFlow;
  varying float vEdge;

  void main() {
    vFlow = aFlow;
    vEdge = aEdge;

    // Total rotation = CH's Carrington longitude + how far the Sun has rotated
    float angle = uChLon + uSunAngle;
    float cosA  = cos(angle);
    float sinA  = sin(angle);

    vec3 p  = position;   // baked in +Z-reference frame
    float x = p.x * cosA - p.z * sinA;
    float z = p.x * sinA + p.z * cosA;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(x, p.y, z, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSourceSpeed;  // HSS speed at source (km/s), e.g. 800–1400

  varying float vFlow;  // 0 = Sun surface, 1 = arm tip
  varying float vEdge;  // 0 = centre, 1 = tube edge

  // ── Same drag-model used by CME colour transitions ──────────────────────────
  // a = (1.41 - 0.0035 * v0) / 1000  [km/s per second of travel time]
  // The arm tip represents ~5 days of travel time to 1 AU.
  // vFlow maps to travel-time: t = vFlow * TRAVEL_TIME_SECONDS
  // liveSpeed = clamp( v0 + a * t, 300, v0 )
  float deceleratedSpeed(float v0, float frac) {
    float TRAVEL_SECONDS = 5.0 * 24.0 * 3600.0; // ~5 days to arm tip
    float a = (1.41 - 0.0035 * v0) / 1000.0;   // negative → decelerates
    float t = frac * TRAVEL_SECONDS;
    float v = v0 + a * t;
    return clamp(v, 300.0, v0);
  }

  // ── CME-matched speed-to-colour ramp ────────────────────────────────────────
  // Breakpoints (km/s): 1800 purple | 1000 red-orange | 800 orange |
  //                     500 yellow  | 350 grey-yellow lerp | <350 grey
  vec3 speedToColor(float spd) {
    if (spd >= 1800.0) return vec3(0.576, 0.439, 0.859); // medium purple
    if (spd >= 1000.0) {
      float t = (spd - 1000.0) / 800.0;
      return mix(vec3(1.0, 0.271, 0.0), vec3(0.576, 0.439, 0.859), t); // orange-red → purple
    }
    if (spd >= 800.0) {
      float t = (spd - 800.0) / 200.0;
      return mix(vec3(1.0, 0.647, 0.0), vec3(1.0, 0.271, 0.0), t); // orange → orange-red
    }
    if (spd >= 500.0) {
      float t = (spd - 500.0) / 300.0;
      return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.647, 0.0), t); // yellow → orange
    }
    if (spd >= 350.0) {
      float t = (spd - 350.0) / 150.0;
      return mix(vec3(0.502, 0.502, 0.502), vec3(1.0, 1.0, 0.0), t); // grey → yellow
    }
    return vec3(0.502, 0.502, 0.502); // grey (ambient wind)
  }

  void main() {
    // Current speed at this point along the arm after deceleration
    float liveSpeed = deceleratedSpeed(uSourceSpeed, vFlow);
    vec3 col = speedToColor(liveSpeed);

    // Outward-travelling ripple (solar wind blowing away from Sun)
    float ripple = fract(vFlow - uTime * 0.18);
    float pulse  = pow(1.0 - abs(ripple - 0.5) * 2.0, 4.0);

    // Soft tube cross-section
    float edgeFade = 1.0 - smoothstep(0.30, 1.00, vEdge);

    // Soft fade-in: stream organises gradually as it leaves the CH surface.
    // No hard edge at the sun — onset over first 12% of arm length.
    float fadeIn  = smoothstep(0.0, 0.12, vFlow);

    // Taper to nothing at arm tip
    float tipFade = 1.0 - smoothstep(0.68, 1.00, vFlow);

    // Bright ridge highlight that pulses with the ripple
    col = mix(col, vec3(1.00, 1.00, 0.95), pulse * 0.35 * edgeFade);

    float alpha = uOpacity * fadeIn * edgeFade * tipFade * (0.32 + 0.68 * pulse);
    alpha = clamp(alpha, 0.0, 0.88);

    gl_FragColor = vec4(col, alpha);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

// ─── Parker spiral mesh ───────────────────────────────────────────────────────

/**
 * Build a Parker-spiral tube arm for one coronal hole.
 *
 * The backbone is built in a canonical frame (φ=0 → +Z axis).
 * The vertex shader rotates the arm by (uChLon + uSunAngle) every frame,
 * so the arm root always tracks the CH's current rotated longitude.
 *
 * @param sunAngle0  Solar rotation angle at build time — used to initialise
 *                   uSunAngle so the arm starts at the correct position immediately.
 */
export function buildParkerSpiralMesh(
  THREE: any,
  ch: CoronalHole,
  sunRadius: number,
  maxReach: number,
  sunAngle0: number,
): any {
  // Faster wind → straighter spiral (less winding).
  // Parker spiral pitch angle: tan(ψ) = Ω·r / v_sw
  // At 600 km/s the spiral is tighter than at 900 km/s.
  const speedT = THREE.MathUtils.clamp((ch.estimatedSpeedKms - 500) / 400, 0, 1);
  const turns = THREE.MathUtils.lerp(SPIRAL_TURNS, 0.14, speedT);
  const phiMax = turns * Math.PI * 2;

  // ── HSS LONGITUDE ALIGNMENT ────────────────────────────────────────────────
  //
  // The backbone is built in a canonical frame with φ=0 at +Z.
  // The vertex shader then rotates the entire mesh by uChLon radians
  // about Y, placing the spiral root at the CH's longitude.
  //
  // The CH patches are also children of sunMesh, built via hgToVec()
  // at the CH's longitude. So at t=0 (the sun surface), the backbone
  // root and the CH centroid land at the same longitude — aligned.
  //
  // The spiral then trails BACKWARD (negative azimuth) as plasma
  // emitted earlier has been carried further by solar rotation.
  // This is the correct Parker spiral geometry.

  // ── CH LATITUDE EXTENT ─────────────────────────────────────────────────────
  //
  // The CH's north-south extent (heightDeg) defines how tall the HSS
  // stream is. The stream should maintain this full vertical extent
  // well beyond the Sun — HSS plasma doesn't collapse to the ecliptic
  // plane quickly. Ulysses showed fast wind filling ±30° latitude from
  // polar CHs all the way to 5 AU.
  //
  // ── Backbone ───────────────────────────────────────────────────────────────
  // Built in the canonical frame: φ=0 at +Z, arm curls in the -φ direction
  // (Parker spiral bends backward opposite to solar rotation because the wind
  //  travels faster than the sun rotates at 1 AU).
  //
  // CRITICAL: Backbone latitude handling for transequatorial CHs.
  //
  // A transequatorial coronal hole (one that spans the solar equator)
  // launches wind from BOTH hemispheres. The centroid might sit at -10°
  // or +8°, but the outflow fills the full latitude band from the CH's
  // southern to northern edge. The ecliptic plane (lat ≈ 0°) runs
  // right through the middle of the outflow — which is exactly where
  // Earth is.
  //
  // The backbone latitude should therefore be DAMPED toward zero:
  //   - If the CH spans the equator (|centroid lat| < half-height),
  //     the backbone runs essentially in the ecliptic plane.
  //   - If the CH is entirely in one hemisphere (small polar CH),
  //     the backbone follows the centroid latitude.
  //
  // This ensures transequatorial CHs produce streams that HIT Earth
  // rather than deflecting entirely to one hemisphere.

  const chHalfHeightDeg = (ch.heightDeg ?? ch.widthDeg ?? 20) / 2;
  const centroidLatDeg = ch.lat;

  // How much of the CH extends across the equator?
  // If |centroid| < halfHeight, the CH spans the equator → strong damping.
  // If |centroid| >> halfHeight, it's entirely polar → minimal damping.
  const equatorCoverage = THREE.MathUtils.clamp(
    1.0 - Math.abs(centroidLatDeg) / Math.max(1, chHalfHeightDeg),
    0, 1
  );
  // Blend: 0 = use full centroid lat, 1 = force to ecliptic (lat=0)
  const eclipticDamping = equatorCoverage * 0.85 + 0.15;
  // Effective backbone latitude at the Sun — damped toward ecliptic
  const backboneLatDeg = centroidLatDeg * (1.0 - eclipticDamping);
  const backboneLatRad = THREE.MathUtils.degToRad(backboneLatDeg);

  const backbone: any[] = [];
  for (let i = 0; i <= SPIRAL_POINTS; i++) {
    const t   = i / SPIRAL_POINTS;
    const phi = t * phiMax;

    // Fill the AU-domain extent for clearer WSA-ENLIL-like interpretation.
    const r = THREE.MathUtils.lerp(sunRadius * 1.03, maxReach, t);

    // Azimuth: starts at 0 (aligned with CH centroid after shader rotation),
    // then trails backward as the Parker spiral winds out.
    const az = -phi;

    // Latitude: further relax toward ecliptic with distance.
    // Solar wind at 1 AU is concentrated near the heliospheric
    // current sheet (roughly the ecliptic during low-tilt periods).
    const latDecay = 1.0 - t * 0.3;
    const latEff = backboneLatRad * Math.max(0, latDecay);
    const cosLat = Math.cos(latEff);

    backbone.push(new THREE.Vector3(
      r * cosLat * Math.sin(az),
      r * Math.sin(latEff),
      r * cosLat * Math.cos(az),
    ));
  }

  const N = backbone.length;
  if (N < 2) {
    // Degenerate case — quiet Sun, arm too short
    const dummy = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ visible: false })
    );
    dummy.name = `hss-spiral-${ch.id}`;
    return dummy;
  }

  // ── Tube extrusion ─────────────────────────────────────────────────────────
  //
  // Base width is derived from the CH's actual angular half-width so the HSS
  // stream boundary physically matches the coronal hole that launched it.
  //
  // Physical rationale:
  //   The HSS is a 3D volume of fast plasma embedded in the Parker spiral.
  //   Near the Sun it's confined to the CH angular extent. But as it
  //   propagates outward:
  //
  //   1. The stream EXPANDS radially (super-radial expansion in the low
  //      corona, then roughly radial beyond ~10 R☉).
  //
  //   2. The trailing edge of the stream interfaces with SLOW wind behind
  //      it — this compression creates a broad transition region.
  //
  //   3. At 1 AU, a single HSS passage lasts 2–4 DAYS in L1 data.
  //      At ~600 km/s that's a structure spanning ~0.7–1.4 AU in depth.
  //      The cross-sectional width is comparable — it's a massive volume.
  //
  //   4. The SIR (Stream Interaction Region) at the leading edge is a
  //      broad compression front, not a thin wall.
  //
  //   We use a strong flare factor: the tube radius grows by ~8–12× from
  //   the Sun to Earth, producing the broad swathe visible in ENLIL runs.
  //   Wider CHs produce wider streams (more open flux = broader outflow).
  //
  // Use the LARGER of width and height so the tube covers the CH's full
  // north-south extent, not just its equatorial cross-section.
  const chMaxExtentDeg = Math.max(ch.widthDeg ?? 15, ch.heightDeg ?? ch.widthDeg ?? 15);
  const chHalfAngleRad = THREE.MathUtils.degToRad(chMaxExtentDeg / 2);
  const tubeR0 = sunRadius * Math.sin(chHalfAngleRad);

  // Minimum base radius so even small CHs produce a visible stream
  const tubeR0Clamped = Math.max(tubeR0, sunRadius * 0.15);

  const sides  = SPIRAL_TUBE_SIDES;
  const pos: number[]  = [];
  const flow: number[] = [];
  const edge: number[] = [];
  const idx: number[]  = [];

  // Wider CHs produce wider streams — scale the flare with CH extent
  const widthFactor = THREE.MathUtils.clamp(chMaxExtentDeg / 30, 0.6, 1.8);

  for (let i = 0; i < N; i++) {
    const t    = i / (N - 1);
    const curr = backbone[i];
    const prev = backbone[Math.max(0, i - 1)];
    const next = backbone[Math.min(N - 1, i + 1)];

    const tang = next.clone().sub(prev).normalize();
    const up   = new THREE.Vector3(0, 1, 0);
    let right  = new THREE.Vector3().crossVectors(tang, up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up2  = new THREE.Vector3().crossVectors(right, tang).normalize();

    for (let s = 0; s < sides; s++) {
      const a  = (s / sides) * Math.PI * 2;
      const cr = Math.cos(a), sr = Math.sin(a);

      // Tube radius: starts at the CH angular width at the sun,
      // expands dramatically by Earth distance.
      //
      // Uses a power curve (t^0.7) so the expansion accelerates —
      // the stream is still narrow near the Sun but really opens up
      // in the outer heliosphere, matching ENLIL visualizations.
      const tExpand = Math.pow(t, 0.7);
      const flare   = 1.0 + tExpand * (8.0 * widthFactor);  // 1× at sun → ~9–15× at Earth
      const rTube   = tubeR0Clamped * flare;

      pos.push(
        curr.x + rTube * (cr * right.x + sr * up2.x),
        curr.y + rTube * (cr * right.y + sr * up2.y),
        curr.z + rTube * (cr * right.z + sr * up2.z),
      );
      flow.push(t);
      edge.push(Math.abs(cr));   // 1.0 at sides of tube cross-section
    }
  }

  for (let i = 0; i < N - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const sn = (s + 1) % sides;
      const a  = i * sides + s,  b  = i * sides + sn;
      const c  = (i+1) * sides + s, d = (i+1) * sides + sn;
      idx.push(a, b, c, b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('aFlow',    new THREE.Float32BufferAttribute(flow, 1));
  geom.setAttribute('aEdge',    new THREE.Float32BufferAttribute(edge, 1));
  geom.setIndex(idx);
  geom.computeVertexNormals();

  // ── Longitude alignment ─────────────────────────────────────────────────────
  // hgToVec places positive lon at +X via sin(theta).
  // The vertex shader's Y-rotation with positive angle rotates +Z toward -X.
  // To match, we NEGATE the longitude so the shader puts the backbone
  // at the same +X position as hgToVec for positive ch.lon.
  const lonRad = THREE.MathUtils.degToRad(-ch.lon);

  const mat = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms: {
      uChLon:       { value: lonRad },
      uSunAngle:    { value: sunAngle0 },
      uTime:        { value: 0 },
      uOpacity:     { value: Math.min(0.85, ch.opacity + (ch.darkness ?? 0) * 0.22) },
      uSourceSpeed: { value: ch.estimatedSpeedKms },  // km/s — drives gradient deceleration
    },
    transparent: true,
    side:        THREE.DoubleSide,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  const mesh    = new THREE.Mesh(geom, mat);
  mesh.name     = `hss-spiral-${ch.id}`;
  mesh.userData = { coronalHoleId: ch.id, isHssMesh: true };
  return mesh;
}

// --- END OF FILE utils/coronalHoleGeometry.ts ---