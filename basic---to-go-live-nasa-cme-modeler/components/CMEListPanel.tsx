import React from 'react';
import { ProcessedCME } from '../types';
import CloseIcon from './icons/CloseIcon';
import { CmeOrientation, orientationSummary } from '../utils/cmeOrientation';
/** NASA's DONKI service down (503 / unavailable), as opposed to any other failure. */
const isNasaOutage = (msg: string) => /503|unavailable|DONKI|downtime/i.test(msg);

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: 'text-green-400 border-green-500/40 bg-green-500/10' },
  estimated: { label: 'Estimated', cls: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  unknown: { label: 'Not determined', cls: 'text-neutral-400 border-neutral-600 bg-neutral-800/60' },
};

const SOURCE_NAMES: Record<string, string> = {
  coronagraph: 'Coronagraphs',
  sourceRegion: 'Source region',
  nasa: "NASA's analysis",
};

/**
 * Our orientation analysis for the selected CME: how the flux rope is tilted,
 * whether that is confirmed (two independent methods agree) or estimated, how
 * confident, which direction the 3D model draws, and why.
 */
const OrientationInfo: React.FC<{ cme: ProcessedCME }> = ({ cme }) => {
  const o: CmeOrientation | null | undefined = cme.orientation;
  if (!o) {
    return <p><strong>Orientation:</strong> <span className="italic">not analysed yet (runs every 30 minutes)</span></p>;
  }
  const style = STATUS_STYLE[o.status] ?? STATUS_STYLE.unknown;
  const d = o.direction;
  const estimates = Object.entries(o.estimates ?? {});
  return (
    <div className="mt-1 mb-1 p-2 rounded border border-neutral-700/60 bg-neutral-950/40 space-y-1">
      <p className="flex flex-wrap items-center gap-1.5">
        <strong>Orientation:</strong> {orientationSummary(o)}
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${style.cls}`}>{style.label}</span>
        {o.status !== 'unknown' && <span className="text-neutral-500">{o.confidence}% confidence</span>}
      </p>
      {estimates.length > 0 && (
        <p className="text-neutral-500">
          {estimates.map(([k, e]) => `${SOURCE_NAMES[k] ?? k}: ${Math.round(e!.tilt)}° (${e!.confidence}%)`).join(' · ')}
        </p>
      )}
      {o.field && (
        <p>
          <strong>Expected field:</strong> {o.field.leadingField === 'south' ? 'southward at the front (Bz negative first)' : 'northward at the front (Bz positive first)'}, rope type {o.field.ropeType}
          <span className="text-neutral-500"> (from the source region and the hemisphere rule)</span>
        </p>
      )}
      {d && (
        <p>
          <strong>Direction drawn:</strong>{' '}
          {d.useInModel
            ? <>ours, {d.lon.toFixed(0)}° / {d.lat.toFixed(0)}° ({d.confidence}%, {d.basis})</>
            : <>NASA's. Ours ({d.lon.toFixed(0)}° / {d.lat.toFixed(0)}°, {d.confidence}%) is not confident enough to use</>}
        </p>
      )}
      {o.notes && o.notes.length > 0 && (
        <p className="text-neutral-500 italic">{o.notes.slice(0, 3).join('. ')}.</p>
      )}
    </div>
  );
};

interface CMEListPanelProps {
  cmes: ProcessedCME[];
  onSelectCME: (cme: ProcessedCME | null) => void; // Allow null to deselect or show all
  selectedCMEId: string | null;
  selectedCMEForInfo: ProcessedCME | null;
  isLoading: boolean;
  fetchError: string | null;
  onClose?: () => void;
  /** Open every CME as a table (components/CmeTableModal). */
  onOpenTable?: () => void;
}

const CMEListPanel: React.FC<CMEListPanelProps> = ({ cmes, onSelectCME, selectedCMEId, selectedCMEForInfo, isLoading, fetchError, onClose, onOpenTable }) => {
  return (
    <div className="panel lg:bg-neutral-950/80 backdrop-blur-md lg:border lg:border-neutral-800/90 lg:rounded-lg p-4 lg:shadow-xl flex flex-col w-full h-full">
      {selectedCMEForInfo && (
        <div className="mb-4 p-3 bg-neutral-900/70 rounded-md border border-neutral-700/60 relative">
          <div className="flex justify-between items-center mb-2 border-b border-neutral-700/50 pb-1">
            <h2 className={`text-lg font-semibold text-neutral-200`}>Selected CME</h2>
            <button onClick={() => onSelectCME(null)} className="p-1 text-neutral-400 hover:text-white" title="Deselect CME">
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-1 text-xs text-neutral-400 max-h-48 overflow-y-auto styled-scrollbar pr-1">
            <p><strong>ID:</strong> <a href={selectedCMEForInfo.link} target="_blank" rel="noopener noreferrer" className={`text-neutral-400 hover:underline`}>{selectedCMEForInfo.id}</a></p>
            <p><strong>Start Time:</strong> {selectedCMEForInfo.startTime.toLocaleString()}</p>
            <p><strong>Speed:</strong> {selectedCMEForInfo.speed} km/s</p>
            {selectedCMEForInfo.longitudeMeasured === false ? (
              <p><strong>Direction (Lon/Lat):</strong> not measured / {selectedCMEForInfo.latitude.toFixed(1)}°{' '}
                <span className="text-neutral-500">(NASA measured it in one coronagraph's view only, so its longitude is unknown; drawn at {selectedCMEForInfo.sourceLocation !== 'N/A' && selectedCMEForInfo.sourceLocation ? `its source region's, ${selectedCMEForInfo.longitude.toFixed(0)}°` : "0° as a placeholder"})</span></p>
            ) : (
              <p><strong>Direction (Lon/Lat):</strong> {selectedCMEForInfo.longitude.toFixed(1)}° / {selectedCMEForInfo.latitude.toFixed(1)}°</p>
            )}
            <OrientationInfo cme={selectedCMEForInfo} />
            <p><strong>Source:</strong> {selectedCMEForInfo.sourceLocation}</p>
            <p><strong>Instruments:</strong> {selectedCMEForInfo.instruments}</p>
            <p><strong>Earth Directed:</strong> <span className={selectedCMEForInfo.isEarthDirected ? 'text-green-400 font-bold' : 'text-orange-400'}>{selectedCMEForInfo.isEarthDirected ? 'Yes' : 'No'}</span></p>
            <p><strong>Predicted Arrival:</strong> {selectedCMEForInfo.predictedArrivalTime ? selectedCMEForInfo.predictedArrivalTime.toLocaleString() : 'N/A'}</p>
            <p><strong>Note:</strong> <span className="italic break-words">{selectedCMEForInfo.note}</span></p>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center border-b border-neutral-700/80 pb-2 mb-3">
        <h2 className={`text-xl font-bold text-neutral-200`}>Available CMEs</h2>
        {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 text-neutral-400 hover:text-white">
                <CloseIcon className="w-6 h-6"/>
            </button>
        )}
      </div>
      
      <button
        onClick={() => onSelectCME(null)} // Clicking "Show All" deselects any specific CME
        className={`w-full mb-3 text-sm px-3 py-2 rounded-md border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:ring-neutral-400 ${
          !selectedCMEId
            ? `bg-neutral-100 text-neutral-900 border-neutral-100 font-semibold`
            : `bg-transparent border-neutral-600 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-500`
        }`}
      >
        Show All (Live Simulation)
      </button>
      {onOpenTable && (
        <button
          type="button"
          onClick={onOpenTable}
          className="w-full mb-3 text-sm px-3 py-2 rounded-md border border-sky-700/60 bg-sky-900/30 text-sky-200 hover:bg-sky-800/40 transition-colors"
          title="Every CME with its 21.5 Rs time, source, ENLIL arrival, flare, inputs and outputs"
        >
          CME table: times, sources, ENLIL and flares
        </button>
      )}

      <div className="flex-grow overflow-y-auto styled-scrollbar pr-2">
        {isLoading && !fetchError && <p className={`italic text-neutral-400`}>Loading CMEs...</p>}
        {/* NASA down: the NASA offline badge by the view's buttons says so,
            rather than an error. Anything else is still an error worth reading. */}
        {fetchError && (isNasaOutage(fetchError)
          ? <p className="italic text-neutral-500">CMEs will appear here once NASA is back.</p>
          : <p className="text-red-400">Error: {fetchError}</p>)}
        {!isLoading && !fetchError && cmes.length === 0 && (
          <p className={`italic text-neutral-400`}>No modelable CMEs found for this period.</p>
        )}
        {!isLoading && !fetchError && cmes.map(cme => (
          <div
            key={cme.id}
            onClick={() => onSelectCME(cme)}
            className={`p-2.5 mb-2 rounded-md border cursor-pointer transition-all duration-200 ease-in-out text-xs
              ${selectedCMEId === cme.id 
                ? `bg-neutral-200 text-neutral-900 border-neutral-200 shadow-lg transform scale-[1.02]` 
                : `bg-neutral-800/50 border-neutral-700/70 hover:bg-neutral-700/60 hover:border-neutral-600 text-neutral-300`}`}
          >
            <p className="font-semibold text-inherit">Launched {formatLaunch(cme.startTime)}</p>
            <p className="text-inherit">{launchedAgo(cme.startTime)}</p>
            <p className="text-inherit">Speed: <span className="font-normal">{cme.speed} km/s</span></p>
            {cme.isEarthDirected && <p className="font-bold text-green-300 mt-1">Potentially Earth-Directed</p>}
            {cme.longitudeMeasured === false && <p className="text-neutral-500 mt-1">Direction not measured</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

// The launch in the viewer's own time zone, date and time together. The list
// used to pair the UTC date with the local time, so a CME launched in the
// early hours showed under the wrong day, and labelled every one "(-001)",
// which is just the tail of NASA's id and almost always the same.
function formatLaunch(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function launchedAgo(d: Date): string {
  const hours = (Date.now() - d.getTime()) / 3600000;
  if (hours < 1) return 'Less than an hour ago';
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default CMEListPanel;