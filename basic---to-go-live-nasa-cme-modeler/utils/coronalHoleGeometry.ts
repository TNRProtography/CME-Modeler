// --- START OF FILE utils/coronalHoleGeometry.ts ---
//
// Pure geometry helpers for Coronal Hole (CH) footprint rendering and
// High-Speed Stream (HSS) volume generation.
//
// These functions are stateless and rely on `window.THREE` exactly like the
// rest of SimulationCanvas.tsx — no import needed at call sites.
//
// KEY CONCEPTS
// ════════════
//  • The CH footprint is modelled as a polygon (or ellipse fallback) in
//    heliographic coordinates.  We project it onto the solar sphere using
//    spherical-to-Cartesian conversion.
//
//  • The HSS is a lofted "open corridor" that extrudes the CH footprint
//    radially outward.  Cross-sections widen with heliocentric distance.
//    Near the Sun the HSS strongly resembles the CH shape; far out it widens
//    into a broad plume.
//
//  • All distances are in the same normalised *scene units* used by the rest
//    of SimulationCanvas (SCENE_SCALE from constants.ts).

import { CoronalHole } from './coronalHoleData';

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/**
 * Convert heliographic (lat, lon) in degrees to a unit Cartesian vector.
 * Conventions match the rest of the scene:
 *   +Y = north solar pole
 *   +X = Carrington longitude 90°
 *   +Z = Carrington longitude 0° (toward observer by default)
 */
function heliographicToCartesian(THREE: any, lat: number, lon: number): any {
  const phi   = THREE.MathUtils.degToRad(90 - lat);   // colatitude
  const theta = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
}

// ─── CH polygon utilities ─────────────────────────────────────────────────────

/**
 * Build an array of 3-D points on the solar sphere surface representing
 * the CH boundary polygon.
 *
 * @param THREE        window.THREE reference
 * @param ch           The coronal hole data
 * @param sunRadius    Radius of the solar sphere in scene units
 * @returns            Array of THREE.Vector3 on the sphere surface (closed loop)
 */
export function buildChFootprintPoints(THREE: any, ch: CoronalHole, sunRadius: number): any[] {
  if (ch.polygon && ch.polygon.length >= 3) {
    // Convert polygon vertices (relative offsets from centroid) to world coords.
    const pts = ch.polygon.map(v => {
      const absLat = ch.lat + v.lat;
      const absLon = ch.lon + v.lon;
      return heliographicToCartesian(THREE, absLat, absLon).multiplyScalar(sunRadius);
    });
    // Close the loop
    pts.push(pts[0].clone());
    return pts;
  }

  // ── Ellipse fallback ──────────────────────────────────────────────────────
  // When no polygon is provided, approximate the CH as an ellipse on the
  // sphere.  We build points in the local tangent plane then project back.
  const N = 24; // number of ellipse points
  const halfW = THREE.MathUtils.degToRad((ch.widthDeg  ?? 20) / 2);
  const halfH = THREE.MathUtils.degToRad((ch.heightDeg ?? ch.widthDeg ?? 20) / 2);
  const centre = heliographicToCartesian(THREE, ch.lat, ch.lon);

  // Build a local tangent frame: up = northward, right = eastward
  const north  = new THREE.Vector3(0, 1, 0);
  const right  = new THREE.Vector3().crossVectors(north, centre).normalize();
  const up     = new THREE.Vector3().crossVectors(centre, right).normalize();

  const pts: any[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const localX = Math.cos(a) * halfW;
    const localY = Math.sin(a) * halfH;
    // Displace in tangent plane then re-project to sphere surface
    const displaced = centre.clone()
      .addScaledVector(right, localX)
      .addScaledVector(up,    localY)
      .normalize()
      .multiplyScalar(sunRadius);
    pts.push(displaced);
  }
  return pts;
}

// ─── CH surface mesh ─────────────────────────────────────────────────────────

/**
 * Create a THREE.Mesh that renders the coronal hole as a dark semi-transparent
 * patch on the solar sphere surface.
 *
 * The mesh sits just above the photosphere (sunRadius * 1.003) so it always
 * draws over the sun shader / photosphere texture without z-fighting.
 *
 * @returns  THREE.Mesh — add to scene, set `.visible = true/false` as needed.
 */
