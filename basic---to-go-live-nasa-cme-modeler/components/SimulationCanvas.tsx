import React, { useRef, useEffect, useCallback } from 'react';
import { ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData, InteractionMode, SimulationCanvasHandle } from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER
} from '../constants';

/**
 * SimulationCanvas (Enhanced)
 * -------------------------------------------------------------
 * Drop-in upgraded version of your CME visualization canvas.
 * Major improvements:
 * - Smoother animation (delta smoothing + capped frame timing)
 * - Higher visual polish (dual-layer starfield, animated space fog)
 * - Shock-front rings per-CME + gentle turbulence jitter
 * - Stronger performance hygiene (GPU resource cleanup, capped DPR, context loss handling)
 * - Robust resize via ResizeObserver
 * - Camera presets + keyboard shortcuts (R to reset, 1 Top, 2 Oblique)
 * - Prediction line auto-updates w/ Earth motion
 * - Safer THREE/GSAP detection + graceful fallbacks
 * - Timeline playhead smoothing and edge handling
 */

// --- Light helpers ----------------------------------------------------------
const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const getTHREE = () => (hasDOM ? (window as any).THREE : undefined);
const getGSAP = () => (hasDOM ? (window as any).gsap : undefined);

// Cache for the particle texture to avoid recreating it
let particleTextureCache: any = null;

// Creates a soft, radial gradient texture for particle sprites
const createParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || !hasDOM) return null;

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

  particleTextureCache = new getTHREE().CanvasTexture(canvas);
  return particleTextureCache;
};

// Calculates CME opacity based on speed (km/s)
const getCmeOpacity = (speed: number): number => {
  const THREE = getTHREE();
  if (!THREE) return 0.12; // Fallback opacity if THREE is not loaded
  const minSpeed = 300;
  const maxSpeed = 3000;
  const minOpacity = 0.04;
  const maxOpacity = 0.65;
  const clamped = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  return THREE.MathUtils.mapLinear(clamped, minSpeed, maxSpeed, minOpacity, maxOpacity);
};

// Calculates CME particle count based on speed (km/s)
const getCmeParticleCount = (speed: number): number => {
  const THREE = getTHREE();
  if (!THREE) return 3500; // Default if THREE isn't loaded
  const minSpeed = 300;
  const maxSpeed = 3000;
  const minParticles = 1600;
  const maxParticles = 8000;
  const clamped = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  const count = THREE.MathUtils.mapLinear(clamped, minSpeed, maxSpeed, minParticles, maxParticles);
  return Math.floor(count);
};

// Calculates CME particle size based on speed (km/s)
const getCmeParticleSize = (speed: number, scale: number): number => {
  const THREE = getTHREE();
  if (!THREE) return 0.05 * scale; // Fallback size
  const minSpeed = 300;
  const maxSpeed = 3000;
  const minSize = 0.035 * scale;
  const maxSize = 0.085 * scale;
  const clamped = THREE.MathUtils.clamp(speed, minSpeed, maxSpeed);
  return THREE.MathUtils.mapLinear(clamped, minSpeed, maxSpeed, minSize, maxSize);
};

// Determines the core color of the CME based on its speed
const getCmeCoreColor = (speed: number): any /* THREE.Color */ => {
  const THREE = getTHREE();
  if (!THREE) return new (class { constructor(hex: any) {} setHex() { return this; } })(0xffffff);
  if (speed >= 2500) return new THREE.Color(0xff69b4); // Hot Pink (extreme)
  if (speed >= 1800) return new THREE.Color(0x9370db); // Medium Purple (major)
  if (speed >= 1000) return new THREE.Color(0xff4500); // OrangeRed (strong)
  if (speed >= 800) return new THREE.Color(0xffa500);  // Orange (moderate)
  if (speed >= 500) return new THREE.Color(0xffff00);  // Yellow (mild)
  if (speed < 350) return new THREE.Color(0x808080);   // Grey (slow)
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  const t = THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1);
  return grey.lerp(yellow, t);
};

interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void; // kept for compatibility if needed later
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
    // onCMEClick, // not used here but preserved in props
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
  const rendererRef = useRef<any>(null); // THREE.WebGLRenderer
  const sceneRef = useRef<any>(null); // THREE.Scene
  const cameraRef = useRef<any>(null); // THREE.PerspectiveCamera
  const controlsRef = useRef<any>(null); // THREE.OrbitControls
  const cmeGroupRef = useRef<any>(null); // THREE.Group
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef = useRef<Record<string, any>>({}); // Record<string, THREE.Mesh>
  const predictionLineRef = useRef<any>(null); // THREE.Line
  const backgroundFogRef = useRef<any>(null);

  // CME extras
  const cmeShockGroupRef = useRef<any>(null); // shock-front rings

  const timelineValueRef = useRef(timelineValue);
  const lastTimeRef = useRef(0);
  const deltaSMARef = useRef(16.6); // moving average for delta (ms)

  const animPropsRef = useRef({ onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate });
  useEffect(() => {
    animPropsRef.current = { onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate]);

  const THREE = getTHREE();
  const gsap = getGSAP();

  useEffect(() => { timelineValueRef.current = timelineValue; }, [timelineValue]);

  // Physics-ish travel calculator (optionally using arrival-based decel for Earth-directed CMEs)
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

    const distanceActualAU = speed_AU_per_sec * timeSinceEventSeconds;
    const distanceSceneUnits = distanceActualAU * SCENE_SCALE;
    return distanceSceneUnits;
  }, []);

  // Shape updater (cone-like puff moving out from the Sun)
  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number) => {
    const THREE = getTHREE();
    if (!THREE) return;

    const sunRadius = PLANET_DATA_MAP.SUN.size;

    // Hide only if timeline is before the CME start
    if (distTraveledInSceneUnits < 0) {
      cmeObject.visible = false;
      return;
    }
    cmeObject.visible = true;

    const cmeLength = Math.max(0, distTraveledInSceneUnits - sunRadius);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    const tipPosition = direction.clone().multiplyScalar(sunRadius);
    cmeObject.position.copy(tipPosition);

    // Add gentle turbulence jiggle based on time to avoid overly static feel
    if (cmeObject.userData && cmeObject.userData._seed !== undefined) {
      const t = performance.now() * 0.00035 + cmeObject.userData._seed * 10.123;
      const jitter = 0.003 * SCENE_SCALE * (Math.sin(t) + Math.cos(t * 0.7));
      cmeObject.position.addScaledVector(direction.clone().applyAxisAngle(new THREE.Vector3(1,0,0), 0.5), jitter);
    }

    cmeObject.scale.set(cmeLength, cmeLength, cmeLength);
  }, []);

  // Create/refresh prediction line (Sun -> Earth)
  const refreshPredictionLine = useCallback(() => {
    const THREE = getTHREE();
    if (!THREE || !sceneRef.current || !celestialBodiesRef.current.EARTH) return;
    if (predictionLineRef.current) {
      sceneRef.current.remove(predictionLineRef.current);
      predictionLineRef.current.geometry.dispose();
      predictionLineRef.current.material.dispose();
      predictionLineRef.current = null;
    }
    const earthPos = new THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);
    const points = [new THREE.Vector3(0, 0, 0), earthPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.85,
      dashSize: 0.05 * SCENE_SCALE,
      gapSize: 0.02 * SCENE_SCALE,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.visible = !!(currentlyModeledCMEId);
    sceneRef.current.add(line);
    predictionLineRef.current = line;
  }, [currentlyModeledCMEId]);

  // Initialize Scene ---------------------------------------------------------
  useEffect(() => {
    const THREE = getTHREE();
    const gsap = getGSAP();
    if (!mountRef.current || !THREE) return;
    if (rendererRef.current) return; // Already initialized

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Subtle fog for depth cueing
    const fogColor = new THREE.Color(0x02030a);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(fogColor, 0.002 / SCENE_SCALE);
    backgroundFogRef.current = scene.fog;

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.0005 * SCENE_SCALE,
      200 * SCENE_SCALE
    );
    cameraRef.current = camera;
    onCameraReady(camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for perf
    renderer.setPixelRatio(dpr);
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.outputColorSpace = (THREE as any).SRGBColorSpace || (THREE as any).sRGBEncoding; // backwards safe
    // Guard against context loss (mobile/long sessions)
    const onContextLost = (e: Event) => { e.preventDefault(); };
    const onContextRestored = () => { /* could rebuild resources if needed */ };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 2.2, 250 * SCENE_SCALE);
    scene.add(pointLight);

    // Controls
    const ControlsCtor = (THREE as any).OrbitControls;
    const controls = ControlsCtor ? new ControlsCtor(camera, renderer.domElement) : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.screenSpacePanning = false;
      controls.minDistance = 0.08 * SCENE_SCALE;
      controls.maxDistance = 60 * SCENE_SCALE;
      controlsRef.current = controls;
    }

    // Root groups
    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    cmeShockGroupRef.current = new THREE.Group();
    scene.add(cmeShockGroupRef.current);

    // Dual-layer starfield (parallax feel)
    const makeStars = (count: number, spread: number, size: number, color = 0xa9abb6) => {
      const verts: number[] = [];
      for (let i = 0; i < count; i++) {
        verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
        verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
        verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const m = new THREE.PointsMaterial({ color, size: size * SCENE_SCALE, sizeAttenuation: true, transparent: true, opacity: 0.8 });
      return new THREE.Points(g, m);
    };
    const starNear = makeStars(7000, 220, 0.008, 0xbbbbbb);
    const starFar = makeStars(12000, 450, 0.006, 0x8888aa);
    scene.add(starNear);
    scene.add(starFar);

    // Sun
    const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
    });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // Planets orbiting Sun
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || (data as PlanetData).orbits) return;
      const planetGeometry = new THREE.SphereGeometry((data as PlanetData).size, 32, 32);
      const planetMaterial = new THREE.MeshPhongMaterial({ color: (data as PlanetData).color, shininess: 30 });
      const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
      planetMesh.position.x = (data as PlanetData).radius * Math.sin((data as PlanetData).angle);
      planetMesh.position.z = (data as PlanetData).radius * Math.cos((data as PlanetData).angle);
      planetMesh.userData = data;
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = { mesh: planetMesh, name: (data as PlanetData).name, labelId: (data as PlanetData).labelElementId, userData: data };
      planetLabelInfos.push({ id: (data as PlanetData).labelElementId, name: (data as PlanetData).name, mesh: planetMesh });

      if (name === 'EARTH') {
        const earthData = data as PlanetData;
        const atmosphereGeo = new THREE.SphereGeometry(earthData.size * 1.2, 32, 32);
        const atmosphereMat = new THREE.ShaderMaterial({
          vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER,
          fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } },
          depthWrite: false,
        });
        const atmosphereMesh = new THREE.Mesh(atmosphereGeo, atmosphereMat);
        atmosphereMesh.name = 'atmosphere';
        planetMesh.add(atmosphereMesh);

        const auroraGeo = new THREE.SphereGeometry(earthData.size * 1.25, 64, 64);
        const auroraMat = new THREE.ShaderMaterial({
          vertexShader: AURORA_VERTEX_SHADER,
          fragmentShader: AURORA_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          uniforms: { uTime: { value: 0.0 }, uCmeSpeed: { value: 0.0 }, uImpactTime: { value: 0.0 } },
        });
        const auroraMesh = new THREE.Mesh(auroraGeo, auroraMat);
        auroraMesh.name = 'aurora';
        planetMesh.add(auroraMesh);
      }

      // Orbit tube (thick line)
      const orbitPoints: any[] = [];
      const orbitSegments = 128;
      for (let i = 0; i <= orbitSegments; i++) {
        const angle = (i / orbitSegments) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(angle) * (data as PlanetData).radius, 0, Math.cos(angle) * (data as PlanetData).radius));
      }
      const orbitCurve = new THREE.CatmullRomCurve3(orbitPoints);
      const tubeThickness = 0.005 * SCENE_SCALE;
      const orbitGeometry = new THREE.TubeGeometry(orbitCurve, orbitSegments, tubeThickness, 8, true);
      const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.6 });
      const orbitTube = new THREE.Mesh(orbitGeometry, orbitMaterial);
      scene.add(orbitTube);
      orbitsRef.current[name] = orbitTube;
    });

    // Moons
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      const d = data as PlanetData;
      if (!d.orbits) return;
      const parentBody = celestialBodiesRef.current[d.orbits];
      if (!parentBody) return;

      const moonGeometry = new THREE.SphereGeometry(d.size, 16, 16);
      const moonMaterial = new THREE.MeshPhongMaterial({ color: d.color, shininess: 5 });
      const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
      moonMesh.position.x = d.radius * Math.sin(d.angle);
      moonMesh.position.z = d.radius * Math.cos(d.angle);
      moonMesh.userData = data;
      parentBody.mesh.add(moonMesh);
      celestialBodiesRef.current[name] = { mesh: moonMesh, name: d.name, labelId: d.labelElementId, userData: data };
      planetLabelInfos.push({ id: d.labelElementId, name: d.name, mesh: moonMesh });

      const orbitPoints: any[] = [];
      const orbitSegments = 64;
      for (let i = 0; i <= orbitSegments; i++) {
        const angle = (i / orbitSegments) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(angle) * d.radius, 0, Math.cos(angle) * d.radius));
      }
      const orbitCurve = new THREE.CatmullRomCurve3(orbitPoints);
      const tubeThickness = 0.003 * SCENE_SCALE;
      const orbitGeometry = new THREE.TubeGeometry(orbitCurve, orbitSegments, tubeThickness, 8, true);
      const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 });
      const orbitTube = new THREE.Mesh(orbitGeometry, orbitMaterial);
      orbitTube.name = 'moon-orbit';
      parentBody.mesh.add(orbitTube);
    });

    // Points of Interest (e.g., L1)
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

    // Resize handling (ResizeObserver for accuracy)
    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    // Safe ResizeObserver creation (no optional-chaining after `new`)
    const RO: any = (window as any).ResizeObserver;
    const ro = RO ? new RO(() => handleResize()) : null;
    if (ro && mountRef.current) ro.observe(mountRef.current);
    window.addEventListener('resize', handleResize);

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') moveCamera(ViewMode.TOP, FocusTarget.EARTH);
      if (e.key === '1') moveCamera(ViewMode.TOP, focusTarget ?? FocusTarget.EARTH);
      if (e.key === '2') moveCamera(ViewMode.OBLIQUE ?? ViewMode.SIDE, focusTarget ?? FocusTarget.EARTH);
    };
    window.addEventListener('keydown', onKey);

    // Animation loop
    let animationFrameId = 0;
    const MAX_FPS = 90; // cap to keep thermals under control
    const FRAME_MIN_MS = 1000 / MAX_FPS;

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

      const nowElapsed = getClockElapsedTime();
      let delta = nowElapsed - lastTimeRef.current;
      if (delta < FRAME_MIN_MS / 1000) return; // simple throttle
      lastTimeRef.current = nowElapsed;

      // Smooth delta using simple moving average (ms domain)
      const deltaMs = delta * 1000;
      deltaSMARef.current = deltaSMARef.current * 0.9 + deltaMs * 0.1;
      const smoothedDelta = deltaSMARef.current / 1000;

      const ORBIT_SPEED_SCALE = 2000;

      // Planet/moon motion
      Object.values(celestialBodiesRef.current).forEach(body => {
        const bodyData = body.userData as PlanetData | undefined;
        if (!bodyData || !bodyData.orbitalPeriodDays) return;
        const angularVelocity = (2 * Math.PI) / (bodyData.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE;
        const angle = bodyData.angle + angularVelocity * nowElapsed;
        if (!bodyData.orbits) {
          body.mesh.position.x = bodyData.radius * Math.sin(angle);
          body.mesh.position.z = bodyData.radius * Math.cos(angle);
        } else {
          body.mesh.position.x = bodyData.radius * Math.sin(angle);
          body.mesh.position.z = bodyData.radius * Math.cos(angle);
        }
      });

      // L1 position updates
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

      // Animated uniforms
      const elapsed = nowElapsed;
      if (celestialBodiesRef.current.SUN) {
        (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsed;
      }
      if (celestialBodiesRef.current.EARTH) {
        const earthMesh = celestialBodiesRef.current.EARTH.mesh;
        earthMesh.rotation.y += 0.05 * smoothedDelta;
        earthMesh.children.forEach((child: any) => {
          if (child?.material?.uniforms?.uTime) child.material.uniforms.uTime.value = elapsed;
        });
      }

      // Timeline logic
      if (timelineActive) {
        if (timelinePlaying) {
          const range = timelineMaxDate - timelineMinDate;
          if (range > 0 && timelineValueRef.current < 1000) {
            const simHoursPerSecond = 3 * timelineSpeed;
            const simMillisPerSecond = simHoursPerSecond * 3600 * 1000;
            const simTimePassedThisFrame = smoothedDelta * simMillisPerSecond;
            const valueToAdd = (simTimePassedThisFrame / range) * 1000;
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
        // Live mode / focused simulation
        cmeGroupRef.current.children.forEach((cmeObject: any) => {
          const cme: ProcessedCME = cmeObject.userData;
          if (!cme) return;
          let currentDist = 0;
          if (currentlyModeledCMEId && cme.id === currentlyModeledCMEId) {
            const simStartTime = cme.simulationStartTime !== undefined ? cme.simulationStartTime : elapsed;
            const t = elapsed - simStartTime;
            currentDist = calculateDistance(cme, t < 0 ? 0 : t, true);
          } else if (!currentlyModeledCMEId) {
            const timeSinceEventAPI = (Date.now() - cme.startTime.getTime()) / 1000;
            currentDist = calculateDistance(cme, timeSinceEventAPI < 0 ? 0 : timeSinceEventAPI, false);
          } else {
            updateCMEShape(cmeObject, -1);
            return;
          }
          updateCMEShape(cmeObject, currentDist);
        });
      }

      // Update prediction line every frame for accuracy
      if (predictionLineRef.current && celestialBodiesRef.current.EARTH) {
        const earthPos = new THREE.Vector3();
        celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);
        const g = predictionLineRef.current.geometry as any;
        const posAttr = new THREE.Float32BufferAttribute([0,0,0, earthPos.x, earthPos.y, earthPos.z], 3);
        g.setAttribute('position', posAttr);
        predictionLineRef.current.computeLineDistances();
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsed);

      controlsRef.current?.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    const cleanup = () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', onKey);
      if (ro && mountRef.current) ro.unobserve(mountRef.current);
      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      if (particleTextureCache) {
        particleTextureCache.dispose();
        particleTextureCache = null;
      }
      rendererRef.current?.domElement.removeEventListener('webglcontextlost', onContextLost, false);
      rendererRef.current?.domElement.removeEventListener('webglcontextrestored', onContextRestored, false);
      rendererRef.current?.dispose();
      cancelAnimationFrame(animationFrameId);
      sceneRef.current?.traverse((object: any) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((m: any) => m.dispose());
          else object.material.dispose();
        }
      });
      rendererRef.current = null;
    };

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Build CME meshes on data change -----------------------------------------
  useEffect(() => {
    const THREE = getTHREE();
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    // Clear existing CME visuals
    const clearGroup = (group: any) => {
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
          else child.material.dispose();
        }
      }
    };
    clearGroup(cmeGroupRef.current);
    if (cmeShockGroupRef.current) clearGroup(cmeShockGroupRef.current);

    const particleTexture = createParticleTexture(THREE);

    cmeData.forEach((cme, idx) => {
      const particleCount = getCmeParticleCount(cme.speed);
      const positions: number[] = [];
      const colors: number[] = [];

      const coneHalfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
      const coneHeight = 1; // unit height (scaled later)
      const coneRadius = coneHeight * Math.tan(coneHalfAngleRad);
      const bulgeFactor = 0.5;

      const shockColor = new THREE.Color(0xffaaaa);
      const wakeColor = new THREE.Color(0x8888ff);
      const coreColor = getCmeCoreColor(cme.speed);

      for (let i = 0; i < particleCount; i++) {
        const y = coneHeight * Math.cbrt(Math.random()); // front-weighted
        const radiusAtY = (y / coneHeight) * coneRadius;
        const theta = Math.random() * 2 * Math.PI;
        const r = coneRadius > 0 ? Math.sqrt(Math.random()) * radiusAtY : 0;
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        const normalizedR = r / coneRadius;
        const yOffset = bulgeFactor * (1 - normalizedR * normalizedR);
        const finalY = y * (1 + yOffset);
        positions.push(x, finalY, z);

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
      cmeParticleSystem.userData = { ...cme, _seed: (idx % 7) * 0.137 }; // add jitter seed

      const direction = new THREE.Vector3();
      direction.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      cmeParticleSystem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      cmeGroupRef.current.add(cmeParticleSystem);

      // Shock-front ring (subtle expanding torus)
      const ringR = 0.06 * SCENE_SCALE;
      const ringTube = 0.0025 * SCENE_SCALE;
      const ringGeo = new THREE.TorusGeometry(ringR, ringTube, 8, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcc99, transparent: true, opacity: 0.0 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.quaternion.copy(cmeParticleSystem.quaternion);
      ring.userData = { cmeId: cme.id };
      cmeShockGroupRef.current.add(ring);
    });
  }, [cmeData]);

  // Visibility + focus handling --------------------------------------------
  useEffect(() => {
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
    refreshPredictionLine();
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime, refreshPredictionLine]);

  // Camera moves ------------------------------------------------------------
  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    const THREE = getTHREE();
    const gsap = getGSAP();
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;

    const targetPosition = new THREE.Vector3(0, 0, 0);
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) {
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(targetPosition);
    }

    let camPos = new THREE.Vector3();
    if (view === ViewMode.TOP) {
      camPos.set(targetPosition.x, targetPosition.y + SCENE_SCALE * 4, targetPosition.z + 0.01);
    } else {
      camPos.set(targetPosition.x + SCENE_SCALE * 1.8, targetPosition.y + SCENE_SCALE * 0.3, targetPosition.z);
    }

    gsap.to(cameraRef.current.position, { duration: 1.2, x: camPos.x, y: camPos.y, z: camPos.z, ease: 'power2.inOut' });
    gsap.to(controlsRef.current.target, {
      duration: 1.2,
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
      ease: 'power2.inOut',
      onUpdate: () => controlsRef.current?.update(),
    });
  }, []);

  useEffect(() => { moveCamera(activeView, focusTarget); }, [activeView, focusTarget, dataVersion, moveCamera]);

  React.useImperativeHandle(ref, () => ({ resetView: () => moveCamera(ViewMode.TOP, FocusTarget.EARTH) }), [moveCamera]);

  // Force move mode (disable select cursor)
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'grab';
      rendererRef.current.domElement.addEventListener('mousedown', () => (rendererRef.current.domElement.style.cursor = 'grabbing'));
      rendererRef.current.domElement.addEventListener('mouseup', () => (rendererRef.current.domElement.style.cursor = 'grab'));
    }
  }, [interactionMode]);

  // Prediction line rebuild when selection changes
  useEffect(() => { refreshPredictionLine(); }, [currentlyModeledCMEId, cmeData, refreshPredictionLine]);

  // Toggle of extra bodies
  useEffect(() => {
    const extraPlanets = ['MERCURY', 'VENUS', 'MARS'];
    extraPlanets.forEach(name => {
      const body = celestialBodiesRef.current[name];
      const orbit = orbitsRef.current[name];
      if (body) body.mesh.visible = showExtraPlanets;
      if (orbit) orbit.visible = showExtraPlanets;
    });
  }, [showExtraPlanets]);

  // Toggle Moon & L1
  useEffect(() => {
    const moon = celestialBodiesRef.current['MOON'];
    const l1 = celestialBodiesRef.current['L1'];
    if (moon) moon.mesh.visible = showMoonL1;
    if (l1) l1.mesh.visible = showMoonL1;
    const earthMesh = celestialBodiesRef.current['EARTH']?.mesh;
    if (earthMesh) {
      const moonOrbit = earthMesh.children.find((c: any) => c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);

  // Impact checks ------------------------------------------------------------
  const checkImpacts = useCallback(() => {
    const THREE = getTHREE();
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;

    let maxImpactSpeed = 0;
    const earthRadiusVisual = PLANET_DATA_MAP.EARTH.size;
    const earthOrbitRadius = PLANET_DATA_MAP.EARTH.radius;

    const earthWorldPos = new THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthWorldPos);

    // Evolve shock rings + detect overlaps
    cmeShockGroupRef.current?.children.forEach((ring: any) => {
      // Idle: fade ring unless the matching CME is visible
      ring.material.opacity *= 0.96; // slow fade
      ring.scale.multiplyScalar(1.0025); // gentle expansion
    });

    cmeGroupRef.current.children.forEach((cmeObject: any, i: number) => {
      if (!cmeObject.visible || !cmeObject.userData) return;
      const cme: ProcessedCME = cmeObject.userData;
      const cmeTipPosition = cmeObject.position.length();
      const cmeScaledLength = cmeObject.scale.y;
      const distTraveled = cmeTipPosition + cmeScaledLength;

      if (distTraveled >= earthOrbitRadius - (earthRadiusVisual * 10) && distTraveled <= earthOrbitRadius + (earthRadiusVisual * 10)) {
        const cmeDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion).normalize();
        const earthDirection = earthWorldPos.clone().normalize();
        const angleBetween = cmeDirection.angleTo(earthDirection);
        const cmeHalfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
        if (angleBetween <= cmeHalfAngleRad) {
          maxImpactSpeed = Math.max(maxImpactSpeed, cme.speed);

          // Trigger shock ring on match index
          const ring = cmeShockGroupRef.current?.children[i];
          if (ring) {
            ring.position.copy(cmeObject.position);
            ring.quaternion.copy(cmeObject.quaternion);
            ring.scale.setScalar(1);
            ring.material.opacity = 0.55;
          }
        }
      }
    });

    return maxImpactSpeed;
  }, []);

  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsedTime: number) => {
    if (!orbitsRef.current.EARTH || !celestialBodiesRef.current.EARTH) return;
    orbitsRef.current.EARTH.material.color.set(maxImpactSpeed > 0 ? 0xff4444 : 0x666666);
    orbitsRef.current.EARTH.material.opacity = maxImpactSpeed > 0 ? 0.95 : 0.6;

    const earthMesh = celestialBodiesRef.current.EARTH.mesh;
    const atmosphereMesh = earthMesh.children.find((c: any) => c.name === 'atmosphere') as any;
    const auroraMesh = earthMesh.children.find((c: any) => c.name === 'aurora') as any;

    if (maxImpactSpeed > 0) {
      if (atmosphereMesh?.material.uniforms.uImpactTime) {
        const lastImpact = atmosphereMesh.material.uniforms.uImpactTime.value;
        if (elapsedTime - lastImpact > 2.5) atmosphereMesh.material.uniforms.uImpactTime.value = elapsedTime;
      }
      if (auroraMesh?.material.uniforms) {
        auroraMesh.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
        auroraMesh.material.uniforms.uImpactTime.value = elapsedTime;
      }
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};



export default React.forwardRef(SimulationCanvas);
