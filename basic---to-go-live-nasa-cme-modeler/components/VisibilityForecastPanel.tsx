//--- START OF FILE src/components/VisibilityForecastPanel.tsx ---
//
// VisibilityForecastPanel
//
// Shows a "What to expect" timeline from Now → 15 min → 30 min → 1 hour
// in plain English anchored to what the user would physically see outside.
// Each slot uses the same language as the sighting report options:
//   eye / phone / dslr / nothing — so the forecast and report UI speak
//   the same language.
//
// Data sources:
//   • Now        — auroraScore (current ground truth)
//   • 15 / 30m   — substormForecast (L1 solar wind, highest confidence)
//   • 1 hr       — substormForecast p60 + trend (lower confidence)
//   • Sightings  — recent SightingReport array to ground each slot in
//                  what real people are actually seeing right now

import React, { useMemo } from 'react';
import { SubstormForecast, SightingReport } from '../types';
import type { SubstormRiskData } from '../hooks/useForecastData';

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

// ─── Visibility phrase logic ──────────────────────────────────────────────────
//
// Everything is expressed as "what would I see if I walked outside right now?"
// using the same categories as the sighting report buttons.
//
// Inputs:
//   projectedScore  — estimated score at that time window
//   confidence      — 'high' | 'medium' | 'low'
//   sightingContext — optional real-report context to blend in

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface VisibilityResult {
  phrase: string;
  icon: string;
  subtext: string | null;
}

function getVisibilityPhrase(
  projectedScore: number,
  confidence: ConfidenceLevel,
  sightingContext?: { eyeCount: number; phoneCount: number; nothingCount: number; total: number }
): VisibilityResult {

  // If real reports exist, they take priority over the forecast phrase
  // for the NOW slot (confidence = 'ground'). For forecast slots we
  // blend reports into the subtext only.
  const hasSightings = sightingContext && sightingContext.total > 0;
  const eyeConfirmed  = hasSightings && sightingContext!.eyeCount > 0;
  const phoneConfirmed = hasSightings && sightingContext!.phoneCount > 0 && !eyeConfirmed;
  const nothingReported = hasSightings && sightingContext!.nothingCount >= 3 && !eyeConfirmed && !phoneConfirmed;

  // Subtext from real reports — plain language, no jargon
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

  // Score → visibility tier
  // Tuned for NZ aurora (~Kp 6-7 needed for comfortable naked-eye)
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

  // Nothing / very quiet
  const phrase = confidence === 'high'
    ? 'Nothing to see tonight — the sky will look completely normal'
    : confidence === 'medium'
    ? 'Very quiet — not worth going out at the moment'
    : 'Quiet tonight — set an alert and check back later';
  return { phrase, icon: '😴', subtext: nothingReported ? subtext : null };
}

// ─── Score projection helpers ─────────────────────────────────────────────────
//
// Projects current score forward using the substorm forecast's status and
// probability values, sharpened by the worker's risk_trend and Newell data
// when available.

