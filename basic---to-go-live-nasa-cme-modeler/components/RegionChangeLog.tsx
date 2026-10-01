// Every change in a sunspot region over the last two weeks, newest first,
// from the sunspot-history worker. Each line is timed to when the source
// measured it (NOAA's daily bulletin, an HMI hour, a flare's start).

import React, { useState } from 'react';
import { FIELD_LABELS, formatFieldValue, type RegionEvent, type RegionRecord } from '../utils/sunspotHistory';

const fmtNz = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

const SOURCE: Record<RegionEvent['source'], string> = {
  srs: 'NOAA daily report',
  'noaa-json': 'NOAA',
  sharp: 'SDO/HMI',
  donki: 'NASA DONKI',
};

const describe = (e: RegionEvent): { title: string; colour: string; lines: string[] } => {
  const lines = Object.entries(e.changes ?? {})
    .filter(([f]) => f !== 'areaMh')
    .map(([f, [a, b]]) => (a == null
      ? `${FIELD_LABELS[f] ?? f}: ${formatFieldValue(f, b)}`
      : `${FIELD_LABELS[f] ?? f}: ${formatFieldValue(f, a)} → ${formatFieldValue(f, b)}`));
  switch (e.kind) {
    case 'appeared': return { title: 'First listed', colour: '#38bdf8', lines };
    case 'returned': return { title: 'Listed again', colour: '#38bdf8', lines };
    case 'gone': return { title: 'No longer listed (rotated away or faded)', colour: '#737373', lines };
    case 'flare': return { title: `${e.flareClass || ''} flare`.trim(), colour: '#f87171', lines: [] };
    case 'flux': {
      const [a, b] = (e.changes?.usfluxMx ?? [null, null]) as [number | null, number | null];
      const up = a != null && b != null && b > a;
      const pct = a && b ? Math.round((b / a - 1) * 100) : null;
      return {
        title: up ? `Magnetic flux rising${pct != null ? ` (+${pct}%)` : ''}` : `Magnetic flux falling${pct != null ? ` (${pct}%)` : ''}`,
        colour: up ? '#fbbf24' : '#a3a3a3',
        lines,
      };
    }
    default: return { title: 'Changed', colour: '#e5e5e5', lines };
  }
};

const RegionChangeLog: React.FC<{ record: RegionRecord | null | undefined }> = ({ record }) => {
  const [all, setAll] = useState(false);
  if (!record || record.events.length === 0) return null;
  const events = [...record.events].reverse();
  const shown = all ? events : events.slice(0, 6);
  return (
    <div className="mt-3 pt-2.5 border-t border-neutral-800">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs text-neutral-500">Changes, last 14 days</span>
        <span className="text-[10px] text-neutral-500">{record.events.length} recorded</span>
      </div>
      <ol className="space-y-1.5">
        {shown.map((e, i) => {
          const d = describe(e);
          return (
            <li key={`${e.kind}-${e.atMs}-${i}`} className="text-[11px] leading-snug">
              <div className="flex justify-between gap-2">
                <span className="font-semibold" style={{ color: d.colour }}>{d.title}</span>
                <span className="text-neutral-500 shrink-0">{fmtNz(e.atMs)}</span>
              </div>
              {d.lines.length > 0 && <div className="text-neutral-300">{d.lines.join(' · ')}</div>}
              <div className="text-[10px] text-neutral-600">{SOURCE[e.source]}{e.location ? ` · ${e.location}` : ''}</div>
            </li>
          );
        })}
      </ol>
      {events.length > 6 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1.5 text-[11px] text-sky-400 hover:text-sky-300">
          {all ? 'Show fewer' : `Show all ${events.length}`}
        </button>
      )}
    </div>
  );
};

export default RegionChangeLog;
