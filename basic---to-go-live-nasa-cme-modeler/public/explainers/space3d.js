// Shared 3D scene kit for the explainer animations (magnetotail, equinox boost,
// solar wind structure). Shaders and texture URLs mirror the app:
// constants.ts (SUN / EARTH_ATMOSPHERE / AURORA), SimulationCanvas.tsx (textures,
// createParticleTexture), utils/spaceScene.ts (Milky Way strength, palette).
(function () {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
  const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
  const TEX = {
    EARTH_DAY: 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg',
    EARTH_NORMAL: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_normal_2048.jpg',
    EARTH_SPEC: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_specular_2048.jpg',
    EARTH_CLOUDS: 'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png',
    MILKY_WAY: 'https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg',
  };

  const SNOISE = `
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
}`;

  const SUN_VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const SUN_FS = `uniform float uTime; uniform float uDark; uniform float uHoleLon; uniform float uHoleW;
varying vec2 vUv;
${SNOISE}
void main() {
    float time = uTime * 0.1;
    vec2 distortedUV = vUv + 0.1 * vec2(snoise(vUv * 2.0 + time), snoise(vUv * 2.0 + time + 5.0));
    float noiseVal = snoise(distortedUV * 5.0 + time);
    noiseVal = (noiseVal + 1.0) * 0.5;
    vec3 color = mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 0.5, 0.0), noiseVal);
    if (uDark > 0.0) {
      float d = abs(mod(vUv.x - uHoleLon + 0.5, 1.0) - 0.5);
      float lat = abs(vUv.y - 0.5);
      float hole = smoothstep(uHoleW, uHoleW * 0.55, d + snoise(vUv * 9.0) * 0.015) * smoothstep(0.32, 0.18, lat);
      color = mix(color, color * 0.22, hole * uDark);
    }
    gl_FragColor = vec4(color, 1.0);
}`;
  const ATM_VS = `varying vec3 vNormal;
void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const ATM_FS = `uniform float uImpactTime;
uniform float uTime;
varying vec3 vNormal;
void main() {
    float baseIntensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
    float impactGlow = 0.0;
    float timeSinceImpact = uTime - uImpactTime;
    if (uImpactTime > 0.0 && timeSinceImpact > 0.0 && timeSinceImpact < 2.5) {
        impactGlow = sin(timeSinceImpact * 5.0 - length(vNormal) * 2.0) * 0.5 + 0.5;
        impactGlow *= smoothstep(2.5, 0.0, timeSinceImpact);
    }
    vec3 atmosphereColor = vec3(0.8, 0.85, 0.9);
    vec3 finalColor = atmosphereColor * (baseIntensity + impactGlow * 2.0);
    gl_FragColor = vec4(finalColor, baseIntensity + impactGlow);
}`;
  const PT_VS = `attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
uniform float uScale; varying vec3 vC; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float ps = aSize * uScale / max(0.001, -mv.z);
  vA = aAlpha * clamp(ps, 0.0, 1.0);
  gl_PointSize = clamp(ps, 1.0, 42.0);
  vC = aColor;
  gl_Position = projectionMatrix * mv;
  if (aAlpha <= 0.001 || mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
  const PT_FS = `uniform sampler2D uTex; varying vec3 vC; varying float vA;
void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`;
  const LINE_VS = `attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aU;
uniform vec2 uRes; uniform float uWidth;
varying float vSide; varying float vU; varying float vVis;
void main(){
  mat4 pm = projectionMatrix * modelViewMatrix;
  vec4 c = pm * vec4(position, 1.0); vec4 a = pm * vec4(aPrev, 1.0); vec4 b = pm * vec4(aNext, 1.0);
  vVis = step(0.05, c.w) * step(0.05, a.w) * step(0.05, b.w);
  vec2 as2 = a.xy / a.w * uRes; vec2 bs2 = b.xy / b.w * uRes;
  vec2 d = bs2 - as2; float L = length(d);
  d = L > 0.00001 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-d.y, d.x);
  c.xy += nrm * aSide * uWidth / uRes * c.w;
  gl_Position = c; vSide = aSide; vU = aU;
}`;
  const LINE_FS = `uniform vec3 uA; uniform vec3 uB; uniform float uOp; uniform float uTime; uniform float uDir; uniform float uDash; uniform float uEnds; uniform float uFreq;
varying float vSide; varying float vU; varying float vVis;
void main(){
  float e = pow(1.0 - abs(vSide), 1.6);
  float ends = smoothstep(0.0, 0.05, vU) * smoothstep(1.0, 0.95, vU);
  float wave = 0.5 + 0.5 * sin(vU * uFreq - uTime * 3.0 * uDir);
  float sh = mix(0.78 + 0.22 * wave, 0.2 + 0.8 * pow(wave, 3.0), uDash);
  vec3 col = mix(uA, uB, vU);
  gl_FragColor = vec4(col, clamp(e * uOp * vVis * sh * mix(1.0, ends, uEnds), 0.0, 1.0));
}`;
  const SHELL_VS = `attribute vec2 aTP; uniform float uR0; uniform float uAlpha; uniform float uThMax;
varying vec3 vN; varying vec3 vV; varying float vX; varying float vPh;
vec3 surf(float th, float ph){ float r = uR0 * pow(2.0 / (1.0 + cos(th)), uAlpha); return vec3(-r*cos(th), r*sin(th)*cos(ph), r*sin(th)*sin(ph)); }
void main(){
  float th = max(0.003, aTP.x * uThMax); float ph = aTP.y; vec3 p = surf(th, ph);
  vec3 n = normalize(cross(surf(th + 0.002, ph) - p, surf(th, ph + 0.002) - p));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * n); vV = -mv.xyz; vX = p.x; vPh = ph;
  gl_Position = projectionMatrix * mv;
}`;
  const SHELL_FS = `uniform vec3 uColor; uniform float uOp; uniform float uTime; uniform float uFadeA; uniform float uFadeB; uniform float uPow; uniform float uFlow;
varying vec3 vN; varying vec3 vV; varying float vX; varying float vPh;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
  float rip = 0.68 + 0.32 * sin(vX * 0.9 - uTime * uFlow + sin(vPh * 6.0) * 1.5);
  float fade = 1.0 - smoothstep(uFadeA, uFadeB, vX);
  gl_FragColor = vec4(uColor, clamp(f * uOp * rip * fade, 0.0, 1.0));
}`;
  const OVAL_VS = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const OVAL_FS = `uniform float uTime; uniform float uI; uniform float uLat; uniform float uRed;
varying vec3 vP;
${SNOISE}
void main(){
  vec3 n = normalize(vP);
  float lat = degrees(asin(abs(n.y)));
  float phi = atan(n.z, n.x);
  float night = 0.5 + 0.5 * cos(phi);
  float eq = uLat + 7.0 * (1.0 - night);
  float w = 2.0 + (3.0 + 2.5 * min(uI, 3.0)) * night;
  float wig = snoise(vec2(phi * 3.0, uTime * 0.15)) * 1.2;
  float band = smoothstep(eq - 1.5 + wig, eq + 0.8 + wig, lat) * (1.0 - smoothstep(eq + w - 1.0 + wig, eq + w + 2.0 + wig, lat));
  if (band < 0.01) discard;
  float rays = 0.55 + 0.45 * snoise(vec2(phi * 18.0, uTime * 0.35 + lat * 0.2));
  float ray2 = pow(abs(snoise(vec2(phi * 40.0, uTime * 0.6))), 1.5);
  vec3 green = vec3(0.1, 1.0, 0.3); vec3 purple = vec3(0.8, 0.2, 1.0);
  vec3 col = mix(green, purple, smoothstep(0.3, 0.7, snoise(vec2(phi * 0.5, lat * 0.1 + uTime * 0.05))) * 0.35);
  col = mix(col, vec3(1.0, 0.25, 0.3), uRed * smoothstep(eq + w * 0.5, eq + w + 1.5, lat) * 0.5);
  float a = band * (rays * 0.7 + ray2 * 0.6) * (0.25 + 0.75 * night) * clamp(uI, 0.0, 4.0) * 0.55;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;
  const CURT_VS = `attribute float aPhi; attribute float aH; attribute float aHem;
uniform float uTime; uniform float uI; uniform float uLat;
varying float vH; varying float vPhi; varying float vNight;
${SNOISE}
void main(){
  float night = 0.5 + 0.5 * cos(aPhi);
  float eq = uLat + 7.0 * (1.0 - night);
  float latd = eq + 1.0 + (1.5 + 1.5 * min(uI, 3.0)) * night * 0.5 + snoise(vec2(aPhi * 3.0, uTime * 0.15)) * 1.2 + snoise(vec2(aPhi * 11.0, uTime * 0.4)) * 0.4 * min(uI, 3.0);
  float lat = radians(latd);
  float h = 0.012 + (0.025 + 0.05 * min(uI, 3.0)) * night;
  float r = 1.004 + aH * h;
  vec3 p = vec3(cos(lat) * cos(aPhi), aHem * sin(lat), cos(lat) * sin(aPhi)) * r;
  vH = aH; vPhi = aPhi; vNight = night;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
  const CURT_FS = `uniform float uTime; uniform float uI; uniform float uRed;
varying float vH; varying float vPhi; varying float vNight;
${SNOISE}
void main(){
  float rays = pow(0.5 + 0.5 * snoise(vec2(vPhi * 70.0, uTime * 0.5)), 2.5);
  float fold = 0.6 + 0.4 * snoise(vec2(vPhi * 9.0, uTime * 0.2));
  float bottom = smoothstep(0.0, 0.08, vH);
  float fade = pow(1.0 - vH, 1.3);
  vec3 green = vec3(0.15, 1.0, 0.4); vec3 red = vec3(1.0, 0.2, 0.35); vec3 purple = vec3(0.7, 0.25, 1.0);
  vec3 col = mix(green, mix(purple, red, uRed), smoothstep(0.35, 0.95, vH) * (0.4 + 0.6 * uRed));
  float a = bottom * fade * (0.25 + rays * 1.1) * fold * (0.15 + 0.85 * vNight) * clamp(uI, 0.0, 4.0) * 0.5;
  a += uRed * smoothstep(0.4, 0.8, vH) * (1.0 - vH) * 0.25 * uI * vNight * rays;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const bez = (a, b, c, d, t) => { const it = 1 - t; return it * it * it * a + 3 * it * it * t * b + 3 * it * t * t * c + t * t * t * d; };
  function crSample(ctrl, n, out) {
    const m = ctrl.length - 1;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) * m;
      const seg = Math.min(Math.floor(t), m - 1), f = t - seg;
      const p0 = ctrl[Math.max(seg - 1, 0)], p1 = ctrl[seg], p2 = ctrl[seg + 1], p3 = ctrl[Math.min(seg + 2, m)];
      const f2 = f * f, f3 = f2 * f;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3);
    }
  }
  function mkTable(alpha, thMax, N) {
    const X = new Float32Array(N), R = new Float32Array(N);
    for (let i = 0; i < N; i++) { const th = thMax * i / (N - 1); const r = Math.pow(2 / (1 + Math.cos(th)), alpha); X[i] = -r * Math.cos(th); R[i] = r * Math.sin(th); }
    return { X, R, N };
  }
  function lookup(tb, xn) {
    const X = tb.X, R = tb.R, N = tb.N;
    if (xn <= X[0]) return 0;
    if (xn >= X[N - 1]) { const s = (R[N - 1] - R[N - 2]) / (X[N - 1] - X[N - 2]); return R[N - 1] + s * (xn - X[N - 1]); }
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] < xn) lo = m; else hi = m; }
    return R[lo] + (R[hi] - R[lo]) * (xn - X[lo]) / (X[hi] - X[lo]);
  }
  const MP_T = mkTable(0.58, 170 * Math.PI / 180, 512);
  const BS_T = mkTable(0.82, 150 * Math.PI / 180, 512);
  const bsR0 = r0 => r0 * 1.28 + 1.5;
  const rmpAt = (x, r0) => lookup(MP_T, x / r0) * r0;
  const rbsAt = (x, r0) => { const b = bsR0(r0); return lookup(BS_T, x / b) * b; };
  function camAt(frames, u) {
    let i = 0; while (i < frames.length - 2 && u > frames[i + 1][0]) i++;
    const a = frames[i], b = frames[i + 1] || a;
    const f = b === a ? 0 : ss(0, 1, (u - a[0]) / (b[0] - a[0]));
    return { pos: a[1].map((v, j) => lerp(v, b[1][j], f)), tgt: a[2].map((v, j) => lerp(v, b[2][j], f)) };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const ex = Array.from(document.scripts).find(s => s.src === src);
      if (ex) { if (ex.dataset.loaded) return res(); ex.addEventListener('load', () => res()); ex.addEventListener('error', rej); return; }
      const s = document.createElement('script'); s.src = src;
      s.onload = () => { s.dataset.loaded = '1'; res(); }; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function load() {
    return (window.THREE ? Promise.resolve() : loadScript(THREE_URL)).then(() => (window.THREE.OrbitControls ? null : loadScript(ORBIT_URL)));
  }

  function createStage(host, opts) {
    opts = opts || {};
    const THREE = window.THREE;
    const cw = () => host.clientWidth || 800, ch = () => host.clientHeight || 600;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
    let lift = opts.lift == null ? 0.17 : opts.lift;
    renderer.setPixelRatio(dpr); renderer.setSize(cw(), ch()); renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, cw() / ch(), 0.05, 4000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 1.8; controls.maxDistance = 900;
    const ADD = THREE.AdditiveBlending;
    const uRes = { value: new THREE.Vector2(1, 1) }, uScale = { value: 800 }, uTime = { value: 0 };
    const S = { THREE, renderer, scene, camera, controls, dpr, uRes, uScale, uTime, camFree: false, onCamStart: null, ready: false, onReady: null, ss, lerp, clamp, bez, crSample, rmpAt, rbsAt, bsR0, camAt };
    controls.addEventListener('start', () => { if (!S.camFree) { S.camFree = true; if (S.onCamStart) S.onCamStart(); } });
    const resize = () => {
      const w = cw(), h = ch();
      renderer.setSize(w, h); camera.aspect = w / h;
      // Lift the subject above the caption card that covers the lower part of the frame
      camera.setViewOffset(w, h, 0, h * lift, w, h);
      camera.updateProjectionMatrix();
      uRes.value.set(w * dpr, h * dpr);
      uScale.value = (h * dpr) / (2 * Math.tan(camera.fov * Math.PI / 360));
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    S.setLift = v => { if (Math.abs(v - lift) > 0.005) { lift = v; resize(); } };
    const manager = new THREE.LoadingManager(() => { S.ready = true; if (S.onReady) S.onReady(); });
    const tl = new THREE.TextureLoader(manager); tl.setCrossOrigin('anonymous');
    S.tex = k => tl.load(TEX[k]);

    const pcv = document.createElement('canvas'); pcv.width = pcv.height = 64;
    const pg = pcv.getContext('2d'); const grd = pg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    pg.fillStyle = grd; pg.fillRect(0, 0, 64, 64);
    const ptex = new THREE.CanvasTexture(pcv); S.ptex = ptex;

    S.addSky = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), new THREE.MeshBasicMaterial({ map: S.tex('MILKY_WAY'), side: THREE.BackSide, color: 0x6b6b6b, depthWrite: false })); scene.add(m); return m; };
    S.mkSprite = (color, scale, op, parent) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ptex, color, blending: ADD, transparent: true, depthWrite: false, opacity: op }));
      s.scale.set(scale, scale, 1); (parent || scene).add(s); return s;
    };
    S.addSun = (x, R) => {
      const u = { uTime, uDark: { value: 0 }, uHoleLon: { value: 0.5 }, uHoleW: { value: 0.09 } };
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), new THREE.ShaderMaterial({ uniforms: u, vertexShader: SUN_VS, fragmentShader: SUN_FS }));
      mesh.position.set(x, 0, 0); scene.add(mesh);
      const c1 = S.mkSprite(0xffb35c, R * 5, 0.6); c1.position.copy(mesh.position);
      const c2 = S.mkSprite(0xff9a40, R * 13, 0.22); c2.position.copy(mesh.position);
      return { mesh, u, c1, c2 };
    };
    S.addEarth = (parent) => {
      const par = parent || scene;
      if (!S._lit) {
        scene.add(new THREE.AmbientLight(0x334466, 0.35));
        const L = new THREE.DirectionalLight(0xffffff, 1.35); L.position.set(-100, 6, 0); scene.add(L); S.sunLight = L; S._lit = true;
      }
      const group = new THREE.Group(); par.add(group);
      const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), new THREE.MeshPhongMaterial({
        map: S.tex('EARTH_DAY'), normalMap: S.tex('EARTH_NORMAL'), specularMap: S.tex('EARTH_SPEC'),
        specular: new THREE.Color(0x333333), shininess: 18, normalScale: new THREE.Vector2(0.6, 0.6),
      }));
      group.add(earth);
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 96), new THREE.MeshLambertMaterial({ map: S.tex('EARTH_CLOUDS'), transparent: true, opacity: 0.8, depthWrite: false }));
      group.add(clouds);
      const atmU = { uImpactTime: { value: 0 }, uTime };
      group.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 64), new THREE.ShaderMaterial({ uniforms: atmU, vertexShader: ATM_VS, fragmentShader: ATM_FS, side: THREE.BackSide, blending: ADD, transparent: true, depthWrite: false })));
      const aurGroup = new THREE.Group(); group.add(aurGroup);
      const aurU = { uTime, uI: { value: 0.3 }, uLat: { value: 71 }, uRed: { value: 0 } };
      aurGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.006, 128, 96), new THREE.ShaderMaterial({ uniforms: aurU, vertexShader: OVAL_VS, fragmentShader: OVAL_FS, transparent: true, blending: ADD, depthWrite: false })));
      const Sg = 360, phi = [], hh = [], hem = [], pos = [], idx = [];
      for (const hm of [1, -1]) {
        const base = phi.length;
        for (let i = 0; i <= Sg; i++) { const ph = i / Sg * Math.PI * 2; for (const h of [0, 1]) { phi.push(ph); hh.push(h); hem.push(hm); pos.push(0, 0, 0); } }
        for (let i = 0; i < Sg; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aPhi', new THREE.Float32BufferAttribute(phi, 1));
      g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
      g.setAttribute('aHem', new THREE.Float32BufferAttribute(hem, 1));
      g.setIndex(idx);
      const cm = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: aurU, vertexShader: CURT_VS, fragmentShader: CURT_FS, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide }));
      cm.frustumCulled = false; aurGroup.add(cm);
      return { group, earth, clouds, atmU, aurGroup, aurU };
    };
    S.mkShell = (alpha, thMax, color, fadeA, fadeB, pw, flow, parent) => {
      const nT = 96, nP = 96, tp = [], pos = [], idx = [];
      for (let i = 0; i <= nT; i++) for (let j = 0; j <= nP; j++) { tp.push(i / nT, j / nP * Math.PI * 2); pos.push(0, 0, 0); }
      for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) { const a = i * (nP + 1) + j, b = a + nP + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aTP', new THREE.Float32BufferAttribute(tp, 2)); g.setIndex(idx);
      const u = { uR0: { value: 10 }, uAlpha: { value: alpha }, uThMax: { value: thMax }, uColor: { value: new THREE.Color(color) }, uOp: { value: 0.1 }, uTime, uFadeA: { value: fadeA }, uFadeB: { value: fadeB }, uPow: { value: pw }, uFlow: { value: flow } };
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: SHELL_VS, fragmentShader: SHELL_FS, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide }));
      m.frustumCulled = false; (parent || scene).add(m); return { mesh: m, u };
    };
    S.magnetosphere = (parent) => ({
      mp: S.mkShell(0.58, 166 * Math.PI / 180, 0x5aa0ff, 45, 95, 2.4, 2.2, parent),
      bs: S.mkShell(0.82, 140 * Math.PI / 180, 0x78b4ff, 30, 90, 2.0, 3.0, parent),
    });
    S.mkLine = (n, ca, cb, width, op, parent) => {
      const P = new Float32Array(n * 6), PR = new Float32Array(n * 6), NX = new Float32Array(n * 6), SD = new Float32Array(n * 2), U = new Float32Array(n * 2), idx = [];
      for (let i = 0; i < n; i++) { SD[i * 2] = -1; SD[i * 2 + 1] = 1; U[i * 2] = U[i * 2 + 1] = i / (n - 1); }
      for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      const att = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', att(P, 3)); g.setAttribute('aPrev', att(PR, 3)); g.setAttribute('aNext', att(NX, 3));
      g.setAttribute('aSide', new THREE.BufferAttribute(SD, 1)); g.setAttribute('aU', new THREE.BufferAttribute(U, 1)); g.setIndex(idx);
      const u = { uRes, uWidth: { value: width * dpr }, uA: { value: new THREE.Vector3(...ca) }, uB: { value: new THREE.Vector3(...cb) }, uOp: { value: op }, uTime, uDir: { value: 1 }, uDash: { value: 0 }, uEnds: { value: 1 }, uFreq: { value: 48 } };
      const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide }));
      mesh.frustumCulled = false; (parent || scene).add(mesh);
      const pts = new Float32Array(n * 3);
      return {
        mesh, u, n, pts,
        set() {
          for (let i = 0; i < n; i++) {
            const i0 = i * 3, ip = Math.max(0, i - 1) * 3, inx = Math.min(n - 1, i + 1) * 3;
            for (let k = 0; k < 3; k++) {
              const c = pts[i0 + k];
              let pv = pts[ip + k], nv = pts[inx + k];
              if (i === 0) pv = 2 * c - nv;
              if (i === n - 1) nv = 2 * c - pv;
              P[i * 6 + k] = P[i * 6 + 3 + k] = c; PR[i * 6 + k] = PR[i * 6 + 3 + k] = pv; NX[i * 6 + k] = NX[i * 6 + 3 + k] = nv;
            }
          }
          g.attributes.position.needsUpdate = true; g.attributes.aPrev.needsUpdate = true; g.attributes.aNext.needsUpdate = true;
        },
        vis(o) { u.uOp.value = o; mesh.visible = o > 0.002; },
        color(a, b) { u.uA.value.set(...a); u.uB.value.set(...(b || a)); },
      };
    };
    S.mkCloud = (n, parent) => {
      const P = new Float32Array(n * 3), C = new Float32Array(n * 3), A = new Float32Array(n), Sz = new Float32Array(n);
      const g = new THREE.BufferGeometry();
      const att = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', att(P, 3)); g.setAttribute('aColor', att(C, 3)); g.setAttribute('aAlpha', att(A, 1)); g.setAttribute('aSize', att(Sz, 1));
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uTex: { value: ptex }, uScale }, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: ADD }));
      pts.frustumCulled = false; (parent || scene).add(pts);
      return { P, C, A, S: Sz, n, pts, flush() { for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) g.attributes[k].needsUpdate = true; }, hide() { A.fill(0); this.flush(); } };
    };
    S.put = (cl, i, x, y, z, r, g, b, a, s) => { const j = i * 3; cl.P[j] = x; cl.P[j + 1] = y; cl.P[j + 2] = z; cl.C[j] = r; cl.C[j + 1] = g; cl.C[j + 2] = b; cl.A[i] = a; cl.S[i] = s; };

    // Closed dipole field line (magnetotail model). out = Float32Array n*3, in a frame where y is the dipole axis and -x faces the Sun.
    S.dipoleLine = (out, n, L, phi, r0, stretch) => {
      const lf = Math.acos(Math.sqrt(1 / L)), cp = Math.cos(phi), sp = Math.sin(phi);
      const wD = Math.max(0, -cp), wN = Math.max(0, cp), fd = Math.min(1, r0 * 0.92 / L);
      const kst = stretch * wN * Math.pow(Math.max(0, (L - 2) / 3), 1.5);
      for (let i = 0; i < n; i++) {
        const lam = -lf + 2 * lf * i / (n - 1), co = Math.cos(lam), r = L * co * co;
        let rho = r * co, y = r * Math.sin(lam); const q = r / L;
        rho *= 1 - (1 - fd) * wD * q; y *= 1 - (1 - fd) * wD * q * 0.6;
        rho *= 1 + kst * q * q * q; y *= 1 - stretch * wN * 0.5 * q * q * Math.min(1, (L - 2) / 5);
        out[i * 3] = rho * cp; out[i * 3 + 1] = y; out[i * 3 + 2] = rho * sp;
      }
    };

    const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(), tmp = new THREE.Vector3(); let camInit = false;
    S.drive = (pos, tgt, rdt, shake) => {
      if (!S.camFree) {
        if (!camInit) { camPos.set(...pos); camTgt.set(...tgt); camInit = true; }
        const k = 1 - Math.exp(-rdt * 2.2);
        camPos.lerp(tmp.set(...pos), k); camTgt.lerp(tmp.set(...tgt), k);
        camera.position.copy(camPos);
        const ka = camera.aspect < 1 ? Math.pow(1 / camera.aspect, 0.75) : 1;
        if (ka !== 1) camera.position.sub(camTgt).multiplyScalar(ka).add(camTgt);
        if (shake) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
        camera.lookAt(camTgt); controls.target.copy(camTgt);
      } else controls.update();
    };
    S.resumeCam = () => { S.camFree = false; camPos.copy(camera.position); camTgt.copy(controls.target); };
    // anchors: { id: [x,y,z] | null }, els: { id: HTMLElement }
    S.labels = (anchors, els) => {
      const w = cw(), h = ch();
      for (const id in els) {
        const el = els[id]; if (!el) continue;
        const an = anchors[id];
        if (an) {
          tmp.set(an[0], an[1], an[2]).project(camera);
          if (tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2) {
            el.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * w - 2.5).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * h - 7).toFixed(1)}px)`;
            el.style.opacity = '1';
            continue;
          }
        }
        el.style.opacity = '0';
      }
    };
    let raf = 0, alive = true, last = performance.now();
    S.start = (fn) => {
      const tick = (now) => {
        if (!alive) return;
        raf = requestAnimationFrame(tick);
        const rdt = Math.min(0.05, (now - last) / 1000); last = now;
        fn(rdt, now);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);
    };
    S.dispose = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); };
    return S;
  }

  window.Space3D = { load, createStage, ss, lerp, clamp, bez, crSample, rmpAt, rbsAt, bsR0, camAt, TEX };
})();
