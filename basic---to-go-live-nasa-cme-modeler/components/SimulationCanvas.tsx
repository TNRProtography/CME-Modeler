import React, { useRef, useEffect, useCallback } from 'react';
import { ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData, InteractionMode, SimulationCanvasHandle } from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER
} from '../constants';

/** =========================================================
 *  VISUAL UPGRADE ASSET URLS (swap for your own if desired)
 *  ========================================================= */
const TEX = {
  // Earth
  earthDay:       'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/earth/earth-daymap-4k.jpg',
  earthNormal:    'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/earth/earth-normal-4k.jpg',
  earthSpecular:  'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/earth/earth-specular-4k.jpg',
  earthClouds:    'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/earth/earth-clouds-4k.png',
  // Optional planets
  mercury:        'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/mercury/mercury-2k.jpg',
  venus:          'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/venus/venus-2k.jpg',
  mars:           'https://cdn.jsdelivr.net/gh/typpo/spacekit@master/assets/planets/mars/mars-2k.jpg',
  // Milky Way sky (equirectangular)
  milkyWay:       'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/eso_dark_milkyway.jpg'
};

// Texture cache
const _texCache: Record<string, any> = {};
const loadTexture = (THREE: any, url?: string | null) => {
  if (!url) return null;
  if (_texCache[url]) return _texCache[url];
  const t = new THREE.TextureLoader().load(url);
  t.anisotropy = 8;
  _texCache[url] = t;
  return t;
};

// Procedural soft corona sprite cache
let coronaTextureCache: any = null;
const getCoronaTexture = (THREE: any) => {
  if (coronaTextureCache) return coronaTextureCache;
  if (!THREE || typeof document === 'undefined') return null;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size/2, size/2, size*0.05, size/2, size/2, size*0.5);
  g.addColorStop(0.0, 'rgba(255,240,210,0.80)');
  g.addColorStop(0.35,'rgba(255,190,80,0.40)');
  g.addColorStop(0.7, 'rgba(255,150,0,0.12)');
  g.addColorStop(1.0, 'rgba(255,120,0,0.00)');
  ctx.fillStyle = g; ctx.fillRect(0,0,size,size);

  coronaTextureCache = new THREE.CanvasTexture(canvas);
  coronaTextureCache.anisotropy = 4;
  return coronaTextureCache;
};

/** =========================================================
 *  KEEP YOUR ORIGINAL CME PARTICLE CONES (helpers below)
 *  ========================================================= */

// Cache for the particle texture to avoid recreating it
let particleTextureCache: any = null;

// Creates a soft, radial gradient texture for the particles
const createParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  particleTextureCache = new (window as any).THREE.CanvasTexture(canvas);
  return particleTextureCache;
};

// Calculates CME opacity based on speed (km/s)
const getCmeOpacity = (speed: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 0.22;
  const minSpeed = 300, maxSpeed = 3000, minOpacity = 0.06, maxOpacity = 0.65;
  const s = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  return THREE.MathUtils.mapLinear(s, minSpeed, maxSpeed, minOpacity, maxOpacity);
};

// Calculates CME particle count based on speed (km/s)
const getCmeParticleCount = (speed: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 4000;
  const minSpeed = 300, maxSpeed = 3000, minP = 1500, maxP = 7000;
  const s = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  return Math.floor(THREE.MathUtils.mapLinear(s, minSpeed, maxSpeed, minP, maxP));
};

// Calculates CME particle size based on speed (km/s)
const getCmeParticleSize = (speed: number, scale: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 0.05 * scale;
  const minSpeed = 300, maxSpeed = 3000, minSz = 0.04 * scale, maxSz = 0.08 * scale;
  const s = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  return THREE.MathUtils.mapLinear(s, minSpeed, maxSpeed, minSz, maxSz);
};

