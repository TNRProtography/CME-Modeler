//--- START OF FILE src/components/VisibilityForecastPanel.tsx ---

import React, { useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
  );
};
import { SubstormForecast, SightingReport } from '../types';
import type { SubstormRiskData } from '../hooks/useForecastData';
import { computeOvalBoundary as computeOvalBoundaryPhysics, avgBy30m } from '../utils/ovalPhysics';
import { moonAt, nextMoonCrossing } from '../utils/skyConditions';
import { mergeL1Series } from '../utils/auroraVisibility';
import { computeVisibilitySlots } from '../utils/visibilitySlots';
import { resolveViewerLocation } from '../utils/viewerLocation';

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
  moonIllumination?: number | null;
  moonRiseMs?: number | null;
  moonSetMs?: number | null;
  userLatitude?: number | null;
  userLongitude?: number | null;
  /** Proxy-derived data from RTSW merged-24h */
  allNewellData?: { x: number; y: number }[];
  allMagneticData?: { time: number; bt: number; bz: number; by: number; bx: number }[];
  /** L1 speed and dynamic pressure, for the travel time and the pressure term. */
  allSpeedData?: { x: number; y: number }[];
  allPressureData?: { x: number; y: number }[];
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── Oval geometry ───────────────────────────────────────────────────────────
//
// Everything about where the oval is and what can be seen of it comes from
// utils/auroraVisibility, the model every other surface uses too.

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
    subtext = `${sightingContext!.nothingCount} people nearby have checked - nothing visible yet`;
  } else if (hasSightings && sightingContext!.total > 0) {
    subtext = `${sightingContext!.total} report${sightingContext!.total > 1 ? 's' : ''} coming in from people nearby`;
  }

  if (projectedScore >= 80) {
    const phrase = confidence === 'high'
      ? 'Go outside now - this could be one of the best displays in years'
      : confidence === 'medium'
      ? 'Conditions look exceptional - well worth heading out to have a look'
      : 'Could turn into something special - keep a close eye on this';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 65) {
    const phrase = confidence === 'high'
      ? 'You should be able to see it with your own eyes - look south'
      : confidence === 'medium'
      ? 'Good chance of seeing it with your own eyes in a dark spot'
      : 'Might be visible with your own eyes if conditions stay this way';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 50) {
    const phrase = confidence === 'high'
      ? 'A faint green glow should be visible to the south - find somewhere dark'
      : confidence === 'medium'
      ? 'A faint glow to the south is possible - get away from street lights'
      : 'Might just be visible to the eye if you find somewhere dark enough';
    return { phrase, icon: '👁️', subtext };
  }
  if (projectedScore >= 35) {
    const phrase = confidence === 'high'
      ? 'Your phone camera will pick it up - point it south and take a photo'
      : confidence === 'medium'
      ? 'Worth taking a photo to the south - your phone may surprise you'
      : 'Your phone camera might pick something up if conditions improve';
    return { phrase, icon: '📱', subtext };
  }
  if (projectedScore >= 20) {
    const phrase = confidence === 'high'
      ? 'Very faint - only a long-exposure camera shot would show anything'
      : confidence === 'medium'
      ? 'Very faint if anything - not worth going out specially'
      : 'Unlikely to show up even on camera at this stage';
    return { phrase, icon: '📷', subtext };
  }

  const phrase = confidence === 'high'
    ? 'Nothing to see - the sky will look completely normal right now'
    : confidence === 'medium'
    ? 'Very quiet - not worth going out at the moment'
    : 'Quiet - come back later';
  return { phrase, icon: '😴', subtext: nothingReported ? subtext : null };
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
  if (score >= 70) return '#34d399'; // green  - strong/NZ-visible conditions
  if (score >= 50) return '#fbbf24'; // amber  - developing/active
  if (score >= 30) return '#38bdf8'; // sky    - unsettled/disturbed
  return '#525252';                  // grey   - quiet
}

// ─── Confidence dot ───────────────────────────────────────────────────────────

