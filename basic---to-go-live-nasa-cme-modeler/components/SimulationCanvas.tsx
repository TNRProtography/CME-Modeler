import React, { useRef, useEffect, useCallback } from 'react';
import {
  ProcessedCME, ViewMode, FocusTarget, CelestialBody, PlanetLabelInfo, POIData, PlanetData,
  InteractionMode, SimulationCanvasHandle
} from '../types';
import {
  PLANET_DATA_MAP, POI_DATA_MAP, SCENE_SCALE, AU_IN_KM,
  SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER,
  EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER,
  AURORA_VERTEX_SHADER, AURORA_FRAGMENT_SHADER
} from '../constants';

/**
 * CME MODEL OVERVIEW
 * ------------------
 * • Kinematics: Drag-Based Model (DBM) in km, then -> AU -> scene units.
 * • Shape: Particle "croissant" (GCS-flavored). Built as a bent-tube sweep (arc in YZ, tube around it).
 *   - Self-similar expansion: scale ∝ radial distance.
 *   - Width tied to halfAngle: tube thickness ~ r * tan(halfAngle) * 0.45 (tunable).
 * • Rendering: Points with additive blending + speed-tinted colors.
 * • Brightness heuristic: boosts for plane-of-sky (∝ sin² χ approx) for more realistic white-light look.
 * • Timeline + solo playback: preserved exactly.
 */

// ---------- Helpers & caches ----------
let particleTextureCache: any = null;

const createParticleTexture = (THREE: any) => {
  if (particleTextureCache) return particleTextureCache;
  if (!THREE || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  particleTextureCache = new (window as any).THREE.CanvasTexture(canvas);
  return particleTextureCache;
};

const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v));
const kmToScene = (km:number) => (km / AU_IN_KM) * SCENE_SCALE;

const getCmeOpacity = (THREE:any, speed:number):number => {
  if (!THREE) return 0.22;
  const minS=300, maxS=3000, minO=0.06, maxO=0.65;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return THREE.MathUtils.mapLinear(s, minS, maxS, minO, maxO);
};
const getCmeParticleCount = (THREE:any, speed:number):number => {
  if (!THREE) return 3200;
  const minS=300, maxS=3000, minP=1800, maxP=9500;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return Math.floor(THREE.MathUtils.mapLinear(s, minS, maxS, minP, maxP));
};
const getCmeParticleSize = (THREE:any, speed:number, scale:number):number => {
  if (!THREE) return 0.05 * scale;
  const minS=300, maxS=3000, minSz=0.035 * scale, maxSz=0.085 * scale;
  const s = THREE.MathUtils.clamp(speed, minS, maxS);
  return THREE.MathUtils.mapLinear(s, minS, maxS, minSz, maxSz);
};
const getCmeCoreColor = (THREE:any, speed:number): any => {
  if (!THREE) return { r:1, g:1, b:1, setHex:()=>{} };
  if (speed >= 2500) return new THREE.Color(0xff69b4);
  if (speed >= 1800) return new THREE.Color(0x9370db);
  if (speed >= 1000) return new THREE.Color(0xff4500);
  if (speed >= 800)  return new THREE.Color(0xffa500);
  if (speed >= 500)  return new THREE.Color(0xffff00);
  if (speed < 350)   return new THREE.Color(0x9a9a9a);
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  const t = THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1);
  return grey.lerp(yellow, t);
};

// ---------- DBM (drag-based model) ----------
type DBMParams = { w:number; gamma:number; r0_km:number };
const DBM_DEFAULTS: DBMParams = {
  w: 400,
  gamma: 1.5e-7,
  r0_km: 696340, // ~R☉ from center (solar surface)
};
function dbmSolve(t_sec:number, v0:number, params:DBMParams) {
  const { w, gamma, r0_km } = params;
  const dv0 = v0 - w;
  const denom = Math.max(1e-6, 1 + gamma * dv0 * Math.max(0, t_sec));
  const v = w + (dv0 / denom);
  const r = r0_km + w * t_sec + (1 / gamma) * Math.log(denom);
  return { r_km: r, v_km_s: v };
}

// ---------- Component ----------
interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void; // kept for API compatibility
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
  dataVersion: number;
  interactionMode: InteractionMode;
}

