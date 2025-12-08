// --- START OF FILE SimulationCanvas.tsx ---

import React, { useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import {
  ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle
} from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER,
} from '../constants';

/** =========================================================
 *  STABLE, HOTLINK-SAFE TEXTURE URLS (Wikimedia + Wellesley)
 *  ========================================================= */
const TEX = {
  EARTH_DAY:
    "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg",
  EARTH_NORMAL:
    "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_normal_2048.jpg",
  EARTH_SPEC:
    "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_specular_2048.jpg",
  EARTH_CLOUDS:
    "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png",
  MOON:
    "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/moon_1024.jpg",
  SUN_PHOTOSPHERE:
    "https://upload.wikimedia.org/wikipedia/commons/c/cb/Solarsystemscope_texture_2k_sun.jpg",
  MILKY_WAY:
    "https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg",
};

/** =========================================================
 *  HELPERS
 *  ========================================================= */

let particleTextureCache: any = null;
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
  particleTextureCache = new THREE.CanvasTexture(canvas);
  return particleTextureCache;
};

const getCmeOpacity = (speed: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 0.22;
  return THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.06, 0.65);
};

const getCmeParticleCount = (speed: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 4000;
  return Math.floor(THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(speed, 300, 3000), 300, 3000, 1500, 7000));
};

const getCmeParticleSize = (speed: number, scale: number): number => {
  const THREE = (window as any).THREE;
  if (!THREE) return 0.05 * scale;
  return THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(speed, 300, 3000), 300, 3000, 0.04 * scale, 0.08 * scale);
};

const getCmeCoreColor = (speed: number): any => {
  const THREE = (window as any).THREE;
  if (!THREE) return { setHex: () => {} };
  if (speed >= 2500) return new THREE.Color(0xff69b4);
  if (speed >= 1800) return new THREE.Color(0x9370db);
  if (speed >= 1000) return new THREE.Color(0xff4500);
  if (speed >= 800)  return new THREE.Color(0xffa500);
  if (speed >= 500)  return new THREE.Color(0xffff00);
  if (speed < 350)   return new THREE.Color(0x808080);
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  return grey.lerp(yellow, THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1));
};

