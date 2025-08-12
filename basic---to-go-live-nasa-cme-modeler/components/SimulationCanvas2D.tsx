// --- START OF FILE src/components/SimulationCanvas2D.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ProcessedCME } from '../types';
import { PLANET_DATA_MAP, SCENE_SCALE, AU_IN_KM, SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER, EARTH_ATMOSPHERE_VERTEX_SHADER, EARTH_ATMOSPHERE_FRAGMENT_SHADER } from '../constants';

// --- Props Interface (Simplified for this view) ---
interface SimulationCanvas2DProps {
  cmeData: ProcessedCME[];
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void;
  timelineActive: boolean;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineValue: number;
  timelineMinDate: number;
  timelineMaxDate: number;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showLabels: boolean;
  getClockElapsedTime: () => number;
  resetClock: () => void;
}

// --- Texture URLs (to match 3D view) ---
const TEX = {
  EARTH_DAY: "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg",
  EARTH_CLOUDS: "https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/earth_clouds_2048.png",
  MILKY_WAY: "https://upload.wikimedia.org/wikipedia/commons/8/85/Solarsystemscope_texture_8k_stars_milky_way.jpg",
};

// --- Helper Functions (Identical to 3D Canvas) ---
const createParticleTexture = (THREE: any) => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d'); if (!context) return null;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
};
const getCmeOpacity = (speed: number): number => Math.min(0.65, Math.max(0.06, (speed - 300) / (2700) * 0.59 + 0.06));
const getCmeParticleCount = (speed: number): number => Math.floor(Math.min(7000, Math.max(1500, (speed - 300) / (2700) * 5500 + 1500)));
const getCmeParticleSize = (speed: number, scale: number): number => Math.min(0.08, Math.max(0.04, (speed - 300) / (2700) * 0.04 + 0.04)) * scale;
const getCmeCoreColor = (THREE: any, speed: number) => {
    if (speed >= 2500) return new THREE.Color(0xff69b4); if (speed >= 1800) return new THREE.Color(0x9370db);
    if (speed >= 1000) return new THREE.Color(0xff4500); if (speed >= 800) return new THREE.Color(0xffa500);
    if (speed >= 500) return new THREE.Color(0xffff00); if (speed < 350) return new THREE.Color(0x808080);
    return new THREE.Color(0x808080).lerp(new THREE.Color(0xffff00), (speed - 350) / 150);
};
const calculateDistance = (cme: ProcessedCME, timeSinceEventSeconds: number): number => (cme.speed / AU_IN_KM) * Math.max(0, timeSinceEventSeconds) * SCENE_SCALE;
const ORBIT_SPEED_SCALE = 2000;

const SimpleLabel: React.FC<{ name: string; position: { x: number; y: number; visible: boolean } }> = ({ name, position }) => (
    <div className="absolute text-white text-xs pointer-events-none transition-opacity duration-200" style={{ left: position.x, top: position.y, opacity: position.visible ? 1 : 0, transform: 'translate(-50%, 12px)', textShadow: '0 0 4px black' }}>
        {name}
    </div>
);

