// --- START OF FILE src/components/SimulationCanvas.tsx ---

import React, { useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import {
  ProcessedCME, ProcessedHSS, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle
} from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER,
  FLUX_ROPE_VERTEX_SHADER, FLUX_ROPE_FRAGMENT_SHADER,
  HSS_VERTEX_SHADER, HSS_FRAGMENT_SHADER
} from '../constants';

const TEX = {
  EARTH_DAY: "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg",
  EARTH_NORMAL: "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_normal_2048.jpg",
  EARTH_SPEC: "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_specular_2048.jpg",
  EARTH_CLOUDS: "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png",
  MOON: "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/moon_1024.jpg",
  SUN_PHOTOSPHERE: "https://upload.wikimedia.org/wikipedia/commons/c/cb/Solarsystemscope_texture_2k_sun.jpg",
  MILKY_WAY: "https://upload.wikimedia.org/wikipedia/commons/6/60/ESO_-_Milky_Way.jpg",
};

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

let arrowTextureCache: any = null;
const createArrowTexture = (THREE: any) => {
  if (arrowTextureCache) return arrowTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  
  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  const arrowWidth = size / 6;
  const arrowHeight = size / 4;
  const spacing = size / 3;

  for (let x = -arrowWidth; x < size + spacing; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, size * 0.5);
    ctx.lineTo(x + arrowWidth, size * 0.5 - arrowHeight / 2);
    ctx.lineTo(x + arrowWidth, size * 0.5 + arrowHeight / 2);
    ctx.closePath();
    ctx.fill();
  }
  
  arrowTextureCache = new THREE.CanvasTexture(canvas);
  arrowTextureCache.wrapS = THREE.RepeatWrapping;
  arrowTextureCache.wrapT = THREE.RepeatWrapping;
  return arrowTextureCache;
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

const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v));

interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  hssData: ProcessedHSS[];
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
  showHSS: boolean;
  dataVersion: number;
  interactionMode: InteractionMode;
  onSunClick?: () => void;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData, hssData, activeView, focusTarget, currentlyModeledCMEId, timelineActive,
    timelinePlaying, timelineSpeed, timelineValue, timelineMinDate, timelineMaxDate,
    setPlanetMeshesForLabels, setRendererDomElement, onCameraReady, getClockElapsedTime,
    resetClock, onScrubberChangeByAnim, onTimelineEnd, showExtraPlanets, showMoonL1,
    showFluxRope, showHSS, dataVersion, interactionMode, onSunClick,
  } = props;

  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const cmeGroupRef = useRef<any>(null);
  const hssGroupRef = useRef<any>(null);
  const celestialBodiesRef = useRef<Record<string, CelestialBody>>({});
  const orbitsRef = useRef<Record<string, any>>({});
  const predictionLineRef = useRef<any>(null);
  const fluxRopeRef = useRef<any>(null);
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
    showFluxRope, showHSS
  });

  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
      timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
      showFluxRope, showHSS
    };
  }, [
    onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
    showFluxRope, showHSS
  ]);

  const THREE = (window as any).THREE;
  const gsap = (window as any).gsap;

  useEffect(() => { timelineValueRef.current = timelineValue; }, [timelineValue]);

  const MIN_CME_SPEED_KMS = 300;

  const calculateDistanceWithDeceleration = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    const u_kms = cme.speed;
    const t_s = Math.max(0, timeSinceEventSeconds);
    if (u_kms <= MIN_CME_SPEED_KMS) {
        return (u_kms * t_s / AU_IN_KM) * SCENE_SCALE;
    }
    const a_ms2 = 1.41 - 0.0035 * u_kms;
    const a_kms2 = a_ms2 / 1000.0;

    if (a_kms2 >= 0) {
        return ((u_kms * t_s + 0.5 * a_kms2 * t_s * t_s) / AU_IN_KM) * SCENE_SCALE;
    }
    
    const time_to_floor_s = (MIN_CME_SPEED_KMS - u_kms) / a_kms2;
    let distance_km;
    if (t_s < time_to_floor_s) {
        distance_km = (u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s);
    } else {
        const distance_during_decel = (u_kms * time_to_floor_s) + (0.5 * a_kms2 * time_to_floor_s * time_to_floor_s);
        distance_km = distance_during_decel + MIN_CME_SPEED_KMS * (t_s - time_to_floor_s);
    }
    return (distance_km / AU_IN_KM) * SCENE_SCALE;
  }, []);

  const calculateDistanceByInterpolation = useCallback((cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    if (!cme.predictedArrivalTime) return 0;
    const earthOrbitRadiusActualAU = PLANET_DATA_MAP.EARTH.radius / SCENE_SCALE;
    const totalTravelTimeSeconds = (cme.predictedArrivalTime.getTime() - cme.startTime.getTime()) / 1000;
    if (totalTravelTimeSeconds <= 0) return 0;
    return (Math.min(1.0, timeSinceEventSeconds / totalTravelTimeSeconds) * earthOrbitRadiusActualAU) * SCENE_SCALE;
  }, []);

  const updateCMEShape = useCallback((cmeObject: any, distTraveledInSceneUnits: number) => {
    if (!THREE) return;
    const sunRadius = PLANET_DATA_MAP.SUN.size;
    if (distTraveledInSceneUnits < 0) { cmeObject.visible = false; return; }
    cmeObject.visible = true;
    const cmeLength = Math.max(0, distTraveledInSceneUnits - sunRadius);
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
    cmeObject.position.copy(direction.clone().multiplyScalar(sunRadius));
    cmeObject.scale.set(cmeLength, cmeLength, cmeLength);
  }, [THREE]);

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


  useEffect(() => {
    if (!mountRef.current || !THREE || rendererRef.current) return;

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
    const tex = {
      earthDay: loader.load(TEX.EARTH_DAY), earthNormal: loader.load(TEX.EARTH_NORMAL),
      earthSpec: loader.load(TEX.EARTH_SPEC), earthClouds: loader.load(TEX.EARTH_CLOUDS),
      moon: loader.load(TEX.MOON), sunPhoto: loader.load(TEX.SUN_PHOTOSPHERE),
      milkyWay: loader.load(TEX.MILKY_WAY),
    };
    tex.milkyWay.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex.milkyWay;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.PointLight(0xffffff, 2.4, 300 * SCENE_SCALE));

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true; // Explicitly enable
    controls.enableRotate = true; // Explicitly enable
    controls.enablePan = true; // Explicitly enable
    controlsRef.current = controls;

    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    hssGroupRef.current = new THREE.Group();
    scene.add(hssGroupRef.current);

    const fluxRopeGeometry = new THREE.TorusGeometry(1.0, 0.05, 16, 100);
    const fluxRopeMaterial = new THREE.ShaderMaterial({
      vertexShader: FLUX_ROPE_VERTEX_SHADER,
      fragmentShader: FLUX_ROPE_FRAGMENT_SHADER,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 1.0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    fluxRopeRef.current = new THREE.Mesh(fluxRopeGeometry, fluxRopeMaterial);
    fluxRopeRef.current.rotation.x = Math.PI / 2;
    fluxRopeRef.current.visible = false;
    scene.add(fluxRopeRef.current);

    const makeStars = (count: number, spread: number, size: number) => {
      const verts: number[] = [];
      for (let i = 0; i < count; i++) verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE), THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: size * SCENE_SCALE, sizeAttenuation: true, transparent: true, opacity: 0.95 }));
    };
    starsNearRef.current = makeStars(30000, 250, 0.012);
    starsFarRef.current  = makeStars(20000, 300, 0.006);
    scene.add(starsNearRef.current);
    scene.add(starsFarRef.current);

    const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER, transparent: true });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;
      const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), new THREE.MeshPhongMaterial({ color: data.color }));
      planetMesh.position.x = data.radius * Math.sin(data.angle);
      planetMesh.position.z = data.radius * Math.cos(data.angle);
      planetMesh.userData = data;
      scene.add(planetMesh);
      celestialBodiesRef.current[name] = { mesh: planetMesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: planetMesh });

      if (name === 'EARTH') {
        planetMesh.material = new THREE.MeshPhongMaterial({ map: tex.earthDay, normalMap: tex.earthNormal, specularMap: tex.earthSpec });
        const clouds = new THREE.Mesh( new THREE.SphereGeometry(data.size * 1.01, 48, 48), new THREE.MeshLambertMaterial({ map: tex.earthClouds, transparent: true, opacity: 0.7 }) );
        clouds.name = 'clouds'; planetMesh.add(clouds);
        const aurora = new THREE.Mesh( new THREE.SphereGeometry(data.size * 1.25, 64, 64), new THREE.ShaderMaterial({ vertexShader: AURORA_VERTEX_SHADER, fragmentShader: AURORA_FRAGMENT_SHADER, blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0.0 }, uCmeSpeed: { value: 0.0 }, uImpactTime: { value: 0.0 }, uAuroraMinY: { value: 0.5 }, uAuroraIntensity: { value: 0.0 } } }) );
        aurora.name = 'aurora'; planetMesh.add(aurora);
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
      const moonMesh = new THREE.Mesh( new THREE.SphereGeometry(data.size, 16, 16), new THREE.MeshPhongMaterial({ color: data.color, map: name === 'MOON' ? tex.moon : null }) );
      moonMesh.userData = data;
      parentBody.mesh.add(moonMesh);
      celestialBodiesRef.current[name] = { mesh: moonMesh, name: data.name, labelId: data.labelElementId, userData: data };
      if (name === 'MOON') planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh: moonMesh });
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
        // IMPORTANT: Do not stop propagation here, or OrbitControls won't receive the event.
    };

    const handlePointerUp = (event: PointerEvent) => {
        const upTime = Date.now();
        const deltaTime = upTime - pointerDownTime.current;
        const deltaX = Math.abs(event.clientX - pointerDownPosition.current.x);
        const deltaY = Math.abs(event.clientY - pointerDownPosition.current.y);
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Only trigger sun click if it was a quick tap (not a drag)
        if (deltaTime < 200 && distance < 10) {
            if (!mountRef.current || !cameraRef.current || !raycasterRef.current || !mouseRef.current || !sceneRef.current) return;
            
            const rect = mountRef.current.getBoundingClientRect();
            mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
            
            const sunObject = celestialBodiesRef.current['SUN']?.mesh;
            if (sunObject) {
                const intersects = raycasterRef.current.intersectObject(sunObject);
                if (intersects.length > 0 && onSunClick) {
                    onSunClick();
                }
            }
        }
    };

    if (renderer.domElement) {
        renderer.domElement.addEventListener('pointerdown', handlePointerDown);
        renderer.domElement.addEventListener('pointerup', handlePointerUp);
    }

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const { currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate, onScrubberChangeByAnim, onTimelineEnd, showFluxRope, showHSS } = animPropsRef.current;

      const elapsedTime = getClockElapsedTime();
      const delta = elapsedTime - lastTimeRef.current;
      lastTimeRef.current = elapsedTime;

      if (starsNearRef.current) starsNearRef.current.rotation.y += 0.00015;
      if (starsFarRef.current)  starsFarRef.current.rotation.y  += 0.00009;

      Object.values(celestialBodiesRef.current).forEach(body => {
        const d = body.userData as PlanetData;
        if (d?.orbitalPeriodDays) {
          const a = d.angle + ((2 * Math.PI) / (d.orbitalPeriodDays * 24 * 3600) * 2000) * elapsedTime;
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

      cmeGroupRef.current.children.forEach((c: any) => c.material.opacity = getCmeOpacity(c.userData.speed));

      if (fluxRopeRef.current) {
        fluxRopeRef.current.visible = showFluxRope && !!currentlyModeledCMEId;
        if (fluxRopeRef.current.visible) {
            const cmeObject = cmeGroupRef.current.children.find((c: any) => c.userData.id === currentlyModeledCMEId);
            if (cmeObject) {
                fluxRopeRef.current.position.copy(cmeObject.position);
                fluxRopeRef.current.quaternion.copy(cmeObject.quaternion);
                const cme: ProcessedCME = cmeObject.userData;
                const coneRadius = cmeObject.scale.y * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle));
                fluxRopeRef.current.scale.set(coneRadius, coneRadius, coneRadius);
                const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeObject.quaternion);
                fluxRopeRef.current.position.add(dir.clone().multiplyScalar(cmeObject.scale.y));
                fluxRopeRef.current.material.uniforms.uColor.value = getCmeCoreColor(cme.speed);
            }
        }
        fluxRopeRef.current.material.uniforms.uTime.value = elapsedTime;
      }

      if (hssGroupRef.current) {
        hssGroupRef.current.visible = showHSS;
        hssGroupRef.current.children.forEach((hssMesh: any) => {
            if (hssMesh.material.uniforms) {
                hssMesh.material.uniforms.uTime.value = elapsedTime;
                hssMesh.rotation.y -= 0.01 * delta; 
            }
        });
      }

      if (timelineActive) {
         if (timelinePlaying) {
             const r = timelineMaxDate - timelineMinDate;
             if (r > 0 && timelineValueRef.current < 1000) {
                 const v = timelineValueRef.current + (delta * (3 * timelineSpeed * 3600 * 1000) / r) * 1000;
                 if (v >= 1000) { timelineValueRef.current = 1000; onTimelineEnd(); } else timelineValueRef.current = v;
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
              if (currentlyModeledCMEId && c.userData.id === currentlyModeledCMEId) {
                  const t = elapsedTime - (c.userData.simulationStartTime ?? elapsedTime);
                  if (c.userData.isEarthDirected && c.userData.predictedArrivalTime) {
                    const d = calculateDistanceByInterpolation(c.userData, t < 0 ? 0 : t);
                    updateCMEShape(c, d);
                  } else {
                    updateCMEShape(c, calculateDistanceWithDeceleration(c.userData, t));
                  }
              } else if (!currentlyModeledCMEId) {
                   const t = (Date.now() - c.userData.startTime.getTime()) / 1000;
                   updateCMEShape(c, calculateDistanceWithDeceleration(c.userData, t));
              } else {
                  c.visible = false;
              }
          });
      }
      
      const earth = celestialBodiesRef.current.EARTH?.mesh;
      if (earth) {
        // Logic for earth impacts can go here
      }

      // VITAL: This must be called to enable interactions
      if (controlsRef.current) {
        controlsRef.current.update();
      }
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
        if (arrowTextureCache) { arrowTextureCache.dispose?.(); arrowTextureCache = null; }
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
  }, [dataVersion]);

  // Build CME particle systems
  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    while (cmeGroupRef.current.children.length > 0) {
      const c = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(c);
      if ((c as any).geometry) (c as any).geometry.dispose();
    }

    const particleTexture = createParticleTexture(THREE);

    cmeData.forEach(cme => {
      const pCount = getCmeParticleCount(cme.speed);
      const pos: number[] = [];
      const colors: number[] = [];
      const halfAngle = THREE.MathUtils.degToRad(cme.halfAngle);
      const coneRadius = 1 * Math.tan(halfAngle);
      const shockColor = new THREE.Color(0xffaaaa);
      const wakeColor = new THREE.Color(0x8888ff);
      const coreColor = getCmeCoreColor(cme.speed);

      for (let i = 0; i < pCount; i++) {
        const y = Math.cbrt(Math.random());
        const rAtY = y * coneRadius;
        const theta = Math.random() * 2 * Math.PI;
        const r = coneRadius > 0 ? Math.sqrt(Math.random()) * rAtY : 0;
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        pos.push(x, y * (1 + 0.5 * (1 - (r / coneRadius) ** 2)), z);

        const relPos = y;
        const finalColor = new THREE.Color();
        if (relPos < 0.1) finalColor.copy(wakeColor).lerp(coreColor, relPos / 0.1);
        else if (relPos < 0.3) finalColor.copy(coreColor);
        else finalColor.copy(coreColor).lerp(shockColor, (relPos - 0.3) / 0.7);
        colors.push(finalColor.r, finalColor.g, finalColor.b);
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const mat = new THREE.PointsMaterial({
        size: getCmeParticleSize(cme.speed, SCENE_SCALE),
        sizeAttenuation: true,
        map: particleTexture,
        transparent: true,
        opacity: getCmeOpacity(cme.speed),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true
      });

      const system = new THREE.Points(geom, mat);
      system.userData = cme;
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cme.latitude), THREE.MathUtils.degToRad(cme.longitude));
      system.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cmeGroupRef.current.add(system);
    });
  }, [cmeData, getClockElapsedTime]);

  // CME Visibility & Prediction Line
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
      sceneRef.current.add(l);
      predictionLineRef.current = l;
    }
  }, [currentlyModeledCMEId, cmeData, getClockElapsedTime]);

  // HSS Generation
  useEffect(() => {
      const THREE = (window as any).THREE;
      if (!THREE || !hssGroupRef.current || !sceneRef.current) return;

      while(hssGroupRef.current.children.length > 0){ 
        const child = hssGroupRef.current.children[0];
        hssGroupRef.current.remove(child);
        if(child.geometry) child.geometry.dispose();
      }

      hssData.forEach(hss => {
          const points = [];
          const spiralTightness = 0.5; 
          for (let i = 0; i < 100; i++) {
              const r = i * 0.5 * SCENE_SCALE; 
              const theta = i * spiralTightness; 
              points.push(new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)));
          }
          const curve = new THREE.CatmullRomCurve3(points);
          const geometry = new THREE.TubeGeometry(curve, 64, 0.05 * SCENE_SCALE, 8, false);
          
          const material = new THREE.ShaderMaterial({
              vertexShader: HSS_VERTEX_SHADER,
              fragmentShader: HSS_FRAGMENT_SHADER,
              uniforms: { uTime: { value: 0 } },
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
          });
          
          const mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.y = Math.random() * Math.PI * 2; 
          hssGroupRef.current.add(mesh);
      });
  }, [hssData]);

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

  useImperativeHandle(ref, () => ({
    resetView: () => moveCamera(ViewMode.TOP, FocusTarget.EARTH),
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
        const graphEndTime = graphStartTime + 7 * 24 * 3600 * 1000; 
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
                        const cmeThickness = SCENE_SCALE * 0.3; 
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

  return (
    <div 
        ref={mountRef} 
        className="w-full h-full" 
        style={{ touchAction: 'none' }} // CRITICAL FOR MOBILE ORBIT CONTROLS
    />
  );
};

export default React.forwardRef(SimulationCanvas);
// --- END OF FILE src/components/SimulationCanvas.tsx ---