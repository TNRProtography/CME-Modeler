// --- START OF FILE src/components/SimulationCanvas2D.tsx ---

import React, { useRef, useEffect, useCallback } from 'react';
import { ProcessedCME } from '../types';
import { PLANET_DATA_MAP, SCENE_SCALE, AU_IN_KM } from '../constants';

// --- Props Interface (Unchanged) ---
interface SimulationCanvas2DProps {
  cmeData: ProcessedCME[];
  currentlyModeledCMEId: string | null;
  onCMEClick: (cme: ProcessedCME) => void;
  timelineActive: boolean;
  timelinePlaying: boolean;
  timelineSpeed: number;
  timelineValue: number; // 0-1000
  timelineMinDate: number;
  timelineMaxDate: number;
  onScrubberChangeByAnim: (value: number) => void;
  onTimelineEnd: () => void;
  showExtraPlanets: boolean;
  showLabels: boolean; // Note: 2D view labels are drawn on canvas, not HTML
  getClockElapsedTime: () => number;
  resetClock: () => void;
}

// --- Helper Functions (Copied from 3D Canvas for consistency) ---
const createParticleTexture = (THREE: any) => {
    // This is a simplified version for brevity. In a real app, share this logic.
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
};
const getCmeOpacity = (speed: number): number => Math.min(0.65, Math.max(0.06, (speed - 300) / (3000 - 300) * 0.59 + 0.06));
const getCmeParticleCount = (speed: number): number => Math.floor(Math.min(7000, Math.max(1500, (speed - 300) / (3000 - 300) * 5500 + 1500)));
const getCmeParticleSize = (speed: number, scale: number): number => Math.min(0.08, Math.max(0.04, (speed - 300) / (3000 - 300) * 0.04 + 0.04)) * scale;
const getCmeCoreColor = (THREE: any, speed: number) => {
    if (speed >= 2500) return new THREE.Color(0xff69b4); if (speed >= 1800) return new THREE.Color(0x9370db);
    if (speed >= 1000) return new THREE.Color(0xff4500); if (speed >= 800) return new THREE.Color(0xffa500);
    if (speed >= 500) return new THREE.Color(0xffff00); if (speed < 350) return new THREE.Color(0x808080);
    return new THREE.Color(0x808080).lerp(new THREE.Color(0xffff00), (speed - 350) / 150);
};
const calculateDistance = (cme: ProcessedCME, timeSinceEventSeconds: number): number => (cme.speed / AU_IN_KM) * Math.max(0, timeSinceEventSeconds) * SCENE_SCALE;
const ORBIT_SPEED_SCALE = 2000;


