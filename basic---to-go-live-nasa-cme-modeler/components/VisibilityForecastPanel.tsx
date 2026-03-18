//--- START OF FILE src/components/VisibilityForecastPanel.tsx ---

import React, { useMemo } from 'react';
import { SubstormForecast, SightingReport } from '../types';
import type { SubstormRiskData } from '../hooks/useForecastData';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotConfig {
  label: string;
  phrase: string;
  icon: string;
  subtext: string | null;
  confidence: 'ground' | 'high' | 'medium' | 'low' | 'hidden';
}

interface VisibilityForecastPanelProps {
  auroraScore: number | null;
  substormForecast: SubstormForecast;
  substormRiskData: SubstormRiskData | null;
  recentSightings: SightingReport[];
  isDaylight: boolean;
  userLatitude?: number | null;
  userLongitude?: number | null;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── Oval geometry (mirrors AuroraSightings) ─────────────────────────────────
const POLE_LAT_RAD =  80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

function geoToGmagLat(latDeg: number, lonDeg: number): number {
  const phi = latDeg * Math.PI / 180;
  const lam = lonDeg * Math.PI / 180;
  const sin = Math.sin(phi) * Math.sin(POLE_LAT_RAD) +
              Math.cos(phi) * Math.cos(POLE_LAT_RAD) * Math.cos(lam - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * 180 / Math.PI;
}

function computeOvalBoundary(metrics: SubstormRiskData['metrics'], bayOnset: boolean): number {
  const newell60 = metrics?.solar_wind?.newell_avg_60m ?? 0;
  const newell30 = metrics?.solar_wind?.newell_avg_30m ?? 0;
  const newell   = Math.max(newell60, newell30 * 0.85);
  let boundary   = -(65.5 - newell / 1800);
  boundary       = Math.max(boundary, -76);
  boundary       = Math.min(boundary, -44);
  if (bayOnset) boundary = Math.min(boundary, -47.2);
  return boundary;
}

/**
 * Returns a location-adjusted score for visibility display.
 * If the user is north of the visibility horizon, the score is reduced
 * proportionally so the phrase matches what the map shows.
 * If no location is available, the raw score is returned unchanged.
 */
function locationAdjustedScore(
  rawScore: number,
  userLat: number | null | undefined,
  userLon: number | null | undefined,
  metrics: SubstormRiskData['metrics'],
  bayOnset: boolean,
): number {
  if (userLat == null || userLon == null) return rawScore;
  const userGmag   = geoToGmagLat(userLat, userLon);
  const boundary   = computeOvalBoundary(metrics, bayOnset);
  const visDeg     = 9.0 + (Math.max(0, Math.min(rawScore, 100)) / 100) * 16.0;
  const visHorizon = boundary + visDeg; // geomagnetic lat of visibility line (negative)
  // distFromVis: positive = user is equatorward (north) of vis line = can't see
  //              negative = user is poleward (south) of vis line = can see
  const distFromVis = userGmag - visHorizon;
  if (distFromVis <= 0) {
    // User is within or past the visibility horizon — no adjustment needed
    return rawScore;
  }
  // User is north of visibility line. Scale score down based on how far.
  // Every 1° north of the line roughly halves visibility, capped at 0.
  // 3° north = almost invisible, 5° north = nothing to see.
  const penalty = Math.min(1, distFromVis / 4.0);
  return rawScore * (1 - penalty);
}

interface VisibilityResult {
  phrase: string;
  icon: string;
  subtext: string | null;
}

// ─── Visibility phrase logic ──────────────────────────────────────────────────

function getVisibilityPhrase(
  projectedScore: number,
  confidence: ConfidenceLevel,
  sightingContext?: { eyeCount: number; phoneCount: number; nothingCount: number; total: number }
): VisibilityResult {
  const hasSightings = sightingContext && sightingContext.total > 0;
  const eyeConfirmed    = hasSightings && sightingContext!.eyeCount > 0;
  const phoneConfirmed  = hasSightings && sightingContext!.phoneCount > 0 && !eyeConfirmed;
  const nothingReported = hasSightings && sightingContext!.nothingCount >= 3 && !eyeConfirmed && !phoneConfirmed;

  let subtext: string | null = null;
  if (eyeConfirmed) {
    subtext = `${sightingContext!.eyeCount} ${sightingContext!.eyeCount === 1 ? 'person nearby is' : 'people nearby are'} seeing it with their own eyes right now`;
  } else if (phoneConfirmed) {
    subtext = `${sightingContext!.phoneCount} ${sightingContext!.phoneCount === 1 ? 'person nearby has' : 'people nearby have'} spotted it on their phone camera`;
  } else if (nothingReported) {
    subtext = `${sightingContext!.nothingCount} people nearby have checked — nothing visible yet`;
  } else if (hasSightings && sightingContext!.total > 0) {
    subtext = `${sightingContext!.total} report${sightingContext!.total > 1 ? 's' : ''} coming in from people nearby`;
  }

  if (projectedScore >= 80) {
    const phrase = confidence === 'high'
      ? 'Go outside now — this could be one of the best displays in years'
      : confidence === 'medium'
      ? 'Conditions look exceptional — well worth heading out to have a look'
      : 'Could turn into something special — keep a close eye on this';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 65) {
    const phrase = confidence === 'high'
      ? 'You should be able to see it with your own eyes — look south'
      : confidence === 'medium'
      ? 'Good chance of seeing it with your own eyes in a dark spot'
      : 'Might be visible with your own eyes if conditions stay this way';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 50) {
    const phrase = confidence === 'high'
      ? 'A faint green glow should be visible to the south — find somewhere dark'
      : confidence === 'medium'
      ? 'A faint glow to the south is possible — get away from street lights'
      : 'Might just be visible to the eye if you find somewhere dark enough';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 35) {
    const phrase = confidence === 'high'
      ? 'Your phone camera will pick it up — point it south and take a photo'
      : confidence === 'medium'
      ? 'Worth taking a photo to the south — your phone may surprise you'
      : 'Your phone camera might pick something up if conditions improve';
    return { phrase, icon: '📱', subtext };
  }
  if (projectedScore >= 20) {
    const phrase = confidence === 'high'
      ? 'Very faint — only a long-exposure camera shot would show anything'
      : confidence === 'medium'
      ? 'Very faint if anything — not worth going out specially'
      : 'Unlikely to show up even on camera at this stage';
    return { phrase, icon: '📷', subtext };
  }

  const phrase = confidence === 'high'
    ? 'Activity just picked up — aurora may be starting right now'
    : confidence === 'medium'
    ? 'Very quiet — not worth going out at the moment'
    : 'Quiet — come back later';
  return { phrase: confidence === 'high' && projectedScore < 5 ? 'Nothing to see — the sky will look completely normal' : phrase, icon: '😴', subtext: nothingReported ? subtext : null };
}

// ─── Score projection — substorm worker only ─────────────────────────────────
//
// All projected scores derive exclusively from the substorm worker's current
// score and its own physics-based trend signals. The SpotTheAurora composite
// is NOT used here — it's a visibility estimate, not a substorm measurement.

function projectSubstormScores(
  workerScore: number,
  forecast: SubstormForecast,
  workerTrend?: string,
  newellNow?: number,
  newellAvg30?: number,
  confidence?: number | null,
): { score15: number; score30: number; score60: number } {
  const { status, p30, p60 } = forecast;

  // Trend from the worker's own risk_trend field
  const trendMult =
    workerTrend === 'Rapidly Increasing' ? 1.18 :
    workerTrend === 'Increasing'         ? 1.08 :
    workerTrend === 'Decreasing'         ? 0.88 :
    workerTrend === 'Rapidly Decreasing' ? 0.72 : 1.0;

  // Newell acceleration — if coupling is intensifying right now, boost near-term
  const newellAccel = newellNow && newellAvg30 && newellNow > newellAvg30 * 1.2;
  const newellBoost = newellAccel ? 1.08 : 1.0;

  // Confidence-based dampening — low confidence = wider uncertainty, cap projections
  const confMult = confidence != null ? (0.7 + (confidence / 100) * 0.3) : 1.0;

  const boostFromP = (p: number, base: number) =>
    base + p * (100 - base) * 0.75;

  let score15: number, score30: number, score60: number;

  switch (status) {
    case 'ONSET':
      // Already happening — near-term stays high, 60 min starts to decay
      score15 = workerScore * 1.05;
      score30 = workerScore * 0.90;
      score60 = workerScore * 0.62;
      break;
    case 'IMMINENT_30':
      // Substorm expected within 30 min — peaks around 30 min mark
      score15 = boostFromP(p30, workerScore);
      score30 = boostFromP(p30, workerScore) * 1.05;
      score60 = boostFromP(p60, workerScore) * 0.78;
      break;
    case 'LIKELY_60':
      // Gradual build toward 60 min
      score15 = workerScore * 1.08;
      score30 = boostFromP(p30 * 0.65, workerScore);
      score60 = boostFromP(p60, workerScore);
      break;
    case 'WATCH':
      // Building but uncertain
      score15 = workerScore * 1.04;
      score30 = workerScore * 1.12;
      score60 = boostFromP(p60 * 0.45, workerScore);
      break;
    case 'QUIET':
    default:
      // Stable or decaying
      score15 = workerScore * 0.94;
      score30 = workerScore * 0.83;
      score60 = workerScore * 0.68;
      break;
  }

  const applyAll = (s: number) =>
    Math.max(0, s * trendMult * newellBoost * confMult);

  return {
    score15: applyAll(score15),
    score30: applyAll(score30),
    score60: applyAll(score60),
  };
}

function getSlotConfidence(
  status: SubstormForecast['status'],
  slot: '15m' | '30m' | '1h'
): ConfidenceLevel {
  if (status === 'ONSET')       return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
  if (status === 'IMMINENT_30') return slot === '1h'  ? 'medium' : 'high';
  if (status === 'LIKELY_60')   return slot === '1h'  ? 'high'   : 'medium';
  if (status === 'WATCH')       return slot === '15m' ? 'medium' : 'low';
  return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
}

function summariseSightings(sightings: SightingReport[]) {
  const cutoff = Date.now() - 30 * 60 * 1000;
  const recent = sightings.filter(s => s.timestamp >= cutoff);
  return {
    eyeCount:     recent.filter(s => s.status === 'eye').length,
    phoneCount:   recent.filter(s => s.status === 'phone' || s.status === 'dslr').length,
    nothingCount: recent.filter(s => s.status.startsWith('nothing')).length,
    total:        recent.filter(s => !s.status.startsWith('nothing') && s.status !== 'cloudy').length,
  };
}

// ─── Score colour helper ──────────────────────────────────────────────────────

function scoreColour(score: number): string {
  if (score >= 70) return '#34d399'; // green  — strong/NZ-visible conditions
  if (score >= 50) return '#fbbf24'; // amber  — developing/active
  if (score >= 30) return '#38bdf8'; // sky    — unsettled/disturbed
  return '#525252';                  // grey   — quiet
}

// ─── Confidence dot ───────────────────────────────────────────────────────────

const ConfidenceDot: React.FC<{ level: SlotConfig['confidence'] }> = ({ level }) => {
  const map: Record<SlotConfig['confidence'], { color: string; title: string }> = {
    ground: { color: 'bg-emerald-400', title: 'Ground truth — real sensor data' },
    high:   { color: 'bg-emerald-400', title: 'High confidence forecast' },
    medium: { color: 'bg-amber-400',   title: 'Moderate confidence forecast' },
    low:    { color: 'bg-neutral-500', title: 'Low confidence — treat as rough guide' },
    hidden: { color: 'bg-transparent', title: '' },
  };
  const { color, title } = map[level];
  if (level === 'hidden') return null;
  return <span className={`inline-block w-2 h-2 rounded-full ${color} flex-shrink-0 mt-0.5`} title={title} />;
};

// ─── Trend arrow ─────────────────────────────────────────────────────────────

const TrendArrow: React.FC<{ trend?: string }> = ({ trend }) => {
  if (!trend || trend === 'Stable') return <span className="text-xs text-neutral-600">→</span>;
  if (trend === 'Rapidly Increasing') return <span className="text-xs text-emerald-400 font-bold">↑↑</span>;
  if (trend === 'Increasing')         return <span className="text-xs text-emerald-500">↑</span>;
  if (trend === 'Rapidly Decreasing') return <span className="text-xs text-red-400 font-bold">↓↓</span>;
  if (trend === 'Decreasing')         return <span className="text-xs text-red-500">↓</span>;
  return null;
};

// ─── Main component ───────────────────────────────────────────────────────────

export const VisibilityForecastPanel: React.FC<VisibilityForecastPanelProps> = ({
  auroraScore,
  substormForecast,
  substormRiskData,
  recentSightings,
  isDaylight,
  userLatitude,
  userLongitude,
}) => {
  // All scores derive from the substorm worker — the physics-based measurement
  const rawWorkerScore = substormRiskData?.current?.score   ?? null;
  const workerScore    = rawWorkerScore != null
    ? locationAdjustedScore(
        rawWorkerScore,
        userLatitude,
        userLongitude,
        substormRiskData?.metrics,
        substormRiskData?.current?.bay_onset_flag ?? false,
      )
    : null;
  const workerTrend   = substormRiskData?.current?.risk_trend;
  const workerLevel   = substormRiskData?.current?.level;
  const bayOnset      = substormRiskData?.current?.bay_onset_flag   ?? false;
  const cmeSheath     = substormRiskData?.current?.cme_sheath_flag  ?? false;
  const newellNow     = substormRiskData?.metrics?.solar_wind?.newell_coupling_now;
  const newellAvg30   = substormRiskData?.metrics?.solar_wind?.newell_avg_30m;
  const workerConf    = substormRiskData?.current?.confidence;
  const bz            = substormRiskData?.metrics?.solar_wind?.bz;
  const southMin30    = substormRiskData?.metrics?.solar_wind?.southward_minutes_30m;

  // Now slot: worker score is ground truth. Fall back to auroraScore only if
  // the worker hasn't loaded yet.
  const nowScore    = workerScore ?? auroraScore ?? 0;

  // Forecast slots projected from raw (unadjusted) score, then each slot
  // gets the location penalty applied individually via locationAdjustedScore.
  const base = rawWorkerScore ?? auroraScore ?? 0;

  const sightingContext = useMemo(() => summariseSightings(recentSightings), [recentSightings]);

  const { score15: rawScore15, score30: rawScore30, score60: rawScore60 } = useMemo(
    () => projectSubstormScores(base, substormForecast, workerTrend, newellNow, newellAvg30, workerConf),
    [base, substormForecast, workerTrend, newellNow, newellAvg30, workerConf]
  );

  const conf15 = getSlotConfidence(substormForecast.status, '15m');
  const conf30 = getSlotConfidence(substormForecast.status, '30m');
  const conf60 = getSlotConfidence(substormForecast.status, '1h');

  const nowVisibility = useMemo(() => {
    const base = getVisibilityPhrase(nowScore, 'high', sightingContext);
    const extraNotes: string[] = [];
    if (bayOnset)  extraNotes.push('Activity just picked up — aurora may be starting right now');
    if (cmeSheath) extraNotes.push('A solar storm is passing Earth right now — conditions could change fast');
    if (workerConf != null && nowScore >= 30) {
      extraNotes.push(`${workerConf}% chance of a display based on current solar conditions`);
    }
    return {
      ...base,
      subtext: [base.subtext, ...extraNotes].filter(Boolean).join(' · ') || null,
    };
  }, [nowScore, sightingContext, bayOnset, cmeSheath, workerConf]);

  const score15 = useMemo(() => locationAdjustedScore(rawScore15, userLatitude, userLongitude, substormRiskData?.metrics, bayOnset), [rawScore15, userLatitude, userLongitude, substormRiskData, bayOnset]);
  const score30 = useMemo(() => locationAdjustedScore(rawScore30, userLatitude, userLongitude, substormRiskData?.metrics, bayOnset), [rawScore30, userLatitude, userLongitude, substormRiskData, bayOnset]);
  const score60 = useMemo(() => locationAdjustedScore(rawScore60, userLatitude, userLongitude, substormRiskData?.metrics, bayOnset), [rawScore60, userLatitude, userLongitude, substormRiskData, bayOnset]);
  const vis15 = useMemo(() => getVisibilityPhrase(score15, conf15), [score15, conf15]);
  const vis30 = useMemo(() => getVisibilityPhrase(score30, conf30), [score30, conf30]);
  const vis60 = useMemo(() => getVisibilityPhrase(score60, conf60), [score60, conf60]);

  // Use raw (unadjusted) score to gate forecast slot visibility — slots should
  // always show when conditions are active globally, even if the user is north
  // of the visibility line. The phrases themselves will reflect their location.
  const rawBase = rawWorkerScore ?? auroraScore ?? 0;
  const showForecast = rawBase >= 15 || substormForecast.status !== 'QUIET';

  if (isDaylight) {
    return (
      <div className="col-span-12 card bg-neutral-950/80 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">What to expect</h3>
        <div className="flex items-center gap-3 text-neutral-400 text-sm">
          <span className="text-2xl">☀️</span>
          <span>It's still daylight — aurora is only visible after dark. Come back after dark.</span>
        </div>
      </div>
    );
  }

  const slots: {
    time: string;
    vis: VisibilityResult;
    conf: SlotConfig['confidence'];
    substormScore: number;
  }[] = [
    { time: 'Now',    vis: nowVisibility, conf: 'ground', substormScore: Math.round(nowScore)  },
    ...(showForecast ? [
      { time: '15 min', vis: vis15, conf: conf15 as SlotConfig['confidence'], substormScore: Math.round(score15) },
      { time: '30 min', vis: vis30, conf: conf30 as SlotConfig['confidence'], substormScore: Math.round(score30) },
      { time: '1 hour', vis: vis60, conf: conf60 as SlotConfig['confidence'], substormScore: Math.round(score60) },
    ] : []),
  ];

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-white">What to expect</h3>
        <span className="text-xs text-neutral-500">Based on current conditions</span>
      </div>

      {/* Substorm context bar — just below the header */}
      {workerScore != null && (
        <div className="flex items-center gap-3 mb-4 py-2 border-b border-neutral-800/60">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-500">Substorm index</span>
            <span className="text-sm font-bold tabular-nums" style={{ color: scoreColour(rawWorkerScore ?? 0) }}>
              {typeof rawWorkerScore === 'number' ? Math.round(rawWorkerScore) : rawWorkerScore}
            </span>
            <span className="text-xs font-medium text-neutral-400">{workerLevel}</span>
            <TrendArrow trend={workerTrend} />
          </div>
          {workerConf != null && nowScore >= 30 && (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-neutral-600">·</span>
              <span className="text-xs text-neutral-500">{workerConf}% confidence</span>
            </div>
          )}
          {bz != null && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-neutral-600">Bz</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: bz < -5 ? '#34d399' : bz > 3 ? '#f87171' : '#d4d4d4' }}>
                {bz > 0 ? '+' : ''}{bz.toFixed(1)} nT
              </span>
              {southMin30 != null && southMin30 > 5 && (
                <span className="text-xs text-neutral-600">· south {southMin30}m</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slots */}
      <div className="space-y-0 divide-y divide-neutral-800/60">
        {slots.map(({ time, vis, conf, substormScore }) => (
          <div key={time} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">

            {/* Time label */}
            <div className="w-14 flex-shrink-0 pt-0.5">
              <span className={`text-xs font-semibold ${time === 'Now' ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {time}
              </span>
            </div>

            {/* Icon */}
            <div className="text-xl flex-shrink-0 leading-none mt-0.5">
              {vis.icon}
            </div>

            {/* Phrase + subtext */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm leading-snug ${time === 'Now' ? 'text-white font-medium' : 'text-neutral-200'}`}>
                {vis.phrase}
              </p>
              {vis.subtext && (
                <p className="text-xs text-emerald-400/80 mt-0.5 leading-snug">
                  {vis.subtext}
                </p>
              )}
              {conf === 'low' && (
                <p className="text-xs text-neutral-600 mt-0.5">Rough guide only</p>
              )}
            </div>

            {/* Score + confidence dot */}
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-1">
              <ConfidenceDot level={conf} />
              <span
                className="text-xs font-bold tabular-nums"
                style={{ color: scoreColour(substormScore) }}
                title="Substorm index score"
              >
                {substormScore}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-neutral-800/60">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">👁️</span>
            <span className="text-xs text-neutral-500">Naked eye</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📱</span>
            <span className="text-xs text-neutral-500">Phone camera</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📷</span>
            <span className="text-xs text-neutral-500">DSLR only</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">😴</span>
            <span className="text-xs text-neutral-500">Nothing expected</span>
          </div>
        </div>
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span className="text-xs text-neutral-600">Confidence:</span>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-neutral-500">High</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-neutral-500">Moderate</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-neutral-500" />
            <span className="text-xs text-neutral-500">Low</span>
          </div>
          <span className="text-xs text-neutral-600 ml-auto">Score = substorm index 0–100</span>
        </div>
      </div>
    </div>
  );
};

export default VisibilityForecastPanel;
//--- END OF FILE src/components/VisibilityForecastPanel.tsx ---