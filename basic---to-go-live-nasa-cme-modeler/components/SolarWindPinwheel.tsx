import React, { useEffect, useMemo, useRef } from 'react';

const SUN_CENTER = 256;
const SOLAR_ANGULAR_VELOCITY = 2.7e-6; // rad/s
const AU_KM = 149_597_870.7;
const FAST_WIND_SPEED = 650; // km/s
const SLOW_WIND_SPEED = 400; // km/s
const DEFAULT_SIZE = 600;

export interface CHPoint {
  x: number;
  y: number;
}

export interface CHData {
  coronal_holes_polygons: CHPoint[];
}

export interface SolarWindPinwheelProps {
  data: CHData;
  size?: number;
  earthAngleDeg?: number;
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

const buildFastWindBins = (data: CHData | undefined, binCount = 360) => {
  const bins = new Array<boolean>(binCount).fill(false);
  const points = data?.coronal_holes_polygons ?? [];

  points.forEach(point => {
    const angle = Math.atan2(point.y - SUN_CENTER, point.x - SUN_CENTER);
    const deg = (angle * 180) / Math.PI;
    const normalizedDeg = (deg + 360) % 360;
    const bin = Math.round(normalizedDeg) % binCount;
    bins[bin] = true;
  });

  return bins;
};

const drawSpiral = (
  ctx: CanvasRenderingContext2D,
  startAngle: number,
  spiralFactor: number,
  maxRadius: number,
  center: number,
  segments: number,
  color: string,
  width: number,
  alpha: number
) => {
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const rFraction = i / segments; // 0 to 1 AU
    const radius = rFraction * maxRadius;
    const phi = startAngle + spiralFactor * rFraction;
    const x = center + radius * Math.cos(phi);
    const y = center + radius * Math.sin(phi);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.stroke();
};

const SolarWindPinwheel: React.FC<SolarWindPinwheelProps> = ({ data, size = DEFAULT_SIZE, earthAngleDeg = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fastWindBins = useMemo(() => buildFastWindBins(data), [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;

    const center = size / 2;
    const auRadius = size * 0.45;
    const spiralSegments = 180;
    const spiralFactorSlow = (SOLAR_ANGULAR_VELOCITY * AU_KM) / SLOW_WIND_SPEED;
    const spiralFactorFast = (SOLAR_ANGULAR_VELOCITY * AU_KM) / FAST_WIND_SPEED;

    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    // 1 AU dashed ring
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([8, 10]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(center, center, auRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Sun glow
    const sunGradient = ctx.createRadialGradient(center, center, 4, center, center, 32);
    sunGradient.addColorStop(0, '#ffe7a8');
    sunGradient.addColorStop(0.6, 'rgba(255, 200, 120, 0.65)');
    sunGradient.addColorStop(1, 'rgba(255, 180, 80, 0.25)');
    ctx.fillStyle = sunGradient;
    ctx.beginPath();
    ctx.arc(center, center, 18, 0, Math.PI * 2);
    ctx.fill();

    // Slow wind canvas pass
    for (let deg = 0; deg < 360; deg++) {
      const angle = toRadians(deg);
      const isFast = fastWindBins[deg];
      if (isFast) continue;
      drawSpiral(ctx, angle, spiralFactorSlow, auRadius, center, spiralSegments, '#2A4B7C', 0.9, 0.35);
    }

    // Fast wind ribbons
    for (let deg = 0; deg < 360; deg++) {
      if (!fastWindBins[deg]) continue;
      const angle = toRadians(deg);
      ctx.shadowColor = 'rgba(217, 130, 43, 0.45)';
      ctx.shadowBlur = 12;
      drawSpiral(ctx, angle, spiralFactorFast, auRadius, center, spiralSegments, '#D9822B', 3.6, 0.85);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Earth marker
    const earthAngle = toRadians(earthAngleDeg);
    const earthX = center + auRadius * Math.cos(earthAngle);
    const earthY = center + auRadius * Math.sin(earthAngle);
    ctx.fillStyle = '#4da6ff';
    ctx.strokeStyle = '#d7ecff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(earthX, earthY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }, [data, earthAngleDeg, fastWindBins, size]);

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="rounded-2xl shadow-2xl border border-white/10"
      />
      <div className="text-sm text-neutral-200 text-center max-w-2xl">
        Solar wind pinwheel showing Parker spiral streams: amber ribbons for fast wind sourced from the provided coronal hole
        map, blue-grey for ambient slow wind, with Earth fixed at 1 AU on the right.
      </div>
    </div>
  );
};

export default SolarWindPinwheel;
