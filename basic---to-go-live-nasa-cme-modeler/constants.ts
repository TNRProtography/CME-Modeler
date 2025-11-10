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
  VENUS: { name: 'Venus', radius: 0.723 * SCENE_SCALE, size: 0.015 * SCENE_SCALE, color: 0xe6e6e6, angle: 3.5, labelElementId: 'venus-label', orbitalPeriodDays: 225 },
  
  EARTH: { name: 'Earth', radius: 1.0 * SCENE_SCALE, size: 0.02 * SCENE_SCALE, color: 0x2a6a9c, angle: 0, labelElementId: 'earth-label', orbitalPeriodDays: 365.25 },
  
  MOON: { name: 'Moon', orbits: 'EARTH', radius: 0.15 * SCENE_SCALE, size: 0.005 * SCENE_SCALE, color: 0xbbbbbb, angle: 2.1, labelElementId: 'moon-label', orbitalPeriodDays: 27.3 },
  MARS: { name: 'Mars', radius: 1.52 * SCENE_SCALE, size: 0.012 * SCENE_SCALE, color: 0xff5733, angle: 5.1, labelElementId: 'mars-label', orbitalPeriodDays: 687 },
  SUN: { name: 'Sun', radius: 0, size: 0.1 * SCENE_SCALE, color: 0xffcc00, angle: 0, labelElementId: 'sun-label' } // Sun data for consistency
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
    float noiseVal = snoise(distortedUV * 5.0 + time); // Renamed from noise to avoid conflict
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
        // A ripple effect that fades out
        impactGlow = sin(timeSinceImpact * 5.0 - length(vNormal) * 2.0) * 0.5 + 0.5; // simple ripple
        impactGlow *= smoothstep(2.5, 0.0, timeSinceImpact); // fade out over 2.5s
    }
    
    vec3 atmosphereColor = vec3(0.8, 0.85, 0.9);
    // Add the base glow and the impact glow, making the impact glow bright
    vec3 finalColor = atmosphereColor * (baseIntensity + impactGlow * 2.0);
    
    // The final alpha is a combination of the base glow and the impact glow
    gl_FragColor = vec4(finalColor, baseIntensity + impactGlow);
}`;

export const AURORA_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const AURORA_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uCmeSpeed; // e.g., 300 to 3000
uniform float uImpactTime; // Time of impact start
varying vec3 vNormal;
varying vec2 vUv;

// 2D simplex noise function
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
    // 1. Fade effect based on time since last impact
    float timeSinceImpact = uTime - uImpactTime;
    float fadeDuration = 10.0; // Effect lasts 10 seconds
    float impactFade = 0.0;
    if (uImpactTime > 0.0 && timeSinceImpact < fadeDuration) {
        // Fade in quickly, fade out slowly towards the end
        impactFade = smoothstep(0.0, 1.5, timeSinceImpact) * smoothstep(fadeDuration, fadeDuration - 4.0, timeSinceImpact);
    }
    if (impactFade <= 0.0) {
        discard;
    }

    // 2. Latitude extent based on CME speed
    float minSpeed = 300.0;
    float maxSpeed = 2500.0;
    float speedT = pow(clamp((uCmeSpeed - minSpeed) / (maxSpeed - minSpeed), 0.0, 1.0), 1.5);
    
    // abs(vNormal.y) is 1 at poles, 0 at equator.
    // Higher speed -> aurora reaches lower latitudes (vNormal.y closer to 0)
    float polarBandStart = mix(0.85, 0.4, speedT); // Start of band from pole (0.85 = ~58 deg lat)
    float polarBandEnd = 0.99; // End near pole
    
    float polarMask = smoothstep(polarBandStart, polarBandStart + 0.1, abs(vNormal.y)) - smoothstep(polarBandEnd, polarBandEnd + 0.05, abs(vNormal.y));
    if (polarMask <= 0.0) {
        discard;
    }

    // 3. Animated aurora curtain effect using noise
    float longitude = atan(vNormal.x, vNormal.z);
    float latitude = asin(vNormal.y);
    float noiseTime = uTime * 0.2;

    // Main wavy curtain patterns, moving at different speeds
    float noise1 = snoise(vec2(longitude * 3.0, latitude * 5.0 - noiseTime));
    float noise2 = snoise(vec2(longitude * 7.0, latitude * 6.0 + noiseTime * 1.5));
    
    // Vertical ray-like structure
    float curtain = pow(snoise(vec2(longitude * 2.5, uTime * 0.1)), 2.0);
    curtain = smoothstep(0.1, 0.6, curtain);
    
    float finalNoise = (noise1 + noise2) * 0.5 * curtain;
    finalNoise = pow(abs(finalNoise), 1.5) + pow(snoise(vec2(longitude * 1.5, latitude * 4.0 + noiseTime * -0.8)), 2.0) * 0.3;

    // 4. Determine color
    vec3 green = vec3(0.1, 1.0, 0.3);
    vec3 purple = vec3(0.8, 0.2, 1.0);
    // Color varies slowly with time and position
    vec3 color = mix(green, purple, smoothstep(0.3, 0.7, snoise(vec2(longitude * 0.5, latitude + uTime * 0.05))));
    
    // 5. Final output
    gl_FragColor = vec4(color, finalNoise * polarMask * impactFade);
}
`;

