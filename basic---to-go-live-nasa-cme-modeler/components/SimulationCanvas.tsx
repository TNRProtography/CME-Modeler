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
 * Physically-leaning CME rendering:
 * - Drag-Based kinematics (DBM) in km -> AU -> scene units.
 * - Self-similar expansion (fixed half-angle).
 * - Hollow ellipsoidal shell approximating a GCS-like front (croissant-lite).
 * - Approx. Thomson scattering weighting for brightness.
 *
 * Tunables (see DBM_DEFAULTS below) let you stiffen/soften deceleration.
 */

interface SimulationCanvasProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
  focusTarget: FocusTarget | null;
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void; // not used but kept
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

type DBMParams = {
  w: number;      // ambient solar wind speed (km/s)
  gamma: number;  // drag parameter (km^-1)
  r0_km: number;  // initial distance from Sun center (km)
};

const DBM_DEFAULTS: DBMParams = {
  w: 400,                 // typical slow wind
  gamma: 1.5e-7,          // within published range (1e-7 .. 2e-7 km^-1)
  r0_km: 696340,          // ~ 1 R☉ from center, i.e. at the surface
};

// Utility: solve DBM analytically for distance (km) and speed (km/s) at time t (s)
function dbmSolve(t_sec: number, v0: number, params: DBMParams) {
  const { w, gamma, r0_km } = params;
  const dv0 = v0 - w;
  const denom = 1 + gamma * dv0 * Math.max(0, t_sec);
  const v = w + (dv0 / Math.max(denom, 1e-6));
  const r = r0_km + w * t_sec + (1 / gamma) * Math.log(Math.max(denom, 1e-6));
  return { r_km: r, v_km_s: v };
}

function kmToScene(km: number) {
  const au = km / AU_IN_KM;
  return au * SCENE_SCALE;
}

function halfAngleToLateralRadius(distanceScene: number, halfAngleDeg: number) {
  const th = (halfAngleDeg * Math.PI) / 180;
  return Math.tan(th) * distanceScene; // lateral self-similar radius
}

