// The next three days in three-hour blocks, NOAA 3-day forecast style, in
// what can be seen rather than in Kp. See utils/threeDayGrid.

import React, { useState } from 'react';
import type { GridCell, GridDay } from '../utils/threeDayGrid';
import { bestCell } from '../utils/threeDayGrid';

const ICON: Record<string, string> = { eye: '👁️', phone: '📱', camera: '📷', none: '😴' };
const CELL_BG: Record<string, string> = {
  eye: 'bg-emerald-500/25 border-emerald-400/40',
  phone: 'bg-sky-500/20 border-sky-400/40',
  camera: 'bg-yellow-500/15 border-yellow-400/30',
  none: 'bg-neutral-800/40 border-neutral-700/40',
};
const TIER_WORD: Record<string, string> = {
  eye: 'Naked eye', phone: 'Phone camera', camera: 'Camera only', none: 'Nothing expected',
};

const hourLabel = (h: number) => {
  const f = (x: number) => {
    const hh = x % 24;
    return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? 'am' : 'pm'}`;
  };
  return `${f(h)}-${f(h + 3)}`;
};

const dayLabel = (ms: number) => new Date(ms + 12 * 3600000).toLocaleDateString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short',
});

const timeLabel = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
});

/** Why a block is what it is, in a sentence. */
const describeCell = (c: GridCell): string => {
  if (c.past) return 'Already past.';
  if (c.darkness === 'daylight') return 'Daylight: nothing can be seen, whatever the activity.';
  const why = c.driver === 'NOAA Kp' ? `NOAA forecasts Kp ${c.kp?.toFixed(2)}`
    : c.driver === 'coronal hole' ? 'a coronal hole stream from the tracker'
    : c.driver === 'CME' ? 'a CME from the model'
    : 'quiet conditions';
  const moon = c.moonUp ? `the Moon is up, ${Math.round(c.moonIllumination * 100)}% lit` : 'the Moon is down';
  return `${TIER_WORD[c.tier]} (${c.effective}/100) around ${timeLabel(c.bestMs)}: ${why}; ${moon}`
    + (c.darkness !== 'dark' ? `, ${c.darkness}` : '') + '.';
};

const ThreeDayVisibilityGrid: React.FC<{ grid: GridDay[]; locationNote: string }> = ({ grid, locationNote }) => {
  const [picked, setPicked] = useState<GridCell | null>(null);
  if (grid.length === 0) return null;
  const best = bestCell(grid);
  const shown = picked ?? best;

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1.5">
        <span className="text-xs font-semibold text-neutral-200">Next 3 days, 3 hours at a time</span>
        <span className="text-[10px] text-neutral-500">NZ time · {locationNote}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="text-left text-[10px] font-normal text-neutral-500 pr-1" />
              {grid.map((d) => (
                <th key={d.dayStartMs} className="text-[11px] font-semibold text-neutral-300 text-center">
                  {dayLabel(d.dayStartMs)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid[0].cells.map((_, row) => (
              <tr key={row}>
                <td className="text-[10px] text-neutral-500 whitespace-nowrap pr-1">{hourLabel(grid[0].cells[row].startHour)}</td>
                {grid.map((d) => {
                  const c = d.cells[row];
                  if (!c) return <td key={d.dayStartMs} />;
                  const day = c.darkness === 'daylight' && !c.past;
                  const cls = c.past ? 'bg-neutral-900/40 border-neutral-800/40 opacity-40'
                    : day ? 'bg-neutral-800/20 border-neutral-800/40'
                    : CELL_BG[c.tier] ?? CELL_BG.none;
                  const isShown = shown && shown.startMs === c.startMs;
                  return (
                    <td key={d.dayStartMs} className="p-0">
                      <button
                        type="button"
                        onClick={() => setPicked(c)}
                        title={describeCell(c)}
                        className={`w-full h-8 rounded border text-center leading-none flex items-center justify-center gap-1 ${cls} ${isShown ? 'ring-1 ring-white/60' : ''}`}
                      >
                        {c.past ? <span className="text-[10px] text-neutral-600">-</span>
                          : day ? <span className="text-sm opacity-60">☀️</span>
                          : (
                            <>
                              <span className="text-sm">{ICON[c.tier] ?? ICON.none}</span>
                              <span className="text-[10px] font-mono text-neutral-300">{c.effective}</span>
                            </>
                          )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-300 mt-1.5">
        {shown
          ? <>{picked ? '' : 'Best ahead: '}{describeCell(shown)}</>
          : 'Nothing visible expected in the next three days.'}
      </p>
      <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
        👁️ naked eye · 📱 phone camera · 📷 camera only · 😴 nothing · ☀️ daylight. The number is strength for your
        location, 0-100, after the Moon and twilight. Each block takes the stronger of the coronal hole streams on the
        Coronal Hole Tracker and the CME model. Tap a block for why.
      </p>
    </div>
  );
};

export default ThreeDayVisibilityGrid;
