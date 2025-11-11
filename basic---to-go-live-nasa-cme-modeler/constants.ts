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
  SUN:     { name: 'Sun',     radius: 0, size: 0.1 * SCENE_SCALE, color: 0xffcc00, angle: 0, labelElementId: 'sun-label' } // Sun data for consistency
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

// --- START OF MODIFICATION: New Shaders for the Flux Rope Teardrop ---
export const FLUX_ROPE_VERTEX_SHADER = `
varying vec3 vNormal;
void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const FLUX_ROPE_FRAGMENT_SHADER = `
uniform vec3 uColor;
varying vec3 vNormal;

void main() {
    // Create a rim-lighting effect to make the edges glow brighter
    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    
    // Set a base transparency
    float alpha = 0.35;

    // The final color is the base color, with transparency boosted by the rim light
    gl_FragColor = vec4(uColor, alpha + intensity);
}`;
// --- END OF MODIFICATION ---

export const PRIMARY_COLOR = "#fafafa"; // neutral-50 (bright white accent)
export const PANEL_BG_COLOR = "rgba(23, 23, 23, 0.9)"; // neutral-900 with alpha
export const TEXT_COLOR = "#e5e5e5"; // neutral-200
export const HOVER_BG_COLOR = "rgba(38, 38, 38, 1)"; // neutral-800
// --- END OF FILE constants.ts ---