import React, { useRef, useEffect, useCallback } from 'react';
import {
  ProcessedCME,
  ViewMode,
  FocusTarget,
  CelestialBody,
  PlanetLabelInfo,
  POIData,
  PlanetData,
  InteractionMode,
  SimulationCanvasHandle,
} from '../types';
import {
  PLANET_DATA_MAP,
  POI_DATA_MAP,
  SCENE_SCALE,
  AU_IN_KM,
  SUN_VERTEX_SHADER,
  SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER,
  EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER,
  AURORA_FRAGMENT_SHADER,
} from '../constants';

/**
 * VISUAL UPGRADE NOTES
 * - CME: particle cone w/ speed-based opacity + size + color, plus an expanding shock shell (faint sphere) and a short fading tail.
 * - Sun: keeps your shader core but adds a soft corona sprite halo.
 * - Planets: retains phong, adds Earth aurora/atmosphere shader uniforms & subtle rotation; optional L1 + moon visibility toggles.
 * - Orbits: thick tube meshes with glow-ish opacity (already in your version).
 * - Scene: denser starfield + deep parallax layer; smooth OrbitControls; cinematic camera tween via GSAP.
 * - Timeline: respects your timelineActive/playing/scrub logic; per-CME “solo” animation preserved.
 */

// ---------- Small caches / helpers ----------
let particleTextureCache: any = null;
let coronaTextureCache: any = null;

const createRadialParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
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

const createCoronaTexture = (THREE: any) => {
  if (coronaTextureCache) return coronaTextureCache;
  if (!THREE || typeof document === 'undefined') return null;

  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Soft multi-ring radial
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, size * 0.02, center, center, size * 0.5);
  gradient.addColorStop(0.0, 'rgba(255,240,200,0.75)');
  gradient.addColorStop(0.35, 'rgba(255,200,50,0.35)');
  gradient.addColorStop(0.6, 'rgba(255,160,0,0.12)');
  gradient.addColorStop(1.0, 'rgba(255,120,0,0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  coronaTextureCache = new THREE.CanvasTexture(canvas);
  coronaTextureCache.anisotropy = 4;
  return coronaTextureCache;
};

// Speed-mapped visuals
const getCmeOpacity = (THREE: any, speed: number): number => {
  if (!THREE) return 0.22;
  const minS = 300, maxS = 3000, minO = 0.06, maxO = 0.65;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return THREE.MathUtils.mapLinear(s, minS, maxS, minO, maxO);
};

const getCmeParticleCount = (THREE: any, speed: number): number => {
  if (!THREE) return 3500;
  const minS = 300, maxS = 3000, minP = 1800, maxP = 9000;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return Math.floor(THREE.MathUtils.mapLinear(s, minS, maxS, minP, maxP));
};

const getCmeParticleSize = (THREE: any, speed: number, scale: number): number => {
  if (!THREE) return 0.05 * scale;
  const minS = 300, maxS = 3000, minSz = 0.035 * scale, maxSz = 0.085 * scale;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return THREE.MathUtils.mapLinear(s, minS, maxS, minSz, maxSz);
};

const getCmeCoreColor = (THREE: any, speed: number): any => {
  if (!THREE) return { r: 1, g: 1, b: 1, setHex: () => {} };
  if (speed >= 2500) return new THREE.Color(0xff69b4);     // Hot Pink
  if (speed >= 1800) return new THREE.Color(0x9370db);     // Medium Purple
  if (speed >= 1000) return new THREE.Color(0xff4500);     // OrangeRed
  if (speed >= 800)  return new THREE.Color(0xffa500);     // Orange
  if (speed >= 500)  return new THREE.Color(0xffff00);     // Yellow
  if (speed < 350)   return new THREE.Color(0x808080);     // Grey
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  const t = THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1);
  return grey.lerp(yellow, t);
};

