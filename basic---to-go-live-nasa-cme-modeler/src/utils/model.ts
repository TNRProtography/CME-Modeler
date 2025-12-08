import { CMEForecast, CMEMilestone, CMEParameters } from '../types';

const AU_KM = 149_597_870;

const fractionStops = [0, 0.25, 0.5, 0.75, 1];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function predictCMEArrival(params: CMEParameters): CMEForecast {
  const launch = new Date(params.launchTime);
  const distanceKm = AU_KM;
  const v0 = params.initialSpeed; // km/s
  const a = params.acceleration; // km/s^2

  let transitSeconds: number;
  if (Math.abs(a) < 1e-6) {
    transitSeconds = distanceKm / Math.max(v0, 1);
  } else {
    const discriminant = v0 * v0 + 2 * a * distanceKm;
    const safeDiscriminant = discriminant < 0 ? 0 : discriminant;
    const sqrt = Math.sqrt(safeDiscriminant);
    const candidate = (-v0 + sqrt) / a;
    transitSeconds = candidate > 0 ? candidate : distanceKm / Math.max(v0, 1);
  }

  const transitHours = transitSeconds / 3600;
  const arrival = new Date(launch.getTime() + transitSeconds * 1000);
  const finalSpeed = v0 + a * transitSeconds;

  const kpEstimate = Math.round(
    clamp(2 + params.density * 0.1 + params.angularWidth * 0.02 + v0 * 0.002 + a * -900, 1, 9),
  );

  const milestones: CMEMilestone[] = fractionStops.map((fraction) => {
    const t = transitSeconds * fraction;
    const distance = distanceKm * fraction;
    const speed = v0 + a * t;
    return {
      label: fraction === 1 ? 'Arrival' : `${Math.round(fraction * 100)}% distance`,
      timeHours: t / 3600,
      distanceAU: distance / AU_KM,
      speed,
    };
  });

  return { arrival, transitHours, finalSpeed, kpEstimate, milestones };
}

export function formatDate(date: Date) {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
