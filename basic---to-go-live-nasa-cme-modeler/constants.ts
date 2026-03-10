// --- START OF FILE constants.ts ---

// src/constants.ts
import { PlanetData, POIData } from './types';

// --- THIS IS THE CORRECTED LINE ---
// Vite uses import.meta.env to access environment variables
export const NASA_API_KEY: string = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
// ------------------------------------

export const AU_IN_KM = 149597870.7;
export const SCENE_SCALE = 3.0; // Affects visual scaling of distances and CMEs relative to planets
export const SUN_ANGULAR_VELOCITY = 2.61799e-6; // rad/sec (approx for 27.27 day synodic period)

export const PLANET_DATA_MAP: Record<string, PlanetData> = {
  MERCURY: { name: 'Mercury', radius: 0.387 * SCENE_SCALE, size: 0.008 * SCENE_SCALE, color: 0x8c8c8c, angle: 1.2, labelElementId: 'mercury-label', orbitalPeriodDays: 88 },
  VENUS:   { name: 'Venus',   radius: 0.723 * SCENE_SCALE, size: 0.015 * SCENE_SCALE, color: 0xe6e6e6, angle: 3.5, labelElementId: 'venus-label',   orbitalPeriodDays: 225 },
  EARTH:   { name: 'Earth',   radius: 1.0   * SCENE_SCALE, size: 0.02  * SCENE_SCALE, color: 0x2a6a9c, angle: 0,   labelElementId: 'earth-label',   orbitalPeriodDays: 365.25 },
  MOON:    { name: 'Moon', orbits: 'EARTH', radius: 0.15 * SCENE_SCALE, size: 0.005 * SCENE_SCALE, color: 0xbbbbbb, angle: 2.1, labelElementId: 'moon-label', orbitalPeriodDays: 27.3 },
  MARS:    { name: 'Mars',    radius: 1.52  * SCENE_SCALE, size: 0.012 * SCENE_SCALE, color: 0xff5733, angle: 5.1, labelElementId: 'mars-label',    orbitalPeriodDays: 687 },
  JUPITER: { name: 'Jupiter', radius: 5.20  * SCENE_SCALE, size: 0.055 * SCENE_SCALE, color: 0xc88b3a, angle: 0.8, labelElementId: 'jupiter-label', orbitalPeriodDays: 4333 },
  SATURN:  { name: 'Saturn',  radius: 9.58  * SCENE_SCALE, size: 0.045 * SCENE_SCALE, color: 0xe4d191, angle: 2.2, labelElementId: 'saturn-label',  orbitalPeriodDays: 10759 },
  URANUS:  { name: 'Uranus',  radius: 19.2  * SCENE_SCALE, size: 0.030 * SCENE_SCALE, color: 0x7de8e8, angle: 4.1, labelElementId: 'uranus-label',  orbitalPeriodDays: 30687 },
  NEPTUNE: { name: 'Neptune', radius: 30.05 * SCENE_SCALE, size: 0.028 * SCENE_SCALE, color: 0x3f54ba, angle: 1.5, labelElementId: 'neptune-label', orbitalPeriodDays: 60190 },
  SUN:     { name: 'Sun',     radius: 0, size: 0.1 * SCENE_SCALE, color: 0xffcc00, angle: 0, labelElementId: 'sun-label' }
};

export const POI_DATA_MAP: Record<string, POIData> = {
  L1: {
    name: 'L1',
    size: 0.005 * SCENE_SCALE,
    color: 0xffaaff,
    labelElementId: 'l1-label',
    parent: 'EARTH',
    distanceFromParent: (15e6 / AU_IN_KM) * SCENE_SCALE, // Visually exaggerated distance (~15M km) for clarity
  }
};

export const SUN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const SUN_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    float time = uTime * 0.1;
    vec2 distortedUV = vUv + 0.1 * vec2(snoise(vUv * 2.0 + time), snoise(vUv * 2.0 + time + 5.0));
    float noiseVal = snoise(distortedUV * 5.0 + time);
    noiseVal = (noiseVal + 1.0) * 0.5;
    vec3 color = mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 0.5, 0.0), noiseVal);
    gl_FragColor = vec4(color, 1.0);
}`;

export const EARTH_ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vNormal;
void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const EARTH_ATMOSPHERE_FRAGMENT_SHADER = `
uniform float uImpactTime;
uniform float uTime;
varying vec3 vNormal;

