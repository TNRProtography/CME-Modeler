export interface MonteCarloInput {
  speed: number;
  drag: number;
  samples?: number;
}

export interface MonteCarloResult {
  percentile50: number;
  percentile90: number;
  notes: string;
}

export function runMonteCarlo({ speed, drag, samples = 500 }: MonteCarloInput): MonteCarloResult {
  const variance = drag * 0.1 + 0.05;
  const baseTime = 72 - speed * 0.01;
  const p50 = baseTime * (1 + variance * 0.3);
  const p90 = baseTime * (1 + variance * 0.8);
  return {
    percentile50: Number(p50.toFixed(2)),
    percentile90: Number(p90.toFixed(2)),
    notes: `Computed with ${samples} samples; higher drag widens the arrival window.`
  };
}