// --- The NEW 2D Simulation Component (using locked 3D views) ---
const SimulationCanvas2D: React.FC<SimulationCanvas2DProps> = (props) => {
    const topDownMountRef = useRef<HTMLDivElement>(null);
    const sideViewMountRef = useRef<HTMLDivElement>(null);
    
    // Using refs to hold Three.js objects
    const sceneRef = useRef<any>();
    const topCameraRef = useRef<any>();
    const sideCameraRef = useRef<any>();
    const topRendererRef = useRef<any>();
    const sideRendererRef = useRef<any>();
    const cmeGroupRef = useRef<any>();
    const animationFrameId = useRef<number>();
    const celestialBodiesRef = useRef<Record<string, any>>({});

    const earthDirectedCMEs = props.cmeData.filter(cme => cme.isEarthDirected);

    // --- Scene Initialization ---
    useEffect(() => {
        const THREE = (window as any).THREE;
        if (!THREE || !topDownMountRef.current || !sideViewMountRef.current) return;

        // --- Create ONE scene for both views ---
        const scene = new THREE.Scene();
        sceneRef.current = scene;

        // --- Create TWO cameras, one for each view ---
        topCameraRef.current = new THREE.PerspectiveCamera(50, topDownMountRef.current.clientWidth / topDownMountRef.current.clientHeight, 0.1, 1000);
        sideCameraRef.current = new THREE.PerspectiveCamera(50, sideViewMountRef.current.clientWidth / sideViewMountRef.current.clientHeight, 0.1, 1000);
        
        // --- Position the cameras in their fixed locations ---
        const cameraDistance = PLANET_DATA_MAP.MARS.radius * 3;
        topCameraRef.current.position.set(0, cameraDistance, 0);
        topCameraRef.current.lookAt(0, 0, 0);
        sideCameraRef.current.position.set(cameraDistance, 0, 0);
        sideCameraRef.current.lookAt(0, 0, 0);

        // --- Create TWO renderers ---
        topRendererRef.current = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        topRendererRef.current.setSize(topDownMountRef.current.clientWidth, topDownMountRef.current.clientHeight);
        topRendererRef.current.setPixelRatio(window.devicePixelRatio);
        topDownMountRef.current.appendChild(topRendererRef.current.domElement);

        sideRendererRef.current = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        sideRendererRef.current.setSize(sideViewMountRef.current.clientWidth, sideViewMountRef.current.clientHeight);
        sideRendererRef.current.setPixelRatio(window.devicePixelRatio);
        sideViewMountRef.current.appendChild(sideRendererRef.current.domElement);

        // --- Build Scene Objects (planets, sun, orbits) ---
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const pointLight = new THREE.PointLight(0xffffff, 1.5, 300 * SCENE_SCALE);
        scene.add(pointLight);

        const sunGeometry = new THREE.SphereGeometry(PLANET_DATA_MAP.SUN.size, 32, 32);
        const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
        scene.add(sunMesh);
        celestialBodiesRef.current['SUN'] = sunMesh;

        ['EARTH', 'MERCURY', 'VENUS', 'MARS'].forEach(name => {
            const data = PLANET_DATA_MAP[name as keyof typeof PLANET_DATA_MAP];
            const planetGeo = new THREE.SphereGeometry(data.size, 16, 16);
            const planetMat = new THREE.MeshBasicMaterial({ color: data.color as number });
            const planetMesh = new THREE.Mesh(planetGeo, planetMat);
            planetMesh.userData = data;
            scene.add(planetMesh);
            celestialBodiesRef.current[name] = planetMesh;

            const orbitPoints = Array.from({ length: 129 }, (_, i) => {
                const angle = (i / 128) * Math.PI * 2;
                return new THREE.Vector3(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius);
            });
            const orbitCurve = new THREE.CatmullRomCurve3(orbitPoints);
            const orbitGeo = new THREE.TubeGeometry(orbitCurve, 128, 0.005 * SCENE_SCALE, 8, true);
            const orbitMat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.8 });
            scene.add(new THREE.Mesh(orbitGeo, orbitMat));
        });

        cmeGroupRef.current = new THREE.Group();
        scene.add(cmeGroupRef.current);

        // Resize handler
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

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            topDownMountRef.current?.removeChild(topRendererRef.current.domElement);
            sideViewMountRef.current?.removeChild(sideRendererRef.current.domElement);
            topRendererRef.current.dispose();
            sideRendererRef.current.dispose();
        };
    }, []);

    // --- CME Creation (identical to 3D canvas) ---
    useEffect(() => {
        const THREE = (window as any).THREE;
        if (!THREE || !cmeGroupRef.current) return;
        
        while (cmeGroupRef.current.children.length) {
            cmeGroupRef.current.remove(cmeGroupRef.current.children[0]);
        }
        
        const particleTexture = createParticleTexture(THREE);

        earthDirectedCMEs.forEach(cme => {
            const particleCount = getCmeParticleCount(cme.speed);
            const positions: number[] = [];
            const colors: number[] = [];
            const coneHalfAngleRad = (cme.halfAngle * Math.PI) / 180;
            const coreColor = getCmeCoreColor(THREE, cme.speed);

            for (let i = 0; i < particleCount; i++) {
                const y = Math.random();
                const theta = Math.random() * 2 * Math.PI;
                const r = Math.tan(coneHalfAngleRad) * y * Math.sqrt(Math.random());
                positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
                colors.push(coreColor.r, coreColor.g, coreColor.b);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const mat = new THREE.PointsMaterial({
                size: getCmeParticleSize(cme.speed, SCENE_SCALE),
                map: particleTexture,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: true,
                opacity: getCmeOpacity(cme.speed),
                vertexColors: true,
            });

            const particleSystem = new THREE.Points(geo, mat);
            particleSystem.userData = cme;
            const direction = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - (cme.latitude * Math.PI) / 180, (cme.longitude * Math.PI) / 180);
            particleSystem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
            cmeGroupRef.current.add(particleSystem);
        });
    }, [earthDirectedCMEs]);

    // --- Animation Loop ---
    useEffect(() => {
        props.resetClock();
        const animate = () => {
            animationFrameId.current = requestAnimationFrame(animate);
            const elapsedTime = props.getClockElapsedTime();
            const currentTimelineTime = props.timelineMinDate + (props.timelineMaxDate - props.timelineMinDate) * (props.timelineValue / 1000);

            // Animate planets
            Object.values(celestialBodiesRef.current).forEach((mesh: any) => {
                const data = mesh.userData;
                if (data && data.orbitalPeriodDays) {
                    const angularVelocity = (2 * Math.PI) / (data.orbitalPeriodDays * 24 * 3600) * ORBIT_SPEED_SCALE;
                    const angle = data.angle + angularVelocity * elapsedTime;
                    mesh.position.set(Math.sin(angle) * data.radius, 0, Math.cos(angle) * data.radius);
                }
            });

            // Animate CMEs
            cmeGroupRef.current?.children.forEach((cmeMesh: any) => {
                const cme = cmeMesh.userData;
                let timeSinceEventSeconds;
                if (props.timelineActive) {
                    timeSinceEventSeconds = (currentTimelineTime - cme.startTime.getTime()) / 1000;
                } else {
                    timeSinceEventSeconds = (Date.now() - cme.startTime.getTime()) / 1000;
                }
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

            // Render both scenes
            if (topRendererRef.current && sideRendererRef.current && sceneRef.current && topCameraRef.current && sideCameraRef.current) {
                topRendererRef.current.render(sceneRef.current, topCameraRef.current);
                sideRendererRef.current.render(sceneRef.current, sideCameraRef.current);
            }
        };
        animate();
        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        };
    }, [props]);

    // --- Click Handler using Raycasting ---
    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>, camera: any) => {
        const THREE = (window as any).THREE;
        if (!camera || !cmeGroupRef.current) return;
        
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const rect = event.currentTarget.getBoundingClientRect();
        
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        // Increase threshold for particle systems
        raycaster.params.Points.threshold = PLANET_DATA_MAP.EARTH.radius * 0.2;

        const intersects = raycaster.intersectObjects(cmeGroupRef.current.children);
        
        if (intersects.length > 0) {
            props.onCMEClick(intersects[0].object.userData);
        }
    };
    
    return (
        <div className="w-full h-full flex flex-col p-4 gap-4 bg-black">
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded z-10">Top-Down View</h2>
                <div ref={topDownMountRef} className="w-full h-full rounded-lg border border-neutral-700 cursor-pointer" onClick={(e) => handleCanvasClick(e, topCameraRef.current)} />
            </div>
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded z-10">Side View</h2>
                <div ref={sideViewMountRef} className="w-full h-full rounded-lg border border-neutral-700 cursor-pointer" onClick={(e) => handleCanvasClick(e, sideCameraRef.current)} />
            </div>
        </div>
    );
};

export default SimulationCanvas2D;
// --- END OF FILE src/components/SimulationCanvas2D.tsx ---