void main() {
    float baseIntensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
    
    float impactGlow = 0.0;
    float timeSinceImpact = uTime - uImpactTime;
    
    // Animate glow for 2.5 seconds after impact
    if (uImpactTime > 0.0 && timeSinceImpact > 0.0 && timeSinceImpact < 2.5) {
        impactGlow = sin(timeSinceImpact * 5.0 - length(vNormal) * 2.0) * 0.5 + 0.5;
        impactGlow *= smoothstep(2.5, 0.0, timeSinceImpact);
    }
    
    vec3 atmosphereColor = vec3(0.8, 0.85, 0.9);
    vec3 finalColor = atmosphereColor * (baseIntensity + impactGlow * 2.0);
    gl_FragColor = vec4(finalColor, baseIntensity + impactGlow);
}`;

// ------------------------------
// AURORA SHADERS (UPDATED)
// ------------------------------
export const AURORA_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Aurora fragment shader
 * - uAuroraMinY: sine of equatorward latitude boundary (e.g., sin(70°) ≈ 0.94)
 *   Aurora shows where abs(normal.y) >= uAuroraMinY (both poles).
 * - uAuroraIntensity: brightness multiplier (set by CPU from CME speed).
 * - uImpactTime/uTime: temporal gating for short-lived impact glow.
 */
export const AURORA_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uCmeSpeed;     // optional for color dynamics
uniform float uImpactTime;   // time of impact start
uniform float uAuroraMinY;   // NEW: latitude extent control (sin(latitude))
uniform float uAuroraIntensity; // NEW: brightness control
varying vec3 vNormal;
varying vec2 vUv;

// 2D simplex noise
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    // 1) Fade window based on time since last impact
    float timeSinceImpact = uTime - uImpactTime;
    float fadeDuration = 10.0; // seconds
    float impactFade = 0.0;
    if (uImpactTime > 0.0 && timeSinceImpact < fadeDuration) {
        impactFade = smoothstep(0.0, 1.5, timeSinceImpact) * smoothstep(fadeDuration, fadeDuration - 4.0, timeSinceImpact);
    }
    if (impactFade <= 0.0) { discard; }

    // 2) Latitude mask using explicit boundary from CPU (both poles)
    float y = abs(normalize(vNormal).y);
    // soft edge around the boundary so expansion looks organic
    float edge = 0.03;
    float polarMask = smoothstep(uAuroraMinY - edge, uAuroraMinY + edge, y);
    if (polarMask <= 0.0) { discard; }

    // 3) Aurora curtain noise/rays
    vec3 nrm = normalize(vNormal);
    float lon = atan(nrm.x, nrm.z);
    float lat = asin(nrm.y);
    float t = uTime * 0.2;

    float noise1 = snoise(vec2(lon * 3.0, lat * 5.0 - t));
    float noise2 = snoise(vec2(lon * 7.0, lat * 6.0 + t * 1.5));
    float curtain = pow(snoise(vec2(lon * 2.5, uTime * 0.1)), 2.0);
    curtain = smoothstep(0.1, 0.6, curtain);
    float finalNoise = (noise1 + noise2) * 0.5 * curtain;
    finalNoise = pow(abs(finalNoise), 1.5) + pow(snoise(vec2(lon * 1.5, lat * 4.0 - t * 0.8)), 2.0) * 0.3;

    // 4) Color blend (gentle variation)
    vec3 green  = vec3(0.1, 1.0, 0.3);
    vec3 purple = vec3(0.8, 0.2, 1.0);
    vec3 color = mix(green, purple, smoothstep(0.3, 0.7, snoise(vec2(lon * 0.5, lat + uTime * 0.05))));

    // 5) Apply intensity + masks
    color *= uAuroraIntensity;
    float alpha = finalNoise * polarMask * impactFade;

    gl_FragColor = vec4(color, alpha);
}`;

// --- START OF MODIFICATION: Reverting Flux Rope Shaders ---
export const FLUX_ROPE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const FLUX_ROPE_FRAGMENT_SHADER = `
uniform sampler2D uTexture;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
    float speed = 0.5;
    float pulseWidth = 0.1;
    float wavePos = fract(uTime * speed);
    float d = min(abs(vUv.x - wavePos), 1.0 - abs(vUv.x - wavePos));
    float pulse = smoothstep(pulseWidth, 0.0, d);
    vec4 tex = texture2D(uTexture, vUv);
    if (tex.a < 0.1 || pulse < 0.01) discard;
    gl_FragColor = vec4(uColor, tex.a * pulse);
}`;
// --- END OF MODIFICATION ---

export const PRIMARY_COLOR = "#fafafa";
export const PANEL_BG_COLOR = "rgba(23, 23, 23, 0.9)";
export const TEXT_COLOR = "#e5e5e5";
export const HOVER_BG_COLOR = "rgba(38, 38, 38, 1)";

