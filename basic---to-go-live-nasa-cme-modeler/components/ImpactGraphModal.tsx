// What the solar wind at Earth is expected to do, and what that means tonight.
//
// This used to be three charts of a profile the 3D scene computed for itself.
// It now reads the one forecast timeline the rest of the app reads, so the
// numbers here, the numbers on the coronal hole tracker and the holes drawn on
// the Sun cannot disagree - they are the same arithmetic run once.
//
// Two things it deliberately does not do. It does not draw a forecast Bz line,
// because nobody can forecast Bz and a line implies otherwise; it draws the
// part the sector geometry guarantees and shades the part that is unknowable.
// And it does not lead with the wind at all - it leads with what you would see
// on each night, because that is the question being asked.

import React, { useMemo } from 'react';
import CloseIcon from './icons/CloseIcon';
import { useForecast } from '../hooks/useForecast';
import { nightlyOutlook } from '../utils/auroraOutlook';
import { resolveViewerLocation, locationLabel } from '../utils/viewerLocation';
import type { L1State } from '../utils/forecastTimeline';

interface ImpactGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const fmtNz = (ms: number, withDate = true): string =>
  new Date(ms).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

const fmtDay = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'long', day: 'numeric', month: 'short' });

/** A small line chart. Enough for a shape, without a chart library. */
const Trace: React.FC<{
  points: L1State[];
  valueOf: (p: L1State) => number;
  bandOf?: (p: L1State) => [number, number];
  colour: string;
  label: string;
  unit: string;
  nowMs: number;
}> = ({ points, valueOf, bandOf, colour, label, unit, nowMs }) => {
  if (points.length < 2) return null;

  const W = 720, H = 90, PAD = 4;
  const t0 = points[0].atMs, t1 = points[points.length - 1].atMs;
  const values = points.map(valueOf);
  const bandValues = bandOf ? points.flatMap((p) => bandOf(p)) : [];
  const lo = Math.min(...values, ...bandValues);
  const hi = Math.max(...values, ...bandValues);
  const span = Math.max(1e-6, hi - lo);

  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.atMs).toFixed(1)},${y(valueOf(p)).toFixed(1)}`).join(' ');
  const band = bandOf
    ? `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.atMs).toFixed(1)},${y(bandOf(p)[0]).toFixed(1)}`).join(' ')} `
      + `${[...points].reverse().map((p) => `L${x(p.atMs).toFixed(1)},${y(bandOf(p)[1]).toFixed(1)}`).join(' ')} Z`
    : null;

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-500 font-mono">{lo.toFixed(0)} to {hi.toFixed(0)} {unit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none" role="img" aria-label={label}>
        {band && <path d={band} fill={`${colour}22`} />}
        {/* Where observation stops and model begins. */}
        <line x1={x(nowMs)} y1={0} x2={x(nowMs)} y2={H} stroke="#a3a3a3" strokeWidth="1"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
};

const TIER_STYLE: Record<string, string> = {
  eye: 'text-emerald-300 border-emerald-700/60 bg-emerald-900/30',
  phone: 'text-sky-300 border-sky-700/60 bg-sky-900/30',
  camera: 'text-yellow-300 border-yellow-700/60 bg-yellow-900/20',
  none: 'text-neutral-400 border-neutral-700 bg-neutral-800/40',
};