const SimulationCanvas: React.ForwardRefRenderFunction<SimulationCanvasHandle, SimulationCanvasProps> = (props, ref) => {
  const {
    cmeData, activeView, focusTarget, currentlyModeledCMEId,
    timelineActive, timelinePlaying, timelineSpeed, timelineValue,
    timelineMinDate, timelineMaxDate,
    setPlanetMeshesForLabels, setRendererDomElement, onCameraReady,
    getClockElapsedTime, resetClock, onScrubberChangeByAnim, onTimelineEnd,
    showExtraPlanets, showMoonL1, dataVersion, interactionMode
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

  const lastTimeRef = useRef(0);
  const timelineValueRef = useRef(timelineValue);
  const animPropsRef = useRef({
    onScrubberChangeByAnim, onTimelineEnd,
    currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed,
    timelineMinDate, timelineMaxDate
  });

  useEffect(() => {
    animPropsRef.current = {
      onScrubberChangeByAnim, onTimelineEnd,
      currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed,
      timelineMinDate, timelineMaxDate
    };
  }, [onScrubberChangeByAnim, onTimelineEnd, currentlyModeledCMEId, timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate]);

  useEffect(() => { timelineValueRef.current = timelineValue; }, [timelineValue]);

  const THREE = (window as any).THREE;
  const gsap = (window as any).gsap;

  // ---------- Scene init ----------
  useEffect(() => {
    if (!mountRef.current || !THREE) return;
    if (rendererRef.current) return;

    resetClock();
    lastTimeRef.current = getClockElapsedTime();

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.001 * SCENE_SCALE,
      120 * SCENE_SCALE
    );
    cameraRef.current = camera;
    onCameraReady(camera);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    setRendererDomElement(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.PointLight(0xffffff, 2.2, 300 * SCENE_SCALE);
    scene.add(key);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.12 * SCENE_SCALE;
    controls.maxDistance = 55 * SCENE_SCALE;
    controlsRef.current = controls;

    // Starfield
    const addStarLayer = (count: number, spread: number) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[3*i] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        pos[3*i+1] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
        pos[3*i+2] = THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size: 0.012 * SCENE_SCALE, transparent: true, opacity: 0.85 });
      return new THREE.Points(geo, mat);
    };
    scene.add(addStarLayer(12000, 260));
    scene.add(addStarLayer(20000, 440));

    // Sun
    const sunGeo = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
    const sunMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
      transparent: true
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sunMesh);
    celestialBodiesRef.current['SUN'] = { mesh: sunMesh, name: 'Sun', labelId: 'sun-label' };

    const planetLabelInfos: PlanetLabelInfo[] = [{ id: 'sun-label', name: 'Sun', mesh: sunMesh }];

    // Planets (orbits)
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (name === 'SUN' || data.orbits) return;

      const geo = new THREE.SphereGeometry(data.size, 32, 32);
      const mat = new THREE.MeshPhongMaterial({ color: data.color, shininess: 32, specular: 0x222222 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = data.radius * Math.sin(data.angle);
      mesh.position.z = data.radius * Math.cos(data.angle);
      mesh.userData = data;
      scene.add(mesh);
      celestialBodiesRef.current[name] = { mesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh });

      if (name === 'EARTH') {
        const d = data as PlanetData;

        const atmGeo = new THREE.SphereGeometry(d.size * 1.2, 32, 32);
        const atmMat = new THREE.ShaderMaterial({
          vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER, fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
          uniforms: { uImpactTime: { value: 0.0 }, uTime: { value: 0.0 } }
        });
        const atm = new THREE.Mesh(atmGeo, atmMat); atm.name = 'atmosphere'; mesh.add(atm);

        const aurGeo = new THREE.SphereGeometry(d.size * 1.25, 64, 64);
        const aurMat = new THREE.ShaderMaterial({
          vertexShader: AURORA_VERTEX_SHADER, fragmentShader: AURORA_FRAGMENT_SHADER,
          blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
          uniforms: { uTime: { value: 0.0 }, uCmeSpeed: { value: 0.0 }, uImpactTime: { value: 0.0 } }
        });
        const aur = new THREE.Mesh(aurGeo, aurMat); aur.name = 'aurora'; mesh.add(aur);
      }

      // Orbit tube
      const orbitPts: any[] = [];
      const segs = 128;
      for (let i=0;i<=segs;i++){
        const a = (i/segs)*Math.PI*2;
        orbitPts.push(new THREE.Vector3(Math.sin(a)*data.radius, 0, Math.cos(a)*data.radius));
      }
      const curve = new THREE.CatmullRomCurve3(orbitPts);
      const tube = new THREE.TubeGeometry(curve, segs, 0.005 * SCENE_SCALE, 8, true);
      const omat = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.6 });
      const orbit = new THREE.Mesh(tube, omat);
      scene.add(orbit);
      orbitsRef.current[name] = orbit;
    });

    // Moons
    Object.entries(PLANET_DATA_MAP).forEach(([name, data]) => {
      if (!data.orbits) return;
      const parent = celestialBodiesRef.current[data.orbits];
      if (!parent) return;

      const geo = new THREE.SphereGeometry(data.size, 16, 16);
      const mat = new THREE.MeshPhongMaterial({ color: data.color, shininess: 6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = data.radius * Math.sin(data.angle);
      mesh.position.z = data.radius * Math.cos(data.angle);
      mesh.userData = data;
      parent.mesh.add(mesh);
      celestialBodiesRef.current[name] = { mesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh });

      const pts:any[] = []; const segs = 64;
      for (let i=0;i<=segs;i++){
        const a=(i/segs)*Math.PI*2;
        pts.push(new THREE.Vector3(Math.sin(a)*data.radius, 0, Math.cos(a)*data.radius));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, segs, 0.003 * SCENE_SCALE, 8, true);
      const omat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 });
      const orbit = new THREE.Mesh(tube, omat); orbit.name = 'moon-orbit';
      parent.mesh.add(orbit);
    });

    // Lagrange/POIs
    Object.entries(POI_DATA_MAP).forEach(([name, data]) => {
      const geo = new THREE.TetrahedronGeometry(data.size, 0);
      const mat = new THREE.MeshBasicMaterial({ color: data.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = data;
      scene.add(mesh);
      celestialBodiesRef.current[name] = { mesh, name: data.name, labelId: data.labelElementId, userData: data };
      planetLabelInfos.push({ id: data.labelElementId, name: data.name, mesh });
    });

    setPlanetMeshesForLabels(planetLabelInfos);

    const onResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // CME container
    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    // Animation loop
    let raf=0;
    const animate = () => {
      raf = requestAnimationFrame(animate);

      const {
        currentlyModeledCMEId: modeledId,
        timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate,
        onScrubberChangeByAnim, onTimelineEnd
      } = animPropsRef.current;

      const elapsed = getClockElapsedTime();
      const delta = elapsed - lastTimeRef.current;
      lastTimeRef.current = elapsed;

      // Orbits + uniforms
      const ORBIT_SPEED_SCALE = 2000;
      Object.values(celestialBodiesRef.current).forEach(body => {
        const d = body.userData as PlanetData | undefined;
        if (!d || !d.orbitalPeriodDays) return;
        const angVel = (2*Math.PI) / (d.orbitalPeriodDays*86400) * ORBIT_SPEED_SCALE;
        const angle = d.angle + angVel * elapsed;
        body.mesh.position.x = d.radius * Math.sin(angle);
        body.mesh.position.z = d.radius * Math.cos(angle);
      });
      if (celestialBodiesRef.current.SUN) {
        (celestialBodiesRef.current.SUN.mesh.material as any).uniforms.uTime.value = elapsed;
      }
      const earthBody = celestialBodiesRef.current.EARTH;
      if (earthBody) {
        earthBody.mesh.rotation.y += 0.05 * delta;
        earthBody.mesh.children.forEach((child:any)=>{
          if (child.material?.uniforms?.uTime) child.material.uniforms.uTime.value = elapsed;
        });
      }

      // Timeline vs live
      if (timelineActive) {
        if (timelinePlaying) {
          const range = timelineMaxDate - timelineMinDate;
          if (range > 0 && timelineValueRef.current < 1000) {
            const simHoursPerSec = 3 * timelineSpeed;
            const simMsPerSec = simHoursPerSec * 3600 * 1000;
            const add = (delta * simMsPerSec / range) * 1000;
            const val = timelineValueRef.current + add;
            timelineValueRef.current = val >= 1000 ? 1000 : val;
            if (val >= 1000) onTimelineEnd();
            onScrubberChangeByAnim(timelineValueRef.current);
          }
        }
        const currentTime = timelineMinDate + (timelineMaxDate - timelineMinDate) * (timelineValueRef.current / 1000);
        updateCMEsByTime(currentTime);
      } else {
        updateCMEsLive(elapsed, modeledId);
      }

      const maxImpactSpeed = checkImpacts();
      updateImpactEffects(maxImpactSpeed, elapsed);

      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      if (mountRef.current && rendererRef.current) mountRef.current.removeChild(rendererRef.current.domElement);
      try { rendererRef.current?.dispose(); } catch {}
      cancelAnimationFrame(raf);
      sceneRef.current?.traverse((obj:any)=>{
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m:any)=>m.dispose());
          else obj.material.dispose();
        }
      });
      rendererRef.current = null;
      if (particleTextureCache) { particleTextureCache.dispose?.(); particleTextureCache = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [THREE, dataVersion]);

  // ---------- Build particle “croissant” CMEs ----------
  useEffect(() => {
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    // Clear
    while (cmeGroupRef.current.children.length > 0) {
      const child = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const m = (child as any).material;
        if (Array.isArray(m)) m.forEach((x:any)=>x.dispose()); else m.dispose();
      }
    }

    const pTex = createParticleTexture(THREE);

    cmeData.forEach((cme) => {
      // Group per CME, oriented later
      const group = new THREE.Group();
      group.userData = { ...cme, simStart: 0, currentRScene: 0, currentSpeed: cme.speed };

      // --- Build a UNIT croissant particle cloud (scale later) ---
      // Centerline curve (croissant arc) in YZ-plane; we sweep a circular tube around it.
      // Unit major radius R_unit = 1. Tube radius a_unit depends on halfAngle.
      const R_unit = 1;
      const halfAngleRad = THREE.MathUtils.degToRad(cme.halfAngle);
      const a_unit = clamp(Math.tan(halfAngleRad) * 0.45, 0.08, 0.6); // tube radius ~ width proxy

      // Arc extent (controls how open the croissant is)
      const sMax = clamp(halfAngleRad * 1.15, 0.4, 1.1); // radians of centerline arc to each side

      const particleCount = getCmeParticleCount(THREE, cme.speed);
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);

      const coreColor = getCmeCoreColor(THREE, cme.speed);
      const shockColor = new THREE.Color(0xffb0a0);
      const wakeColor = new THREE.Color(0x88bbff);

      // Random sampling along arc (s) and tube angle (t)
      for (let i=0;i<particleCount;i++){
        // Bias toward front (positive s) to show shock a bit more
        const u = Math.random();
        const s = THREE.MathUtils.lerp(-sMax, sMax, Math.pow(u, 0.8));

        // Tube angle
        const t = Math.random() * Math.PI * 2;

        // Centerline (YZ arc) of radius R_unit
        // C(s) = (0, R*sin s, R*(1 - cos s))
        const Cy = R_unit * Math.sin(s);
        const Cz = R_unit * (1 - Math.cos(s));
        const C = new THREE.Vector3(0, Cy, Cz);

        // Tangent T = dC/ds normalized => (0, R*cos s, R*sin s)
        const Ty = R_unit * Math.cos(s);
        const Tz = R_unit * Math.sin(s);
        const T = new THREE.Vector3(0, Ty, Tz).normalize();

        // Binormal B fixed along +X (since curve lies in YZ plane)
        const B = new THREE.Vector3(1,0,0);
        // Normal N = T x B (perp within YZ plane)
        const N = new THREE.Vector3().crossVectors(T, B).normalize();

        // Tube offset: a_unit * (cos t * N + sin t * B)
        const offset = new THREE.Vector3().copy(N).multiplyScalar(Math.cos(t)*a_unit)
                          .add(new THREE.Vector3().copy(B).multiplyScalar(Math.sin(t)*a_unit));

        const P = new THREE.Vector3().copy(C).add(offset);

        positions[3*i+0] = P.x;
        positions[3*i+1] = P.y;
        positions[3*i+2] = P.z;

        // Color ramp by arc position: wake -> core -> shock
        const rp = (s + sMax) / (2*sMax); // 0..1 from rear to front
        const col = new THREE.Color();
        const wakeEnd = 0.22, coreEnd = 0.85;
        if (rp < wakeEnd) {
          const tt = rp / wakeEnd;
          col.copy(wakeColor).lerp(coreColor, tt);
        } else if (rp < coreEnd) {
          col.copy(coreColor);
        } else {
          const tt = (rp - coreEnd) / (1 - coreEnd);
          col.copy(coreColor).lerp(shockColor, tt);
        }
        colors[3*i+0] = col.r;
        colors[3*i+1] = col.g;
        colors[3*i+2] = col.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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
      particles.name = 'croissantParticles';
      group.add(particles);

      // Orientation from (lat, lon): local +Y is the radial axis
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - cme.latitude),
        THREE.MathUtils.degToRad(cme.longitude)
      );
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);

      cmeGroupRef.current.add(group);
    });
  }, [cmeData, THREE]);

  // ---------- Selection visibility & prediction line ----------
  useEffect(() => {
    if (!cmeGroupRef.current) return;
    cmeGroupRef.current.children.forEach((obj:any) => {
      const cme: ProcessedCME = obj.userData;
      if (currentlyModeledCMEId) {
        obj.visible = cme.id === currentlyModeledCMEId;
        if (cme.id === currentlyModeledCMEId) obj.userData.simStart = getClockElapsedTime();
      } else {
        obj.visible = true;
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
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), earthPos]);
      const material = new THREE.LineDashedMaterial({
        color: 0xffff66, transparent: true, opacity: 0.9,
        dashSize: 0.05 * SCENE_SCALE, gapSize: 0.02 * SCENE_SCALE
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      sceneRef.current.add(line);
      predictionLineRef.current = line;
    }
  }, [currentlyModeledCMEId, cmeData, THREE, getClockElapsedTime]);

  // ---------- Camera moves ----------
  const moveCamera = useCallback((view: ViewMode, focus: FocusTarget | null) => {
    if (!cameraRef.current || !controlsRef.current || !gsap || !THREE) return;
    const target = new THREE.Vector3(0,0,0);
    if (focus === FocusTarget.EARTH && celestialBodiesRef.current.EARTH) {
      celestialBodiesRef.current.EARTH.mesh.getWorldPosition(target);
    }
    const cam = new THREE.Vector3();
    if (view === ViewMode.TOP) cam.set(target.x, target.y + SCENE_SCALE * 4.2, target.z + 0.01);
    else cam.set(target.x + SCENE_SCALE * 1.9, target.y + SCENE_SCALE * 0.35, target.z);
    gsap.to(cameraRef.current.position, { duration: 1.2, x: cam.x, y: cam.y, z: cam.z, ease: 'power2.inOut' });
    gsap.to(controlsRef.current.target, {
      duration: 1.2, x: target.x, y: target.y, z: target.z, ease: 'power2.inOut',
      onUpdate: () => controlsRef.current.update()
    });
  }, [gsap, THREE]);

  useEffect(() => { moveCamera(activeView, focusTarget); }, [activeView, focusTarget, dataVersion, moveCamera]);
  React.useImperativeHandle(ref, () => ({ resetView: () => moveCamera(ViewMode.TOP, FocusTarget.EARTH) }), [moveCamera]);

  // Cursor/mode
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'move';
    }
  }, [interactionMode]);

  // Toggles
  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    ['MERCURY','VENUS','MARS'].forEach(n=>{
      const b = celestialBodiesRef.current[n]; const o = orbitsRef.current[n];
      if (b) b.mesh.visible = showExtraPlanets;
      if (o) o.visible = showExtraPlanets;
    });
  }, [showExtraPlanets]);

  useEffect(() => {
    const moon = celestialBodiesRef.current['MOON']; const l1 = celestialBodiesRef.current['L1'];
    if (moon) moon.mesh.visible = showMoonL1;
    if (l1) l1.mesh.visible = showMoonL1;
    const earthMesh = celestialBodiesRef.current['EARTH']?.mesh;
    if (earthMesh) {
      const moonOrbit = earthMesh.children.find((c:any)=>c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);

  // ---------- Update CMEs by absolute timeline ----------
  const updateCMEsByTime = useCallback((currentMs:number) => {
    if (!cmeGroupRef.current || !THREE) return;
    const sunR = PLANET_DATA_MAP.SUN.size;

    cmeGroupRef.current.children.forEach((obj:any) => {
      const cme: ProcessedCME = obj.userData;
      const t = (currentMs - cme.startTime.getTime()) / 1000;
      if (t < 0) { obj.visible = false; return; }
      obj.visible = true;

      const { r_km, v_km_s } = dbmSolve(t, cme.speed, DBM_DEFAULTS);
      const r_scene = kmToScene(r_km);
      updateCMETransform(obj, r_scene, cme.halfAngle, sunR);

      obj.userData.currentSpeed = v_km_s;
      obj.userData.currentRScene = r_scene;
    });
  }, [THREE]);

  // ---------- Update CMEs live (solo or all) ----------
  const updateCMEsLive = useCallback((elapsed:number, modeledId:string | null) => {
    if (!cmeGroupRef.current || !THREE) return;
    const sunR = PLANET_DATA_MAP.SUN.size;

    cmeGroupRef.current.children.forEach((obj:any) => {
      const cme: ProcessedCME = obj.userData;
      let t:number;
      if (modeledId && cme.id === modeledId) {
        const simStart = obj.userData.simStart ?? 0;
        t = Math.max(0, elapsed - simStart);
      } else if (!modeledId) {
        t = Math.max(0, (Date.now() - cme.startTime.getTime()) / 1000);
      } else {
        obj.visible = false; return;
      }

      obj.visible = true;

      const { r_km, v_km_s } = dbmSolve(t, cme.speed, DBM_DEFAULTS);
      const r_scene = kmToScene(r_km);
      updateCMETransform(obj, r_scene, cme.halfAngle, sunR);

      obj.userData.currentSpeed = v_km_s;
      obj.userData.currentRScene = r_scene;
    });
  }, [THREE]);

  // ---------- Croissant transform (position/orientation/scale) ----------
  const updateCMETransform = useCallback((group:any, r_scene:number, halfAngle:number, sunRadiusScene:number) => {
    if (r_scene < sunRadiusScene) { group.visible = false; return; }

    // Self-similar width ~ r * tan(halfAngle)
    const lateral = Math.tan((halfAngle * Math.PI)/180) * r_scene;
    // Tube radius is a fraction of lateral; keeps a hollow look while not exploding with distance
    const tubeScale = clamp(lateral * 0.45, 0.05 * SCENE_SCALE, 0.9 * SCENE_SCALE);

    // Position: move croissant center outward along its local +Y (already oriented by quaternion)
    const dir = new (window as any).THREE.Vector3(0,1,0).applyQuaternion(group.quaternion);
    const center = dir.clone().multiplyScalar(r_scene);
    group.position.copy(center);

    // Scale: the unit croissant has major radius R_unit=1; scale uniformly by r_scene to put its centerline ~ r_scene from Sun.
    // Then lightly adjust tube radius by scaling the child points container if present.
    group.scale.setScalar(r_scene);

    // Global opacity tweak via 1/r^2 density drop and viewing geometry (sin^2 chi)
    const particles = group.getObjectByName('croissantParticles') as any;
    if (particles?.material) {
      const cam = cameraRef.current?.position ?? new (window as any).THREE.Vector3(0,0,1);
      const sunToCam = cam.clone().normalize();
      const scatterAngle = sunToCam.angleTo(dir);
      const thomsonBoost = 0.6 + 0.6 * Math.pow(Math.sin(scatterAngle), 2);
      const dens = 1 / Math.max(1, Math.pow(r_scene / SCENE_SCALE, 2));
      const base = getCmeOpacity((window as any).THREE, group.userData.speed ?? 800);
      particles.material.opacity = clamp(base * thomsonBoost * (0.7 + 0.6*dens), 0.04, 0.85);

      // Nudge particle size slightly with distance so very distant croissants remain visible
      const szBase = getCmeParticleSize((window as any).THREE, group.userData.speed ?? 800, SCENE_SCALE);
      particles.material.size = clamp(szBase * (0.9 + 0.15 * (SCENE_SCALE / Math.max(SCENE_SCALE, r_scene))), 0.02*SCENE_SCALE, 0.12*SCENE_SCALE);
    }

  }, []);

  // ---------- Impact proxy & effects ----------
  const checkImpacts = useCallback((): number => {
    if (!cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;
    let maxImpactSpeed = 0;
    const earthOrbitR = PLANET_DATA_MAP.EARTH.radius;

    cmeGroupRef.current.children.forEach((group:any) => {
      if (!group.visible) return;
      const r_scene = group.userData.currentRScene as number | undefined;
      const v = group.userData.currentSpeed as number | undefined;
      if (!r_scene || v === undefined) return;
      if (r_scene >= earthOrbitR * 0.98 && r_scene <= earthOrbitR * 1.05) {
        maxImpactSpeed = Math.max(maxImpactSpeed, v);
      }
    });

    return maxImpactSpeed;
  }, []);

  const updateImpactEffects = useCallback((maxImpactSpeed:number, elapsed:number) => {
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    if (!earth) return;
    const aur = earth.children.find((c:any)=>c.name==='aurora');
    const atm = earth.children.find((c:any)=>c.name==='atmosphere');

    const hit = clamp(maxImpactSpeed / 2000, 0, 1);
    if (aur?.material?.uniforms) {
      aur.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
      (aur.material as any).opacity = 0.18 + hit * (0.25 + 0.10 * Math.sin(elapsed * 2.0));
    }
    if (atm?.material?.uniforms) {
      (atm.material as any).opacity = 0.12 + hit * 0.22;
      atm.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0.0;
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