export function buildChSurfaceMesh(THREE: any, ch: CoronalHole, sunRadius: number): any {
  const footprint = buildChFootprintPoints(THREE, ch, sunRadius * 1.003);

  // Tessellate the footprint polygon as a triangle fan around the centroid.
  // This is sufficient for CH polygons with ≤ 30 vertices.
  const centroid = new THREE.Vector3();
  footprint.forEach(p => centroid.add(p));
  centroid.divideScalar(footprint.length);
  centroid.normalize().multiplyScalar(sunRadius * 1.003);

  const positions: number[] = [];
  const n = footprint.length - 1; // last point == first
  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[i + 1];
    positions.push(centroid.x, centroid.y, centroid.z);
    positions.push(a.x, a.y, a.z);
    positions.push(b.x, b.y, b.z);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color:       0x001a2e,      // Very dark blue-black — open magnetic field region
    transparent: true,
    opacity:     0.72,
    side:        THREE.FrontSide,
    depthWrite:  false,
    blending:    THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name    = `ch-surface-${ch.id}`;
  mesh.userData = { coronalHoleId: ch.id };
  mesh.renderOrder = 1;  // draw on top of sun photosphere layer
  return mesh;
}

// ─── CH outline ring ──────────────────────────────────────────────────────────

/**
 * Create a THREE.Line that draws the coronal hole boundary outline.
 * Gives the CH a subtle glowing border so it reads clearly on the Sun.
 */