const createSolarOutburstGeometry = (THREE: any, count: number, halfAngleDeg: number) => {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const progress = new Float32Array(count);

  const spread = THREE.MathUtils.degToRad(Math.max(30, halfAngleDeg * 0.9));

  for (let i = 0; i < count; i++) {
    // sample along an expanding magnetic shell: compact, filament-like tail near the sun and a bulbous nose
    // that is slightly flattened like a forward shock front
    const spineT = Math.pow(Math.random(), 0.62);
    const noseBias = THREE.MathUtils.smoothstep(spineT, 0.1, 1.0);

    // latitudinal spread widens toward the front, giving the shock a halo while keeping the tail narrow
    const lat = (Math.random() - 0.5) * spread * THREE.MathUtils.lerp(0.35, 1.25, noseBias);
    const roll = (Math.random() - 0.5) * Math.PI * 2;

    // axial radius fattens toward the head but stays filamentary near the tail
    const coreRadius = THREE.MathUtils.lerp(0.12, 1.4, noseBias * noseBias);
    const tubeRadius = THREE.MathUtils.lerp(0.03, 0.28, THREE.MathUtils.smoothstep(spineT, 0.05, 0.95))
      * (0.55 + 0.5 * Math.random());

    // subtle forward flattening to hint at the bow-shock and sheath
    const flatten = THREE.MathUtils.lerp(0.1, 0.55, noseBias);
    const radial = coreRadius + Math.cos(roll) * tubeRadius * (0.6 + 0.4 * flatten);
    const y = spineT * 1.32 + Math.sin(roll) * tubeRadius * 0.55;
    const x = radial * Math.sin(lat);
    const z = radial * Math.cos(lat);

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;

    progress[i] = THREE.MathUtils.clamp(spineT, 0, 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('progress', new THREE.Float32BufferAttribute(progress, 1));
  return geometry;
};

const tintGeometryByStops = (
  geometry: any,
  progressKey: string,
  stops: { stop: number; color: any }[],
  THREE: any
) => {
  const progressAttr = geometry.getAttribute(progressKey);
  const colorAttr = geometry.getAttribute('color');

  if (!progressAttr || !colorAttr) return;

  const temp = new THREE.Color();
  for (let i = 0; i < progressAttr.count; i++) {
    const rel = progressAttr.getX(i);
    let lower = stops[0];
    let upper = stops[stops.length - 1];

    for (let s = 0; s < stops.length - 1; s++) {
      if (rel >= stops[s].stop && rel <= stops[s + 1].stop) {
        lower = stops[s];
        upper = stops[s + 1];
        break;
      }
    }

    const span = Math.max(1e-5, upper.stop - lower.stop);
    const t = Math.max(0, Math.min(1, (rel - lower.stop) / span));
    temp.copy(lower.color).lerp(upper.color, t);
    colorAttr.setXYZ(i, temp.r, temp.g, temp.b);
  }
  colorAttr.needsUpdate = true;
};

const createCroissantFluxRope = (THREE: any, particleTexture: any, count: number) => {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const progress = new Float32Array(count);

  const majorRadius = 1.0;
  const minorRadius = 0.35;
  const arcSpan = Math.PI * 0.7;

  for (let i = 0; i < count; i++) {
    const u = THREE.MathUtils.lerp(-arcSpan, arcSpan, Math.random());
    const v = Math.random() * Math.PI * 2;

    const localMinor = minorRadius + Math.random() * 0.15;
    const x = (majorRadius + localMinor * Math.cos(v)) * Math.cos(u);
    const y = localMinor * Math.sin(v);
    const z = (majorRadius + localMinor * Math.cos(v)) * Math.sin(u);

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;

    colors[idx] = 1;
    colors[idx + 1] = 1;
    colors[idx + 2] = 1;

    const arcProgress = (u + arcSpan) / (arcSpan * 2);
    progress[i] = Math.min(1, Math.max(0, arcProgress));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('progress', new THREE.Float32BufferAttribute(progress, 1));

  const material = new THREE.PointsMaterial({
    size: 0.05 * SCENE_SCALE,
    sizeAttenuation: true,
    map: particleTexture,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
  });

  const points = new THREE.Points(geometry, material);
  points.userData.particleCount = count;
  return points;
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
  timelineValue: number;
  timelineMinDate: number;
  timelineMaxDate: number;
  setPlanetMeshesForLabels: (labels: PlanetLabelInfo[]) => void;
  setRendererDomElement: (element: HTMLCanvasElement) => void;
  onCameraReady: (camera: any) => void;
  getClockElapsedTime: () => number;
  resetClock: () => void;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showExtraPlanets: boolean;
  showMoonL1: boolean;
  showFluxRope: boolean;
  dataVersion: number;
  interactionMode: InteractionMode;
  onSunClick?: () => void;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData,
    activeView,
    focusTarget,
    currentlyModeledCMEId,
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
    showFluxRope,
    dataVersion,
    interactionMode,
    onSunClick,
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
  const fluxRopeRef = useRef<any>(null);
  const fluxRopeStateRef = useRef<{ lastCmeId: string | null; lastSpeed: number }>({ lastCmeId: null, lastSpeed: 0 });

  const starsNearRef = useRef<any>(null);
  const starsFarRef = useRef<any>(null);

  const timelineValueRef = useRef(timelineValue);
  const lastTimeRef = useRef(0);

  const raycasterRef = useRef<any>(null);
  const mouseRef = useRef<any>(null);
  
  const pointerDownTime = useRef(0);
  const pointerDownPosition = useRef({ x: 0, y: 0 });

  const animPropsRef = useRef({
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope,
  });

  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope,
    };
  }, [
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope,
  ]);

  const THREE = (window as any).THREE;
  const gsap = (window as any).gsap;

  useEffect(() => {
    timelineValueRef.current = timelineValue;
  }, [timelineValue]);

  const MIN_CME_SPEED_KMS = 300;

  const syncFluxRopeWithCME = (cmeObject: any) => {
    const THREE = (window as any).THREE;
    if (!THREE || !fluxRopeRef.current) return;

    const particleTexture = createParticleTexture(THREE);
    const cme: ProcessedCME = cmeObject.userData;
    const targetCount = getCmeParticleCount(cme.speed);

    if (fluxRopeRef.current.userData.particleCount !== targetCount) {
      const refreshedFluxRope = createCroissantFluxRope(THREE, particleTexture, targetCount);
      fluxRopeRef.current.geometry.dispose();
      (fluxRopeRef.current.material as any).dispose?.();
      fluxRopeRef.current.geometry = refreshedFluxRope.geometry;
      fluxRopeRef.current.material = refreshedFluxRope.material;
      fluxRopeRef.current.userData.particleCount = targetCount;
    }

    const shouldRefreshColors =
      fluxRopeStateRef.current.lastCmeId !== cme.id ||
      fluxRopeStateRef.current.lastSpeed !== cme.speed;

    if (shouldRefreshColors) {
      const progressAttr = fluxRopeRef.current.geometry.getAttribute('progress');
      const colorsAttr = fluxRopeRef.current.geometry.getAttribute('color');

      if (progressAttr && colorsAttr) {
        const shockColor = new THREE.Color(0xffaaaa);
        const wakeColor = new THREE.Color(0x8888ff);
        const coreColor = getCmeCoreColor(cme.speed);
        const tempColor = new THREE.Color();

        for (let i = 0; i < progressAttr.count; i++) {
          const rel = progressAttr.getX(i);
          if (rel < 0.15) tempColor.copy(wakeColor).lerp(coreColor, rel / 0.15);
          else if (rel < 0.55) tempColor.copy(coreColor);
          else tempColor.copy(coreColor).lerp(shockColor, (rel - 0.55) / 0.45);

          colorsAttr.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
        }
        colorsAttr.needsUpdate = true;
      }

      fluxRopeStateRef.current.lastCmeId = cme.id;
      fluxRopeStateRef.current.lastSpeed = cme.speed;
    }

    const material = fluxRopeRef.current.material as any;
    material.size = getCmeParticleSize(cme.speed, SCENE_SCALE);
    material.opacity = getCmeOpacity(cme.speed);
    material.map = particleTexture;
    material.needsUpdate = true;

    const coneRadius = cmeObject.scale.y * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle));
    fluxRopeRef.current.scale.set(coneRadius, coneRadius, coneRadius);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    fluxRopeRef.current.position.copy(cmeObject.position).add(dir.clone().multiplyScalar(cmeObject.scale.y));
    fluxRopeRef.current.quaternion.copy(cmeObject.quaternion);
  };

  const calculateDistanceWithDeceleration = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    const u_kms = cme.speed;
    const t_s = Math.max(0, timeSinceEventSeconds);

    if (u_kms <= MIN_CME_SPEED_KMS) {
        const distance_km = u_kms * t_s;
        return (distance_km / AU_IN_KM) * SCENE_SCALE;
    }

    const a_ms2 = 1.41 - 0.0035 * u_kms;
    const a_kms2 = a_ms2 / 1000.0;

    if (a_kms2 >= 0) {
        const distance_km = (u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s);
        return (distance_km / AU_IN_KM) * SCENE_SCALE;
    }
    
    const time_to_floor_s = (MIN_CME_SPEED_KMS - u_kms) / a_kms2;

    let distance_km;
    if (t_s < time_to_floor_s) {
        distance_km = (u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s);
    } else {
        const distance_during_decel = (u_kms * time_to_floor_s) + (0.5 * a_kms2 * time_to_floor_s * time_to_floor_s);
        const time_coasting = t_s - time_to_floor_s;
        const distance_during_coast = MIN_CME_SPEED_KMS * time_coasting;
        distance_km = distance_during_decel + distance_during_coast;
    }

    return (distance_km / AU_IN_KM) * SCENE_SCALE;
  }, []);

  const calculateDistanceByInterpolation = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    if (!cme.predictedArrivalTime) return 0;
    const earthOrbitRadiusActualAU = PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE;
    const totalTravelTimeSeconds = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
    if (totalTravelTimeSeconds <= 0) return 0;
    const proportionOfTravel = Math.min(1.0, timeSinceEventSeconds / totalTravelTimeSeconds);
    const distanceActualAU = proportionOfTravel * earthOrbitRadiusActualAU;
    return distanceActualAU * SCENE_SCALE;
  }, []);

  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number) => {
    if (!THREE) return;
    const sunRadius = PLANET_DATA_MAP.SUN.size;
    if (distTraveledInSceneUnits < 0) {
      cmeObject.visible = false;
      return;
    }

    cmeObject.visible = true;
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);

    // keep the root tethered to the solar surface while letting the shock nose race outward
    const availableLength = Math.max(0, distTraveledInSceneUnits - sunRadius * 0.65);
    const shockNose = sunRadius + availableLength;
    const anchoredRoot = sunRadius * 0.55 + availableLength * 0.22;
    const sheathDepth = Math.max(0.001, shockNose - anchoredRoot);

    // radial expansion grows with distance and the reported half-angle, flaring slightly more than a cone
    const baseCone = Math.tan(THREE.MathUtils.degToRad(Math.max(8, cmeObject.userData.halfAngle * 0.85)));
    const expansion = (sunRadius * 0.35 + sheathDepth * baseCone * 1.35) * THREE.MathUtils.clamp(1 + availableLength / (SCENE_SCALE * 4), 1, 1.75);

    const midpoint = anchoredRoot + sheathDepth * 0.52;
    cmeObject.position.copy(direction.clone().multiplyScalar(midpoint));
    cmeObject.scale.set(expansion, sheathDepth, expansion * 0.78);
  }, [THREE]);

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    raycasterRef.current = new THREE.Raycaster();
    mouseRef.current = new THREE.Vector2();

    const loader = new THREE.TextureLoader();
    (loader as any).crossOrigin = "anonymous";
    const withAniso = (t: any) => { if (renderer.capabilities?.getMaxAnisotropy) t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    const tex = {
      earthDay: withAniso(loader.load(TEX.EARTH_DAY)), earthNormal: withAniso(loader.load(TEX.EARTH_NORMAL)),
      earthSpec: withAniso(loader.load(TEX.EARTH_SPEC)), earthClouds: withAniso(loader.load(TEX.EARTH_CLOUDS)),
      moon: withAniso(loader.load(TEX.MOON)), sunPhoto: withAniso(loader.load(TEX.SUN_PHOTOSPHERE)),
      milkyWay: withAniso(loader.load(TEX.MILKY_WAY)),
    };
    tex.milkyWay.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex.milkyWay;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.PointLight(0xffffff, 2.4, 300 * SCENE_SCALE));

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false; controls.minDistance = 0.12 * SCENE_SCALE;
    controls.maxDistance = 55 * SCENE_SCALE;
    controlsRef.current = controls;

    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    const fluxRopeParticleTexture = createParticleTexture(THREE);
    fluxRopeRef.current = createCroissantFluxRope(THREE, fluxRopeParticleTexture, 4000);
    fluxRopeRef.current.visible = false;
    scene.add(fluxRopeRef.current);

    const makeStars = (count: number, spread: number, size: number) => {
      const verts: number[] = [];
      for (let i = 0; i < count; i++) verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const m = new THREE.PointsMaterial({ color: 0xffffff, size: size * SCENE_SCALE, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false });
      return new THREE.Points(g, m);
    };
    const starsNear = makeStars(30000, 250, 0.012);
    const starsFar  = makeStars(20000, 300, 0.006);
    starsFar.rotation.y = Math.PI / 7;
    scene.add(starsNear);
    scene.add(starsFar);
    starsNearRef.current = starsNear;
    starsFarRef.current = starsFar;

    const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER, transparent: true });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    sunMesh.name = 'sun-shader';
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const sunOverlayGeo = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size * 1.001, 64, 64);
    const sunOverlayMat = new THREE.MeshBasicMaterial({ map: tex.sunPhoto, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sunOverlay = new THREE.Mesh(sunOverlayGeo, sunOverlayMat);
    sunOverlay.name = "sun-photosphere";
    scene.add(sunOverlay);

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;
      const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), new THREE.MeshPhongMaterial({ color: data.color, shininess: 30 }));
      planetMesh.position.x = data.radius * Math.sin(data.angle);
      planetMesh.position.z = data.radius * Math.cos(data.angle);
      planetMesh.userData = data;
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = { mesh: planetMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: planetMesh });

      if (name === 'EARTH') {
        planetMesh.material = new THREE.MeshPhongMaterial({ map: tex.earthDay, normalMap: tex.earthNormal, specularMap: tex.earthSpec, specular: new THREE.Color(0x111111), shininess: 6 });
        const clouds = new THREE.Mesh( new THREE.SphereGeometry((data as PlanetData).size * 1.01, 48, 48), new THREE.MeshLambertMaterial({ map: tex.earthClouds, transparent: true, opacity: 0.7, depthWrite: false }) );
        clouds.name = 'clouds';
        planetMesh.add(clouds);

        const atmosphere = new THREE.Mesh( new THREE.SphereGeometry((data as PlanetData).size * 1.2, 32, 32), new THREE.ShaderMaterial({ vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER, fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER, blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } } }) );
        atmosphere.name = 'atmosphere';
        planetMesh.add(atmosphere);

        const aurora = new THREE.Mesh( new THREE.SphereGeometry((data as PlanetData).size * 1.25, 64, 64), new THREE.ShaderMaterial({ vertexShader: AURORA_VERTEX_SHADER, fragmentShader: AURORA_FRAGMENT_SHADER, blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0.0 }, uCmeSpeed: { value: 0.0 }, uImpactTime: { value: 0.0 }, uAuroraMinY: { value: Math.sin(70 * Math.PI / 180) }, uAuroraIntensity: { value: 0.0 } } }) );
        aurora.name = 'aurora';
        planetMesh.add(aurora);
      }

      const orbitPoints = [];
      for (let i = 0; i <= 128; i++) orbitPoints.push( new THREE.Vector3( Math.sin((i / 128) * Math.PI * 2) * data.radius, 0, Math.cos((i / 128) * Math.PI * 2) * data.radius ) );
      const orbitTube = new THREE.Mesh( new THREE.TubeGeometry(new THREE.CatmullRomCurve3(orbitPoints), 128, 0.005 * SCENE_SCALE, 8, true), new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 }) );
      scene.add(orbitTube);
      orbitsRef.current[name] = orbitTube;
    });

    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (!data.orbits) return;
      const parentBody = celestialBodiesRef.current[data.orbits];
      if (!parentBody) return;

      const moonMesh = new THREE.Mesh( new THREE.SphereGeometry(data.size, 16, 16), new THREE.MeshPhongMaterial({ color: data.color, shininess: 6, map: name === 'MOON' ? tex.moon : null }) );
      moonMesh.position.x = data.radius * Math.sin(data.angle);
      moonMesh.position.z = data.radius * Math.cos(data.angle);
      moonMesh.userData = data;
      parentBody.mesh.add(moonMesh);
      celestialBodiesRef.current[name] = { mesh: moonMesh, name: data.name, labelId: data.labelElementId, userData: data };

      if (name === 'MOON') {
        const already = planetLabelInfos.find(p => p.name === 'Moon');
        if (!already) planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: moonMesh });
      }

      const orbitPoints = [];
      for (let i = 0; i <= 64; i++) orbitPoints.push( new THREE.Vector3( Math.sin((i / 64) * Math.PI * 2) * data.radius, 0, Math.cos((i / 64) * Math.PI * 2) * data.radius ) );
      const orbitTube = new THREE.Mesh( new THREE.TubeGeometry(new THREE.CatmullRomCurve3(orbitPoints), 64, 0.003 * SCENE_SCALE, 8, true), new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 }) );
      orbitTube.name = 'moon-orbit';
      parentBody.mesh.add(orbitTube);
    });

    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const poiMesh = new THREE.Mesh(new THREE.TetrahedronGeometry(data.size, 0), new THREE.MeshBasicMaterial({ color: data.color }));
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

    const handlePointerDown = (event: PointerEvent) => {
        pointerDownTime.current = Date.now();
        pointerDownPosition.current.x = event.clientX;
        pointerDownPosition.current.y = event.clientY;
    };

    const handlePointerUp = (event: PointerEvent) => {
        const upTime = Date.now();
        const deltaTime = upTime - pointerDownTime.current;
        const deltaX = Math.abs(event.clientX - pointerDownPosition.current.x);
        const deltaY = Math.abs(event.clientY - pointerDownPosition.current.y);
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (deltaTime < 200 && distance < 10) {
            if (!mountRef.current || !cameraRef.current || !raycasterRef.current || !mouseRef.current || !sceneRef.current) return;
            
            const rect = mountRef.current.getBoundingClientRect();
            mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
            
            const sunObject = celestialBodiesRef.current['SUN']?.mesh;
            if (sunObject) {
                const intersects = raycasterRef.current.intersectObject(sunObject);
                if (intersects.length > 0) {
                    if (onSunClick) {
                        onSunClick();
                    }
                }
            }
        }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const {
        currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed,
        timelineMinDate, timelineMaxDate, onScrubberChangeByAnim, onTimelineEnd,
        showFluxRope
      } = animPropsRef.current;

      const elapsedTime = getClockElapsedTime();
      const delta = elapsedTime - lastTimeRef.current;
      lastTimeRef.current = elapsedTime;

      if (starsNearRef.current) starsNearRef.current.rotation.y += 0.00015;
      if (starsFarRef.current)  starsFarRef.current.rotation.y  += 0.00009;

      const ORBIT_SPEED_SCALE = 2000;
      Object.values(celestialBodiesRef.current).forEach(body => {
        const d = body.userData as PlanetData | undefined;
        if (d?.orbitalPeriodDays) {
          const a = d.angle + ((2 * Math.PI) / (d.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE) * elapsedTime;
          body.mesh.position.x = d.radius * Math.sin(a);
          body.mesh.position.z = d.radius * Math.cos(a);
        }
      });

      const l1Body = celestialBodiesRef.current['L1'];
      const earthBody = celestialBodiesRef.current['EARTH'];
      if (l1Body && earthBody) {
        const p = new THREE.Vector3(); earthBody.mesh.getWorldPosition(p);
        const d = p.clone().normalize();
        const l1Pos = p.clone().sub(d.multiplyScalar((l1Body.userData as POIData).distanceFromParent));
        l1Body.mesh.position.copy(l1Pos);
        l1Body.mesh.lookAt(p);
      }

      if (celestialBodiesRef.current.SUN) (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsedTime;

      if (celestialBodiesRef.current.EARTH) {
        const e = celestialBodiesRef.current.EARTH.mesh;
        e.rotation.y += 0.05 * delta;
        const c = e.children.find((c:any)=>c.name==='clouds');
        if(c) c.rotation.y += 0.01 * delta;
        e.children.forEach((ch: any) => {
          if (ch.material?.uniforms?.uTime) ch.material.uniforms.uTime.value = elapsedTime;
        });
      }

      cmeGroupRef.current.children.forEach((system: any) => {
        const baseOpacity = getCmeOpacity(system.userData.speed);
        system.traverse((child: any) => {
          if (child.material && typeof child.material.opacity === 'number') {
            const scale = child.userData?.opacityScale ?? 1;
            child.material.opacity = baseOpacity * scale;
          }
        });
      });

      if (timelineActive) {
        if (timelinePlaying) {
          const r = timelineMaxDate - timelineMinDate;
          if (r > 0 && timelineValueRef.current < 1000) {
            const v = timelineValueRef.current + (delta * (3 * timelineSpeed * 3600 * 1000) / r) * 1000;
            if (v >= 1000) { timelineValueRef.current = 1000; onTimelineEnd(); }
            else { timelineValueRef.current = v; }
            onScrubberChangeByAnim(timelineValueRef.current);
          }
        }
        const t = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        cmeGroupRef.current.children.forEach((c: any) => {
          const s = (t - c.userData.startTime.getTime()) / 1000;
          updateCMEShape(c, s < 0 ? -1 : calculateDistanceWithDeceleration(c.userData, s));
        });
      } else {
        cmeGroupRef.current.children.forEach((c: any) => {
          let d = 0;
          if (currentlyModeledCMEId && c.userData.id === currentlyModeledCMEId) {
            const cme = c.userData;
            const t = elapsedTime - (cme.simulationStartTime ?? elapsedTime);
            if (cme.isEarthDirected && cme.predictedArrivalTime) {
                d = calculateDistanceByInterpolation(cme, t < 0 ? 0 : t); 
            } else {
                d = calculateDistanceWithDeceleration(cme, t < 0 ? 0 : t);
            }
          } else if (!currentlyModeledCMEId) {
            const t = (Date.now() - c.userData.startTime.getTime()) / 1000;
            d = calculateDistanceWithDeceleration(c.userData, t < 0 ? 0 : t);
          } else {
            updateCMEShape(c, -1);
            return;
          }
          updateCMEShape(c, d);
        });
      }

      const shouldShowFluxRope = showFluxRope && currentlyModeledCMEId;
      if (fluxRopeRef.current) {
        fluxRopeRef.current.visible = !!shouldShowFluxRope;
        if (shouldShowFluxRope) {
          const cmeObject = cmeGroupRef.current.children.find((c: any) => c.userData.id === currentlyModeledCMEId);
          if (cmeObject) syncFluxRopeWithCME(cmeObject);
        } else {
          fluxRopeStateRef.current.lastCmeId = null;
          fluxRopeStateRef.current.lastSpeed = 0;
        }
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsedTime);

      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current?.domElement) {
          rendererRef.current.domElement.removeEventListener('pointerdown', handlePointerDown);
          rendererRef.current.domElement.removeEventListener('pointerup', handlePointerUp);
      }
      if (mountRef.current && rendererRef.current) mountRef.current.removeChild(rendererRef.current.domElement);
      if (particleTextureCache) { particleTextureCache.dispose?.(); particleTextureCache = null; }
      try { rendererRef.current?.dispose(); } catch {}
      cancelAnimationFrame(animationFrameId);
      sceneRef.current?.traverse((o:any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m:any) => m.dispose());
          else o.material.dispose();
        }
      });
      rendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE, dataVersion]);

  // Build CME particle systems
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    while (cmeGroupRef.current.children.length > 0) {
      const c = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(c);
      c.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const m = child.material;
          if (Array.isArray(m)) m.forEach((x: any) => x.dispose());
          else m.dispose();
        }
      });
    }

    const particleTexture = createParticleTexture(THREE);

    cmeData.forEach(cme => {
      const pCount = getCmeParticleCount(cme.speed);
      const baseGeom = createSolarOutburstGeometry(THREE, pCount, cme.halfAngle);

      const shockColor = new THREE.Color(0xfff4d1);
      const coreColor = getCmeCoreColor(cme.speed);
      const wakeColor = new THREE.Color(0x3c9bff);
      const sheathColor = new THREE.Color(0xffb347);

      const makeLayer = (
        colorStops: { stop: number; color: any }[],
        opacity: number,
        sizeMultiplier: number,
        scale: { x: number; y: number; z: number }
      ) => {
        const geom = baseGeom.clone();
        tintGeometryByStops(geom, 'progress', colorStops, THREE);

        const mat = new THREE.PointsMaterial({
          size: getCmeParticleSize(cme.speed, SCENE_SCALE) * sizeMultiplier,
          sizeAttenuation: true,
          map: particleTexture,
          transparent: true,
          opacity: getCmeOpacity(cme.speed) * opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          vertexColors: true,
        });

        const pts = new THREE.Points(geom, mat);
        pts.userData.opacityScale = opacity;
        pts.scale.set(scale.x, scale.y, scale.z);
        return pts;
      };

      const shock = makeLayer(
        [
          { stop: 0, color: wakeColor.clone().multiplyScalar(0.25) },
          { stop: 0.2, color: wakeColor.clone().lerp(sheathColor, 0.55) },
          { stop: 0.55, color: sheathColor.clone().lerp(shockColor, 0.5) },
          { stop: 0.85, color: shockColor },
          { stop: 1, color: shockColor.clone().lerp(coreColor, 0.18) },
        ],
        1.05,
        1.1,
        { x: 1.42, y: 1.08, z: 1.38 }
      );

      const core = makeLayer(
        [
          { stop: 0, color: wakeColor.clone().multiplyScalar(0.25) },
          { stop: 0.18, color: wakeColor.clone().lerp(coreColor, 0.55) },
          { stop: 0.52, color: coreColor },
          { stop: 0.78, color: coreColor.clone().lerp(sheathColor, 0.35) },
          { stop: 1, color: coreColor.clone().lerp(shockColor, 0.35) },
        ],
        0.92,
        0.92,
        { x: 0.8, y: 0.92, z: 0.8 }
      );

      const wake = makeLayer(
        [
          { stop: 0, color: wakeColor.clone().multiplyScalar(0.65) },
          { stop: 0.3, color: wakeColor },
          { stop: 0.65, color: wakeColor.clone().lerp(coreColor, 0.28) },
          { stop: 1, color: coreColor.clone().multiplyScalar(0.6) }
        ],
        0.8,
        0.98,
        { x: 0.98, y: 1.1, z: 0.98 }
      );

      const system = new THREE.Group();
      system.userData = cme;
      system.add(shock);
      system.add(wake);
      system.add(core);

      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      system.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cmeGroupRef.current.add(system);
    });
  }, [cmeData, getClockElapsedTime]);

  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!cmeGroupRef.current) return;

    cmeGroupRef.current.children.forEach((cmeMesh: any) => {
      cmeMesh.visible = !currentlyModeledCMEId || cmeMesh.userData.id === currentlyModeledCMEId;
      if (cmeMesh.userData.id === currentlyModeledCMEId) cmeMesh.userData.simulationStartTime = getClockElapsedTime();
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
      const p = new THREE.Vector3();
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(p);
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), p]);
      const m = new THREE.LineDashedMaterial({ color: 0xffff66, transparent: true, opacity: 0.85, dashSize: 0.05 * SCENE_SCALE, gapSize: 0.02 * SCENE_SCALE });
      const l = new THREE.Line(g, m);
      l.computeLineDistances();
      l.visible = !!currentlyModeledCMEId;
      sceneRef.current.add(l);
      predictionLineRef.current = l;
    }
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime]);

  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    const THREE = (window as any).THREE; const gsap = (window as any).gsap;
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;
    const target = new THREE.Vector3(0, 0, 0);
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) celestialBodiesRef.current.EARTH.mesh.getWorldPosition(target);
    const pos = new THREE.Vector3();
    if (view === ViewMode.TOP) pos.set(target.x, target.y + SCENE_SCALE * 4.2, target.z + 0.01);
    else pos.set(target.x + SCENE_SCALE * 1.9, target.y + SCENE_SCALE * 0.35, target.z);
    gsap.to(cameraRef.current.position, { duration: 1.2, x: pos.x, y: pos.y, z: pos.z, ease: "power2.inOut" });
    gsap.to(controlsRef.current.target, { duration: 1.2, x: target.x, y: target.y, z: target.z, ease: "power2.inOut", onUpdate: () => controlsRef.current.update() });
  }, []);

  useEffect(() => { moveCamera(activeView, focusTarget); }, [activeView, focusTarget, dataVersion, moveCamera]);

  useImperativeHandle(ref, () => ({
    resetView: () => { moveCamera(ViewMode.TOP, FocusTarget.EARTH); },
    resetAnimationTimer: () => { lastTimeRef.current = getClockElapsedTime(); },
    captureCanvasAsDataURL: () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        return rendererRef.current.domElement.toDataURL('image/png');
      }
      return null;
    },
    calculateImpactProfile: () => {
        if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return [];
        
        const earthData = PLANET_DATA_MAP.EARTH;
        const simStartTime = timelineMinDate;
        if (simStartTime <= 0) return [];

        const graphStartTime = Date.now();
        const graphEndTime = graphStartTime + 7 * 24 * 3600 * 1000; // 7 days ahead
        const graphDuration = graphEndTime - graphStartTime;

        const graphData = [];
        const numSteps = 200; 
        const ambientSpeed = 350;
        const ambientDensity = 5;

        for (let i = 0; i <= numSteps; i++) {
            const stepRatio = i / numSteps;
            const currentTime = graphStartTime + graphDuration * stepRatio;

            const totalSecondsSinceSimEpoch = (currentTime - simStartTime) / 1000;
            const orbitalPeriodSeconds = earthData.orbitalPeriodDays! * 24 * 3600;
            const startingAngle = earthData.angle;
            const angularVelocity = (2 * Math.PI) / orbitalPeriodSeconds; 
            const earthAngle = startingAngle + angularVelocity * totalSecondsSinceSimEpoch;
            
            const earthX = earthData.radius * Math.sin(earthAngle);
            const earthZ = earthData.radius * Math.cos(earthAngle);
            const earthPos = new THREE.Vector3(earthX, 0, earthZ);
            
            let totalSpeed = ambientSpeed;
            let totalDensity = ambientDensity;

            cmeGroupRef.current.children.forEach((cmeObject: any) => {
                const cme = cmeObject.userData as ProcessedCME;
                const timeSinceCmeStart = (currentTime - cme.startTime.getTime()) / 1000;
                
                if (timeSinceCmeStart > 0) {
                    const cmeDist = calculateDistanceWithDeceleration(cme, timeSinceCmeStart);
                    
                    const cmeDir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
                    const angleToEarth = cmeDir.angleTo(earthPos.clone().normalize());

                    if (angleToEarth < THREE.MathUtils.degToRad(cme.halfAngle)) {
                        const distToEarth = earthPos.length();
                        const cmeThickness = SCENE_SCALE * 0.3; // Visual thickness of the CME
                        const cmeFront = cmeDist;
                        const cmeBack = cmeDist - cmeThickness;

                        if (distToEarth < cmeFront && distToEarth > cmeBack) {
                            const u_kms = cme.speed;
                            const a_ms2 = 1.41 - 0.0035 * u_kms;
                            const a_kms2 = a_ms2 / 1000.0;
                            const currentSpeed = Math.max(MIN_CME_SPEED_KMS, u_kms + a_kms2 * timeSinceCmeStart);
                            
                            const penetration_distance = cmeFront - distToEarth;
                            const coreThickness = cmeThickness * 0.25;
                            let intensity = 0;

                            if (penetration_distance <= coreThickness) {
                                intensity = 1.0;
                            } else {
                                const wake_progress = (penetration_distance - coreThickness) / (cmeThickness - coreThickness);
                                intensity = 0.5 * (1 + Math.cos(wake_progress * Math.PI));
                            }
                            
                            const speedContribution = (currentSpeed - ambientSpeed) * intensity;
                            const densityContribution = (THREE.MathUtils.mapLinear(cme.speed, 300, 2000, 5, 50) - ambientDensity) * intensity;
                            
                            totalSpeed = Math.max(totalSpeed, ambientSpeed + speedContribution);
                            totalDensity += densityContribution;
                        }
                    }
                }
            });
            graphData.push({ time: currentTime, speed: totalSpeed, density: totalDensity });
        }
        return graphData;
    }
  }), [moveCamera, getClockElapsedTime, THREE, timelineMinDate, calculateDistanceWithDeceleration, cmeData]);

  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'move';
    }
  }, [interactionMode]);

  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    ['MERCURY', 'VENUS', 'MARS'].forEach(n => {
      const b = celestialBodiesRef.current[n];
      const o = orbitsRef.current[n];
      if (b) b.mesh.visible = showExtraPlanets;
      if (o) o.visible = showExtraPlanets;
    });
  }, [showExtraPlanets]);

  useEffect(() => {
    if (!celestialBodiesRef.current) return;
    const m = celestialBodiesRef.current['MOON'];
    const l = celestialBodiesRef.current['L1'];
    if (m) m.mesh.visible = showMoonL1;
    if (l) l.mesh.visible = showMoonL1;
    const e = celestialBodiesRef.current['EARTH']?.mesh;
    if (e) {
      const o = e.children.find((c:any) => c.name === 'moon-orbit');
      if (o) o.visible = showMoonL1;
    }
  }, [showMoonL1]);

  const checkImpacts = useCallback(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;
    let maxSpeed = 0;
    const p = new THREE.Vector3(); celestialBodiesRef.current.EARTH.mesh.getWorldPosition(p);
    cmeGroupRef.current.children.forEach((c: any) => {
      const d = c.userData;
      if (!d || !c.visible) return;
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
      const tip = c.position.clone().add(dir.clone().multiplyScalar(c.scale.y));
      if (tip.distanceTo(p) < PLANET_DATA_MAP.EARTH.size * 2.2 && d.speed > maxSpeed) maxSpeed = d.speed;
    });
    return maxSpeed;
  }, []);

  const speedToLatBoundaryDeg = (speed: number) => {
    const s = clamp(speed, 300, 3000);
    const t = (s - 300) / (3000 - 300);
    const lat = 70 - (70 - 45) * t;
    return lat;
  };

  const speedToIntensity = (speed: number) => {
    const s = clamp(speed, 300, 3000);
    return 0.25 + (s - 300) / (3000 - 300) * 0.95;
  };

  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsed: number) => {
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    if (!earth) return;

    const aurora = earth.children.find((c: any) => c.name === 'aurora');
    const atmosphere = earth.children.find((c: any) => c.name === 'atmosphere');

    const hit = clamp(maxImpactSpeed / 1500, 0, 1);

    if (aurora?.material?.uniforms) {
      const latDeg = speedToLatBoundaryDeg(maxImpactSpeed || 0);
      const minY  = Math.sin(latDeg * Math.PI / 180);
      const intensity = speedToIntensity(maxImpactSpeed || 0);

      aurora.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
      aurora.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0.0;
      aurora.material.uniforms.uAuroraMinY.value = minY;
      aurora.material.uniforms.uAuroraIntensity.value = intensity;

      (aurora.material as any).opacity = 0.12 + hit * (0.45 + 0.18 * Math.sin(elapsed * 2.0));
    }

    if (atmosphere?.material?.uniforms) {
      (atmosphere.material as any).opacity = 0.12 + hit * 0.22;
      atmosphere.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0.0;
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
// --- END OF FILE SimulationCanvas.tsx ---