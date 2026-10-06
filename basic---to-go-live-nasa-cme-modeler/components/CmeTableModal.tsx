// Every current CME in one table, with the figures forecasters ask for:
// start, time at 21.5 solar radii, speed, source region and location, the
// WSA-ENLIL arrival at Earth, the associated flare, and - opened per CME - the
// full description, the ENLIL inputs and every ENLIL run's outputs.
//
// All of it is DONKI's own record (ProcessedCME.raw), so nothing here is
// estimated by the app. The analysis shown is the one the 3D view draws
// (utils/cmeAnalysis pickAnalysis); flare classes come from DONKI's flare list.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProcessedCME, CMEAnalysis } from '../types';
import { fetchFlareData, SolarFlare } from '../services/nasaService';
import { pickAnalysis } from '../utils/cmeAnalysis';
import { enlilAnimationUrl, enlilAnimationFolder } from '../utils/enlilLinks';
import CloseIcon from './icons/CloseIcon';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cmes: ProcessedCME[];
  /** Show this CME in the 3D view. */
  onViewCME?: (cme: ProcessedCME) => void;
}

interface EnlilImpact { isGlancingBlow?: boolean; location?: string; arrivalTime?: string }
interface EnlilRun {
  modelCompletionTime?: string;
  au?: number;
  estimatedShockArrivalTime?: string | null;
  estimatedDuration?: number | null;
  rmin_re?: number | null;
  kp_18?: number | null;
  kp_90?: number | null;
  kp_135?: number | null;
  kp_180?: number | null;
  isEarthGB?: boolean;
  link?: string;
  impactList?: EnlilImpact[] | null;
  cmeIDs?: string[];
}

interface Row {
  cme: ProcessedCME;
  analysis: CMEAnalysis | null;
  runs: EnlilRun[];
  /** The newest run that has the CME reaching Earth, else null. */
  earthRun: EnlilRun | null;
  flares: { id: string; flare: SolarFlare | null }[];
}

const NZ: Intl.DateTimeFormatOptions = {
  timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
};
const fmt = (iso?: string | null): string => {
  if (!iso) return ' - ';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ' - ' : d.toLocaleString('en-NZ', NZ);
};
const utc = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};
const num = (v: unknown, digits = 0): string =>
  (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : ' - ');

/** A flare's id carries its start time: 2026-10-05T12:30:00-FLR-001. */
const flareTimeFromId = (id: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(id);
  return m ? `${m[1]}Z` : null;
};

/** NOAA's region number as the rest of the app shows it: DONKI's 14549 is AR 4549. */
const regionLabel = (n: number | null | undefined): string | null =>
  (typeof n === 'number' && n > 0 ? `AR ${n >= 10000 ? n % 10000 : n}` : null);

const newestFirst = (a: EnlilRun, b: EnlilRun) =>
  new Date(b.modelCompletionTime ?? 0).getTime() - new Date(a.modelCompletionTime ?? 0).getTime();

function buildRows(cmes: ProcessedCME[], flaresById: Map<string, SolarFlare>): Row[] {
  return cmes.map((cme) => {
    const analysis = (pickAnalysis(cme.raw?.cmeAnalyses ?? null) as CMEAnalysis | null) ?? null;
    const runs = ((analysis?.enlilList ?? []) as EnlilRun[]).slice().sort(newestFirst);
    const earthRun = runs.find((r) => !!r.estimatedShockArrivalTime) ?? null;
    const flares = (cme.raw?.linkedEvents ?? [])
      .map((e) => e.activityID)
      .filter((id) => id.includes('-FLR-'))
      .map((id) => ({ id, flare: flaresById.get(id) ?? null }));
    return { cme, analysis, runs, earthRun, flares };
  });
}

const FlareText: React.FC<{ f: { id: string; flare: SolarFlare | null } }> = ({ f }) => (
  f.flare
    ? <span title={`Peak ${utc(f.flare.peakTime)}`}><strong className="text-amber-300">{f.flare.classType}</strong> {fmt(f.flare.peakTime)}</span>
    : <span title={f.id}>Flare {fmt(flareTimeFromId(f.id))}</span>
);