export function buildChOutlineLine(THREE: any, ch: CoronalHole, sunRadius: number): any {
  const footprint = buildChFootprintPoints(THREE, ch, sunRadius * 1.005);
  const geom = new THREE.BufferGeometry().setFromPoints(footprint);
  const mat = new THREE.LineBasicMaterial({
    color:       0x4499cc,
    transparent: true,
    opacity:     0.55,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geom, mat);
  line.name     = `ch-outline-${ch.id}`;
  line.userData = { coronalHoleId: ch.id };
  return line;
}

// ─── HSS stream volume ────────────────────────────────────────────────────────

// Shader constants
const HSS_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAnimPhase;
  varying vec3  vWorldPos;
  varying float vDist;       // normalised heliocentric distance [0..1]
  varying float vEdge;       // 0 = centre of stream, 1 = edge
  varying float vRipple;

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vDist     = clamp(length(vWorldPos) / 12.0, 0.0, 1.0);  // 12 = ~scene far

    // Edge factor — stored in uv.x: 0=centre, 1=edge  (set in buildHssGeometry)
    vEdge = uv.x;

    // Animated ripple: periodic pulse that travels away from the Sun
    float phase = uAnimPhase + uTime * 0.12;
    vRipple = 0.5 + 0.5 * sin((vDist * 14.0 - phase) * 3.14159);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HSS_FRAGMENT_SHADER = `
  uniform float uOpacity;
  uniform float uTime;
  varying float vDist;
  varying float vEdge;
  varying float vRipple;

  void main() {
    // Core colour: pale cyan-gold for fast solar wind
    vec3 nearColour = vec3(0.55, 0.85, 1.0);   // cyan-white near Sun
    vec3 farColour  = vec3(0.9,  0.75, 0.3);   // warm gold far from Sun
    vec3 col = mix(nearColour, farColour, vDist);

    // Opacity: highest in the core, fades at the edges and far end
    float edgeFade = 1.0 - smoothstep(0.55, 1.0, vEdge);
    float distFade = 1.0 - smoothstep(0.45, 1.0, vDist);
    float ripple   = 0.6 + 0.4 * vRipple;

    float alpha = uOpacity * edgeFade * distFade * ripple;
    alpha = clamp(alpha, 0.0, 0.7);

    gl_FragColor = vec4(col, alpha);
    if (gl_FragColor.a < 0.005) discard;
  }
`;

/**
 * Build the HSS stream volume as a lofted mesh that originates from the CH
 * footprint on the solar surface and expands radially outward.
 *
 * GEOMETRY STRATEGY
 * ─────────────────
 * We define N "rings" at increasing heliocentric distances.
 * Ring 0 sits just above the CH footprint (sunRadius * 1.05).
 * Ring N-1 sits at `maxReach` scene units from the Sun.
 *
 * At each ring, the cross-section polygon is the CH footprint scaled and
 * rotated to track the outward axis, then expanded by the expansion rate.
 *
 * The UV.x channel carries the normalised edge distance [0=centre, 1=edge]
 * so the fragment shader can fade the HSS edges softly.
 *
 * @param THREE               window.THREE
 * @param ch                  Coronal hole source data
 * @param sunRadius           Solar sphere radius in scene units
 * @param maxReach            How far the HSS extends (scene units, ~1.5–2 AU)
 * @returns                   THREE.Mesh — toggle .visible for the HSS control
 */
export function buildHssMesh(THREE: any, ch: CoronalHole, sunRadius: number, maxReach: number): any {
  // Number of radial rings along the stream axis
  const RINGS  = 18;
  const RING_PTS = ch.polygon ? ch.polygon.length : 24; // points per ring

  // Outward axis direction (unit vector) based on CH centroid
  const axis = heliographicToCartesian(THREE, ch.sourceDirectionDeg.lat, ch.sourceDirectionDeg.lon);

  // Build a local frame (right, up) perpendicular to the outward axis
  const worldUp = Math.abs(axis.y) < 0.99
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const axisRight = new THREE.Vector3().crossVectors(axis, worldUp).normalize();
  const axisUp    = new THREE.Vector3().crossVectors(axisRight, axis).normalize();

  // Collect the CH footprint as a 2-D shape in the tangent plane at the Sun.
  // We express each footprint point as (r, angle) from the centroid.
  const chCentreWorld = axis.clone().multiplyScalar(sunRadius);
  const footprint3d   = buildChFootprintPoints(THREE, ch, sunRadius);
  // Project to 2-D tangent plane
  const fp2d = footprint3d.slice(0, -1).map((p: any) => {
    const delta = p.clone().sub(chCentreWorld);
    return { u: delta.dot(axisRight), v: delta.dot(axisUp) };
  });

  // For each ring, compute the radially expanded cross-section
  const positions: number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  // Pre-compute each ring's points
  const ringPoints: any[][] = [];
  for (let ri = 0; ri < RINGS; ri++) {
    const t       = ri / (RINGS - 1);                 // 0..1 along stream
    const dist    = THREE.MathUtils.lerp(sunRadius * 1.04, maxReach, t);
    const centre  = axis.clone().multiplyScalar(dist);

    // Expansion: half-angle grows linearly with distance beyond the Sun
    const distAU  = dist;                              // already in scene units ≈ AU scale
    const spreadFac = 1.0 + (ch.expansionHalfAngleDeg / 30.0) * t * 3.5;

    const ring: any[] = [];
    for (let pi = 0; pi < RING_PTS; pi++) {
      const idx = pi % fp2d.length;
      const { u, v } = fp2d[idx];
      const ru = u * spreadFac;
      const rv = v * spreadFac;
      const pt = centre.clone()
        .addScaledVector(axisRight, ru)
        .addScaledVector(axisUp,    rv);
      ring.push(pt);
    }
    ringPoints.push(ring);
  }

  // Compute centroid of ring 0 for UV edge mapping
  const computeCentroid = (ring: any[]) => {
    const c = new THREE.Vector3();
    ring.forEach(p => c.add(p));
    return c.divideScalar(ring.length);
  };

  // Build the vertex buffers and index buffer (quad strips between adjacent rings)
  for (let ri = 0; ri < RINGS; ri++) {
    const ring   = ringPoints[ri];
    const cent   = computeCentroid(ring);
    // maxRingRadius — used to normalise UV edge
    let maxR = 0;
    ring.forEach(p => { const d = p.distanceTo(cent); if (d > maxR) maxR = d; });

    for (let pi = 0; pi < RING_PTS; pi++) {
      const p    = ring[pi];
      const edge = maxR > 0 ? p.distanceTo(cent) / maxR : 0;
      positions.push(p.x, p.y, p.z);
      uvs.push(edge, ri / (RINGS - 1));
    }
  }

  // Quad strips: connect ring ri to ring ri+1
  for (let ri = 0; ri < RINGS - 1; ri++) {
    for (let pi = 0; pi < RING_PTS; pi++) {
      const piNext = (pi + 1) % RING_PTS;
      const a = ri       * RING_PTS + pi;
      const b = ri       * RING_PTS + piNext;
      const c = (ri + 1) * RING_PTS + pi;
      const d = (ri + 1) * RING_PTS + piNext;
      // Two triangles per quad
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // Close the end cap at the solar surface (ring 0) using a fan
  // and optionally the far end (ring RINGS-1) — we leave far end open (stream continues)
  const capRing = ringPoints[0];
  const capCent = computeCentroid(capRing);
  const capCentIdx = positions.length / 3;
  positions.push(capCent.x, capCent.y, capCent.z);
  uvs.push(0, 0);
  for (let pi = 0; pi < RING_PTS; pi++) {
    const piNext = (pi + 1) % RING_PTS;
    const a = pi;
    const b = piNext;
    indices.push(capCentIdx, b, a);   // inward-facing cap
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    vertexShader:   HSS_VERTEX_SHADER,
    fragmentShader: HSS_FRAGMENT_SHADER,
    uniforms: {
      uTime:      { value: 0 },
      uAnimPhase: { value: ch.animPhase },
      uOpacity:   { value: ch.opacity },
    },
    transparent:  true,
    side:         THREE.DoubleSide,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name     = `hss-stream-${ch.id}`;
  mesh.userData = {
    coronalHoleId:     ch.id,
    estimatedSpeedKms: ch.estimatedSpeedKms,
    isHssMesh:         true,
  };
  return mesh;
}

// --- END OF FILE utils/coronalHoleGeometry.ts ---