// ── JUPITER SHADER ─────────────────────────────────────────────────────────
// Animated banded gas giant with Great Red Spot hint
export const JUPITER_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod(i,289.);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
void main() {
  float t = uTime * 0.04;
  float lat = vUv.y;
  // Banded base — alternating warm/cool bands
  float band = sin(lat * 18.0) * 0.5 + 0.5;
  float turbulence = snoise(vec2(vUv.x * 4.0 + t * (0.5 + lat), lat * 6.0)) * 0.18;
  float b = clamp(band + turbulence, 0.0, 1.0);
  vec3 warm = vec3(0.78, 0.55, 0.25);
  vec3 cool = vec3(0.55, 0.38, 0.18);
  vec3 light = vec3(0.92, 0.82, 0.65);
  vec3 col = mix(cool, warm, b);
  col = mix(col, light, pow(b, 3.0) * 0.5);
  // Great Red Spot region (equatorial band)
  float spotLat = abs(lat - 0.38);
  float spotLon = mod(vUv.x + t * 0.3, 1.0);
  float spot = smoothstep(0.08, 0.0, spotLat) * smoothstep(0.14, 0.0, abs(spotLon - 0.5));
  col = mix(col, vec3(0.72, 0.22, 0.10), spot * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

// ── SATURN SHADER ──────────────────────────────────────────────────────────
export const SATURN_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod(i,289.);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
void main() {
  float t = uTime * 0.025;
  float band = sin(vUv.y * 14.0) * 0.5 + 0.5;
  float turb = snoise(vec2(vUv.x * 3.0 + t, vUv.y * 5.0)) * 0.12;
  float b = clamp(band + turb, 0.0, 1.0);
  vec3 c1 = vec3(0.87, 0.80, 0.55);
  vec3 c2 = vec3(0.70, 0.60, 0.35);
  vec3 c3 = vec3(0.95, 0.90, 0.72);
  vec3 col = mix(c2, c1, b);
  col = mix(col, c3, pow(b, 4.0) * 0.4);
  gl_FragColor = vec4(col, 1.0);
}`;

// ── URANUS SHADER ──────────────────────────────────────────────────────────
// Pale cyan ice giant with subtle banding
export const URANUS_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod(i,289.);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
void main() {
  float t = uTime * 0.015;
  float band = sin(vUv.y * 8.0) * 0.5 + 0.5;
  float turb = snoise(vec2(vUv.x * 2.0 + t, vUv.y * 4.0)) * 0.08;
  float b = clamp(band + turb, 0.0, 1.0);
  vec3 c1 = vec3(0.49, 0.91, 0.91);
  vec3 c2 = vec3(0.35, 0.72, 0.78);
  vec3 c3 = vec3(0.70, 0.96, 0.96);
  vec3 col = mix(c2, c1, b);
  col = mix(col, c3, pow(b, 3.0) * 0.3);
  // Limb darkening
  float limb = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 0.4) * pow(1.0 - abs(vUv.y - 0.5) * 2.0, 0.4);
  col *= 0.75 + 0.25 * limb;
  gl_FragColor = vec4(col, 1.0);
}`;

// ── NEPTUNE SHADER ─────────────────────────────────────────────────────────
// Deep blue with stormy dynamic bands
export const NEPTUNE_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod(i,289.);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
void main() {
  float t = uTime * 0.05; // Neptune has fast winds
  float band = sin(vUv.y * 10.0 + snoise(vec2(vUv.x*2.0, vUv.y*3.0+t))*0.8) * 0.5 + 0.5;
  float turb = snoise(vec2(vUv.x * 5.0 + t * 1.2, vUv.y * 4.0 - t)) * 0.2;
  float b = clamp(band + turb, 0.0, 1.0);
  vec3 deep  = vec3(0.10, 0.20, 0.65);
  vec3 mid   = vec3(0.18, 0.35, 0.82);
  vec3 light = vec3(0.35, 0.55, 0.95);
  vec3 col = mix(deep, mid, b);
  col = mix(col, light, pow(b, 2.5) * 0.4);
  // Dark spot
  float spotLat = abs(vUv.y - 0.45);
  float spotLon = mod(vUv.x + t * 0.15, 1.0);
  float spot = smoothstep(0.07, 0.0, spotLat) * smoothstep(0.10, 0.0, abs(spotLon - 0.3));
  col = mix(col, vec3(0.05, 0.08, 0.30), spot * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

// Shared simple vertex shader for all planet surface shaders
export const PLANET_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// --- END OF FILE constants.ts ---