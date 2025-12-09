import React, { useMemo } from 'react';
import { ProcessedCME } from '../types';
import LoadingSpinner from './icons/LoadingSpinner';
import CmeIcon from './icons/CmeIcon';
import GlobeIcon from './icons/GlobeIcon';

interface WsaEnlilBuilderPageProps {
  cmes: ProcessedCME[];
  isLoading: boolean;
  fetchError: string | null;
  onViewCMEInVisualization: (cmeId: string) => void;
  onReload: () => void;
}

const formatNZTimestamp = (date: Date) =>
  date.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const WsaEnlilBuilderPage: React.FC<WsaEnlilBuilderPageProps> = ({
  cmes,
  isLoading,
  fetchError,
  onViewCMEInVisualization,
  onReload,
}) => {
  const earthDirectedCmes = useMemo(
    () =>
      cmes
        .filter((cme) => cme.isEarthDirected)
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime()),
    [cmes]
  );

  return (
    <div className="h-full overflow-y-auto styled-scrollbar bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-neutral-900/80 border border-neutral-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">
              <GlobeIcon className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">WSA-ENLIL Lab</p>
              <h1 className="text-2xl md:text-3xl font-bold text-neutral-50">Earth-Directed CME Builder</h1>
              <p className="text-neutral-400 max-w-3xl">
                Create in-app WSA-ENLIL runs with only Earth-directed CMEs. Choose an event to preview it in the 3D visualization and align inputs for the operational model.
              </p>
            </div>
          </div>
          <button
            onClick={onReload}
            className="self-start md:self-center px-4 py-2 rounded-lg bg-neutral-800 text-neutral-200 border border-neutral-700 hover:border-sky-500 hover:text-white transition-colors"
          >
            Refresh CME List
          </button>
        </header>

        <section className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-neutral-100">Earth-directed Candidates</h2>
            <div className="text-sm text-neutral-400">
              {earthDirectedCmes.length} available
            </div>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-10 text-neutral-300 gap-3">
              <LoadingSpinner className="w-10 h-10" />
              <p>Fetching latest CMEs…</p>
            </div>
          )}

          {!isLoading && fetchError && (
            <div className="bg-red-500/10 border border-red-500/40 text-red-200 rounded-lg p-4">
              <p className="font-semibold">Unable to load CME data</p>
              <p className="text-sm text-red-100/80 mt-1">{fetchError}</p>
            </div>
          )}

          {!isLoading && !fetchError && earthDirectedCmes.length === 0 && (
            <div className="bg-neutral-800/70 border border-neutral-700 text-neutral-300 rounded-lg p-4">
              <p className="font-semibold">No Earth-directed CMEs detected in the selected window.</p>
              <p className="text-sm text-neutral-400 mt-1">Adjust the time range or check back shortly for new events suitable for WSA-ENLIL runs.</p>
            </div>
          )}

          {!isLoading && !fetchError && earthDirectedCmes.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {earthDirectedCmes.map((cme) => (
                <article key={cme.id} className="bg-neutral-800/60 border border-neutral-700/60 rounded-lg p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-neutral-200 font-semibold">
                      <CmeIcon className="w-5 h-5" />
                      {cme.id}
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-300 border border-green-400/50 font-semibold">Earth Directed</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-neutral-300">
                    <div>
                      <p className="text-neutral-400">Launch Time (NZ)</p>
                      <p className="font-semibold">{formatNZTimestamp(cme.startTime)}</p>
                    </div>
                    <div>
                      <p className="text-neutral-400">Speed</p>
                      <p className="font-semibold">{Math.round(cme.speed)} km/s</p>
                    </div>
                    <div>
                      <p className="text-neutral-400">Longitude</p>
                      <p className="font-semibold">{cme.longitude.toFixed(1)}°</p>
                    </div>
                    <div>
                      <p className="text-neutral-400">Latitude</p>
                      <p className="font-semibold">{cme.latitude.toFixed(1)}°</p>
                    </div>
                    <div>
                      <p className="text-neutral-400">Half Width</p>
                      <p className="font-semibold">{cme.halfAngle ?? 0}°</p>
                    </div>
                    <div>
                      <p className="text-neutral-400">Instruments</p>
                      <p className="font-semibold truncate" title={cme.instruments}>{cme.instruments}</p>
                    </div>
                  </div>
                  {cme.predictedArrivalTime && (
                    <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
                      Estimated arrival: {formatNZTimestamp(cme.predictedArrivalTime)}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-auto">
                    <button
                      onClick={() => onViewCMEInVisualization(cme.id)}
                      className="px-3 py-2 rounded-md bg-indigo-600/80 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
                    >
                      Preview in 3D Viewer
                    </button>
                    <a
                      href={cme.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-md bg-neutral-700/80 hover:bg-neutral-600 text-neutral-50 text-sm font-semibold border border-neutral-600 transition-colors"
                    >
                      Source Details
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default WsaEnlilBuilderPage;