const SimulationCanvas2D: React.FC<SimulationCanvas2DProps> = (props) => {
    const topDownMountRef = useRef<HTMLDivElement>(null);
    const sideViewMountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<any>();
    const topCameraRef = useRef<any>();
    const sideCameraRef = useRef<any>();
    const topRendererRef = useRef<any>();
    const sideRendererRef = useRef<any>();
    const cmeGroupRef = useRef<any>();
    const animationFrameId = useRef<number>();
    const lastTimeRef = useRef(0);
    const celestialBodiesRef = useRef<Record<string, any>>({});
    const [labelPositions, setLabelPositions] = useState<Record<string, { top: any, side: any }>>({});

    const earthDirectedCMEs = props.cmeData.filter(cme => cme.isEarthDirected);

    useEffect(() => {
        const THREE = (window as any).THREE;
        if (!THREE || !topDownMountRef.current || !sideViewMountRef.current) return;

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        const loader = new THREE.TextureLoader();
        (loader as any).crossOrigin = "anonymous";
        
        const near = 0.1 * SCENE_SCALE;
        const far = 1000 * SCENE_SCALE;
        topCameraRef.current = new THREE.PerspectiveCamera(50, topDownMountRef.current.clientWidth / topDownMountRef.current.clientHeight, near, far);
        sideCameraRef.current = new THREE.PerspectiveCamera(50, sideViewMountRef.current.clientWidth / sideViewMountRef.current.clientHeight, near, far);
        
        const cameraDistance = PLANET_DATA_MAP.EARTH.radius * 2.5;
        topCameraRef.current.position.set(0, cameraDistance, 0.01);
        topCameraRef.current.lookAt(0, 0, 0);
        sideCameraRef.current.position.set(cameraDistance, 0, 0);
        sideCameraRef.current.lookAt(0, 0, 0);

        topRendererRef.current = new THREE.WebGLRenderer({ antialias: true });
        topRendererRef.current.setSize(topDownMountRef.current.clientWidth, topDownMountRef.current.clientHeight);
        topRendererRef.current.setPixelRatio(window.devicePixelRatio);
        topDownMountRef.current.appendChild(topRendererRef.current.domElement);

        sideRendererRef.current = new THREE.WebGLRenderer({ antialias: true });
        sideRendererRef.current.setSize(sideViewMountRef.current.clientWidth, sideViewMountRef.current.clientHeight);
        sideRendererRef.current.setPixelRatio(window.devicePixelRatio);
        sideViewMountRef.current.appendChild(sideRendererRef.current.domElement);
        
        const milkyWayTexture = loader.load(TEX.MILKY_WAY);
        milkyWayTexture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = milkyWayTexture;

        const makeStars = (count: number, spread: number, size: number) => {
            const verts: number[] = [];
            for (let i = 0; i < count; i++) verts.push(THREE.MathUtils.randFloatSpread(spread * SCENE_SCALE));
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
            const m = new THREE.PointsMaterial({ color: 0xffffff, size: size * SCENE_SCALE, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false });
            return new THREE.Points(g, m);
        };
        scene.add(makeStars(10000, 250, 0.010));
        scene.add(makeStars(5000, 300, 0.005));
        
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        scene.add(new THREE.PointLight(0xffffff, 1.5, 300 * SCENE_SCALE));

        const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 64, 64);
        const sunMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERTEX_SHADER, fragmentShader: SUN_FRAGMENT_SHADER });
        const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
        scene.add(sunMesh);
        celestialBodiesRef.current['SUN'] = sunMesh;

        const earthData = PLANET_DATA_MAP.EARTH;
        const earthSize = earthData.size * 5; // --- Increased Earth size ---
        const earthGeo = new THREE.SphereGeometry(earthSize, 32, 32);
        const earthMat = new THREE.MeshPhongMaterial({ map: loader.load(TEX.EARTH_DAY) });
        const earthMesh = new THREE.Mesh(earthGeo, earthMat);
        earthMesh.userData = earthData;
        scene.add(earthMesh);
        celestialBodiesRef.current['EARTH'] = earthMesh;

        const cloudsGeo = new THREE.SphereGeometry(earthSize * 1.01, 32, 32);
        const cloudsMat = new THREE.MeshLambertMaterial({ map: loader.load(TEX.EARTH_CLOUDS), transparent: true, opacity: 0.7 });
        earthMesh.add(new THREE.Mesh(cloudsGeo, cloudsMat));

        const atmosphereGeo = new THREE.SphereGeometry(earthSize * 1.15, 32, 32);
        const atmosphereMat = new THREE.ShaderMaterial({
            vertexShader: EARTH_ATMOSPHERE_VERTEX_SHADER, fragmentShader: EARTH_ATMOSPHERE_FRAGMENT_SHADER,
            blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true,
            uniforms: { uTime: { value: 0.0 } }
        });
        earthMesh.add(new THREE.Mesh(atmosphereGeo, atmosphereMat));

        cmeGroupRef.current = new THREE.Group();
        scene.add(cmeGroupRef.current);
        
        const handleResize = () => {
             if (topDownMountRef.current && sideViewMountRef.current) {
                topRendererRef.current.setSize(topDownMountRef.current.clientWidth, topDownMountRef.current.clientHeight);
                topCameraRef.current.aspect = topDownMountRef.current.clientWidth / topDownMountRef.current.clientHeight;
                topCameraRef.current.updateProjectionMatrix();
                sideRendererRef.current.setSize(sideViewMountRef.current.clientWidth, sideViewMountRef.current.clientHeight);
                sideCameraRef.current.aspect = sideViewMountRef.current.clientWidth / sideViewMountRef.current.clientHeight;
                sideCameraRef.current.updateProjectionMatrix();
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if(topDownMountRef.current && topRendererRef.current.domElement) topDownMountRef.current.removeChild(topRendererRef.current.domElement);
            if(sideViewMountRef.current && sideRendererRef.current.domElement) sideViewMountRef.current.removeChild(sideRendererRef.current.domElement);
            topRendererRef.current.dispose();
            sideRendererRef.current.dispose();
        };
    }, []);

    useEffect(() => {
        const THREE = (window as any).THREE;
        if (!THREE || !cmeGroupRef.current) return;
        while (cmeGroupRef.current.children.length) { cmeGroupRef.current.remove(cmeGroupRef.current.children[0]); }
        const particleTexture = createParticleTexture(THREE);

        earthDirectedCMEs.forEach(cme => {
            const particleCount = getCmeParticleCount(cme.speed);
            const positions: number[] = []; const colors: number[] = [];
            const coneHalfAngleRad = (cme.halfAngle * Math.PI) / 180;
            const coreColor = getCmeCoreColor(THREE, cme.speed);
            for (let i = 0; i < particleCount; i++) {
                const y = Math.random(); const theta = Math.random() * 2 * Math.PI;
                const r = Math.tan(coneHalfAngleRad) * y * Math.sqrt(Math.random());
                positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
                colors.push(coreColor.r, coreColor.g, coreColor.b);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const mat = new THREE.PointsMaterial({
                size: getCmeParticleSize(cme.speed, SCENE_SCALE), map: particleTexture,
                blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
                opacity: getCmeOpacity(cme.speed), vertexColors: true,
            });
            const particleSystem = new THREE.Points(geo, mat);
            particleSystem.userData = cme;
            const direction = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - (cme.latitude * Math.PI) / 180, (cme.longitude * Math.PI) / 180);
            particleSystem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
            cmeGroupRef.current.add(particleSystem);
        });
    }, [earthDirectedCMEs]);

    useEffect(() => {
        props.resetClock();
        const THREE = (window as any).THREE;
        const animate = () => {
            animationFrameId.current = requestAnimationFrame(animate);
            const elapsedTime = props.getClockElapsedTime();
            const currentTimelineTime = props.timelineMinDate + (props.timelineMaxDate - props.timelineMinDate) * (props.timelineValue / 1000);

            if (celestialBodiesRef.current['SUN']) {
                celestialBodiesRef.current['SUN'].material.uniforms.uTime.value = elapsedTime;
            }
            const earthMesh = celestialBodiesRef.current['EARTH'];
            if (earthMesh) {
                const data = earthMesh.userData;
                const angularVelocity = (2 * Math.PI) / (data.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE;
                const angle = data.angle + angularVelocity * elapsedTime;
                earthMesh.position.set(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius);
                earthMesh.rotation.y += 0.05 * (elapsedTime - (lastTimeRef.current || elapsedTime));
                earthMesh.children.forEach((child:any) => { if(child.material.uniforms?.uTime) child.material.uniforms.uTime.value = elapsedTime; });
            }
            lastTimeRef.current = elapsedTime;

            cmeGroupRef.current?.children.forEach((cmeMesh: any) => {
                const cme = cmeMesh.userData;
                let timeSinceEventSeconds = props.timelineActive ? (currentTimelineTime - cme.startTime.getTime()) / 1000 : (Date.now() - cme.startTime.getTime()) / 1000;
                const dist = calculateDistance(cme, timeSinceEventSeconds);
                const sunRadius = PLANET_DATA_MAP.SUN.size;
                cmeMesh.visible = dist > sunRadius;
                if (cmeMesh.visible) {
                    const cmeLength = dist - sunRadius;
                    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(cmeMesh.quaternion);
                    cmeMesh.position.copy(dir.clone().multiplyScalar(sunRadius));
                    cmeMesh.scale.set(cmeLength, cmeLength, cmeLength);
                }
            });

            if (props.showLabels) {
                const newPositions: Record<string, any> = {};
                Object.entries(celestialBodiesRef.current).forEach(([name, mesh]) => {
                    const getScreenPos = (camera: any, mount: HTMLDivElement) => {
                        if (!mount) return { x: 0, y: 0, visible: false };
                        const vector = new THREE.Vector3(); mesh.getWorldPosition(vector);
                        vector.project(camera);
                        return { x: (vector.x * 0.5 + 0.5) * mount.clientWidth, y: (-vector.y * 0.5 + 0.5) * mount.clientHeight, visible: vector.z < 1, };
                    };
                    newPositions[name] = { top: getScreenPos(topCameraRef.current, topDownMountRef.current!), side: getScreenPos(sideCameraRef.current, sideViewMountRef.current!), };
                });
                setLabelPositions(newPositions);
            }

            if (topRendererRef.current) topRendererRef.current.render(sceneRef.current, topCameraRef.current);
            if (sideRendererRef.current) sideRendererRef.current.render(sceneRef.current, sideCameraRef.current);
        };
        animate();
        return () => { if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
    }, [props]);

    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>, camera: any) => {
        const THREE = (window as any).THREE;
        if (!camera || !cmeGroupRef.current) return;
        const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
        const rect = event.currentTarget.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        raycaster.params.Points.threshold = PLANET_DATA_MAP.EARTH.radius * 0.2;
        const intersects = raycaster.intersectObjects(cmeGroupRef.current.children);
        if (intersects.length > 0) props.onCMEClick(intersects[0].object.userData);
    };
    
    return (
        <div className="w-full h-full flex flex-col lg:flex-row p-4 pt-16 lg:pt-4 gap-4 bg-black">
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded z-10">Top-Down View</h2>
                <div ref={topDownMountRef} className="w-full h-full rounded-lg border border-neutral-700 cursor-pointer" onClick={(e) => handleCanvasClick(e, topCameraRef.current)} />
                {props.showLabels && Object.entries(labelPositions).map(([name, pos]) => pos.top && <SimpleLabel key={`${name}-top`} name={name} position={pos.top} />)}
            </div>
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded z-10">Side View</h2>
                <div ref={sideViewMountRef} className="w-full h-full rounded-lg border border-neutral-700 cursor-pointer" onClick={(e) => handleCanvasClick(e, sideCameraRef.current)} />
                {props.showLabels && Object.entries(labelPositions).map(([name, pos]) => pos.side && <SimpleLabel key={`${name}-side`} name={name} position={pos.side} />)}
            </div>
        </div>
    );
};

export default SimulationCanvas2D;
// --- END OF FILE src/components/SimulationCanvas2D.tsx ---