// ---------- Component ----------

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
  onCameraReady: (camera: any) => void;
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
    // onCMEClick, // not used (kept to preserve props signature)
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
  const cmeGroupRef = useRef<any>(null); // group containing CMEs
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef = useRef<Record<string, any>>({});
  const predictionLineRef = useRef<any>(null);

  const sunCoronaRef = useRef<any>(null);
  const starfieldNearRef = useRef<any>(null);
  const starfieldFarRef = useRef<any>(null);

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

  // Distance calculation (with decel path blending if earth-directed)
  const calculateDistance = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number, useDeceleration: boolean): number => {
    const speed_km_s = cme.speed;
    const speed_AU_s = speed_km_s / AU_IN_KM;

    if (cme.isEarthDirected && cme.predictedArrivalTime && useDeceleration) {
      const earthOrbitRadiusAU = PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE;
      const totalTravelSec = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
      if (totalTravelSec <= 0) return 0;
      const t = Math.min(1, timeSinceEventSeconds / totalTravelSec);
      const distAU = t * earthOrbitRadiusAU;
      return distAU * SCENE_SCALE;
    }

    const distanceAU = speed_AU_s * Math.max(0, timeSinceEventSeconds);
    return distanceAU * SCENE_SCALE;
  }, []);

  // Update CME mesh visibility/scale along propagation
  const updateCMEShape = useCallback(
    (cmeObject: any, distTraveledInSceneUnits: number) => {
      if (!THREE) return;
      const sunRadius = PLANET_DATA_MAP.SUN.size;

      if (distTraveledInSceneUnits < 0) {
        cmeObject.visible = false;
        return;
      }
      cmeObject.visible = true;

      // Cone's base sits at sun surface; grow length away from sun
      const cmeLength = Math.max(0, distTraveledInSceneUnits - sunRadius);

      // Direction already encoded in quaternion (cone local Y -> direction)
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
      const tip = dir.clone().multiplyScalar(sunRadius);
      cmeObject.position.copy(tip);

      // Scale cone and particles uniformly to length; keep minimum footprint
      const s = cmeLength;
      cmeObject.scale.set(s, s, s);

      // Extras: shock shell and tail if present
      const shock = cmeObject.getObjectByName('shock-shell') as any;
      if (shock) {
        const shellR = Math.max(sunRadius * 1.02, sunRadius + cmeLength * 0.15);
        shock.scale.setScalar(shellR);
        // Soft pulse in opacity with elapsed time
        const t = (performance.now() % 2000) / 2000;
        const pulse = 0.6 + 0.4 * Math.sin(t * Math.PI * 2);
        (shock.material as any).opacity = 0.08 * pulse;
      }

      const tail = cmeObject.getObjectByName('tail') as any;
      if (tail) {
        // Tail stretches ~20% of cone length behind it; fade as it grows
        const tailLen = Math.max(0.05 * SCENE_SCALE, cmeLength * 0.2);
        tail.scale.set(1, tailLen, 1);
        const mat = tail.material as any;
        mat.opacity = Math.max(0.05, 0.25 - Math.min(0.25, cmeLength / (SCENE_SCALE * 3)) * 0.2);
      }
    },
    [THREE]
  );

  // ---------- Scene init ----------
  useEffect(() => {
    if (!mountRef.current || !THREE) return;
    if (rendererRef.current) return;

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.001 * SCENE_SCALE,
      120 * SCENE_SCALE
    );
    cameraRef.current = camera;
    onCameraReady(camera);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.PointLight(0xffffff, 2.4, 300 * SCENE_SCALE);
    scene.add(key);

    // Controls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.12 * SCENE_SCALE;
    controls.maxDistance = 55 * SCENE_SCALE;
    controlsRef.current = controls;

    // CME group
    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    // Starfield layers
    const addStarLayer = (count: number, spread: number) => {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3 + 0] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        positions[i * 3 + 1] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        positions[i * 3 + 2] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ size: 0.012 * SCENE_SCALE, transparent: true, opacity: 0.85 });
      return new THREE.Points(geo, mat);
    };
    const nearStars = addStarLayer(14000, 260);
    const farStars = addStarLayer(22000, 450);
    nearStars.name = 'stars-near';
    farStars.name = 'stars-far';
    scene.add(nearStars);
    scene.add(farStars);
    starfieldNearRef.current = nearStars;
    starfieldFarRef.current = farStars;

    // Sun
    const sunGeo = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
      transparent: true,
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    // Corona halo (sprite that always faces camera)
    const coronaTex = createCoronaTexture(THREE);
    if (coronaTex) {
      const coronaMat = new THREE.SpriteMaterial({
        map: coronaTex,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });
      const corona = new THREE.Sprite(coronaMat);
      corona.name = 'sun-corona';
      corona.scale.setScalar(PLANET_DATA_MAP.SUN.size * 5.2);
      sunMesh.add(corona);
      sunCoronaRef.current = corona;
    }

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // Planets (orbit the Sun)
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;

      const planetGeo = new THREE.SphereGeometry(data.size, 32, 32);
      const planetMat = new THREE.MeshPhongMaterial({
        color: data.color,
        shininess: 32,
        specular: 0x222222,
      });
      const planetMesh = new THREE.Mesh(planetGeo, planetMat);
      planetMesh.position.x = data.radius * Math.sin(data.angle);
      planetMesh.position.z = data.radius * Math.cos(data.angle);
      planetMesh.userData = data;
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = {
        mesh: planetMesh,
        name: data.name,
        labelId: data.labelElementId,
        userData: data,
      };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: planetMesh });

      if (name === 'EARTH') {
        const earthData = data as PlanetData;

        // Atmosphere glow
        const atmGeo = new THREE.SphereGeometry(earthData.size * 1.2, 32, 32);
        const atmMat = new THREE.ShaderMaterial({
          vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER,
          fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } },
          depthWrite: false,
        });
        const atm = new THREE.Mesh(atmGeo, atmMat);
        atm.name = 'atmosphere';
        planetMesh.add(atm);

        // Aurora shell
        const aurGeo = new THREE.SphereGeometry(earthData.size * 1.25, 64, 64);
        const aurMat = new THREE.ShaderMaterial({
          vertexShader: AURORA_VERTEX_SHADER,
          fragmentShader: AURORA_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: { value: 0.0 },
            uCmeSpeed: { value: 0.0 },
            uImpactTime: { value: 0.0 },
          },
        });
        const aur = new THREE.Mesh(aurGeo, aurMat);
        aur.name = 'aurora';
        planetMesh.add(aur);
      }

      // Orbit tube
      const orbitPoints: any[] = [];
      const segs = 128;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(a) * data.radius, 0, Math.cos(a) * data.radius));
      }
      const curve = new THREE.CatmullRomCurve3(orbitPoints);
      const tubeThickness = 0.005 * SCENE_SCALE;
      const orbitGeo = new THREE.TubeGeometry(curve, segs, tubeThickness, 8, true);
      const orbitMat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 });
      const orbitTube = new THREE.Mesh(orbitGeo, orbitMat);
      scene.add(orbitTube);
      orbitsRef.current[name] = orbitTube;
    });

    // Moons
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (!data.orbits) return;
      const parent = celestialBodiesRef.current[data.orbits];
      if (!parent) return;

      const moonGeo = new THREE.SphereGeometry(data.size, 16, 16);
      const moonMat = new THREE.MeshPhongMaterial({ color: data.color, shininess: 6 });
      const moonMesh = new THREE.Mesh(moonGeo, moonMat);
      moonMesh.position.x = data.radius * Math.sin(data.angle);
      moonMesh.position.z = data.radius * Math.cos(data.angle);
      moonMesh.userData = data;
      parent.mesh.add(moonMesh);
      celestialBodiesRef.current[name] = {
        mesh: moonMesh,
        name: data.name,
        labelId: data.labelElementId,
        userData: data,
      };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: moonMesh });

      // Moon orbit tube
      const orbitPoints: any[] = [];
      const segs = 64;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        orbitPoints.push(new THREE.Vector3(Math.sin(a) * data.radius, 0, Math.cos(a) * data.radius));
      }
      const curve = new THREE.CatmullRomCurve3(orbitPoints);
      const t = 0.003 * SCENE_SCALE;
      const orbitGeo = new THREE.TubeGeometry(curve, segs, t, 8, true);
      const orbitMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.7 });
      const orbitTube = new THREE.Mesh(orbitGeo, orbitMat);
      orbitTube.name = 'moon-orbit';
      parent.mesh.add(orbitTube);
    });

    // POIs (e.g., L1)
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const poiGeo = new THREE.TetrahedronGeometry(data.size, 0);
      const poiMat = new THREE.MeshBasicMaterial({ color: data.color });
      const poiMesh = new THREE.Mesh(poiGeo, poiMat);
      poiMesh.userData = data;
      scene.add(poiMesh);
      celestialBodiesRef.current[name] = {
        mesh: poiMesh,
        name: data.name,
        labelId: data.labelElementId,
        userData: data,
      };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: poiMesh });
    });

    // Expose meshes for 2D labels
    setPlanetMeshesForLabels(planetLabelInfos);

    // Resize
    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animate
    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);

      const {
        currentlyModeledCMEId: modeledId,
        timelineActive,
        timelinePlaying,
        timelineSpeed,
        timelineMinDate,
        timelineMaxDate,
        onScrubberChangeByAnim,
        onTimelineEnd,
      } = animPropsRef.current;

      const elapsed = getClockElapsedTime();
      const delta = elapsed - lastTimeRef.current;
      lastTimeRef.current = elapsed;

      // Parallax stars
      if (starfieldNearRef.current && starfieldFarRef.current && cameraRef.current) {
        const cam = cameraRef.current.position.length();
        starfieldNearRef.current.rotation.y += delta * 0.002;
        starfieldFarRef.current.rotation.y += delta * 0.001;
        starfieldNearRef.current.position.z = -cam * 0.02;
        starfieldFarRef.current.position.z = -cam * 0.05;
      }

      // Orbits
      const ORBIT_SPEED_SCALE = 2000;
      Object.values(celestialBodiesRef.current).forEach((body) => {
        const d = body.userData as PlanetData | undefined;
        if (!d || !d.orbitalPeriodDays) return;
        const angVel = (2 * Math.PI) / (d.orbitalPeriodDays * 86400) * ORBIT_SPEED_SCALE;
        const angle = d.angle + angVel * elapsed;

        if (!d.orbits) {
          body.mesh.position.x = d.radius * Math.sin(angle);
          body.mesh.position.z = d.radius * Math.cos(angle);
        } else {
          // child around parent (already parented)
          body.mesh.position.x = d.radius * Math.sin(angle);
          body.mesh.position.z = d.radius * Math.cos(angle);
        }
      });

      // L1 position relative to Earth
      const l1Body = celestialBodiesRef.current['L1'];
      const earthBody = celestialBodiesRef.current['EARTH'];
      if (l1Body && earthBody) {
        const earthPos = new THREE.Vector3();
        earthBody.mesh.getWorldPosition(earthPos);
        const dir = earthPos.clone().normalize();
        const l1Data = l1Body.userData as POIData;
        const l1Pos = earthPos.clone().sub(dir.multiplyScalar(l1Data.distanceFromParent));
        l1Body.mesh.position.copy(l1Pos);
        l1Body.mesh.lookAt(earthPos);
      }

      // Sun uniforms and Earth special layers
      if (celestialBodiesRef.current.SUN) {
        (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsed;
      }
      if (earthBody) {
        earthBody.mesh.rotation.y += 0.05 * delta;
        earthBody.mesh.children.forEach((child: any) => {
          if (child.material?.uniforms?.uTime) {
            child.material.uniforms.uTime.value = elapsed;
          }
        });
      }

      // Timeline vs live
      if (timelineActive) {
        if (timelinePlaying) {
          const range = timelineMaxDate - timelineMinDate;
          if (range > 0 && timelineValueRef.current < 1000) {
            const simHoursPerSec = 3 * timelineSpeed;
            const simMsPerSec = simHoursPerSec * 3600 * 1000;
            const simMs = delta * simMsPerSec;
            const add = (simMs / range) * 1000;
            const newVal = timelineValueRef.current + add;

            if (newVal >= 1000) {
              timelineValueRef.current = 1000;
              onTimelineEnd();
            } else {
              timelineValueRef.current = newVal;
            }
            onScrubberChangeByAnim(timelineValueRef.current);
          }
        }

        const currentTime = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        cmeGroupRef.current.children.forEach((obj: any) => {
          const cme: ProcessedCME = obj.userData;
          if (!cme) return;
          const tSec = (currentTime - cme.startTime.getTime()) / 1000;
          if (tSec < 0) {
            updateCMEShape(obj, -1);
          } else {
            const dist = calculateDistance(cme, tSec, false);
            updateCMEShape(obj, dist);
          }
        });
      } else {
        cmeGroupRef.current.children.forEach((obj: any) => {
          const cme: ProcessedCME = obj.userData;
          if (!cme) return;

          let dist = 0;
          if (modeledId && cme.id === modeledId) {
            const simStart = cme.simulationStartTime !== undefined ? cme.simulationStartTime : elapsed;
            const t = Math.max(0, elapsed - simStart);
            dist = calculateDistance(cme, t, true);
          } else if (!modeledId) {
            const t = Math.max(0, (Date.now() - cme.startTime.getTime()) / 1000);
            dist = calculateDistance(cme, t, false);
          } else {
            updateCMEShape(obj, -1);
            return;
          }
          updateCMEShape(obj, dist);
        });
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsed);

      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      if (particleTextureCache) {
        particleTextureCache.dispose();
        particleTextureCache = null;
      }
      if (coronaTextureCache) {
        coronaTextureCache.dispose();
        coronaTextureCache = null;
      }
      try {
        rendererRef.current?.dispose();
      } catch {}
      cancelAnimationFrame(rafId);
      sceneRef.current?.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
          else obj.material.dispose();
        }
      });
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE, dataVersion]);

  // ---------- Build CMEs ----------
  useEffect(() => {
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    // Clear old
    while (cmeGroupRef.current.children.length > 0) {
      const child = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const mat = (child as any).material;
        if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
        else mat.dispose();
      }
    }

    const pTex = createRadialParticleTexture(THREE);

    cmeData.forEach((cme) => {
      const group = new THREE.Group();
      group.userData = cme;

      // Particle cone
      const particleCount = getCmeParticleCount(THREE, cme.speed);
      const positions: number[] = [];
      const colors: number[] = [];

      const coneHalfAngle = THREE.MathUtils.degToRad(cme.halfAngle);
      const unitH = 1; // scale later
      const coneR = unitH * Math.tan(coneHalfAngle);
      const bulge = 0.55;

      const shockColor = new THREE.Color(0xffb0a0);
      const wakeColor = new THREE.Color(0x88aaff);
      const coreColor = getCmeCoreColor(THREE, cme.speed);

      for (let i = 0; i < particleCount; i++) {
        const y = unitH * Math.cbrt(Math.random()); // denser near base
        const rAtY = (y / unitH) * coneR;
        const theta = Math.random() * Math.PI * 2;
        const r = (coneR > 0 ? Math.sqrt(Math.random()) * rAtY : 0);

        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);

        const nr = r / coneR;
        const yOff = bulge * (1 - nr * nr);
        const fY = y * (1 + yOff);

        positions.push(x, fY, z);

        // longitudinal gradient color
        const rp = y / unitH;
        const final = new THREE.Color();
        const wakeEnd = 0.28;
        const coreEnd = 0.88;
        if (rp < wakeEnd) {
          const t = rp / wakeEnd;
          final.copy(wakeColor).lerp(coreColor, t);
        } else if (rp < coreEnd) {
          final.copy(coreColor);
        } else {
          const t = (rp - coreEnd) / (1 - coreEnd);
          final.copy(coreColor).lerp(shockColor, t);
        }
        colors.push(final.r, final.g, final.b);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: getCmeParticleSize(THREE, cme.speed, SCENE_SCALE),
        sizeAttenuation: true,
        map: pTex,
        transparent: true,
        opacity: getCmeOpacity(THREE, cme.speed),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
      });
      const particles = new THREE.Points(geo, mat);
      particles.name = 'particles';
      group.add(particles);

      // Shock shell (soft sphere that expands faintly)
      const shockGeo = new THREE.SphereGeometry(1, 32, 32);
      const shockMat = new THREE.MeshBasicMaterial({
        color: 0xffddaa,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const shock = new THREE.Mesh(shockGeo, shockMat);
      shock.name = 'shock-shell';
      group.add(shock);

      // Tail – a skinny cone-ish line behind the CME that fades as it grows
      const tailGeo = new THREE.CylinderGeometry(0.001 * SCENE_SCALE, 0.03 * SCENE_SCALE, 1, 8, 1, true);
      const tailMat = new THREE.MeshBasicMaterial({
        color: 0xffaa66,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.name = 'tail';
      // align tail opposite local Y (we'll flip in world via quaternion orientation)
      tail.position.set(0, -0.5, 0);
      group.add(tail);

      // Direction from latitude/longitude
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - cme.latitude),
        THREE.MathUtils.degToRad(cme.longitude)
      );
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      cmeGroupRef.current.add(group);
    });
  }, [cmeData, THREE, getClockElapsedTime]);

  // Handle single-CME focus visibility + restart its sim clock
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

    // Prediction line (Sun -> Earth)
    if (!THREE || !sceneRef.current) return;
    if (predictionLineRef.current) {
      sceneRef.current.remove(predictionLineRef.current);
      predictionLineRef.current.geometry.dispose();
      predictionLineRef.current.material.dispose();
      predictionLineRef.current = null;
    }

    const cme = cmeData.find((c) => c.id === currentlyModeledCMEId);
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
        gapSize: 0.02 * SCENE_SCALE,
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.visible = !!currentlyModeledCMEId;
      sceneRef.current.add(line);
      predictionLineRef.current = line;
    }
  }, [currentlyModeledCMEId, cmeData, THREE, getClockElapsedTime]);

  // Camera moves
  const moveCamera = useCallback(
    (view: ViewMode, focus: FocusTarget | null) => {
      if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;

      const target = new THREE.Vector3(0, 0, 0);
      if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) {
        celestialBodiesRef.current.EARTH.mesh.getWorldPosition(target);
      }

      const cam = new THREE.Vector3();
      if (view === ViewMode.TOP) {
        cam.set(target.x, target.y + SCENE_SCALE * 4.2, target.z + 0.01);
      } else {
        cam.set(target.x + SCENE_SCALE * 1.9, target.y + SCENE_SCALE * 0.35, target.z);
      }

      gsap.to(cameraRef.current.position, {
        duration: 1.2,
        x: cam.x,
        y: cam.y,
        z: cam.z,
        ease: 'power2.inOut',
      });
      gsap.to(controlsRef.current.target, {
        duration: 1.2,
        x: target.x,
        y: target.y,
        z: target.z,
        ease: 'power2.inOut',
        onUpdate: () => controlsRef.current.update(),
      });
    },
    [gsap, THREE]
  );

  useEffect(() => {
    moveCamera(activeView, focusTarget);
  }, [activeView, focusTarget, dataVersion, moveCamera]);

  React.useImperativeHandle(
    ref,
    () => ({
      resetView: () => {
        moveCamera(ViewMode.TOP, FocusTarget.EARTH);
      },
    }),
    [moveCamera]
  );

  // Force MOVE mode cursor (no select)
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'move';
    }
  }, [interactionMode]);

  // Extra planets toggle
  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    const extra = ['MERCURY', 'VENUS', 'MARS'];
    extra.forEach((n) => {
      const b = celestialBodiesRef.current[n];
      const o = orbitsRef.current[n];
      if (b) b.mesh.visible = showExtraPlanets;
      if (o) o.visible = showExtraPlanets;
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
      const moonOrbit = earthMesh.children.find((c: any) => c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);

  // ---------- Impact checking & effects ----------
  const checkImpacts = useCallback((): number => {
    if (!THREE || !cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;

    let maxImpactSpeed = 0;
    const earthPos = new THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);

    cmeGroupRef.current.children.forEach((obj: any) => {
      const cme: ProcessedCME = obj.userData;
      if (!cme || !obj.visible) return;

      // approximate CME tip world position (cone tip direction * current scale + obj position)
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
      const tipWorld = obj.position.clone().add(dir.clone().multiplyScalar(obj.scale.y));
      const d = tipWorld.distanceTo(earthPos);

      // Threshold: “impact” if within near-Earth vicinity
      const impactRadius = PLANET_DATA_MAP.EARTH.size * 2.2;
      if (d < impactRadius) {
        if (cme.speed > maxImpactSpeed) maxImpactSpeed = cme.speed;
      }
    });

    return maxImpactSpeed;
  }, [THREE]);

  const updateImpactEffects = useCallback(
    (maxImpactSpeed: number, elapsed: number) => {
      const earth = celestialBodiesRef.current.EARTH?.mesh;
      if (!earth) return;

      const aurora = earth.children.find((c: any) => c.name === 'aurora');
      const atmosphere = earth.children.find((c: any) => c.name === 'atmosphere');

      const hitBoost = Math.min(1, maxImpactSpeed / 2000);

      if (aurora?.material?.uniforms) {
        aurora.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
        // When impacted, pulse brighter
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.5);
        (aurora.material as any).opacity = 0.18 + hitBoost * 0.32 * pulse;
      }

      if (atmosphere?.material?.uniforms) {
        // brief intensification
        (atmosphere.material as any).opacity = 0.12 + hitBoost * 0.2;
        atmosphere.material.uniforms.uImpactTime.value = hitBoost > 0 ? elapsed : 0.0;
      }
    },
    []
  );

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
