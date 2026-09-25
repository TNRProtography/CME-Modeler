// What is due in the next three days, and whether it is worth staying up for.
//
// The rest of the dashboard measures what is at Earth now. This is the only
// part that looks forward.
//
// Coronal holes come from the Coronal Hole Tracker: every hole it has reaching
// Earth inside the horizon, with its arrival, speed and verdict worked out by
// the same function the tracker uses (utils/holeForecast), so the two cannot
// disagree. They did when this read the combined forecast timeline instead -
// the tracker could have a stream arriving tomorrow that this said was not
// coming. CMEs are the ones the CME Visualization has touching Earth
// (utils/cmeEarthArrivals).
//
// Three things are said about each arrival, in the order somebody planning a
// night needs them: when, how good, and why. "How good" is the visibility
// tier for the darkest moment of the night it lands on - a 700 km/s stream
// arriving at 2pm under a full Moon is not a good night, and a speed on its
// own cannot say so.

import React, { useMemo } from 'react';
import type { ExpectedChange } from '../utils/forecastTimeline';
import { locationLabel } from '../utils/viewerLocation';
import { isDueWithin, type HoleForecast } from '../utils/holeForecast';
import ThreeDayVisibilityGrid from './ThreeDayVisibilityGrid';
import { useThreeDayOutlook } from '../hooks/useThreeDayOutlook';
import { CME_EASE_MS, CME_FULL_MS } from '../utils/cmeEarthArrivals';
import type { GridCell } from '../utils/threeDayGrid';

const TIER_TEXT: Record<string, string> = {
  eye: 'text-emerald-300',
  phone: 'text-sky-300',
  camera: 'text-yellow-300',
  none: 'text-neutral-400',
};

// The same icons as the next-couple-of-hours card, so a glance means the
// same thing in both.
const TIER_ICON: Record<string, string> = {
  eye: '👁️',
  phone: '📱',
  camera: '📷',
  none: '😴',
};

const fmtNz = (ms: number, withDate = true): string =>
  new Date(ms).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

const relative = (ms: number, nowMs: number): string => {
  const hours = (ms - nowMs) / 3600000;
  if (hours <= 0) return 'now';
  if (hours < 1) return `in ${Math.max(10, Math.round(hours * 60 / 10) * 10)} min`;
  if (hours < 36) return `in ${Math.round(hours)} h`;
  return `in ${(hours / 24).toFixed(1)} days`;
};

/**
 * What it is, in the words the rest of the app uses. No hole or CME names:
 * "CH_SUVI_0" means nothing to somebody deciding whether to go out.
 */
const describe = (a: ExpectedChange): { what: string; detail: string } => {
  if (a.kind.startsWith('CME')) {
    return {
      what: 'A CME',
      // The sheath is the compressed wind ahead of the cloud and is usually
      // where the activity is; the ejecta is the cloud itself.
      detail: a.kind === 'CME sheath'
        ? 'Arriving shock and sheath - the compressed wind ahead of the cloud, which is usually the active part.'
        : 'The cloud itself, where the field turns smoothly rather than thrashing.',
    };
  }
  if (a.kind === 'SIR') {
    return {
      what: 'A coronal hole',
      detail: 'The leading edge of its stream: fast wind piling into slower wind ahead of it, which compresses the field.',
    };
  }
  return {
    what: 'A coronal hole',
    detail: 'High-speed wind from an open-field region on the Sun.',
  };
};

const isCme = (a: ExpectedChange) => a.kind.startsWith('CME');

/**
 * How many separate coronal holes and CMEs are due. One source can make more
 * than one entry - a CME's sheath and then its cloud - so sources are counted
 * by id, and an entry the timeline could not name counts on its own.
 */
const countSources = (arrivals: ExpectedChange[], pick: (a: ExpectedChange) => boolean): number => {
  const ids = new Set<string>();
  let unnamed = 0;
  for (const a of arrivals) {
    if (!pick(a)) continue;
    if (a.sourceId) ids.add(a.sourceId); else unnamed++;
  }
  return ids.size + unnamed;
};

const plural = (n: number, one: string, many: string): string =>
  n === 0 ? `no ${many}` : n === 1 ? `1 ${one}` : `${n} ${many}`;

