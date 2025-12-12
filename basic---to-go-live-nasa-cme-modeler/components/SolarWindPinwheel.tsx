import React, { useEffect, useMemo, useRef } from 'react';
import type { CHData } from '../types';

interface SolarWindPinwheelProps {
  data: CHData;
  size?: number;
  earthAngleRadians?: number;
}

const AU_IN_KM = 149_600_000; // 1 Astronomical Unit in km
const SUN_ANGULAR_VELOCITY = 2.7e-6; // rad/s
const DEFAULT_SLOW_WIND_SPEED = 400; // km/s
const DEFAULT_FAST_WIND_SPEED = 650; // km/s

const SolarWindPinwheel: React.FC<SolarWindPinwheelProps> = ({
  data,
  size = 600,
  earthAngleRadians = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fastWindAngles = useMemo(() => {
    const bins = new Array(360).fill(false);
    data?.coronal_holes_polygons?.forEach(({ x, y }) => {
      const angle = Math.atan2(y - 256, x - 256);
      const degrees = Math.round(((angle * 180) / Math.PI + 360) % 360);
      bins[degrees] = true;
    });
    return bins;
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    const center = size / 2;
    const orbitRadius = size * 0.45;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const drawSpiral = (
      startAngle: number,
      speedKmPerSec: number,
      color: string,
      lineWidth: number,
      alpha: number,
      steps = 220
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = alpha;
      ctx.beginPath();

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const radialDistance = orbitRadius * t;
        const distanceKm = AU_IN_KM * t;
        const angle = startAngle + (SUN_ANGULAR_VELOCITY * distanceKm) / speedKmPerSec;
        const x = center + radialDistance * Math.cos(angle);
        const y = center + radialDistance * Math.sin(angle);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
      ctx.restore();
    };

    // Slow wind background
    for (let deg = 0; deg < 360; deg += 1) {
      const angle = (deg * Math.PI) / 180;
      drawSpiral(angle, DEFAULT_SLOW_WIND_SPEED, '#2A4B7C', 0.8, 0.35);
    }

    // Fast wind ribbons sourced from coronal holes
    fastWindAngles.forEach((isFast, deg) => {
      if (!isFast) return;
      const angle = (deg * Math.PI) / 180;
      drawSpiral(angle, DEFAULT_FAST_WIND_SPEED, '#D9822B', 2.5, 0.9);
    });

    // 1 AU dashed orbit
    ctx.save();
    ctx.strokeStyle = '#4c6483';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(center, center, orbitRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Sun
    const sunRadius = 8;
    const sunGradient = ctx.createRadialGradient(center, center, 0, center, center, sunRadius * 3);
    sunGradient.addColorStop(0, 'rgba(255, 215, 0, 1)');
    sunGradient.addColorStop(1, 'rgba(255, 165, 0, 0)');
    ctx.fillStyle = sunGradient;
    ctx.beginPath();
    ctx.arc(center, center, sunRadius * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(center, center, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    // Earth
    const earthRadius = 5;
    const earthX = center + orbitRadius * Math.cos(earthAngleRadians);
    const earthY = center + orbitRadius * Math.sin(earthAngleRadians);
    ctx.fillStyle = '#4da6ff';
    ctx.strokeStyle = '#1f5a99';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }, [fastWindAngles, size, earthAngleRadians]);

  return (
    <div style={{ display: 'inline-block', backgroundColor: '#000000', padding: '8px', borderRadius: '8px' }}>
      <canvas ref={canvasRef} width={size} height={size} />
      <p style={{ color: '#9fb3c8', fontSize: '12px', marginTop: '4px', textAlign: 'center' }}>
        Solar Wind Pinwheel (WSA-Enlil style)
      </p>
    </div>
  );
};

export default SolarWindPinwheel;

/**
 * Example usage:
 *
 * <SolarWindPinwheel
 *   data={{
 *     coronal_holes_polygons: [
 *       { x: 360, y: 200 },
 *       { x: 180, y: 220 },
 *     ],
 *   }}
 *   size={640}
 *   earthAngleRadians={0}
 * />
 */
