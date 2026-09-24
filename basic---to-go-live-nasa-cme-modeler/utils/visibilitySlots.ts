// The five slots of "What to expect in the next couple of hours": Now, 15
// minutes, 30 minutes, 1 hour and 2 hours. One function, used by the app's
// card and the marketing site's live embed, so the two cannot disagree.
//
// Now, 15 and 30 minutes are worked out from the real solar wind. Every
// reading at L1 is moved forward by its own travel time to Earth, and the
// oval at each slot comes from the hour of wind that has reached Earth by
// then. At ordinary speeds that wind is all measured already - it takes 45
// minutes or more to get here - so these three are not projections.
//
// 1 hour and 2 hours are past what L1 has measured, and come from the Spot
// The Aurora score: the hour adjusted by the substorm engine's chance of an
// onset in it, two hours the score as it stands. Both get the viewer's
// location through the same viewline, with the oval held where the newest
// measured wind leaves it.
//
// Every slot then has the viewer's own sky at that time taken off it.

import type { SubstormForecast } from '../types';
import { auroraGeometryAt, realWindBoundary, scoreAtLocation, type L1Sample } from './auroraVisibility';
import { skyConditionsAt, visibilityOutlook } from './skyConditions';

export type SlotKey = 'Now' | '15 min' | '30 min' | '1 hour' | '2 hours';
export type SlotConfidence = 'high' | 'medium' | 'low';

export interface VisibilitySlot {
  key: SlotKey;
  offsetMin: number;
  /** How strong the aurora is for the viewer, 0-100, before the sky. */
  strength: number;
  /** After the Moon and twilight at that time. */
  effective: number;
  confidence: SlotConfidence;
  /** 'wind' - worked out from measured L1 wind; 'score' - from the Spot The Aurora score. */
  source: 'wind' | 'score';
  /** For wind slots: false when there was no L1 series and the fallback oval was used. */
  measured: boolean;
}

export interface VisibilitySlotInputs {
  nowMs: number;
  latitude: number;
  longitude: number;
  /** L1 readings, merged (mergeL1Series). */
  samples: L1Sample[];
  /** A confirmed onset at Eyrewell: counts for now and the next quarter hour. */
  bayOnset: boolean;
  /** The oval's midnight edge when there is no L1 series to use. */
  fallbackBoundary: number;
  /** The Spot The Aurora score, for the viewer. */
  auroraScore: number;
  substormForecast: Pick<SubstormForecast, 'status' | 'p30' | 'p60'>;
  workerTrend?: string;
  newellNow?: number;
  newellAvg30?: number;
  workerConfidence?: number | null;
}

/**
 * The substorm engine's projection of a score over the next hour: its status,
 * its 30 and 60 minute onset chances, its trend, and whether coupling is
 * picking up right now. Applied here to the Spot The Aurora score for the
 * hour slot.
 */
export function projectSubstormScores(
  base: number,
  forecast: Pick<SubstormForecast, 'status' | 'p30' | 'p60'>,
  workerTrend?: string,
  newellNow?: number,
  newellAvg30?: number,
  confidence?: number | null,
): { score15: number; score30: number; score60: number } {
  const { status, p30, p60 } = forecast;

  const trendMult =
    workerTrend === 'Rapidly Increasing' ? 1.18 :
    workerTrend === 'Increasing'         ? 1.08 :
    workerTrend === 'Decreasing'         ? 0.88 :
    workerTrend === 'Rapidly Decreasing' ? 0.72 : 1.0;

  // Coupling intensifying right now boosts the near term.
  const newellAccel = newellNow && newellAvg30 && newellNow > newellAvg30 * 1.2;
  const newellBoost = newellAccel ? 1.08 : 1.0;

  // Low confidence narrows the projection.
  const confMult = confidence != null ? (0.7 + (confidence / 100) * 0.3) : 1.0;

  const boostFromP = (p: number, b: number) => b + p * (100 - b) * 0.75;

  let score15: number, score30: number, score60: number;
  switch (status) {
    case 'ONSET':
      score15 = base * 1.05; score30 = base * 0.90; score60 = base * 0.62; break;
    case 'IMMINENT_30':
      score15 = boostFromP(p30, base); score30 = boostFromP(p30, base) * 1.05; score60 = boostFromP(p60, base) * 0.78; break;
    case 'LIKELY_60':
      score15 = base * 1.08; score30 = boostFromP(p30 * 0.65, base); score60 = boostFromP(p60, base); break;
    case 'WATCH':
      score15 = base * 1.04; score30 = base * 1.12; score60 = boostFromP(p60 * 0.45, base); break;
    case 'QUIET':
    default:
      score15 = base * 0.94; score30 = base * 0.83; score60 = base * 0.68; break;
  }

  const applyAll = (s: number) => Math.max(0, s * trendMult * newellBoost * confMult);
  return { score15: applyAll(score15), score30: applyAll(score30), score60: applyAll(score60) };
}

/** How sure the substorm engine is about its hour, by its status. */
function hourConfidence(status: SubstormForecast['status']): SlotConfidence {
  if (status === 'IMMINENT_30') return 'medium';
  if (status === 'LIKELY_60') return 'high';
  return 'low';
}

export function computeVisibilitySlots(i: VisibilitySlotInputs): VisibilitySlot[] {
  const at = (offsetMin: number) => i.nowMs + offsetMin * 60000;
  const sky = (offsetMin: number) => skyConditionsAt(at(offsetMin), i.latitude, i.longitude);

  let heldBoundary = i.fallbackBoundary;
  const windSlot = (key: SlotKey, offsetMin: number): VisibilitySlot => {
    const real = realWindBoundary(i.samples, at(offsetMin), offsetMin <= 15 && i.bayOnset);
    const boundary = real?.boundary ?? i.fallbackBoundary;
    heldBoundary = boundary;
    const strength = auroraGeometryAt(boundary, at(offsetMin), i.latitude, i.longitude).strength;
    const full = real != null && real.wind.coverage >= 0.999;
    return {
      key, offsetMin, strength,
      effective: visibilityOutlook(strength, sky(offsetMin)).effectiveStrength,
      confidence: full ? 'high' : real ? 'medium' : 'low',
      source: 'wind',
      measured: real != null,
    };
  };

  const now = windSlot('Now', 0);
  const in15 = windSlot('15 min', 15);
  const in30 = windSlot('30 min', 30);

  const scoreSlot = (key: SlotKey, offsetMin: number, score: number, confidence: SlotConfidence): VisibilitySlot => {
    const strength = scoreAtLocation(Math.min(100, Math.max(0, score)), heldBoundary, at(offsetMin), i.latitude, i.longitude);
    return {
      key, offsetMin, strength,
      effective: visibilityOutlook(strength, sky(offsetMin)).effectiveStrength,
      confidence,
      source: 'score',
      measured: true,
    };
  };

  const hour = projectSubstormScores(i.auroraScore, i.substormForecast, i.workerTrend,
    i.newellNow, i.newellAvg30, i.workerConfidence).score60;

  return [
    now, in15, in30,
    scoreSlot('1 hour', 60, hour, hourConfidence(i.substormForecast.status)),
    scoreSlot('2 hours', 120, i.auroraScore, 'low'),
  ];
}