const ConfidenceDot: React.FC<{ level: SlotConfig['confidence'] }> = ({ level }) => {
  const map: Record<SlotConfig['confidence'], { color: string; title: string }> = {
    ground: { color: 'bg-emerald-400', title: 'Ground truth - real sensor data' },
    high:   { color: 'bg-emerald-400', title: 'High confidence forecast' },
    medium: { color: 'bg-amber-400',   title: 'Moderate confidence forecast' },
    low:    { color: 'bg-neutral-500', title: 'Low confidence - treat as rough guide' },
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
  allNewellData,
  allMagneticData,
  allSpeedData,
  allPressureData,
}) => {
  const [modalState, setModalState] = useState<{ title: string; content: string } | null>(null);

  // Where the Moon actually is at each slot's time, for this viewer, rather
  // than one illumination figure for the whole night. A bright Moon below the
  // horizon costs nothing; the same Moon high in the sky costs a lot.
  const where = useMemo(() => {
    if (userLatitude != null && userLongitude != null) return { lat: userLatitude, lon: userLongitude };
    const l = resolveViewerLocation();
    return { lat: l.latitude, lon: l.longitude };
  }, [userLatitude, userLongitude]);
  const slotBaseMs = useMemo(() => Date.now(), [auroraScore, substormRiskData, allNewellData]);
  const moonLine = useMemo(() => {
    const now = moonAt(slotBaseMs, where.lat, where.lon);
    const lit = `${Math.round(now.illumination * 100)}% lit`;
    const next = nextMoonCrossing(slotBaseMs, where.lat, where.lon);
    const at = next
      ? new Date(next.atMs).toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit', hour12: true })
      : null;
    if (now.up) {
      return `The Moon is up (${lit})${at ? ` and sets at ${at}` : ''}.`
        + (now.illumination > 0.3 ? ' It is washing out fainter aurora while it is up, and that is allowed for below.' : '');
    }
    return `The Moon is down${at ? ` until ${at}` : ''} (${lit}), so it is not affecting the sky${at ? ' until then' : ''}.`;
  }, [slotBaseMs, where]);

  const buildStatTooltip = (title: string, whatItIs: string, auroraEffect: string, advanced: string) => `
    <div class='space-y-3 text-left'>
      <p><strong>${title}</strong></p>
      <p><strong>What this is:</strong> ${whatItIs}</p>
      <p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p>
      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p>
    </div>
  `;

  const slotTooltips: Record<string, { title: string; content: string }> = {
    'Now': {
      title: 'Now',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>Worked out from the real solar wind. The satellites at L1, about 1.5 million km upstream, measured this wind roughly 45 to 60 minutes ago, and it has now reached Earth. The oval responds to the last hour of it, so that is what this slot uses, with each reading moved forward by its own travel time.</p>
        <p>From that comes where the auroral oval sits over New Zealand right now, and from your location, in the same magnetic coordinates the oval is measured in, what you can see of it. The Eyrewell magnetometer adds a confirmed substorm onset when there is one. The Moon and twilight are allowed for at your location.</p>
      </div>`,
    },
    '15 min': {
      title: '15 minutes',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>Also real solar wind, not a projection. The wind that will be driving the oval in 15 minutes has already been measured at L1 and is on its way, so this is the same calculation as Now, run 15 minutes ahead on wind that is in flight.</p>
      </div>`,
    },
    '30 min': {
      title: '30 minutes',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>Still real solar wind. At ordinary speeds it takes the wind 45 minutes or more to get here from L1, so the wind for this slot has been measured already. Only in very fast wind, over about 850 km/s, is part of this half hour not yet measured, and then it is marked with a lower confidence.</p>
      </div>`,
    },
    '1 hour': {
      title: '1 hour',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>Past what L1 has measured, so from here it is a forecast. This slot starts from the Spot The Aurora score and adjusts it by the substorm engine's chance of an onset in the next hour, then applies your location and the sky at that time.</p>
        <p>Substorm timing is one of the hardest things to predict in space weather. Treat this as a reasonable guide, not a certainty.</p>
      </div>`,
    },
    '2 hours': {
      title: '2 hours',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>Rough guide only. This is the Spot The Aurora score itself, with your location and the sky at that time applied - in effect, if current conditions hold, roughly this.</p>
        <p>A lot can change in two hours. Don't drive somewhere dark based on this slot alone. Wait for it to move into the shorter windows first.</p>
      </div>`,
    },
    'about': {
      title: 'About What to Expect',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>This uses your location and the real solar wind to tell you what you'll actually see from where you are, right now and over the next two hours.</p>
        <p>Now, 15 minutes and 30 minutes are not predictions. The wind that will reach Earth in that time has already been measured by the satellites at L1, so those slots are worked out from it directly. The hour and two hour slots are past what has been measured, and come from the Spot The Aurora score.</p>
        <p>The number beside each slot is how strong the aurora is for your location, 0 to 100, with what the Moon and twilight will cost you at that time already taken off - the same scale as the Spot The Aurora score.</p>
        <p class='text-xs text-neutral-500'>Tap any time label (Now, 15 min, etc.) for details on how that slot works.</p>
      </div>`,
    },
    'substorm': {
      title: 'Substorm Risk Index',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>A real time measure of how likely a substorm is based on energy flowing into the magnetosphere. It tracks the Newell coupling function, sustained southward magnetic field periods, and watches satellite and NZ ground magnetometers for onset signatures.</p>
        <p>When the index is high and trending up, conditions are primed for a burst of aurora activity.</p>
      </div>`,
    },
    'visibility': {
      title: 'Visibility Levels',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>We tell you what you'll actually see rather than giving you a number to figure out.</p>
        <p><strong class='text-neutral-200'>Eye</strong> means you should see it with your own eyes from somewhere dark.</p>
        <p><strong class='text-neutral-200'>Phone</strong> means your phone camera will pick it up even if your eyes can't.</p>
        <p><strong class='text-neutral-200'>Camera</strong> means only a long exposure DSLR will show anything.</p>
        <p><strong class='text-neutral-200'>None</strong> means it's too quiet from where you are.</p>
        <p>These are adjusted for your GPS location. The same conditions that produce phone aurora in Christchurch might produce nothing in Auckland.</p>
      </div>`,
    },
    'oval': {
      title: 'Aurora Oval',
      content: `<div class='space-y-3 text-left text-sm text-neutral-300'>
        <p>This isn't a forecast. It's a real time picture of where the auroral zone sits right now, computed from Newell coupling averages and ground magnetometer data.</p>
        <p>When it pushes north that's real measured energy input, not a guess. The viewline shows where aurora would appear on your southern horizon from your exact location.</p>
      </div>`,
    },
  };

  const openSlotTooltip = useCallback((slotKey: string) => {
    const tip = slotTooltips[slotKey];
    if (tip) setModalState(tip);
  }, []);

  const openModal = useCallback(() => {
    openSlotTooltip('about');
  }, [openSlotTooltip]);
  const rawWorkerScore = substormRiskData?.current?.score   ?? null;
  // 30-min average IMF By from RTSW mag data - feeds the Russell-McPherron
  // seasonal projection when the oval has to come from the substorm worker.
  const latestBy = useMemo(() => avgBy30m(allMagneticData), [allMagneticData]);
  const workerTrend   = substormRiskData?.current?.risk_trend;
  const workerLevel   = substormRiskData?.current?.level;
  const bayOnset      = substormRiskData?.current?.bay_onset_flag   ?? false;
  const cmeSheath     = substormRiskData?.current?.cme_sheath_flag  ?? false;
  // Prefer proxy RTSW data for solar wind values, fall back to substorm worker
  const _pNewellNow = allNewellData && allNewellData.length > 0 ? allNewellData[allNewellData.length - 1].y : undefined;
  const _pNewellAvg30 = (() => { if (!allNewellData || allNewellData.length === 0) return undefined; const c = Date.now() - 30 * 60000; const pts = allNewellData.filter(p => p.x >= c); return pts.length > 0 ? pts.reduce((s, p) => s + p.y, 0) / pts.length : undefined; })();
  const _pBz = allMagneticData && allMagneticData.length > 0 ? allMagneticData[allMagneticData.length - 1].bz : undefined;
  const _pSouthMin30 = (() => { if (!allMagneticData || allMagneticData.length === 0) return undefined; const c = Date.now() - 30 * 60000; const pts = allMagneticData.filter(p => p.time >= c); if (pts.length === 0) return undefined; return pts.filter(p => p.bz < 0).length; })();
  const newellNow     = _pNewellNow ?? substormRiskData?.metrics?.solar_wind?.newell_coupling_now;
  const newellAvg30   = _pNewellAvg30 ?? substormRiskData?.metrics?.solar_wind?.newell_avg_30m;
  const workerConf    = substormRiskData?.current?.confidence;
  const bz            = _pBz ?? substormRiskData?.metrics?.solar_wind?.bz;
  const southMin30    = _pSouthMin30 ?? substormRiskData?.metrics?.solar_wind?.southward_minutes_30m;

  const sightingContext = useMemo(() => summariseSightings(recentSightings), [recentSightings]);

  // ── Now, 15 and 30 minutes: the real solar wind ──────────────────────────
  //
  // Every reading at L1 is moved forward by its own travel time to Earth, and
  // the oval at each slot is worked out from the hour of wind that has
  // reached Earth by then. At ordinary speeds that wind is all measured
  // already - it takes 45 minutes or more to get here - so these three slots
  // are not projections of anything.
  const l1Samples = useMemo(() => mergeL1Series({
    speed: allSpeedData ?? [],
    newell: allNewellData ?? [],
    pressure: allPressureData ?? [],
    magnetic: allMagneticData ?? [],
  }), [allSpeedData, allNewellData, allPressureData, allMagneticData]);

  // Where the oval sits when the L1 series is missing: the substorm worker's
  // own averages, unshifted. Only used when there is no real wind to use.
  const workerBoundary = useMemo(() => computeOvalBoundaryPhysics({
    newell_avg_60m: substormRiskData?.metrics?.solar_wind?.newell_avg_60m,
    newell_avg_30m: substormRiskData?.metrics?.solar_wind?.newell_avg_30m,
    dynamic_pressure_nPa: substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa,
    avg_30m_pressure_nPa: substormRiskData?.metrics?.solar_wind?.avg_30m_pressure_nPa,
    by: latestBy,
    bz: substormRiskData?.metrics?.solar_wind?.bz,
  }, bayOnset), [substormRiskData, latestBy, bayOnset]);

  // The five slots, from the shared function the marketing site's embed uses
  // too (utils/visibilitySlots).
  const [s0, s15, s30, s60, s120] = useMemo(() => computeVisibilitySlots({
    nowMs: slotBaseMs,
    latitude: where.lat,
    longitude: where.lon,
    samples: l1Samples,
    bayOnset,
    fallbackBoundary: workerBoundary,
    auroraScore: auroraScore ?? 0,
    substormForecast,
    workerTrend,
    newellNow,
    newellAvg30,
    workerConfidence: workerConf,
  }), [slotBaseMs, where, l1Samples, bayOnset, workerBoundary, auroraScore, substormForecast,
       workerTrend, newellNow, newellAvg30, workerConf]);

  const nowScore = s0.strength;
  const headlineScore = auroraScore ?? 0;

  const nowVisibility = useMemo(() => {
    const base = getVisibilityPhrase(s0.effective, 'high', sightingContext);
    const extraNotes: string[] = [];
    if (bayOnset)  extraNotes.push('Activity just picked up - aurora may be starting right now');
    if (cmeSheath) extraNotes.push('A solar storm is passing Earth right now - conditions could change fast');
    if (workerConf != null && nowScore >= 30) {
      extraNotes.push(`${workerConf}% chance of a display based on current solar conditions`);
    }
    if (!s0.measured) extraNotes.push('Live L1 solar wind unavailable - using the substorm worker instead');
    return {
      ...base,
      subtext: [base.subtext, ...extraNotes].filter(Boolean).join(' · ') || null,
    };
  }, [s0, nowScore, sightingContext, bayOnset, cmeSheath, workerConf]);

  const vis15 = useMemo(() => getVisibilityPhrase(s15.effective, s15.confidence), [s15]);
  const vis30 = useMemo(() => getVisibilityPhrase(s30.effective, s30.confidence), [s30]);
  const vis60 = useMemo(() => getVisibilityPhrase(s60.effective, s60.confidence), [s60]);
  const vis120 = useMemo(() => getVisibilityPhrase(s120.effective, s120.confidence), [s120]);

  const daylightNowLine = useMemo(() => {
    const score = Math.round(headlineScore);
    const level = workerLevel ?? 'Unknown';
    const bzTxt = bz != null ? `${bz > 0 ? '+' : ''}${bz.toFixed(1)} nT` : 'n/a';
    return `Current activity: score ${score}/100 · ${level} · IMF Bz ${bzTxt}.`;
  }, [headlineScore, workerLevel, bz]);

  const daylightMoonLine = moonLine;

  // Always show forecast slots when it's dark - phrases reflect location.
  const showForecast = true;

  if (isDaylight) {
    return (
      <div className="col-span-12 card bg-neutral-950/80 p-5 h-full flex flex-col">
        <h3 className="text-lg font-semibold text-white mb-4">What to expect in the next couple of hours</h3>
        <div className="flex items-start gap-3 text-neutral-400 text-sm">
          <span className="text-2xl">☀️</span>
          <div className="space-y-1">
            <p>It&apos;s still daylight - aurora is only visible after dark. Come back after sunset.</p>
            <p className="text-xs text-neutral-500">{daylightNowLine}</p>
            <p className="text-xs text-neutral-500">{daylightMoonLine}</p>
          </div>
        </div>
      </div>
    );
  }

  const slots: {
    time: string;
    vis: VisibilityResult;
    conf: SlotConfig['confidence'];
    /** How strong the aurora is for this location, 0-100, after the Moon and twilight. */
    substormScore: number;
    source: 'wind' | 'score';
  }[] = [
    { time: 'Now',    vis: nowVisibility, conf: s0.measured ? 'ground' : 'low', substormScore: Math.round(s0.effective), source: 'wind' as const },
    ...(showForecast ? [
      { time: '15 min', vis: vis15, conf: s15.confidence as SlotConfig['confidence'], substormScore: Math.round(s15.effective), source: s15.source },
      { time: '30 min', vis: vis30, conf: s30.confidence as SlotConfig['confidence'], substormScore: Math.round(s30.effective), source: s30.source },
      { time: '1 hour', vis: vis60, conf: s60.confidence as SlotConfig['confidence'], substormScore: Math.round(s60.effective), source: s60.source },
      { time: '2 hours', vis: vis120, conf: s120.confidence as SlotConfig['confidence'], substormScore: Math.round(s120.effective), source: s120.source },
    ] : []),
  ];

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-5 h-full flex flex-col">
      {/* Header */}
      <InfoModal isOpen={!!modalState} onClose={() => setModalState(null)} title={modalState?.title ?? ''} content={modalState?.content ?? ''} />
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">What to expect in the next couple of hours</h3>
          <button
            onClick={openModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About this forecast"
          >
            ?
          </button>
        </div>
        <span className="text-xs text-neutral-500">Based on current conditions</span>
      </div>
      {/* Accuracy note */}
      <p className="text-xs text-neutral-600 mb-3 leading-snug">
        This forecast uses your GPS location and the aurora oval position - more accurate than the % score alone.
        {(!userLatitude) && <span className="text-amber-500/80"> Enable location for full accuracy.</span>}
      </p>
      <p className="text-xs text-neutral-500 mb-3 leading-snug">{moonLine}</p>

      {/* Substorm context bar - just below the header */}
      {rawWorkerScore != null && (
        <div className="flex items-center gap-3 mb-4 py-2 border-b border-neutral-800/60">
          <div className="flex items-center gap-1.5">
            <button onClick={() => openSlotTooltip('substorm')} className="text-xs text-neutral-500 hover:underline hover:text-white transition-colors cursor-help" title="Tap for info about the substorm index">Substorm index</button>
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
        {slots.map(({ time, vis, conf, substormScore, source }) => (
          <div key={time} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">

            {/* Time label - tap for info */}
            <div className="w-14 flex-shrink-0 pt-0.5">
              <button
                onClick={() => openSlotTooltip(time)}
                className={`text-xs font-semibold ${time === 'Now' ? 'text-emerald-400' : 'text-neutral-400'} hover:underline hover:text-white transition-colors cursor-help`}
                title={`Tap for info about the ${time} forecast`}
              >
                {time}
              </button>
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
                title={source === 'wind'
                  ? 'Aurora strength for your location from the solar wind measured at L1, after the Moon and twilight (0-100)'
                  : 'Spot The Aurora score for your location, after the Moon and twilight (0-100)'}
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
          <button onClick={() => openSlotTooltip('visibility')} className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity" title="Tap for info about visibility levels">
            <span className="text-sm">👁️</span>
            <span className="text-xs text-neutral-500 hover:text-white transition-colors">Naked eye</span>
          </button>
          <button onClick={() => openSlotTooltip('visibility')} className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity" title="Tap for info about visibility levels">
            <span className="text-sm">📱</span>
            <span className="text-xs text-neutral-500 hover:text-white transition-colors">Phone camera</span>
          </button>
          <button onClick={() => openSlotTooltip('visibility')} className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity" title="Tap for info about visibility levels">
            <span className="text-sm">📷</span>
            <span className="text-xs text-neutral-500 hover:text-white transition-colors">DSLR only</span>
          </button>
          <button onClick={() => openSlotTooltip('visibility')} className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity" title="Tap for info about visibility levels">
            <span className="text-sm">😴</span>
            <span className="text-xs text-neutral-500 hover:text-white transition-colors">Nothing expected</span>
          </button>
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
          <span className="text-xs text-neutral-600 ml-auto">Number = strength for your location, 0-100</span>
        </div>
      </div>
    </div>
  );
};

export default VisibilityForecastPanel;
//--- END OF FILE src/components/VisibilityForecastPanel.tsx ---