// Soft clamp
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

    // Stars (kept simple)
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

    // Planets
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
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        orbitPts.push(new THREE.Vector3(Math.sin(a) * data.radius, 0, Math.cos(a) * data.radius));
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

      // Moon orbit
      const pts: any[] = [];
      const segs = 64;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.sin(a) * data.radius, 0, Math.cos(a) * data.radius));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, segs, 0.003 * SCENE_SCALE, 8, true);
      const omat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.7 });
      const orbit = new THREE.Mesh(tube, omat); orbit.name = 'moon-orbit';
      parent.mesh.add(orbit);
    });

    // POIs
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

    // CME group (container)
    cmeGroupRef.current = new THREE.Group();
    scene.add(cmeGroupRef.current);

    // Animation loop
    let raf = 0;
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

      // Orbit motion + uniforms
      const ORBIT_SPEED_SCALE = 2000;
      Object.values(celestialBodiesRef.current).forEach(body => {
        const d = body.userData as PlanetData | undefined;
        if (!d || !d.orbitalPeriodDays) return;
        const angVel = (2 * Math.PI) / (d.orbitalPeriodDays * 86400) * ORBIT_SPEED_SCALE;
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
        earthBody.mesh.children.forEach((child: any) => {
          if (child.material?.uniforms?.uTime) child.material.uniforms.uTime.value = elapsed;
        });
      }

      // Timeline
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

  // ---------- Build CMEs (ellipsoidal GCS-like shell) ----------
  useEffect(() => {
    if (!THREE || !cmeGroupRef.current || !sceneRef.current) return;

    // clear
    while (cmeGroupRef.current.children.length > 0) {
      const child = cmeGroupRef.current.children[0];
      cmeGroupRef.current.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) {
        const m = (child as any).material;
        if (Array.isArray(m)) m.forEach((x: any) => x.dispose()); else m.dispose();
      }
    }

    // Create per-CME shell
    cmeData.forEach(cme => {
      const group = new THREE.Group();
      group.userData = { ...cme, simStart: 0 }; // simStart assigned when singled
      // Geometry: hollow ellipsoid (front shell) via TWO spheres w/ shader masking
      const shellOuter = new THREE.SphereGeometry(1, 64, 64);
      const shellInner = new THREE.SphereGeometry(0.92, 64, 64);

      // Merge to a single shell by subtractive trick: render inner with backface only & higher depth
      const matOuter = new THREE.MeshPhysicalMaterial({
        color: 0xffe0a0, emissive: 0x000000, metalness: 0,
        roughness: 1, transmission: 0, transparent: true, opacity: 0.20,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      const matInner = new THREE.MeshBasicMaterial({
        color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0.18, depthWrite: false
      });

      const outer = new THREE.Mesh(shellOuter, matOuter);
      const inner = new THREE.Mesh(shellInner, matInner);
      outer.name = 'shellOuter';
      inner.name = 'shellInner';

      // Slight axial flattening (front is not a perfect sphere)
      outer.scale.set(1.0, 0.92, 1.0);
      inner.scale.set(1.0, 0.92, 1.0);

      group.add(outer);
      group.add(inner);

      // A faint cavity/void to suggest flux rope interior (darker center)
      const cavityGeo = new THREE.SphereGeometry(0.7, 48, 48);
      const cavityMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06, depthWrite: false });
      const cavity = new THREE.Mesh(cavityGeo, cavityMat);
      cavity.name = 'cavity';
      group.add(cavity);

      // Orientation from lat/lon
      const dir = new THREE.Vector3();
      dir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - cme.latitude),
        THREE.MathUtils.degToRad(cme.longitude)
      );
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      cmeGroupRef.current.add(group);
    });
  }, [cmeData, THREE]);

  // ---------- Visibility & prediction line for selected ----------
  useEffect(() => {
    if (!cmeGroupRef.current) return;
    cmeGroupRef.current.children.forEach((obj: any) => {
      const cme: ProcessedCME = obj.userData;
      if (currentlyModeledCMEId) {
        obj.visible = cme.id === currentlyModeledCMEId;
        if (cme.id === currentlyModeledCMEId) obj.userData.simStart = getClockElapsedTime();
      } else {
        obj.visible = true;
      }
    });

    // Prediction line (Sun->Earth) for Earth-directed
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

  // Force MOVE mode cursor
  useEffect(() => {
    if (controlsRef.current && rendererRef.current?.domElement) {
      controlsRef.current.enabled = true;
      rendererRef.current.domElement.style.cursor = 'move';
    }
  }, [interactionMode]);

  // Toggles
  useEffect(() => {
    if (!celestialBodiesRef.current || !orbitsRef.current) return;
    ['MERCURY', 'VENUS', 'MARS'].forEach(n => {
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
      const moonOrbit = earthMesh.children.find((c: any) => c.name === 'moon-orbit');
      if (moonOrbit) moonOrbit.visible = showMoonL1;
    }
  }, [showMoonL1]);

  // ---------- Update CMEs by absolute time (timeline) ----------
  const updateCMEsByTime = useCallback((currentMs: number) => {
    if (!THREE || !cmeGroupRef.current) return;
    const sunR = PLANET_DATA_MAP.SUN.size;

    cmeGroupRef.current.children.forEach((obj: any) => {
      const cme: ProcessedCME = obj.userData;
      const t = (currentMs - cme.startTime.getTime()) / 1000; // seconds since launch
      if (t < 0) { obj.visible = false; return; }
      obj.visible = true;

      // DBM in km
      const { r_km, v_km_s } = dbmSolve(t, cme.speed, DBM_DEFAULTS);
      const r_scene = kmToScene(r_km);
      updateCMEGeometry(obj, r_scene, cme.halfAngle, sunR);

      // For Earth impact visuals
      obj.userData.currentSpeed = v_km_s;
      obj.userData.currentRScene = r_scene;
    });
  }, [THREE]);

  // ---------- Update CMEs live (solo or all) ----------
  const updateCMEsLive = useCallback((elapsed: number, modeledId: string | null) => {
    if (!THREE || !cmeGroupRef.current) return;
    const sunR = PLANET_DATA_MAP.SUN.size;

    cmeGroupRef.current.children.forEach((obj: any) => {
      const cme: ProcessedCME = obj.userData;
      let t: number;

      if (modeledId && cme.id === modeledId) {
        // solo: time since we started sim
        const simStart = obj.userData.simStart ?? 0;
        t = Math.max(0, elapsed - simStart);
      } else if (!modeledId) {
        // live: from real launch time
        t = Math.max(0, (Date.now() - cme.startTime.getTime()) / 1000);
      } else {
        obj.visible = false;
        return;
      }

      obj.visible = true;

      const { r_km, v_km_s } = dbmSolve(t, cme.speed, DBM_DEFAULTS);
      const r_scene = kmToScene(r_km);
      updateCMEGeometry(obj, r_scene, cme.halfAngle, sunR);

      obj.userData.currentSpeed = v_km_s;
      obj.userData.currentRScene = r_scene;
    });
  }, [THREE]);

  // ---------- Shape & appearance update ----------
  const updateCMEGeometry = useCallback((group: any, r_scene: number, halfAngle: number, sunRadiusScene: number) => {
    // Hide if below surface (before emergence)
    if (r_scene < sunRadiusScene) { group.visible = false; return; }

    // Self-similar lateral radius
    const lateral = halfAngleToLateralRadius(r_scene, halfAngle);

    // Thickness grows slowly with distance
    const thickness = clamp(0.06 * Math.pow(r_scene / (SCENE_SCALE * 0.5), 0.3) * SCENE_SCALE, 0.03 * SCENE_SCALE, 0.6 * SCENE_SCALE);

    // Place shell just beyond the solar surface along its axis
    const dir = new (window as any).THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    const frontCenter = dir.clone().multiplyScalar(Math.max(sunRadiusScene + 0.001 * SCENE_SCALE, r_scene - thickness * 0.5));
    group.position.copy(frontCenter);

    // Scale shell ellipsoid radii:
    // y-axis ~ radial extent (half-thickness here for outer shell unit sphere of radius 1 scaled later)
    const outer = group.getObjectByName('shellOuter') as any;
    const inner = group.getObjectByName('shellInner') as any;
    const cavity = group.getObjectByName('cavity') as any;

    const radialRadius = thickness;                 // along axis (y in group local)
    const lateralRadius = Math.max(lateral, sunRadiusScene * 0.2); // x & z
    const flatten = 0.92;                           // slight front flattening

    if (outer) outer.scale.set(lateralRadius, radialRadius * flatten, lateralRadius);
    if (inner) inner.scale.set(lateralRadius * 0.92, radialRadius * 0.92 * flatten, lateralRadius * 0.92);
    if (cavity) cavity.scale.set(lateralRadius * 0.7, radialRadius * 0.6, lateralRadius * 0.7);

    // Dynamic opacity with 1/r^2 to mimic electron density drop (qualitative)
    const dens = 1 / Math.max(1, Math.pow(r_scene / (SCENE_SCALE), 2));
    if (outer?.material) outer.material.opacity = clamp(0.12 + 0.35 * dens, 0.05, 0.45);
    if (inner?.material) inner.material.opacity = clamp(0.10 + 0.25 * dens, 0.04, 0.30);

    // Thomson scattering weighting (approx): brighter when close to plane-of-sky
    const cam = cameraRef.current?.position ?? new (window as any).THREE.Vector3(0,0,1);
    const sunToCam = cam.clone().normalize();
    const scatterAngle = sunToCam.angleTo(dir); // 0 -> towards camera, ~π/2 -> plane-of-sky
    const thomson = Math.pow(Math.sin(scatterAngle), 2); // ∝ sin^2(χ)
    const boost = 0.6 + 0.6 * thomson;
    if (outer?.material) outer.material.opacity = clamp(outer.material.opacity * boost, 0.05, 0.6);
    if (inner?.material) inner.material.opacity = clamp(inner.material.opacity * boost, 0.04, 0.4);
  }, []);

  // ---------- Impacts & effects ----------
  const checkImpacts = useCallback((): number => {
    if (!cmeGroupRef.current || !celestialBodiesRef.current.EARTH) return 0;
    let maxImpactSpeed = 0;

    const earthPos = new (window as any).THREE.Vector3();
    celestialBodiesRef.current.EARTH.mesh.getWorldPosition(earthPos);
    const earthR = PLANET_DATA_MAP.EARTH.radius; // orbit radius (scene units)

    cmeGroupRef.current.children.forEach((group: any) => {
      if (!group.visible) return;
      const r_scene = group.userData.currentRScene as number | undefined;
      const v = group.userData.currentSpeed as number | undefined;
      if (!r_scene || v === undefined) return;

      // Impact proxy: when CME front radial distance crosses Earth's orbital radius along its axis
      const frontDist = r_scene; // radial center of shell (scene units)
      if (frontDist >= earthR * 0.98 && frontDist <= earthR * 1.05) {
        maxImpactSpeed = Math.max(maxImpactSpeed, v);
      }
    });

    return maxImpactSpeed;
  }, []);

  const updateImpactEffects = useCallback((maxImpactSpeed: number, elapsed: number) => {
    const earth = celestialBodiesRef.current.EARTH?.mesh;
    if (!earth) return;
    const aur = earth.children.find((c: any) => c.name === 'aurora');
    const atm = earth.children.find((c: any) => c.name === 'atmosphere');

    const hit = clamp(maxImpactSpeed / 2000, 0, 1);
    if (aur?.material?.uniforms) {
      aur.material.uniforms.uCmeSpeed.value = maxImpactSpeed;
      (aur.material as any).opacity = 0.18 + hit * (0.25 + 0.10 * Math.sin(elapsed * 2.2));
    }
    if (atm?.material?.uniforms) {
      (atm.material as any).opacity = 0.12 + hit * 0.22;
      atm.material.uniforms.uImpactTime.value = hit > 0 ? elapsed : 0.0;
    }
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default React.forwardRef(SimulationCanvas);