// Determines the core color of the CME based on its speed
const getCmeCoreColor = (speed: number): any => {
  const THREE = (window as any).THREE;
  if (!THREE) return { setHex: () => {} };
  if (speed >= 2500) return new THREE.Color(0xff69b4); // Hot Pink
  if (speed >= 1800) return new THREE.Color(0x9370db); // Medium Purple
  if (speed >= 1000) return new THREE.Color(0xff4500); // OrangeRed
  if (speed >= 800)  return new THREE.Color(0xffa500); // Orange
  if (speed >= 500)  return new THREE.Color(0xffff00); // Yellow
  if (speed < 350)   return new THREE.Color(0x808080); // Grey
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  const t = THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1);
  return grey.lerp(yellow, t);
};

const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v));

/** =========================================================
 *  COMPONENT
 *  ========================================================= */
interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void;
  timelineActive: boolean;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineValue: number; // 0-1000
  timelineMinDate: number;
  timelineMaxDate: number;
  setPlanetMeshesForLabels: (labels: PlanetLabelInfo[]) => void;
  setRendererDomElement: (element: HTMLCanvasElement) => void;
  onCameraReady: (camera: any) => void; // Pass camera up for labels
  getClockElapsedTime: () => number;
  resetClock: () => void;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showExtraPlanets: boolean;
  showMoonL1: boolean;
  dataVersion: number;
  interactionMode: InteractionMode;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData,
    activeView,
    focusTarget,
    currentlyModeledCMEId,
    // onCMEClick, // not used (kept to preserve signature)
    timelineActive,
    timelinePlaying,
    timelineSpeed,
    timelineValue,
    timelineMinDate,
    timelineMaxDate,
    setPlanetMeshesForLabels,
    setRendererDomElement,
    onCameraReady,
    getClockElapsedTime,
    resetClock,
    onScrubberChangeByAnim,
    onTimelineEnd,
    showExtraPlanets,
    showMoonL1,
    dataVersion,
    interactionMode,
  } = props;

  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const cmeGroupRef = useRef<any>(null);
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef = useRef<Record<string, any>>({});
  const predictionLineRef = useRef<any>(null);

  // New visual refs
  const starsNearRef = useRef<any>(null);
  const starsFarRef = useRef<any>(null);

  const timelineValueRef = useRef(timelineValue);
  const lastTimeRef = useRef(0);

  const animPropsRef = useRef({
    onScrubberChangeByAnim,
    onTimelineEnd,
    currentlyModeledCMEId,
    timelineActive,
    timelinePlaying,
    timelineSpeed,
    timelineMinDate,
    timelineMaxDate,
  });

  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim,
      onTimelineEnd,
      currentlyModeledCMEId,
      timelineActive,
      timelinePlaying,
      timelineSpeed,
      timelineMinDate,
      timelineMaxDate,
    };
  }, [
    onScrubberChangeByAnim,
    onTimelineEnd,
    currentlyModeledCMEId,
    timelineActive,
    timelinePlaying,
    timelineSpeed,
    timelineMinDate,
    timelineMaxDate,
  ]);

  const THREE = (window as any).THREE;
  const gsap = (window as any).gsap;

  useEffect(() => {
    timelineValueRef.current = timelineValue;
  }, [timelineValue]);

  /** Distance from Sun center in SCENE units:
   *  - Earth-directed CMEs can optionally use a “deceleration to arrival” approximation
   *  - Otherwise constant-speed km/s -> AU -> scene units (matches your original feel)
   */
  const calculateDistance = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number, useDeceleration: boolean): number => {
    const speed_km_per_sec = cme.speed;
    const speed_AU_per_sec = speed_km_per_sec / AU_IN_KM;

    if (cme.isEarthDirected && cme.predictedArrivalTime && useDeceleration) {
      const earthOrbitRadiusActualAU = PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE;
      const totalTravelTimeSeconds = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
      if (totalTravelTimeSeconds <= 0) return 0;
      const proportionOfTravel = Math.min(1.0, timeSinceEventSeconds / totalTravelTimeSeconds);
      const distanceActualAU = proportionOfTravel * earthOrbitRadiusActualAU;
      return distanceActualAU * SCENE_SCALE;
    }

    // simple ballistic
    const distanceActualAU = speed_AU_per_sec * Math.max(0, timeSinceEventSeconds);
    return distanceActualAU * SCENE_SCALE;
  }, []);

  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number) => {
    if (!THREE) return;

    const sunRadius = PLANET_DATA_MAP.SUN.size;

    // Only hide if before start (negative distance)
    if (distTraveledInSceneUnits < 0) {
      cmeObject.visible = false;
      return;
    }

    cmeObject.visible = true;

    const cmeLength = Math.max(0, distTraveledInSceneUnits - sunRadius);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    const tipPosition = direction.clone().multiplyScalar(sunRadius);
    cmeObject.position.copy(tipPosition);

    // Scale the cone (unit length=1) up to desired length
    cmeObject.scale.set(cmeLength, cmeLength, cmeLength);
  }, [THREE]);

  // -------- Scene init --------
  useEffect(() => {
    if (!mountRef.current || !THREE) return;
    if (rendererRef.current) return;

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.001 * SCENE_SCALE, 120 * SCENE_SCALE);
    cameraRef.current = camera;
    onCameraReady(camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 2.4, 300 * SCENE_SCALE);
    scene.add(pointLight);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.12 * SCENE_SCALE;
    controls.maxDistance = 55 * SCENE_SCALE;
    controlsRef.current = controls;

    // CME container
    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    // --- Stars: two twinkling layers ---
    const starLayers: any[] = [];
    const makeStars = (count: number, spread: number, size: number) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const phase = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        pos[3 * i + 0] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        pos[3 * i + 1] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        pos[3 * i + 2] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        phase[i] = Math.random() * Math.PI * 2;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
      const mat = new THREE.PointsMaterial({
        size: size * SCENE_SCALE,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Points(geo, mat);
      starLayers.push(mesh);
      scene.add(mesh);
      return mesh;
    };
    const starsNear = makeStars(14000, 260, 0.012);
    const starsFar = makeStars(22000, 480, 0.009);
    starsNearRef.current = starsNear;
    starsFarRef.current = starsFar;

    // --- Milky Way sky dome (equirectangular) ---
    try {
      const milky = loadTexture(THREE, TEX.milkyWay);
      if (milky) {
        milky.mapping = THREE.EquirectangularReflectionMapping;
        const skyGeo = new THREE.SphereGeometry(1000 * SCENE_SCALE, 64, 64);
        const skyMat = new THREE.MeshBasicMaterial({ map: milky, side: THREE.BackSide, depthWrite: false, opacity: 0.95, transparent: true });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        sky.name = 'milkyway-sky';
        scene.add(sky);
      }
    } catch {}

    // --- Sun (keep your shader), add soft corona halo ---
    const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
      transparent: true,
    });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const coronaTex = getCoronaTexture(THREE);
    if (coronaTex) {
      const coronaMat = new THREE.SpriteMaterial({
        map: coronaTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.7
      });
      const corona = new THREE.Sprite(coronaMat);
      corona.name = 'sun-corona';
      corona.scale.setScalar(PLANET_DATA_MAP.SUN.size * 5.2);
      sunMesh.add(corona);
    }

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // --- Planets orbiting the Sun ---
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;

      // Start with plain mesh
      let planetMaterial: any = new THREE.MeshPhongMaterial({ color: data.color, shininess: 32, specular: 0x222222 });
      let planetGeometry = new THREE.SphereGeometry(data.size, 64, 64);
      let planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
      planetMesh.position.x = data.radius * Math.sin(data.angle);
      planetMesh.position.z = data.radius * Math.cos(data.angle);
      planetMesh.userData = data;
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = { mesh: planetMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: planetMesh });

      // Upgrade planet textures where available
      if (name === 'EARTH') {
        const earthData = data as PlanetData;

        const dayMap = loadTexture(THREE, TEX.earthDay);
        const normMap = loadTexture(THREE, TEX.earthNormal);
        const specMap = loadTexture(THREE, TEX.earthSpecular);

        const earthGeo = new THREE.SphereGeometry(earthData.size, 64, 64);
        const earthMat = new THREE.MeshPhongMaterial({
          map: dayMap,
          normalMap: normMap,
          specularMap: specMap,
          specular: new THREE.Color(0x222222),
          shininess: 15
        });
        const earthMesh = new THREE.Mesh(earthGeo, earthMat);
        earthMesh.position.copy(planetMesh.position);
        earthMesh.userData = planetMesh.userData;
        scene.remove(planetMesh);
        scene.add(earthMesh);
        celestialBodiesRef.current[name].mesh = earthMesh;

        // Clouds layer
        const cloudsTex = loadTexture(THREE, TEX.earthClouds);
        if (cloudsTex) {
          const cloudsGeo = new THREE.SphereGeometry(earthData.size * 1.015, 64, 64);
          const cloudsMat = new THREE.MeshPhongMaterial({
            map: cloudsTex,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
          });
          const clouds = new THREE.Mesh(cloudsGeo, cloudsMat);
          clouds.name = 'clouds';
          earthMesh.add(clouds);
        }

        // Atmosphere (yours)
        const atmosphereGeo = new THREE.SphereGeometry(earthData.size * 1.2, 32, 32);
        const atmosphereMat = new THREE.ShaderMaterial({
          vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER,
          fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } }
        });
        const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
        atmosphere.name = 'atmosphere';
        earthMesh.add(atmosphere);

        // Aurora (yours)
        const auroraGeo = new THREE.SphereGeometry(earthData.size * 1.25, 64, 64);
        const auroraMat = new THREE.ShaderMaterial({
          vertexShader: AURORA_VERTEX_SHADER,
          fragmentShader: AURORA_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: { value: 0.0 },
            uCmeSpeed: { value: 0.0 },
            uImpactTime: { value: 0.0 }
          }
        });
        const aurora = new THREE.Mesh(auroraGeo, auroraMat);
        aurora.name = 'aurora';
        earthMesh.add(aurora);

        // Replace label info reference
        const idx = planetLabelInfos.findIndex(p => p.name === 'Earth');
        if (idx >= 0) planetLabelInfos[idx] = { id: earthData.labelElementId, name: earthData.name, mesh: earthMesh };
      } else if (name === 'MERCURY') {
        const tex = loadTexture(THREE, TEX.mercury);
        if (tex) { (planetMesh.material as any).map = tex; (planetMesh.material as any).needsUpdate = true; }
      } else if (name === 'VENUS') {
        const tex = loadTexture(THREE, TEX.venus);
        if (tex) { (planetMesh.material as any).map = tex; (planetMesh.material as any).needsUpdate = true; }
      } else if (name === 'MARS') {
        const tex = loadTexture(THREE, TEX.mars);
        if (tex) { (planetMesh.material as any).map = tex; (planetMesh.material as any).needsUpdate = true; }
      }

      // Orbit tube (your thicker style)
      const orbitPoints = [];
      const orbitSegments = 128;
      for (let i = 0; i <= orbitSegments; i++) {
        const angle = (i / orbitSegments) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius));
      }
      const orbitCurve = new THREE.CatmullRomCurve3(orbitPoints);
      const tubeThickness = 0.005 * SCENE_SCALE;
      const orbitGeometry = new THREE.TubeGeometry(orbitCurve, orbitSegments, tubeThickness, 8, true);
      const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 });
      const orbitTube = new THREE.Mesh(orbitGeometry, orbitMaterial);
      scene.add(orbitTube);
      orbitsRef.current[name] = orbitTube;
    });

    // --- Moons (e.g., Moon) ---
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (!data.orbits) return;
      const parentBody = celestialBodiesRef.current[data.orbits];
      if (!parentBody) return;

      const moonGeometry = new THREE.SphereGeometry(data.size, 16, 16);
      const moonMaterial = new THREE.MeshPhongMaterial({ color: data.color, shininess: 6 });
      const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
      moonMesh.position.x = data.radius * Math.sin(data.angle);
      moonMesh.position.z = data.radius * Math.cos(data.angle);
      moonMesh.userData = data;

      parentBody.mesh.add(moonMesh);
      celestialBodiesRef.current[name] = { mesh: moonMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: moonMesh });

      // Moon orbit tube
      const orbitPoints = [];
      const orbitSegments = 64;
      for (let i = 0; i <= orbitSegments; i++) {
        const angle = (i / orbitSegments) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius));
      }
      const orbitCurve = new THREE.CatmullRomCurve3(orbitPoints);
      const tubeThickness = 0.003 * SCENE_SCALE;
      const orbitGeometry = new THREE.TubeGeometry(orbitCurve, orbitSegments, tubeThickness, 8, true);
      const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 });
      const orbitTube = new THREE.Mesh(orbitGeometry, orbitMaterial);
      orbitTube.name = 'moon-orbit';
      parentBody.mesh.add(orbitTube);
    });

    // --- POIs (e.g., L1) ---
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const poiGeometry = new THREE.TetrahedronGeometry(data.size, 0);
      const poiMaterial = new THREE.MeshBasicMaterial({ color: data.color });
      const poiMesh = new THREE.Mesh(poiGeometry, poiMaterial);
      poiMesh.userData = data;

      scene.add(poiMesh);
      celestialBodiesRef.current[name] = { mesh: poiMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: poiMesh });
    });

    setPlanetMeshesForLabels(planetLabelInfos);

    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const {
        currentlyModeledCMEId,
        timelineActive,
        timelinePlaying,
        timelineSpeed,
        timelineMinDate,
        timelineMaxDate,
        onScrubberChangeByAnim,
        onTimelineEnd,
      } = animPropsRef.current;

      const elapsedTime = getClockElapsedTime();
      const delta = elapsedTime - lastTimeRef.current;
      lastTimeRef.current = elapsedTime;

      // Twinkle stars (mobile-safe subtlety)
      const twinkle = (layer: any, mul: number, t: number) => {
        if (!layer) return;
        const mat = layer.material;
        const base = (layer === starsNearRef.current) ? 0.012 * SCENE_SCALE : 0.009 * SCENE_SCALE;
        mat.size = base * (1.0 + 0.08 * Math.sin(t * 0.8 * mul));
        layer.rotation.y += 0.00015 * mul;
      };
      const tNow = performance.now() * 0.001;
      twinkle(starsNearRef.current, 1.0, tNow);
      twinkle(starsFarRef.current, 0.6, tNow);

      // Orbits motion
      const ORBIT_SPEED_SCALE = 2000;
      Object.values(celestialBodiesRef.current).forEach(body => {
        const bodyData = body.userData as PlanetData | undefined;
        if (!bodyData || !bodyData.orbitalPeriodDays) return;

        const angularVelocity = (2 * Math.PI) / (bodyData.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE;
        const angle = bodyData.angle + angularVelocity * elapsedTime;

        body.mesh.position.x = bodyData.radius * Math.sin(angle);
        body.mesh.position.z = bodyData.radius * Math.cos(angle);
      });

      // L1 position relative to Earth
      const l1Body = celestialBodiesRef.current['L1'];
      const earthBody = celestialBodiesRef.current['EARTH'];
      if (l1Body && earthBody) {
        const earthPos = new THREE.Vector3();
        earthBody.mesh.getWorldPosition(earthPos);
        const sunToEarthDir = earthPos.clone().normalize();
        const l1Data = l1Body.userData as POIData;
        const l1Pos = earthPos.clone().sub(sunToEarthDir.multiplyScalar(l1Data.distanceFromParent));
        l1Body.mesh.position.copy(l1Pos);
        l1Body.mesh.lookAt(earthPos);
      }

      // Sun shader + Earth rotate + shader uniforms
      if (celestialBodiesRef.current.SUN) {
        (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsedTime;
      }
      if (celestialBodiesRef.current.EARTH) {
        const earthMesh = celestialBodiesRef.current.EARTH.mesh;
        earthMesh.rotation.y += 0.05 * delta; // Earth spin
        // Spin clouds subtly
        const clouds = earthMesh.children.find((c:any)=>c.name==='clouds');
        if (clouds) clouds.rotation.y += 0.01 * delta;

        earthMesh.children.forEach((child: any) => {
          if (child.material?.uniforms?.uTime) {
            child.material.uniforms.uTime.value = elapsedTime;
          }
        });
      }

      // Timeline vs live
      if (timelineActive) {
        if (timelinePlaying) {
          const timeRange = timelineMaxDate - timelineMinDate;
          if (timeRange > 0 && timelineValueRef.current < 1000) {
            const simHoursPerSecond = 3 * timelineSpeed;
            const simMillisPerSecond = simHoursPerSecond * 3600 * 1000;
            const simTimePassedThisFrame = delta * simMillisPerSecond;
            const valueToAdd = (simTimePassedThisFrame / timeRange) * 1000;

            const newValue = timelineValueRef.current + valueToAdd;

            if (newValue >= 1000) {
              timelineValueRef.current = 1000;
              onTimelineEnd();
            } else {
              timelineValueRef.current = newValue;
            }
            onScrubberChangeByAnim(timelineValueRef.current);
          }
        }

        const currentTimelineTime = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        cmeGroupRef.current.children.forEach((cmeObject: any) => {
          const cme: ProcessedCME = cmeObject.userData;
          if (!cme) return;

          const timeSinceEventSeconds = (currentTimelineTime - cme.startTime.getTime()) / 1000;
          if (timeSinceEventSeconds < 0) {
            updateCMEShape(cmeObject, -1);
          } else {
            const distSceneUnits = calculateDistance(cme, timeSinceEventSeconds, false);
            updateCMEShape(cmeObject, distSceneUnits);
          }
        });

      } else {
        cmeGroupRef.current.children.forEach((cmeObject: any) => {
          const cme: ProcessedCME = cmeObject.userData;
          if (!cme) return;

          let currentDistSceneUnits = 0;
          if (currentlyModeledCMEId && cme.id === currentlyModeledCMEId) {
            const simStartTime = cme.simulationStartTime !== undefined ? cme.simulationStartTime : elapsedTime;
            const timeSinceEventVisual = elapsedTime - simStartTime;
            currentDistSceneUnits = calculateDistance(cme, timeSinceEventVisual < 0 ? 0 : timeSinceEventVisual, true);
          }
          else if (!currentlyModeledCMEId) {
            const timeSinceEventAPI = (Date.now() - cme.startTime.getTime()) / 1000;
            currentDistSceneUnits = calculateDistance(cme, timeSinceEventAPI < 0 ? 0 : timeSinceEventAPI, false);
          } else {
            updateCMEShape(cmeObject, -1);
            return;
          }
          updateCMEShape(cmeObject, currentDistSceneUnits);
        });
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsedTime);

      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      if (particleTextureCache) {
        particleTextureCache.dispose?.();
        particleTextureCache = null;
      }
      if (coronaTextureCache) {
        coronaTextureCache.dispose?.();
        coronaTextureCache = null;
      }
      try { rendererRef.current?.dispose(); } catch {}
      cancelAnimationFrame(animationFrameId);
      sceneRef.current?.traverse((object:any) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material:any) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      rendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE, dataVersion]);

  // -------- Build CMEs: KEEP your original particle cones --------
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    // Clear old
    while (cmeGroupRef.current.children.length > 0) {
      const child = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const m = (child as any).material;
        if (Array.isArray(m)) m.forEach((x:any)=>x.dispose()); else m.dispose();
      }
    }

    const particleTexture = createParticleTexture(THREE);

    cmeData.forEach(cme => {
      const particleCount = getCmeParticleCount(cme.speed);
      const positions: number[] = [];
      const colors: number[] = [];

      const coneHalfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
      const coneHeight = 1; // unit height for scaling later
      const coneRadius = coneHeight * Math.tan(coneHalfAngleRad);
      const bulgeFactor = 0.5;

      const shockColor = new THREE.Color(0xffaaaa);
      const wakeColor = new THREE.Color(0x8888ff);
      const coreColor = getCmeCoreColor(cme.speed);

      for (let i = 0; i < particleCount; i++) {
        const y = coneHeight * Math.cbrt(Math.random()); // denser near base
        const radiusAtY = (y / coneHeight) * coneRadius;
        const theta = Math.random() * 2 * Math.PI;
        const r = coneRadius > 0 ? Math.sqrt(Math.random()) * radiusAtY : 0;

        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);

        const normalizedR = r / coneRadius;
        const yOffset = bulgeFactor * (1 - normalizedR * normalizedR);
        const finalY = y * (1 + yOffset);

        positions.push(x, finalY, z);

        // longitudinal gradient color
        const relativePos = y / coneHeight;
        const finalColor = new THREE.Color();
        const wakeEnd = 0.3;
        const coreEnd = 0.9;

        if (relativePos < wakeEnd) {
          const t = relativePos / wakeEnd;
          finalColor.copy(wakeColor).lerp(coreColor, t);
        } else if (relativePos < coreEnd) {
          finalColor.copy(coreColor);
        } else {
          const t = (relativePos - coreEnd) / (1.0 - coreEnd);
          finalColor.copy(coreColor).lerp(shockColor, t);
        }
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }

      const particlesGeometry = new THREE.BufferGeometry();
      particlesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      particlesGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const cmeMaterial = new THREE.PointsMaterial({
        size: getCmeParticleSize(cme.speed, SCENE_SCALE),
        sizeAttenuation: true,
        map: particleTexture,
        transparent: true,
        opacity: getCmeOpacity(cme.speed),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
      });

      const cmeParticleSystem = new THREE.Points(particlesGeometry, cmeMaterial);
      cmeParticleSystem.userData = cme;

      // Orientation from latitude/longitude (local +Y is axis)
      const direction = new THREE.Vector3();
      direction.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      cmeParticleSystem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

      cmeGroupRef.current.add(cmeParticleSystem);
    });

  }, [cmeData, getClockElapsedTime]);

  // Single-CME focus / prediction line
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!cmeGroupRef.current) return;
    cmeGroupRef.current.children.forEach((cmeMesh: any) => {
      const cme: ProcessedCME = cmeMesh.userData;
      if (currentlyModeledCMEId) {
        cmeMesh.visible = cme.id === currentlyModeledCMEId;
        if (cme.id === currentlyModeledCMEId && cmeMesh.userData) {
          cmeMesh.userData.simulationStartTime = getClockElapsedTime();
        }
      } else {
        cmeMesh.visible = true;
      }
    });

    if (!THREE || !sceneRef.current) return;
    if (predictionLineRef.current) {
      sceneRef.current.remove(predictionLineRef.current);
      predictionLineRef.current.geometry.dispose();
      predictionLineRef.current.material.dispose();
      predictionLineRef.current = null;
    }

    const cme = cmeData.find(c => c.id === currentlyModeledCMEId);
    if (cme && cme.isEarthDirected && celestialBodiesRef.current.EARTH) {
      const earthPos = new THREE.Vector3();
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);
      const points = [new THREE.Vector3(0, 0, 0), earthPos];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({
        color: 0xffff66,
        transparent: true,
        opacity: 0.85,
        dashSize: 0.05 * SCENE_SCALE,
        gapSize: 0.02 * SCENE_SCALE
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.visible = !!currentlyModeledCMEId;
      sceneRef.current.add(line);
      predictionLineRef.current = line;
    }
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime]);

  // Camera moves
  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    const THREE = (window as any).THREE;
    const gsap = (window as any).gsap;
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;

    const targetPosition = new THREE.Vector3(0, 0, 0);
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) {
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(targetPosition);
    }

    let camPos = new THREE.Vector3();
    if (view === ViewMode.TOP) {
      camPos.set(targetPosition.x, targetPosition.y + SCENE_SCALE * 4.2, targetPosition.z + 0.01);
    } else {
      camPos.set(targetPosition.x + SCENE_SCALE * 1.9, targetPosition.y + SCENE_SCALE * 0.35 , targetPosition.z);
    }

    gsap.to(cameraRef.current.position, {
      duration: 1.2,
      x: camPos.x, y: camPos.y, z: camPos.z,
      ease: "power2.inOut"
    });
    gsap.to(controlsRef.current.target, {
      duration: 1.2,
      x: targetPosition.x, y: targetPosition.y, z: targetPosition.z,
      ease: "power2.inOut",
      onUpdate: () => controlsRef.current.update()
    });
  }, []);

  useEffect(() => {
    moveCamera(activeView, focusTarget);
  }, [activeView, focusTarget, dataVersion, moveCamera]);

  React.useImperativeHandle(ref, () => ({
    resetView: () => {
      moveCamera(ViewMode.TOP, FocusTarget.EARTH);
    }
  }), [moveCamera]);

  // Always MOVE interaction mode (mobile-friendly)
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'move';
    }
  }, [interactionMode]);

  // Extra planets toggle
  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    ['MERCURY', 'VENUS', 'MARS'].forEach(name => {
      const body = celestialBodiesRef.current[name];
      const orbit = orbitsRef.current[name];
      if (body) body.mesh.visible = showExtraPlanets;
      if (orbit) orbit.visible = showExtraPlanets;
    });
  }, [showExtraPlanets]);

  // Moon & L1 toggle
  useEffect(() => {
    if (!celestialBodiesRef.current) return;
    const moon = celestialBodiesRef.current['MOON'];
    const l1 = celestialBodiesRef.current['L1'];

    if (moon) moon.mesh.visible = showMoonL1;
    if (l1) l1.mesh.visible = showMoonL1;

    const earthMesh = celestialBodiesRef.current['EARTH']?.mesh;
    if (earthMesh) {
      const moonOrbit = earthMesh.children.find((c:any) => c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);

  // Impact detection (proxy) — keep your approach, just read tip vs Earth vicinity
  const checkImpacts = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;

    let maxImpactSpeed = 0;
    const earthPos = new THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);

    cmeGroupRef.current.children.forEach((cmeObject: any) => {
      const cme: ProcessedCME = cmeObject.userData;
      if (!cme || !cmeObject.visible) return;

      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
      const tipWorld = cmeObject.position.clone().add(dir.clone().multiplyScalar(cmeObject.scale.y));
      const d = tipWorld.distanceTo(earthPos);

      const impactRadius = PLANET_DATA_MAP.EARTH.size * 2.2; // vicinity threshold
      if (d < impactRadius) {
        if (cme.speed > maxImpactSpeed) maxImpactSpeed = cme.speed;
      }
    });

    return maxImpactSpeed;
  }, []);

  // Stronger aurora/atmosphere response on impact
  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsed: number) => {
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    if (!earth) return;

    const aurora = earth.children.find((c: any) => c.name === 'aurora');
    const atmosphere = earth.children.find((c: any) => c.name === 'atmosphere');

    // Slightly more sensitive than before: /1500 instead of /2000
    const hit = clamp(maxImpactSpeed / 1500, 0, 1);

    if (aurora?.material?.uniforms) {
      aurora.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
      (aurora.material as any).opacity = 0.20 + hit * (0.30 + 0.12 * Math.sin(elapsed * 2.2));
    }

    if (atmosphere?.material?.uniforms) {
      (atmosphere.material as any).opacity = 0.12 + hit * 0.22;
      atmosphere.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0.0;
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