/** A coronal hole from the tracker, in the card's words. */
const HoleItem: React.FC<{ f: HoleForecast; nowMs: number; detailed: boolean }> = ({ f, nowMs, detailed }) => {
  const arrival = f.arrival as number;
  const tier = f.outlook?.tier ?? 'none';
  return (
    <li className="rounded border border-neutral-700/60 bg-neutral-800/40 p-2 flex items-start gap-3">
      {/* The tracker's verdict for the best moment inside its arrival window. */}
      <div className="text-xl flex-shrink-0 leading-none mt-0.5">{TIER_ICON[tier] ?? TIER_ICON.none}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-neutral-100">A coronal hole</span>
          <span className="text-[11px] font-mono text-neutral-400">
            {arrival > nowMs ? relative(arrival, nowMs) : 'arriving now'} · {fmtNz(arrival)}
          </span>
        </div>

        <div className="text-[11px] text-neutral-400 mt-0.5">
          {f.choice.speedKms != null && (
            <>Stream at about <span className="text-neutral-200 font-mono">{f.choice.speedKms} km/s</span></>
          )}
          {f.ensemble && f.windowFromMs != null && f.windowToMs != null && (
            <> · 8 in 10 land between {fmtNz(f.windowFromMs)} and {fmtNz(f.windowToMs)}</>
          )}
        </div>

        {f.outlook ? (
          <div className="text-[11px] mt-1">
            <span className={TIER_TEXT[tier] ?? TIER_TEXT.none}>{f.outlook.label}</span>
            {f.arrivalSky && <span className="text-neutral-500"> · best {fmtNz(f.arrivalSky.atMs)}</span>}
            {/* The note opens with the label; the label is already on the line above. */}
            <div className="text-neutral-500 mt-0.5">
              {f.outlook.note.startsWith(f.outlook.label)
                ? f.outlook.note.slice(f.outlook.label.length).replace(/^[.\s]+/, '')
                : f.outlook.note}
            </div>
          </div>
        ) : null}

        {detailed && (
          <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
            High-speed wind from an open-field region on the Sun.
            {f.connection.factor < 1 && <> {f.connection.note}</>}
            {f.pol && f.pol.confidence !== 'none' && <> Magnetogram polarity: {f.pol.summary}</>}
            {f.gone.gone && ' It has since gone from view, but its stream is already on the way.'}
          </p>
        )}
      </div>
    </li>
  );
};

