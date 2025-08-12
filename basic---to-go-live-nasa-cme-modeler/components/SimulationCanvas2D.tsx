// --- START OF FILE src/components/SimulationCanvas2D.tsx ---

import React, { useRef, useEffect, useCallback } from 'react';
import { ProcessedCME, ViewMode } from '../types';
import { PLANET_DATA_MAP, SCENE_SCALE, AU_IN_KM } from '../constants';

// --- Props Interface ---
interface SimulationCanvas2DProps {
  cmeData: ProcessedCME[];
  activeView: ViewMode;
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
  showLabels: boolean;
  getClockElapsedTime: () => number;
  resetClock: () => void;
}

// --- Helper Functions (adapted for 2D canvas) ---
const ORBIT_SPEED_SCALE = 2000;

const calculateDistance = (cme: ProcessedCME, timeSinceEventSeconds: number): number => {
    const speed_km_per_sec = cme.speed;
    const speed_AU_per_sec = speed_km_per_sec / AU_IN_KM;
    const distanceActualAU = speed_AU_per_sec * Math.max(0, timeSinceEventSeconds);
    return distanceActualAU * SCENE_SCALE;
};

const getCmeCoreColor = (speed: number): string => {
    if (speed >= 2500) return '#ff69b4'; // Hot Pink
    if (speed >= 1800) return '#9370db'; // Medium Purple
    if (speed >= 1000) return '#ff4500'; // OrangeRed
    if (speed >= 800) return '#ffa500'; // Orange
    if (speed >= 500) return '#ffff00'; // Yellow
    if (speed < 350) return '#808080'; // Grey
    const t = (speed - 350) / (500 - 350);
    const r = Math.round(128 * (1 - t) + 255 * t);
    const g = Math.round(128 * (1 - t) + 255 * t);
    const b = Math.round(128 * (1 - t) + 0 * t);
    return `rgb(${r},${g},${b})`;
};

const getCmeOpacity = (speed: number): number => {
    const minSpeed = 300, maxSpeed = 3000, minOpacity = 0.15, maxOpacity = 0.7;
    const s = Math.max(minSpeed, Math.min(speed, maxSpeed));
    return minOpacity + ((s - minSpeed) / (maxSpeed - minSpeed)) * (maxOpacity - minOpacity);
};