const ImpactGraphModal: React.FC<ImpactGraphModalProps> = ({ isOpen, onClose }) => {
  const forecast = useForecast(isOpen);
  const location = useMemo(() => resolveViewerLocation(), []);

  const nights = useMemo(
    () => (forecast.outlook.length > 0
      ? nightlyOutlook(forecast.outlook, location.latitude, location.longitude)
      : []),
    [forecast.outlook, location],
  );

  if (!isOpen) return null;

  const nowMs = Date.now();
  const future = forecast.timeline.filter((p) => p.atMs >= nowMs);

  return (
    <div className="fixed inset-0 bg-black/80 z-[1200] flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-lg w-full max-w-4xl max-h-[92vh] overflow-y-auto styled-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 sticky top-0 bg-neutral-950 z-10">
          <div>
            <h2 className="text-lg font-semibold text-white">Solar Wind Outlook</h2>
            <p className="text-xs text-neutral-500">
              {forecast.source === 'worker' ? 'Computed server-side' :
               forecast.source === 'device' ? 'Computed on this device' : 'Not available'}
              {forecast.generatedAtMs && ` · ${fmtNz(forecast.generatedAtMs)}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-neutral-800" aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="p-4">
          {forecast.loading && forecast.timeline.length === 0 && (
            <p className="text-sm text-neutral-400">Working out the forecast...</p>
          )}

          {!forecast.loading && forecast.timeline.length === 0 && (
            <p className="text-sm text-neutral-400">
              No forecast yet. It needs coronal holes to have been detected, which happens when the Solar Activity
              page has been open. Open that page and come back.
            </p>
          )}

          {forecast.refreshing && (
            <div className="mb-3 text-xs text-sky-300 bg-sky-900/20 border border-sky-800/50 rounded p-2">
              Measuring the latest coronal holes and recomputing - this takes about a minute. What is below is the
              last forecast, and it will update in place when the new one lands.
            </div>
          )}

          {forecast.stale && !forecast.refreshing && forecast.timeline.length > 0 && (
            <div className="mb-3 text-xs text-yellow-300 bg-yellow-900/20 border border-yellow-800/50 rounded p-2">
              The coronal holes behind this forecast are more than six hours old, so treat it as indicative. The
              refresh this panel asked for did not get through, so this is the last good one.
            </div>
          )}

          {/* What you would see, night by night - the actual question. */}
          {nights.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-neutral-200 mb-2">What you could see</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {nights.slice(0, 6).map((night) => (
                  <div key={night.nightMs} className={`rounded border p-2 ${TIER_STYLE[night.tier] ?? TIER_STYLE.none}`}>
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-semibold">{fmtDay(night.nightMs)}</span>
                      <span className="text-[11px] font-mono opacity-80">best {fmtNz(night.bestMs, false)}</span>
                    </div>
                    <div className="text-xs mt-0.5">{night.label}</div>
                    {night.disturbance !== 'ambient' && (
                      <div className="text-[11px] opacity-70 mt-0.5">{night.disturbance}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-neutral-600 mt-1.5">
                For {locationLabel(location)}. Each night is scored at its best moment - darkest sky, oval closest -
                rather than at an arbitrary hour, because a good forecast at 2pm is no use to anybody.
              </p>
            </div>
          )}

          {/* The wind itself. */}
          {future.length > 1 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-neutral-200 mb-2">The wind at Earth</h3>
              <Trace points={forecast.timeline} valueOf={(p) => p.speedKms}
                     colour="#38bdf8" label="Speed" unit="km/s" nowMs={nowMs} />
              <Trace points={forecast.timeline} valueOf={(p) => p.densityCm3}
                     colour="#a78bfa" label="Density" unit="cm⁻³" nowMs={nowMs} />
              <Trace points={forecast.timeline} valueOf={(p) => p.btNt}
                     colour="#fbbf24" label="Field strength (Bt)" unit="nT" nowMs={nowMs} />
              <Trace points={forecast.timeline} valueOf={(p) => p.bzFromSectorNt}
                     bandOf={(p) => [p.bzFromSectorNt - p.bzFluctuationNt, p.bzFromSectorNt + p.bzFluctuationNt]}
                     colour="#fb7185" label="Southward field (Bz)" unit="nT" nowMs={nowMs} />
              <p className="text-[11px] text-neutral-600">
                The dashed line is now: left of it is measured, right of it is modelled. Density is the one that
                surprises people - it <em>drops</em> inside a fast stream and spikes in the compression ahead of it.
              </p>
              <p className="text-[11px] text-neutral-600 mt-1">
                The Bz line is only the part the sector geometry guarantees, which is computable. The shaded band is
                the size of the fluctuations on top, whose sign nobody can forecast - so there is no single Bz
                number here, because there is no honest one to give.
              </p>
            </div>
          )}

          {/* How well this has actually been doing. */}
          <div className="border-t border-neutral-800 pt-3">
            <h3 className="text-sm font-semibold text-neutral-200 mb-1">Track record</h3>
            {forecast.trackRecord && forecast.trackRecord.scored > 0 ? (
              <>
                <p className="text-xs text-neutral-300">{forecast.trackRecord.summary}</p>
                <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                  <div>
                    <div className="text-neutral-500">Arrivals scored</div>
                    <div className="text-neutral-200 font-mono">{forecast.trackRecord.scored}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Median error</div>
                    <div className="text-neutral-200 font-mono">
                      {forecast.trackRecord.medianAbsErrorHours.toFixed(1)} h
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Inside the band</div>
                    <div className="text-neutral-200 font-mono">
                      {Math.round(forecast.trackRecord.bandHitRate * 100)}%
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-neutral-500">
                Nothing scored yet. Each forecast is written down when it is made and compared against what the
                spacecraft at L1 actually measured once its window passes, so this fills in over time. Until it
                does, the uncertainty shown elsewhere is derived from the inputs rather than measured against
                outcomes - which is better than a number picked by hand, but not the same as evidence.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImpactGraphModal;