function projectScores(
  currentScore: number,
  forecast: SubstormForecast,
  workerTrend?: string,
  newellNow?: number,
  newellAvg30?: number,
): { score15: number; score30: number; score60: number } {
  const { status, p30, p60 } = forecast;

  // If the worker gives us a trend that overrides the substorm forecast status,
  // use it to modulate the projections. Rapidly Increasing → boost; Rapidly
  // Decreasing → decay faster than the base model.
  const trendMultiplier =
    workerTrend === 'Rapidly Increasing' ? 1.15 :
    workerTrend === 'Increasing'         ? 1.07 :
    workerTrend === 'Decreasing'         ? 0.90 :
    workerTrend === 'Rapidly Decreasing' ? 0.75 : 1.0;

  // If Newell coupling is accelerating (now > 30m avg), conditions are
  // building faster than the substorm status alone suggests.
  const newellAccelerating = newellNow && newellAvg30 && newellNow > newellAvg30 * 1.2;
  const newellBoost = newellAccelerating ? 1.08 : 1.0;

  const boostFromP = (p: number, base: number) =>
    Math.min(100, base + p * (100 - base) * 0.75);

  let score15: number, score30: number, score60: number;

  switch (status) {
    case 'ONSET':
      score15 = Math.min(100, currentScore * 1.05);
      score30 = currentScore * 0.90;
      score60 = currentScore * 0.65;
      break;
    case 'IMMINENT_30':
      score15 = boostFromP(p30, currentScore);
      score30 = boostFromP(p30, currentScore) * 1.05;
      score60 = boostFromP(p60, currentScore) * 0.80;
      break;
    case 'LIKELY_60':
      score15 = currentScore * 1.10;
      score30 = boostFromP(p30 * 0.7, currentScore);
      score60 = boostFromP(p60, currentScore);
      break;
    case 'WATCH':
      score15 = currentScore * 1.05;
      score30 = currentScore * 1.15;
      score60 = boostFromP(p60 * 0.5, currentScore);
      break;
    case 'QUIET':
    default:
      score15 = currentScore * 0.95;
      score30 = currentScore * 0.85;
      score60 = currentScore * 0.70;
      break;
  }

  // Apply worker trend and Newell modulation to forecast slots only
  // (not Now — that's ground truth)
  const applyModifiers = (s: number) =>
    Math.min(100, Math.max(0, s * trendMultiplier * newellBoost));

  return {
    score15: applyModifiers(score15),
    score30: applyModifiers(score30),
    score60: applyModifiers(score60),
  };
}

// Map forecast status to per-slot confidence levels
function getSlotConfidence(
  status: SubstormForecast['status'],
  slot: '15m' | '30m' | '1h'
): ConfidenceLevel {
  if (status === 'ONSET') {
    return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
  }
  if (status === 'IMMINENT_30') {
    return slot === '15m' ? 'high' : slot === '30m' ? 'high' : 'medium';
  }
  if (status === 'LIKELY_60') {
    return slot === '15m' ? 'medium' : slot === '30m' ? 'medium' : 'high';
  }
  if (status === 'WATCH') {
    return slot === '15m' ? 'medium' : slot === '30m' ? 'low' : 'low';
  }
  // QUIET
  return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
}

// ─── Sighting summariser ──────────────────────────────────────────────────────

