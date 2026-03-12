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
const SPIRAL_TURNS           = 0.38;
const CH_OVEREMPHASIS        = 1.22;

// Physical constants (replicated to avoid circular dep on constants.ts)
const SCENE_SCALE       = 3.0;           // 1 scene unit ≈ 1 AU

// ─── Coordinate helper ────────────────────────────────────────────────────────

/** Heliographic (lat, lon) degrees → unit Cartesian.
 *  Scene: +Y = north pole, +Z = lon 0 toward Earth. */
function hgToVec(THREE: any, lat: number, lon: number): any {
  const phi   = THREE.MathUtils.degToRad(90 - lat);
  // Use negative lon so CH overlays match the sun's apparent rotation sense
  // in the top-view camera framing.
  const theta = THREE.MathUtils.degToRad(-lon);
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

  const sortAndInflate = (raw: any[]): any[] => {
    const sorted = raw
      .map((p: any) => {
        const n = p.clone().normalize();
        return { p: n, a: Math.atan2(n.dot(up), n.dot(right)) };
      })
      .sort((a: any, b: any) => a.a - b.a)
      .map((v: any) => v.p);

    const inflated = sorted.map((p: any) =>
      cenVec.clone().lerp(p, CH_OVEREMPHASIS).normalize().multiplyScalar(r)
    );
    inflated.push(inflated[0].clone());
    return inflated;
  };

  if (ch.polygon && ch.polygon.length >= 3) {
    const pts = ch.polygon.map((v: any) =>
      hgToVec(THREE, ch.lat + v.lat, ch.lon + v.lon).multiplyScalar(r)
    );
    return sortAndInflate(pts);
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

/** Dark triangle-fan patch. Parented to sunMesh → rotates with the sun. */
export function buildChSurfaceMesh(
  THREE: any, ch: CoronalHole, sunRadius: number
): any {
  const fp  = buildChFootprintPoints(THREE, ch, sunRadius);
  const cen = new THREE.Vector3();
  fp.forEach((p: any) => cen.add(p));
  cen.divideScalar(fp.length).normalize().multiplyScalar(sunRadius * 1.003);

  const pos: number[] = [];
  for (let i = 0; i < fp.length - 1; i++) {
    const a = fp[i], b = fp[i + 1];
    pos.push(cen.x, cen.y, cen.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    // Dark coronal hole: real CHs appear as near-black regions on the sun
    // (low-density, low-temperature open field regions).
    // Use NormalBlending + dark color so the patch darkens the sun surface,
    // making it clearly visible against the bright yellow photosphere.
    color: 0x0a0a14, transparent: true, opacity: 0.72,
    side: THREE.FrontSide, depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const mesh    = new THREE.Mesh(geom, mat);
  mesh.name     = `ch-surface-${ch.id}`;
  mesh.userData = { coronalHoleId: ch.id };
  mesh.renderOrder = 1;
  return mesh;
}

// ─── CH outline ───────────────────────────────────────────────────────────────

/** Bright border around the dark coronal hole patch. Also in sunMesh local space. */
export function buildChOutlineLine(
  THREE: any, ch: CoronalHole, sunRadius: number
): any {
  const fp   = buildChFootprintPoints(THREE, ch, sunRadius * 1.006);
  const geom = new THREE.BufferGeometry().setFromPoints(fp);
  const mat  = new THREE.LineBasicMaterial({
    // Bright sky-blue outline — clearly visible against both the dark patch
    // and the bright yellow photosphere.
    color: 0x55ddff, transparent: true, opacity: 0.90,
    depthWrite: false, blending: THREE.NormalBlending,
  });
  const line    = new THREE.Line(geom, mat);
  line.name     = `ch-outline-${ch.id}`;
  line.userData = { coronalHoleId: ch.id };
  line.renderOrder = 2;
  return line;
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

  varying float vFlow;
  varying float vEdge;

  void main() {
    // Colour ramp: electric cyan near Sun → warm amber at 1 AU
    vec3 nearCol = vec3(0.30, 0.85, 1.00);
    vec3 farCol  = vec3(0.95, 0.68, 0.18);
    vec3 col     = mix(nearCol, farCol, pow(vFlow, 0.65));

    // Outward-travelling ripple (solar wind blowing away from Sun)
    float ripple = fract(vFlow - uTime * 0.18);
    float pulse  = pow(1.0 - abs(ripple - 0.5) * 2.0, 4.0);

    // Soft tube cross-section (makes it read as ribbon, not hard cylinder)
    float edgeFade = 1.0 - smoothstep(0.30, 1.00, vEdge);

    // Taper to nothing at arm tip
    float tipFade  = 1.0 - smoothstep(0.68, 1.00, vFlow);

    // Bright ridge highlight that pulses with the ripple
    col = mix(col, vec3(1.00, 1.00, 0.95), pulse * 0.45 * edgeFade);

    float alpha = uOpacity * edgeFade * tipFade * (0.32 + 0.68 * pulse);
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
  const latRad = THREE.MathUtils.degToRad(ch.lat);
  const speedT = THREE.MathUtils.clamp((ch.estimatedSpeedKms - 800) / 600, 0, 1);
  const turns = THREE.MathUtils.lerp(SPIRAL_TURNS, 0.16, speedT);
  const phiMax = turns * Math.PI * 2;

  // ── Backbone ───────────────────────────────────────────────────────────────
  // Built in the canonical frame: φ=0 at +Z, arm curls in the -φ direction
  // (Parker spiral bends backward opposite to solar rotation because the wind
  //  travels faster than the sun rotates at 1 AU).
  const backbone: any[] = [];
  for (let i = 0; i <= SPIRAL_POINTS; i++) {
    const t   = i / SPIRAL_POINTS;
    const phi = t * phiMax;

    // Fill the AU-domain extent for clearer WSA-ENLIL-like interpretation.
    const r = THREE.MathUtils.lerp(sunRadius * 1.03, maxReach, t);

    // Azimuth: starts at 0 (+Z), with tail trailing behind source rotation.
    const az = -phi;

    // Latitude decays with distance (solar wind spreads toward equatorial plane)
    const latEff = latRad * Math.exp(-phi / (phiMax * 0.60));
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
  const tubeR   = SPIRAL_TUBE_RADIUS_FAC * SCENE_SCALE;
  const spreadScale = 1 + Math.max(0.18, (ch.expansionHalfAngleDeg ?? 10) / 20);
  const sides   = SPIRAL_TUBE_SIDES;
  const pos: number[]  = [];
  const flow: number[] = [];
  const edge: number[] = [];
  const idx: number[]  = [];

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
      const flare = 1 + t * (2.2 + spreadScale);
      const rTube = tubeR * flare;
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

  const lonRad = THREE.MathUtils.degToRad(-ch.lon);

  const mat = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms: {
      // uChLon: fixed CH longitude from SUVI (updated when SUVI refreshes)
      uChLon:    { value: lonRad },
      // uSunAngle: accumulated solar rotation — updated every frame by animate loop
      uSunAngle: { value: sunAngle0 },
      uTime:     { value: 0 },
      uOpacity:  { value: Math.min(0.85, ch.opacity + (ch.darkness ?? 0) * 0.22) },
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