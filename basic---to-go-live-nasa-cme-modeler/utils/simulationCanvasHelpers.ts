export const TEX = {
  EARTH_DAY: 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg',
  EARTH_NORMAL: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_normal_2048.jpg',
  EARTH_SPEC: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_specular_2048.jpg',
  EARTH_CLOUDS: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png',
  MOON: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/moon_1024.jpg',
  SUN_PHOTOSPHERE: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Solarsystemscope_texture_2k_sun.jpg',
  MILKY_WAY: 'https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg',
};

export const CH_HSS_LONGITUDE_VISUAL_OFFSET_DEG = -12;
export const CH_HSS_LONGITUDE_VISUAL_OFFSET_RAD = CH_HSS_LONGITUDE_VISUAL_OFFSET_DEG * Math.PI / 180;

export const BZ_FIELD_LINE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uBzSouth;
  attribute float aAlong;
  attribute float aAngle;
  attribute float aPhase;
  varying float vAlpha;
  varying float vBzSouth;
  varying float vArrow;
  void main() {
    float flowDir = uBzSouth > 0.5 ? -1.0 : 1.0;
    float travel = mod(aAlong + aPhase + uTime * 0.18 * flowDir, 1.0);
    float fade = smoothstep(0.0, 0.12, travel) * smoothstep(1.0, 0.88, travel);
    vAlpha = fade * 0.85;
    vBzSouth = uBzSouth;
    float arrowPos = mod(travel * 6.0, 1.0);
    vArrow = pow(max(0.0, 1.0 - abs(arrowPos - 0.5) * 8.0), 2.0);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 3.5;
  }
`;

export const BZ_FIELD_LINE_FRAGMENT_SHADER = `
  uniform float uBzSouth;
  varying float vAlpha;
  varying float vArrow;
  void main() {
    vec3 northColor = vec3(0.27, 0.53, 1.0);
    vec3 southColor = vec3(1.0,  0.27, 0.13);
    vec3 col = mix(northColor, southColor, uBzSouth);
    col = mix(col, vec3(1.0), vArrow * 0.6);
    vec2 uv = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.35, 0.5, length(uv));
    gl_FragColor = vec4(col, vAlpha * disc);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export const BZ_INDICATOR_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const BZ_INDICATOR_FRAGMENT_SHADER = `
  uniform float uBzSouth;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float dist = length(p);
    if (dist > 0.92) discard;
    vec3 northColor = vec3(0.27, 0.53, 1.0);
    vec3 southColor = vec3(1.0,  0.27, 0.13);
    vec3 col = mix(northColor, southColor, uBzSouth);
    float shaft = step(abs(p.x), 0.10) * step(abs(p.y), 0.58);
    float arrowDir  = uBzSouth > 0.5 ? -1.0 : 1.0;
    float headY     = arrowDir * 0.58;
    float headDist  = arrowDir * (p.y - headY);
    float headWidth = 0.30 * headDist;
    float head = step(0.0, headDist) * step(abs(p.x), headWidth) * step(headDist, 0.38);
    float arrow = clamp(shaft + head, 0.0, 1.0);
    float pulse = 0.78 + 0.22 * sin(uTime * 2.5);
    float glow = smoothstep(0.5, 0.0, dist) * 0.18 * arrow;
    float finalAlpha = (arrow * 0.90 + glow) * pulse;
    finalAlpha *= 1.0 - smoothstep(0.80, 0.92, dist);
    gl_FragColor = vec4(col * pulse, finalAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

let particleTextureCache: any = null;
export const createParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  particleTextureCache = new THREE.CanvasTexture(canvas);
  return particleTextureCache;
};

let arrowTextureCache: any = null;
export const createArrowTexture = (THREE: any) => {
  if (arrowTextureCache) return arrowTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const size = 256; canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  const aw = size / 6, ah = size / 4, sp = size / 3;
  for (let x = -aw; x < size + sp; x += sp) {
    ctx.beginPath(); ctx.moveTo(x, size * 0.5);
    ctx.lineTo(x + aw, size * 0.5 - ah / 2); ctx.lineTo(x + aw, size * 0.5 + ah / 2);
    ctx.closePath(); ctx.fill();
  }
  arrowTextureCache = new THREE.CanvasTexture(canvas);
  arrowTextureCache.wrapS = THREE.RepeatWrapping;
  arrowTextureCache.wrapT = THREE.RepeatWrapping;
  return arrowTextureCache;
};

export const GCS_ARC_RADIUS_FRAC = 0.55;
export const GCS_ARC_SPAN = Math.PI * 0.85;
export const GCS_TUBE_RADIUS_FRAC = 0.52;
export const GCS_AXIAL_DEPTH_FRAC = 0.38;
export const BZ_FIELD_LINE_COUNT = 8;
export const BZ_FIELD_LINE_POINTS = 120;

export const getCmeOpacity = (speed: number) => {
  const T = (window as any).THREE;
  if (!T) return 0.22;
  return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.06, 0.65);
};

export const getCmeParticleCount = (speed: number) => {
  const T = (window as any).THREE;
  if (!T) return 4000;
  return Math.floor(T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 1500, 7000));
};

export const getCmeParticleSize = (speed: number, scale: number) => {
  const T = (window as any).THREE;
  if (!T) return 0.05 * scale;
  return T.MathUtils.mapLinear(T.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.04 * scale, 0.08 * scale);
};

export const getCmeCoreColor = (speed: number) => {
  const T = (window as any).THREE;
  if (!T) return { setHex: () => {} };
  const clamped = T.MathUtils.clamp(speed, 0, 3000);
  const stops = [
    { speed: 0, color: new T.Color(0x808080) },
    { speed: 350, color: new T.Color(0x808080) },
    { speed: 500, color: new T.Color(0xffff00) },
    { speed: 800, color: new T.Color(0xffa500) },
    { speed: 1000, color: new T.Color(0xff4500) },
    { speed: 1800, color: new T.Color(0x9370db) },
    { speed: 2500, color: new T.Color(0xff69b4) },
    { speed: 3000, color: new T.Color(0xff69b4) },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];
    if (clamped <= end.speed) {
      const t = end.speed === start.speed ? 0 : T.MathUtils.mapLinear(clamped, start.speed, end.speed, 0, 1);
      return start.color.clone().lerp(end.color, t);
    }
  }
  return stops[stops.length - 1].color.clone();
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