function summariseSightings(sightings: SightingReport[]) {
  const cutoff = Date.now() - 30 * 60 * 1000; // last 30 min
  const recent = sightings.filter(s => s.timestamp >= cutoff);
  return {
    eyeCount:     recent.filter(s => s.status === 'eye').length,
    phoneCount:   recent.filter(s => s.status === 'phone' || s.status === 'dslr').length,
    nothingCount: recent.filter(s => s.status.startsWith('nothing')).length,
    total:        recent.filter(s => !s.status.startsWith('nothing') && s.status !== 'cloudy').length,
  };
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

const ConfidenceDot: React.FC<{ level: SlotConfig['confidence'] }> = ({ level }) => {
  const map: Record<SlotConfig['confidence'], { color: string; title: string }> = {
    ground:  { color: 'bg-emerald-400',  title: 'Ground truth — real sensor data' },
    high:    { color: 'bg-emerald-400',  title: 'High confidence forecast' },
    medium:  { color: 'bg-amber-400',    title: 'Moderate confidence forecast' },
    low:     { color: 'bg-neutral-500',  title: 'Low confidence — treat as rough guide' },
    hidden:  { color: 'bg-transparent',  title: '' },
  };
  const { color, title } = map[level];
  if (level === 'hidden') return null;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} flex-shrink-0 mt-0.5`}
      title={title}
    />
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const VisibilityForecastPanel: React.FC<VisibilityForecastPanelProps> = ({
  auroraScore,
  substormForecast,
  substormRiskData,
  recentSightings,
  isDaylight,
}) => {
  // Use the worker's score for Now if available — it's more physics-grounded
  // than the SpotTheAurora composite. Fall back to auroraScore if not yet loaded.
  const workerScore   = substormRiskData?.current?.score ?? null;
  const workerTrend   = substormRiskData?.current?.risk_trend;
  const bayOnset      = substormRiskData?.current?.bay_onset_flag ?? false;
  const cmeSheath     = substormRiskData?.current?.cme_sheath_flag ?? false;
  const newellNow     = substormRiskData?.metrics?.solar_wind?.newell_coupling_now;
  const newellAvg30   = substormRiskData?.metrics?.solar_wind?.newell_avg_30m;
  const workerConf    = substormRiskData?.current?.confidence;

  // For the Now slot: prefer worker score; for forecast slots use auroraScore
  // as the starting point (it blends SpotTheAurora + location adjustment)
  const nowScore      = workerScore ?? auroraScore ?? 0;
  const forecastBase  = auroraScore ?? workerScore ?? 0;

  const sightingContext = useMemo(() => summariseSightings(recentSightings), [recentSightings]);

  const { score15, score30, score60 } = useMemo(
    () => projectScores(forecastBase, substormForecast, workerTrend, newellNow, newellAvg30),
    [forecastBase, substormForecast, workerTrend, newellNow, newellAvg30]
  );

  const conf15 = getSlotConfidence(substormForecast.status, '15m');
  const conf30 = getSlotConfidence(substormForecast.status, '30m');
  const conf60 = getSlotConfidence(substormForecast.status, '1h');

  // NOW slot — worker score + real sightings + bay/CME flags in subtext
  const nowVisibility = useMemo(() => {
    const base = getVisibilityPhrase(nowScore, 'high', sightingContext);
    // Append bay onset or CME sheath note to subtext if applicable
    const extraNotes: string[] = [];
    if (bayOnset) extraNotes.push('Activity just picked up — aurora may be starting right now');
    if (cmeSheath) extraNotes.push('A solar storm is passing Earth right now — conditions could change fast');
    if (workerConf !== null && workerConf !== undefined && nowScore >= 30) {
      extraNotes.push(`${workerConf}% chance of a display based on current solar conditions`);
    }
    return {
      ...base,
      subtext: [base.subtext, ...extraNotes].filter(Boolean).join(' · ') || null,
    };
  }, [nowScore, sightingContext, bayOnset, cmeSheath, workerConf]);

  const vis15 = useMemo(() => getVisibilityPhrase(score15, conf15), [score15, conf15]);
  const vis30 = useMemo(() => getVisibilityPhrase(score30, conf30), [score30, conf30]);
  const vis60 = useMemo(() => getVisibilityPhrase(score60, conf60), [score60, conf60]);

  const showForecast = forecastBase >= 20 || substormForecast.status !== 'QUIET';

  // Special daylight override
  if (isDaylight) {
    return (
      <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">What to expect</h3>
        <div className="flex items-center gap-3 text-neutral-400 text-sm">
          <span className="text-2xl">☀️</span>
          <span>It's still daylight — aurora is only visible after dark. Set an alert and we'll let you know if something develops tonight.</span>
        </div>
      </div>
    );
  }

  const slots: { time: string; vis: VisibilityResult; conf: SlotConfig['confidence']; projScore: number }[] = [
    { time: 'Now',    vis: nowVisibility, conf: 'ground', projScore: nowScore },
    ...(showForecast ? [
      { time: '15 min', vis: vis15, conf: conf15 as SlotConfig['confidence'], projScore: Math.round(score15) },
      { time: '30 min', vis: vis30, conf: conf30 as SlotConfig['confidence'], projScore: Math.round(score30) },
      { time: '1 hour', vis: vis60, conf: conf60 as SlotConfig['confidence'], projScore: Math.round(score60) },
    ] : []),
  ];

  return (
    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">What to expect</h3>
        <span className="text-xs text-neutral-500">Based on current conditions</span>
      </div>

      <div className="space-y-0 divide-y divide-neutral-800/60">
        {slots.map(({ time, vis, conf, projScore }) => (
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
              {/* Low confidence disclaimer */}
              {conf === 'low' && (
                <p className="text-xs text-neutral-600 mt-0.5">Rough guide only</p>
              )}
            </div>

            {/* Confidence dot + projected score */}
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-1">
              <ConfidenceDot level={conf} />
              {time !== 'Now' && (
                <span className="text-xs text-neutral-600 tabular-nums">{projScore}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1">
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
        <div className="flex items-center gap-x-3 gap-y-1 ml-auto">
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-neutral-500">High confidence</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-neutral-500">Moderate</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-neutral-500" />
            <span className="text-xs text-neutral-500">Low</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisibilityForecastPanel;
//--- END OF FILE src/components/VisibilityForecastPanel.tsx ---