const EarthArrival: React.FC<{ row: Row }> = ({ row }) => {
  if (row.earthRun) {
    return (
      <span title={utc(row.earthRun.estimatedShockArrivalTime)}>
        <span className="text-green-300 font-semibold">{fmt(row.earthRun.estimatedShockArrivalTime)}</span>
        {row.earthRun.isEarthGB && <span className="text-neutral-400"> (glancing)</span>}
      </span>
    );
  }
  if (row.runs.length > 0) return <span className="text-neutral-400">Misses Earth</span>;
  return <span className="text-neutral-500">No ENLIL run</span>;
};

const LinkButton: React.FC<{ href: string; children: React.ReactNode; title?: string }> = ({ href, children, title }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" title={title}
     className="inline-block px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-sky-300 border border-neutral-700 transition-colors">
    {children}
  </a>
);

/** The opened part of a row: description, ENLIL inputs, ENLIL outputs, links. */
const Details: React.FC<{ row: Row; onViewCME?: (cme: ProcessedCME) => void }> = ({ row, onViewCME }) => {
  const { cme, analysis, runs } = row;
  return (
    <div className="space-y-4 text-xs text-neutral-300">
      <div className="flex flex-wrap gap-2">
        {onViewCME && (
          <button type="button" onClick={() => onViewCME(cme)}
                  className="px-2.5 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white transition-colors">
            Show in 3D
          </button>
        )}
        {cme.link && <LinkButton href={cme.link}>DONKI entry</LinkButton>}
        {row.flares.map((f) => f.flare?.link && (
          <LinkButton key={f.id} href={f.flare.link}>Flare {f.flare.classType}</LinkButton>
        ))}
      </div>

      <section>
        <h4 className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">Description</h4>
        <p className="whitespace-pre-wrap leading-relaxed text-neutral-300">{cme.raw?.note || cme.note || 'No description.'}</p>
        {cme.instruments && cme.instruments !== 'N/A' && (
          <p className="mt-1 text-neutral-500">Seen by {cme.instruments}</p>
        )}
      </section>

      <section>
        <h4 className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">ENLIL parameters (cone model inputs)</h4>
        {analysis ? (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
            <div><dt className="text-neutral-500">Time at 21.5 Rs</dt><dd title={utc(analysis.time21_5)}>{fmt(analysis.time21_5)}</dd></div>
            <div><dt className="text-neutral-500">Speed</dt><dd>{num(analysis.speed)} km/s</dd></div>
            <div><dt className="text-neutral-500">Longitude</dt><dd>{num(analysis.longitude)}°</dd></div>
            <div><dt className="text-neutral-500">Latitude</dt><dd>{num(analysis.latitude)}°</dd></div>
            <div><dt className="text-neutral-500">Half angle</dt><dd>{num(analysis.halfAngle)}°</dd></div>
            <div><dt className="text-neutral-500">Type</dt><dd>{analysis.type || ' - '}</dd></div>
            <div><dt className="text-neutral-500">Most accurate</dt><dd>{analysis.isMostAccurate ? 'Yes' : 'No'}</dd></div>
            <div><dt className="text-neutral-500">Data level</dt><dd>{analysis.levelOfData ?? ' - '}</dd></div>
          </dl>
        ) : <p className="text-neutral-500">No analysis from NASA yet.</p>}
        {analysis?.note && <p className="mt-1.5 text-neutral-400 whitespace-pre-wrap">{analysis.note}</p>}
      </section>

      <section>
        <h4 className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">
          ENLIL outputs {runs.length > 0 && <span className="normal-case tracking-normal text-neutral-400">({runs.length} run{runs.length === 1 ? '' : 's'}, newest first)</span>}
        </h4>
        {runs.length === 0 && <p className="text-neutral-500">NASA has not run WSA-ENLIL for this CME.</p>}
        <div className="space-y-2">
          {runs.map((run, i) => {
            const anim = enlilAnimationUrl(run.modelCompletionTime, run.au);
            const others = (run.impactList ?? []).filter((x) => x.location && !/earth/i.test(x.location));
            const kps = [['18°', run.kp_18], ['90°', run.kp_90], ['135°', run.kp_135], ['180°', run.kp_180]]
              .filter(([, v]) => typeof v === 'number');
            return (
              <div key={`${run.modelCompletionTime}-${i}`} className="rounded border border-neutral-800 bg-neutral-900/50 p-2.5">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                  <div><dt className="text-neutral-500">Run completed</dt><dd title={utc(run.modelCompletionTime)}>{fmt(run.modelCompletionTime)}</dd></div>
                  <div><dt className="text-neutral-500">Earth arrival</dt>
                    <dd title={utc(run.estimatedShockArrivalTime)} className={run.estimatedShockArrivalTime ? 'text-green-300 font-semibold' : 'text-neutral-400'}>
                      {run.estimatedShockArrivalTime ? `${fmt(run.estimatedShockArrivalTime)}${run.isEarthGB ? ' (glancing)' : ''}` : 'Misses Earth'}
                    </dd>
                  </div>
                  <div><dt className="text-neutral-500">Duration at Earth</dt><dd>{typeof run.estimatedDuration === 'number' ? `${num(run.estimatedDuration, 1)} h` : ' - '}</dd></div>
                  <div><dt className="text-neutral-500">Magnetopause standoff</dt><dd>{typeof run.rmin_re === 'number' ? `${num(run.rmin_re, 1)} Re` : ' - '}</dd></div>
                  {kps.length > 0 && (
                    <div className="col-span-2 sm:col-span-4"><dt className="text-neutral-500">Kp estimate by IMF clock angle</dt>
                      <dd>{kps.map(([k, v]) => `${k}: Kp ${num(v)}`).join(' · ')}</dd></div>
                  )}
                  {others.length > 0 && (
                    <div className="col-span-2 sm:col-span-4"><dt className="text-neutral-500">Other impacts</dt>
                      <dd>{others.map((x) => `${x.location} ${fmt(x.arrivalTime)}${x.isGlancingBlow ? ' (glancing)' : ''}`).join(' · ')}</dd></div>
                  )}
                  <div><dt className="text-neutral-500">Model reach</dt><dd>{num(run.au, 1)} AU</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-2">
                  {run.link && <LinkButton href={run.link}>ENLIL DONKI entry</LinkButton>}
                  {anim && <LinkButton href={anim} title="This run's solar wind speed animation, from NASA iSWA">ENLIL model</LinkButton>}
                  <a href={enlilAnimationFolder(run.modelCompletionTime)} target="_blank" rel="noopener noreferrer"
                     className="inline-block px-2 py-1 text-neutral-400 hover:text-neutral-200">All this month</a>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

const CmeTableModal: React.FC<Props> = ({ isOpen, onClose, cmes, onViewCME }) => {
  const [flares, setFlares] = useState<SolarFlare[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchFlareData().then((f) => { if (!cancelled) setFlares(f); }).catch(() => { /* classes show as times */ });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  const rows = useMemo(() => {
    const byId = new Map(flares.map((f) => [f.flrID, f]));
    return buildRows([...cmes].sort((a, b) => b.startTime.getTime() - a.startTime.getTime()), byId);
  }, [cmes, flares]);

  if (!isOpen) return null;
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  return createPortal(
    <div className="fixed inset-0 z-[3000] bg-black/75 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}
         role="dialog" aria-modal="true" aria-labelledby="cme-table-title">
      <div className="w-full max-w-7xl max-h-[100dvh] sm:max-h-[92dvh] flex flex-col bg-neutral-950 border border-neutral-800 sm:rounded-xl shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-neutral-800">
          <div>
            <h2 id="cme-table-title" className="text-lg font-semibold text-white">Current CMEs</h2>
            <p className="text-[11px] text-neutral-500">From NASA DONKI. Times are New Zealand time; hover for UTC. Tap a CME for its description, ENLIL inputs and outputs.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-neutral-400 hover:text-white" aria-label="Close">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-auto styled-scrollbar">
          {rows.length === 0 && <p className="p-6 text-center text-neutral-500 italic">No CMEs in this period.</p>}

          {/* Wide screens: a table. */}
          {rows.length > 0 && (
            <table className="hidden md:table w-full text-xs text-left text-neutral-300">
              <thead className="sticky top-0 bg-neutral-950 text-[11px] uppercase tracking-wider text-neutral-500 z-10">
                <tr className="border-b border-neutral-800">
                  <th className="px-3 py-2 font-medium">Start</th>
                  <th className="px-3 py-2 font-medium">At 21.5 Rs</th>
                  <th className="px-3 py-2 font-medium">Speed</th>
                  <th className="px-3 py-2 font-medium">Region</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">ENLIL Earth arrival</th>
                  <th className="px-3 py-2 font-medium">Flare</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpenRow = open === row.cme.id;
                  return (
                    <React.Fragment key={row.cme.id}>
                      <tr className={`border-b border-neutral-900 cursor-pointer hover:bg-neutral-900/70 ${isOpenRow ? 'bg-neutral-900/70' : ''}`}
                          onClick={() => toggle(row.cme.id)}>
                        <td className="px-3 py-2 whitespace-nowrap" title={utc(row.cme.raw?.startTime)}>{fmt(row.cme.raw?.startTime)}</td>
                        <td className="px-3 py-2 whitespace-nowrap" title={utc(row.analysis?.time21_5)}>{fmt(row.analysis?.time21_5)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{num(row.analysis?.speed ?? row.cme.speed)} km/s</td>
                        <td className="px-3 py-2 whitespace-nowrap">{regionLabel(row.cme.raw?.activeRegionNum) ?? ' - '}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.cme.raw?.sourceLocation || ' - '}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><EarthArrival row={row} /></td>
                        <td className="px-3 py-2">{row.flares.length ? row.flares.map((f) => <div key={f.id}><FlareText f={f} /></div>) : <span className="text-neutral-500"> - </span>}</td>
                        <td className="px-3 py-2 text-right text-sky-300 whitespace-nowrap">{isOpenRow ? 'Hide' : 'Details'}</td>
                      </tr>
                      {isOpenRow && (
                        <tr className="bg-neutral-900/40 border-b border-neutral-800">
                          <td colSpan={8} className="px-4 py-4"><Details row={row} onViewCME={onViewCME} /></td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Phones: a card per CME. */}
          <div className="md:hidden divide-y divide-neutral-900">
            {rows.map((row) => {
              const isOpenRow = open === row.cme.id;
              return (
                <div key={row.cme.id} className="px-4 py-3">
                  <button type="button" onClick={() => toggle(row.cme.id)} className="w-full text-left text-xs text-neutral-300">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-semibold text-neutral-100">{fmt(row.cme.raw?.startTime)}</span>
                      <span className="text-sky-300">{isOpenRow ? 'Hide' : 'Details'}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1.5">
                      <div><dt className="text-neutral-500">At 21.5 Rs</dt><dd>{fmt(row.analysis?.time21_5)}</dd></div>
                      <div><dt className="text-neutral-500">Speed</dt><dd>{num(row.analysis?.speed ?? row.cme.speed)} km/s</dd></div>
                      <div><dt className="text-neutral-500">Source</dt><dd>{[regionLabel(row.cme.raw?.activeRegionNum), row.cme.raw?.sourceLocation].filter(Boolean).join(' · ') || ' - '}</dd></div>
                      <div><dt className="text-neutral-500">ENLIL Earth arrival</dt><dd><EarthArrival row={row} /></dd></div>
                      <div className="col-span-2"><dt className="text-neutral-500">Flare</dt><dd>{row.flares.length ? row.flares.map((f) => <div key={f.id}><FlareText f={f} /></div>) : ' - '}</dd></div>
                    </dl>
                  </button>
                  {isOpenRow && <div className="mt-3"><Details row={row} onViewCME={onViewCME} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CmeTableModal;
