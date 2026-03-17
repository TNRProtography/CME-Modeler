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

// ─── Types ───────────────────────────────────────────────────────────────────

interface SlotConfig {
  label: string;
  phrase: string;
  icon: string;         // emoji representing visibility method
  subtext: string | null;
  confidence: 'ground' | 'high' | 'medium' | 'low' | 'hidden';
}

interface VisibilityForecastPanelProps {
  auroraScore: number | null;
  substormForecast: SubstormForecast;
  recentSightings: SightingReport[];   // last ~30 min of reports
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

  // Subtext from real reports
  let subtext: string | null = null;
  if (eyeConfirmed) {
    subtext = `${sightingContext!.eyeCount} ${sightingContext!.eyeCount === 1 ? 'person' : 'people'} seeing it with the naked eye nearby`;
  } else if (phoneConfirmed) {
    subtext = `${sightingContext!.phoneCount} ${sightingContext!.phoneCount === 1 ? 'person' : 'people'} picking it up on camera nearby`;
  } else if (nothingReported) {
    subtext = `${sightingContext!.nothingCount} nearby reports — nothing visible yet`;
  } else if (hasSightings && sightingContext!.total > 0) {
    subtext = `${sightingContext!.total} report${sightingContext!.total > 1 ? 's' : ''} coming in nearby`;
  }

  // Score → visibility tier
  // Tuned for NZ aurora (~Kp 6-7 needed for comfortable naked-eye)
  if (projectedScore >= 80) {
    const phrase = confidence === 'high'
      ? 'Bright aurora filling the sky — unmissable'
      : confidence === 'medium'
      ? 'Could be bright and active overhead'
      : 'Possibly exceptional if conditions hold';
    return { phrase, icon: '👁️', subtext };
  }

  if (projectedScore >= 65) {
    const phrase = confidence === 'high'
      ? 'Clearly visible to the naked eye — colours likely'
      : confidence === 'medium'
      ? 'Should be visible to the naked eye'
      : 'Naked-eye sighting possible if conditions hold';
    return { phrase, icon: '👁️', subtext };
  }

  if (projectedScore >= 50) {
    const phrase = confidence === 'high'
      ? 'Visible to the naked eye — faint glow on the horizon'
      : confidence === 'medium'
      ? 'Faint naked-eye glow likely in a dark location'
      : 'Could become visible to the naked eye';
    return { phrase, icon: '👁️', subtext };
  }

  if (projectedScore >= 35) {
    const phrase = confidence === 'high'
      ? 'Showing clearly on phone cameras — eye sightings unlikely'
      : confidence === 'medium'
      ? 'Starting to show on phone cameras'
      : 'Camera sightings possible if conditions develop';
    return { phrase, icon: '📱', subtext };
  }

  if (projectedScore >= 20) {
    const phrase = confidence === 'high'
      ? 'A faint glow — visible on phone camera in a dark spot'
      : confidence === 'medium'
      ? 'May show a faint glow on camera'
      : 'Camera sighting unlikely but possible';
    return { phrase, icon: '📷', subtext };
  }

  // Low / nothing
  const phrase = confidence === 'high'
    ? 'Nothing to see — sky would look completely normal'
    : confidence === 'medium'
    ? 'Probably nothing visible tonight'
    : 'Very unlikely to change';
  return { phrase, icon: '😴', subtext: nothingReported ? subtext : null };
}

// ─── Score projection helpers ─────────────────────────────────────────────────
//
// Projects current score forward using the substorm forecast's status and
// probability values.  Returns { score15, score30, score60 }.

function projectScores(
  currentScore: number,
  forecast: SubstormForecast
): { score15: number; score30: number; score60: number } {
  const { status, p30, p60 } = forecast;

  // Map substorm probability (0-1) to a rough score boost
  // A P30 of 0.8 with current score 40 should push score30 toward 70-80
  const boostFromP = (p: number, base: number) =>
    Math.min(100, base + p * (100 - base) * 0.75);

  switch (status) {
    case 'ONSET':
      // Already happening — scores peak now, start to decay over 60 min
      return {
        score15: Math.min(100, currentScore * 1.05),
        score30: currentScore * 0.90,
        score60: currentScore * 0.65,
      };

    case 'IMMINENT_30':
      // Substorm expected within 30 min — score rises fast then decays
      return {
        score15: boostFromP(p30, currentScore),
        score30: boostFromP(p30, currentScore) * 1.05,
        score60: boostFromP(p60, currentScore) * 0.80,
      };

    case 'LIKELY_60':
      // Substorm expected within 60 min — gradual rise
      return {
        score15: currentScore * 1.10,
        score30: boostFromP(p30 * 0.7, currentScore),
        score60: boostFromP(p60, currentScore),
      };

    case 'WATCH':
      // Building but uncertain — modest rise
      return {
        score15: currentScore * 1.05,
        score30: currentScore * 1.15,
        score60: boostFromP(p60 * 0.5, currentScore),
      };

    case 'QUIET':
    default:
      // Stable or decaying
      return {
        score15: currentScore * 0.95,
        score30: currentScore * 0.85,
        score60: currentScore * 0.70,
      };
  }
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
  recentSightings,
  isDaylight,
}) => {
  const score = auroraScore ?? 0;
  const sightingContext = useMemo(() => summariseSightings(recentSightings), [recentSightings]);

  const { score15, score30, score60 } = useMemo(
    () => projectScores(score, substormForecast),
    [score, substormForecast]
  );

  const conf15 = getSlotConfidence(substormForecast.status, '15m');
  const conf30 = getSlotConfidence(substormForecast.status, '30m');
  const conf60 = getSlotConfidence(substormForecast.status, '1h');

  // NOW slot — driven purely by current score + real sightings
  const nowVisibility = useMemo(
    () => getVisibilityPhrase(score, 'high', sightingContext),
    [score, sightingContext]
  );

  // Forecast slots — no sighting context blended in (those are "now" truth)
  // but subtext will note if reports are already ahead of forecast
  const vis15 = useMemo(() => getVisibilityPhrase(score15, conf15), [score15, conf15]);
  const vis30 = useMemo(() => getVisibilityPhrase(score30, conf30), [score30, conf30]);
  const vis60 = useMemo(() => getVisibilityPhrase(score60, conf60), [score60, conf60]);

  // Only show forecast slots when there's something worth saying
  // (hides low-confidence "probably nothing" noise during quiet periods)
  const showForecast = score >= 20 || substormForecast.status !== 'QUIET';

  // Special daylight override
  if (isDaylight) {
    return (
      <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-5">
        <h3 className="text-lg font-semibold text-white mb-4">What to expect</h3>
        <div className="flex items-center gap-3 text-neutral-400 text-sm">
          <span className="text-2xl">☀️</span>
          <span>Aurora viewing isn't possible while the sun is up. Check back after dark.</span>
        </div>
      </div>
    );
  }

  const slots: { time: string; vis: VisibilityResult; conf: SlotConfig['confidence']; projScore: number }[] = [
    { time: 'Now',    vis: nowVisibility, conf: 'ground', projScore: score },
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