// --- NEW: Shaders for the Helical Flux Rope ---
export const FLUX_ROPE_VERTEX_SHADER = `
varying vec2 vUv;
varying float vFresnel;

void main() {
    vUv = uv;

    // Deform the straight tube into a cone shape.
    // The geometry is created along the Z axis (after rotation).
    // 'uv.x' gives the progress along the tube (0.0 at sun, 1.0 at front).
    // This scales the radius of the helix from 0 to its full size.
    float coneRadiusScale = uv.x;
    vec3 deformedPosition = position;
    deformedPosition.xy *= coneRadiusScale;

    // Calculate fresnel for a nice glow effect on the edges.
    vec4 mvPosition = modelViewMatrix * vec4(deformedPosition, 1.0);
    vec3 normal = normalize(normalMatrix * normal);
    vec3 viewVector = normalize(-mvPosition.xyz);
    vFresnel = pow(1.0 - abs(dot(normal, viewVector)), 3.0);

    gl_Position = projectionMatrix * mvPosition;
}`;

export const FLUX_ROPE_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFresnel;

// Function to draw an arrow shape in a 0-1 UV space
float arrow(vec2 uv, float thickness, float headSize) {
    // Shaft (a vertical line)
    float shaft = smoothstep(thickness, 0.0, abs(uv.x - 0.5));
    
    // Head (a triangle pointing up)
    float head = smoothstep(headSize, 0.0, abs(uv.y - 0.8) - uv.x) 
               * smoothstep(headSize, 0.0, abs(uv.y - 0.8) - (1.0 - uv.x));
               
    return max(shaft, head) * step(0.0, uv.y);
}

void main() {
    float numArrows = 20.0;
    float arrowSpeed = -2.0;

    // Create a local coordinate system for each arrow that repeats along the tube
    vec2 localUv = vec2(fract(vUv.x * numArrows + uTime * arrowSpeed), vUv.y);

    // Draw up-pointing arrows on the top half of the tube (vUv.y > 0.5)
    float upArrow = arrow(localUv, 0.05, 0.2);
    
    // Draw down-pointing arrows on the bottom half by flipping the y-coordinate
    float downArrow = arrow(vec2(localUv.x, 1.0 - localUv.y), 0.05, 0.2);
    
    float arrowMask = 0.0;
    if (vUv.y > 0.5) {
        arrowMask = upArrow;
    } else {
        arrowMask = downArrow;
    }
    
    // Create subtle glowing coils for the main body of the rope
    float coil = sin(vUv.y * 30.0 + vUv.x * 10.0) * 0.3 + 0.7;

    // Combine the glowing edge (fresnel), the coils, and the bright arrows
    float finalAlpha = (vFresnel * 0.7) + (coil * 0.3) + (arrowMask * 1.0);
    
    if (finalAlpha < 0.1) {
        discard;
    }
    
    gl_FragColor = vec4(uColor, finalAlpha);
}`;


export const PRIMARY_COLOR = "#fafafa"; // neutral-50 (bright white accent)
export const PANEL_BG_COLOR = "rgba(23, 23, 23, 0.9)"; // neutral-900 with alpha
export const TEXT_COLOR = "#e5e5e5"; // neutral-200
export const HOVER_BG_COLOR = "rgba(38, 38, 38, 1)"; // neutral-800