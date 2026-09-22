// The HSS barrier's shader patch for CME particle materials (three.js r128
// PointsMaterial). The walls themselves are worked out in hssBarrier.ts; this
// only applies them on the GPU, per particle.

/**
 * Teaches a CME particle material the HSS barrier.
 *
 * Each particle is placed in the world as usual, then its azimuth about the
 * solar axis, relative to the CME's own, is checked against the walls:
 * west(r) = A + B·r and east(r) likewise (radians, east positive), a straight
 * line in r so a wall can lean with the spiral across the CME's depth. A
 * particle past a wall is swung back onto it about the Sun's axis, keeping a
 * sliver of its overshoot so the pile-up has some depth, and marked so the
 * fragment shader can brighten it - the compression, made visible.
 *
 * Pass the front's uniforms when patching its tail so both obey one wall.
 *
 * r128 does not upload viewMatrix to a PointsMaterial, so the camera's view
 * comes in as uHbView, set by bindHssBarrierView just before the object is
 * drawn. With the barrier idle the stock projection is used untouched.
 */
export function attachHssBarrierShader(THREE: any, material: any, shared?: any) {
  const u = shared ?? {
    uHbOn: { value: 0 },
    uHbAz: { value: 0 },
    uHbWest: { value: new THREE.Vector2(10, 0) },
    uHbEast: { value: new THREE.Vector2(10, 0) },
    uHbView: { value: new THREE.Matrix4() },
  };
  material.userData.hssBarrier = u;
  material.onBeforeCompile = (shader: any) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uHbOn;
uniform float uHbAz;
uniform vec2 uHbWest;
uniform vec2 uHbEast;
uniform mat4 uHbView;
varying float vHbSquash;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
vHbSquash = 0.0;
if ( uHbOn > 0.5 ) {
  vec4 hbWorld = modelMatrix * vec4( transformed, 1.0 );
  float hbR = length( hbWorld.xz );
  float hbA = atan( hbWorld.x, hbWorld.z ) - uHbAz;
  hbA -= 6.28318530718 * floor( ( hbA + 3.14159265359 ) / 6.28318530718 );
  float hbW = uHbWest.x + uHbWest.y * hbR;
  float hbE = uHbEast.x + uHbEast.y * hbR;
  float hbN = hbA;
  if ( hbA > hbW ) {
    hbN = hbW + ( hbA - hbW ) * 0.06;
    vHbSquash = clamp( ( hbA - hbW ) / 0.2, 0.25, 1.0 );
  } else if ( hbA < -hbE ) {
    hbN = -hbE + ( hbA + hbE ) * 0.06;
    vHbSquash = clamp( ( -hbE - hbA ) / 0.2, 0.25, 1.0 );
  }
  float hbD = hbN - hbA;
  float hbC = cos( hbD );
  float hbS = sin( hbD );
  hbWorld.xz = vec2( hbWorld.x * hbC + hbWorld.z * hbS, hbWorld.z * hbC - hbWorld.x * hbS );
  mvPosition = uHbView * hbWorld;
}
gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vHbSquash;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= 1.0 + vHbSquash * 1.8;
diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + vHbSquash * 0.8 ) );`);
  };
  return u;
}

/** Keeps uHbView current: the camera's view, taken just before this draws. */
export function bindHssBarrierView(object: any, u: any) {
  object.onBeforeRender = (_renderer: any, _scene: any, camera: any) => {
    u.uHbView.value.copy(camera.matrixWorldInverse);
  };
}