// --- The 2D Canvas Component ---
const SimulationCanvas2D: React.FC<SimulationCanvas2DProps> = (props) => {
    const topDownCanvasRef = useRef<HTMLCanvasElement>(null);
    const sideViewCanvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>();
    
    // --- NEW: Filter for only Earth-directed CMEs ---
    const earthDirectedCMEs = props.cmeData.filter(cme => cme.isEarthDirected);

    const draw = useCallback(() => {
        const canvases = [topDownCanvasRef.current, sideViewCanvasRef.current];
        canvases.forEach((canvas, index) => {
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const isSideView = index === 1;
            const width = canvas.width;
            const height = canvas.height;
            const centerX = width / 2;
            const centerY = height / 2;
            
            const maxOrbitRadius = PLANET_DATA_MAP.MARS.radius * 1.2;
            const scale = Math.min(width, height) / (maxOrbitRadius * 2);

            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, width, height);

            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.lineWidth = 1;
            ['EARTH', 'MERCURY', 'VENUS', 'MARS'].forEach(name => {
                if (!props.showExtraPlanets && name !== 'EARTH') return;
                const planet = PLANET_DATA_MAP[name as keyof typeof PLANET_DATA_MAP];
                if(isSideView) {
                    ctx.beginPath();
                    ctx.moveTo(centerX - planet.radius * scale, centerY);
                    ctx.lineTo(centerX + planet.radius * scale, centerY);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, planet.radius * scale, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            });

            const elapsedTime = props.getClockElapsedTime();
            const currentTimelineTime = props.timelineMinDate + (props.timelineMaxDate - props.timelineMinDate) * (props.timelineValue / 1000);

            // --- Draw Sun ---
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(centerX, centerY, PLANET_DATA_MAP.SUN.size * scale, 0, 2 * Math.PI);
            ctx.fill();

            // --- Calculate Earth's position for the prediction line ---
            let earthX = centerX, earthY = centerY;
            const earthData = PLANET_DATA_MAP.EARTH;
            const earthAngularVelocity = (2 * Math.PI) / (earthData.orbitalPeriodDays! * 24 * 3600) * ORBIT_SPEED_SCALE;
            const earthAngle = earthData.angle + earthAngularVelocity * elapsedTime;
            earthX = centerX + Math.sin(earthAngle) * earthData.radius * scale;
            earthY = isSideView ? centerY : centerY + Math.cos(earthAngle) * earthData.radius * scale;

            // --- NEW: Draw prediction line from Sun to Earth in top-down view ---
            if (!isSideView) {
                ctx.save();
                ctx.setLineDash([5, 10]);
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(earthX, earthY);
                ctx.stroke();
                ctx.restore();
            }

            // --- Draw CMEs ---
            earthDirectedCMEs.forEach(cme => {
                let timeSinceEventSeconds;
                if (props.timelineActive) {
                    timeSinceEventSeconds = (currentTimelineTime - cme.startTime.getTime()) / 1000;
                } else {
                    timeSinceEventSeconds = (Date.now() - cme.startTime.getTime()) / 1000;
                }

                if (timeSinceEventSeconds < 0) return;

                const sunRadius = PLANET_DATA_MAP.SUN.size * scale;
                const dist = calculateDistance(cme, timeSinceEventSeconds) * scale;
                if (dist <= sunRadius) return;

                const lonRad = (cme.longitude * Math.PI) / 180;
                const latRad = (cme.latitude * Math.PI) / 180;
                const halfAngleRad = (cme.halfAngle * Math.PI) / 180;
                
                // --- NEW: Create a radial gradient to simulate particle cloud ---
                const coreColor = getCmeCoreColor(cme.speed);
                const gradient = ctx.createRadialGradient(centerX, centerY, sunRadius, centerX, centerY, dist);
                gradient.addColorStop(0, 'rgba(0,0,0,0)'); // Transparent at the sun
                gradient.addColorStop(0.7, `${coreColor}B0`); // Semi-transparent body
                gradient.addColorStop(1, `${coreColor}20`); // Fading edge
                
                ctx.fillStyle = gradient;
                ctx.globalAlpha = getCmeOpacity(cme.speed);

                if(isSideView) {
                    const startAngle = latRad - halfAngleRad;
                    const endAngle = latRad + halfAngleRad;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, dist, -endAngle, -startAngle);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    const startAngle = -lonRad - halfAngleRad - Math.PI / 2;
                    const endAngle = -lonRad + halfAngleRad - Math.PI / 2;
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.arc(centerX, centerY, dist, startAngle, endAngle);
                    ctx.closePath();
                    ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;


            // --- Draw Planets & Labels ---
            ['EARTH', 'MERCURY', 'VENUS', 'MARS'].forEach(name => {
                if (!props.showExtraPlanets && name !== 'EARTH') return;
                const planet = PLANET_DATA_MAP[name as keyof typeof PLANET_DATA_MAP];
                const angularVelocity = (2 * Math.PI) / (planet.orbitalPeriodDays! * 24 * 3600) * ORBIT_SPEED_SCALE;
                const angle = planet.angle + angularVelocity * elapsedTime;
                
                const planetX = centerX + Math.sin(angle) * planet.radius * scale;
                const planetY = isSideView ? centerY : centerY + Math.cos(angle) * planet.radius * scale;

                ctx.fillStyle = planet.color as string;
                ctx.beginPath();
                ctx.arc(planetX, planetY, Math.max(2, planet.size * scale * 50), 0, 2 * Math.PI);
                ctx.fill();

                if (props.showLabels) {
                    ctx.fillStyle = 'white';
                    ctx.font = '12px sans-serif';
                    ctx.fillText(planet.name, planetX + 5, planetY + 4);
                }
            });
        });

        animationFrameId.current = requestAnimationFrame(draw);
    }, [props, earthDirectedCMEs]); // Depend on the filtered array

    useEffect(() => {
        props.resetClock();
        animationFrameId.current = requestAnimationFrame(draw);

        const resizeObserver = new ResizeObserver(() => {
            [topDownCanvasRef.current, sideViewCanvasRef.current].forEach(canvas => {
                if (canvas && canvas.parentElement) {
                    canvas.width = canvas.parentElement.clientWidth;
                    canvas.height = canvas.parentElement.clientHeight;
                }
            });
        });

        if (topDownCanvasRef.current?.parentElement) resizeObserver.observe(topDownCanvasRef.current.parentElement);
        if (sideViewCanvasRef.current?.parentElement) resizeObserver.observe(sideViewCanvasRef.current.parentElement);

        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            resizeObserver.disconnect();
        };
    }, [draw, props.resetClock]);
    
    const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>, isSideView: boolean) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const maxOrbitRadius = PLANET_DATA_MAP.MARS.radius * 1.2;
        const scale = Math.min(width, height) / (maxOrbitRadius * 2);

        const clickDist = Math.sqrt((x - centerX)**2 + (y - centerY)**2);
        let clickAngle = Math.atan2(y - centerY, x - centerX);

        const currentTimelineTime = props.timelineMinDate + (props.timelineMaxDate - props.timelineMinDate) * (props.timelineValue / 1000);

        let clickedCME: ProcessedCME | null = null;
        [...earthDirectedCMEs].reverse().forEach(cme => { // Use filtered array
            if (clickedCME) return;
            
            let timeSinceEventSeconds;
            if (props.timelineActive) {
                timeSinceEventSeconds = (currentTimelineTime - cme.startTime.getTime()) / 1000;
            } else {
                timeSinceEventSeconds = (Date.now() - cme.startTime.getTime()) / 1000;
            }
            if (timeSinceEventSeconds < 0) return;

            const dist = calculateDistance(cme, timeSinceEventSeconds) * scale;
            if (clickDist > dist) return;

            const halfAngleRad = (cme.halfAngle * Math.PI) / 180;
            let cmeAngle;
            if(isSideView) {
                cmeAngle = -(cme.latitude * Math.PI) / 180;
            } else {
                cmeAngle = -(cme.longitude * Math.PI) / 180 - Math.PI / 2;
            }

            let angleDiff = Math.abs(clickAngle - cmeAngle);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff <= halfAngleRad) {
                clickedCME = cme;
            }
        });
        
        if (clickedCME) {
            props.onCMEClick(clickedCME);
        }
    };

    return (
        <div className="w-full h-full flex flex-col p-4 gap-4 bg-black">
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded">Top-Down View</h2>
                <canvas ref={topDownCanvasRef} className="w-full h-full rounded-lg border border-neutral-700" onClick={(e) => handleCanvasClick(e, false)} />
            </div>
            <div className="flex-1 min-h-0 relative">
                <h2 className="absolute top-2 left-2 text-white font-bold bg-black/50 px-2 py-1 rounded">Side View</h2>
                <canvas ref={sideViewCanvasRef} className="w-full h-full rounded-lg border border-neutral-700" onClick={(e) => handleCanvasClick(e, true)}/>
            </div>
        </div>
    );
};

export default SimulationCanvas2D;
// --- END OF FILE src/components/SimulationCanvas2D.tsx ---