export const ExpectedArrivals: React.FC<{
  /** Advanced view shows the physics line; simple view does not. */
  detailed?: boolean;
  horizonDays?: number;
}> = ({ detailed = false, horizonDays = 3 }) => {
  const { location, chState, nowMs, allHoles, grid, cmeArrivals } = useThreeDayOutlook(horizonDays);
  const horizonMs = horizonDays * 86400000;

  // The ones reaching Earth inside the horizon, soonest first.
  const holes = useMemo(() => allHoles
    .map((h) => h.forecast)
    .filter((f) => isDueWithin(f, nowMs, horizonMs))
    .sort((a, b) => (a.arrival as number) - (b.arrival as number)), [allHoles, nowMs, horizonMs]);

  const gridView = <ThreeDayVisibilityGrid grid={grid} locationNote={`for ${locationLabel(location)}`} />;

  // CMEs: every one the CME Visualization has touching Earth, arriving
  // inside the horizon or still blowing past (utils/cmeEarthArrivals).
  const cmes = useMemo((): ExpectedChange[] => cmeArrivals
    .filter((a) => a.arrivalMs + CME_FULL_MS + CME_EASE_MS >= nowMs && a.arrivalMs <= nowMs + horizonMs)
    .sort((a, b) => a.arrivalMs - b.arrivalMs)
    .map((a) => ({
      atMs: a.arrivalMs, peakMs: a.arrivalMs, endMs: a.arrivalMs + CME_FULL_MS + CME_EASE_MS,
      fromSpeedKms: 0, peakSpeedKms: Math.round(a.speedKms), sourceId: a.id, kind: 'CME sheath', peakSouthwardNt: 0,
    })), [cmeArrivals, nowMs, horizonMs]);

  // A CME's verdict: the best block of the 3-day grid while it is here.
  const cellFor = (a: ExpectedChange) => {
    let best: GridCell | null = null;
    for (const day of grid) for (const c of day.cells) {
      if (c.past || c.endMs <= a.atMs || c.startMs >= a.endMs || c.darkness === 'daylight') continue;
      if (!best || c.effective > best.effective) best = c;
    }
    return best;
  };

  const haveHoleData = !!chState && (chState.history.length > 0 || chState.detections.length > 0);

  if (!haveHoleData && cmes.length === 0) {
    return (
      <div>
        {gridView}
        <p className="text-xs text-neutral-500">
          {chState?.error
            ? 'The coronal hole imagery could not be read, so no stream can be listed yet.'
            : 'Working out which coronal hole streams are due...'}
        </p>
      </div>
    );
  }

  if (holes.length === 0 && cmes.length === 0) {
    return (
      <div>
        {gridView}
        <p className="text-xs text-neutral-400">
          No coronal hole stream or CME is due in the next {horizonDays} days. None of the holes on the Coronal
          Hole Tracker reaches Earth in that time, and the CME Visualization has no CME reaching Earth.
        </p>
      </div>
    );
  }

  const cmeCount = countSources(cmes, isCme);
  type Item = { atMs: number; hole?: HoleForecast; cme?: ExpectedChange };
  const items: Item[] = [
    ...holes.map((f): Item => ({ atMs: f.arrival as number, hole: f })),
    ...cmes.map((a): Item => ({ atMs: a.atMs, cme: a })),
  ].sort((a, b) => a.atMs - b.atMs);

  return (
    <div>
    {gridView}
    <ul className="space-y-2">
      <li className="text-xs text-neutral-200">
        {haveHoleData ? (
          <>In the next {horizonDays} days: {plural(holes.length, 'coronal hole', 'coronal holes')} and{' '}
          {plural(cmeCount, 'CME', 'CMEs')} expected to affect Earth.</>
        ) : (
          // CMEs known, holes not yet measured: say so rather than "no coronal holes".
          <>In the next {horizonDays} days: {plural(cmeCount, 'CME', 'CMEs')} expected to affect Earth. Coronal
          holes are still being measured.</>
        )}
      </li>
      {items.map((item, i) => {
        if (item.hole) {
          return <HoleItem key={`hole-${i}-${item.atMs}`} f={item.hole} nowMs={nowMs} detailed={detailed} />;
        }
        const a = item.cme as ExpectedChange;
        const { what, detail } = describe(a);
        const cell = cellFor(a);
        const night = cell ? { tier: cell.tier, label: cell.label, bestMs: cell.bestMs } : null;
        return (
          <li key={`${a.atMs}-${a.sourceId ?? a.kind}`}
              className="rounded border border-neutral-700/60 bg-neutral-800/40 p-2 flex items-start gap-3">
            {/* The likely tier on its best night; nothing to see if it lands in daylight. */}
            <div className="text-xl flex-shrink-0 leading-none mt-0.5">
              {TIER_ICON[night?.tier ?? 'none'] ?? TIER_ICON.none}
            </div>
            <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-xs font-semibold text-neutral-100">{what}</span>
              <span className="text-[11px] font-mono text-neutral-400">
                {relative(a.atMs, nowMs)} · {fmtNz(a.atMs)}
              </span>
            </div>

            <div className="text-[11px] text-neutral-400 mt-0.5">
              Launched at <span className="text-neutral-200 font-mono">{a.peakSpeedKms} km/s</span>
              {' '}· the CME Visualization has its particles reaching Earth
            </div>

            {night ? (
              <div className="text-[11px] mt-1">
                <span className={TIER_TEXT[night.tier] ?? TIER_TEXT.none}>{night.label}</span>
                <span className="text-neutral-500"> · best {fmtNz(night.bestMs)}</span>
              </div>
            ) : (
              // An arrival that lands entirely in daylight still matters - it
              // just cannot be seen while it is at its strongest.
              <div className="text-[11px] text-neutral-500 mt-1">
                No dark hours inside this arrival, so nothing to see while it is at its strongest.
              </div>
            )}

            {detailed && (
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
                {detail} The size of the storm is from its speed alone.
              </p>
            )}
            </div>
          </li>
        );
      })}
      <li className="text-[10px] text-neutral-600 pt-0.5">
        For {locationLabel(location)}. Coronal holes are the Coronal Hole Tracker&apos;s forecasts; CMEs are the ones
        the CME Visualization has reaching Earth. Arrival times carry real uncertainty - the tracker and the impact graph show the spread.
      </li>
    </ul>
    </div>
  );
};

export default ExpectedArrivals;
