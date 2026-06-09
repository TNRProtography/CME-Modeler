import React, { useMemo, useState } from 'react';

type JMapInstrument = 'HI2' | 'HI1';

type InstrumentInfo = {
  label: string;
  subtitle: string;
  description: string;
  url: string;
  elongationRange: string;
};

const JMAP_INFO: Record<JMapInstrument, InstrumentInfo> = {
  HI1: {
    label: 'HI1',
    subtitle: 'HI1: closer-in heliospheric view',
    description: 'HI1 looks from STEREO-A into the inner heliosphere, just beyond the coronagraph field. It is useful for spotting CME material as it first moves away from the Sun.',
    url: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi1_ahead_090.gif',
    elongationRange: 'roughly 4°–24° elongation',
  },
  HI2: {
    label: 'HI2',
    subtitle: 'HI2: farther-out heliospheric view',
    description: 'HI2 looks farther out from STEREO-A into interplanetary space. It can sometimes show CME material continuing outward after it has passed beyond the HI1 field.',
    url: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi2_ahead_090.gif',
    elongationRange: 'roughly 20°–50° elongation',
  },
};

const formatDateTime = (value?: Date | null) => {
  if (!value) return 'Awaiting image load';
  return value.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' NZT';
};

const READ_THE_IMAGE_ITEMS = [
  ['Left to right', 'time'],
  ['Bottom to top', 'increasing elongation from the Sun as seen by STEREO-A'],
  ['Diagonal bright/dark bands', 'possible outward-moving CME or solar-wind structure'],
  ['Vertical black bands/gaps', 'missing or unavailable beacon data'],
  ['Forecast status', 'visual evidence only, not an automatic forecast'],
];

const StereoCmeVisualTracker: React.FC = () => {
  const [instrument, setInstrument] = useState<JMapInstrument>('HI2');
  const [imageError, setImageError] = useState(false);
  const [imageLoadedAt, setImageLoadedAt] = useState<Date | null>(null);
  const [refreshToken, setRefreshToken] = useState(Date.now());

  const selected = JMAP_INFO[instrument];
  const imageSrc = useMemo(() => `${selected.url}?_=${refreshToken}`, [selected.url, refreshToken]);

  const refreshImage = () => {
    setImageError(false);
    setImageLoadedAt(null);
    setRefreshToken(Date.now());
  };

  const selectInstrument = (nextInstrument: JMapInstrument) => {
    setInstrument(nextInstrument);
    setImageError(false);
    setImageLoadedAt(null);
    setRefreshToken(Date.now());
  };

  return (
    <section className="col-span-12 card bg-neutral-950/80 p-4 border border-neutral-800/80">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-white">STEREO-A J-map Viewer</h2>
            <span className="px-2.5 py-1 rounded-full border border-purple-700/50 bg-purple-950/30 text-xs font-semibold text-purple-200">HI1/HI2 Beacon</span>
            <span className="px-2.5 py-1 rounded-full border border-sky-700/50 bg-sky-950/30 text-xs font-semibold text-sky-200">Visual inspection only</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed max-w-3xl">
            This panel shows official STEREO-A beacon J-map imagery. J-maps are time–elongation plots from STEREO-A’s heliospheric imagers. They are useful for visually inspecting outward-moving CME signatures, but they do not automatically predict Earth impact or aurora strength.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>Image loaded: {formatDateTime(imageLoadedAt)}</span>
          <button onClick={refreshImage} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh J-map image">↻</button>
        </div>
      </div>

      {imageError && (
        <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          J-map image failed to load. Try switching HI1/HI2, refreshing, or opening the official image directly.
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-2">
          {(['HI2', 'HI1'] as JMapInstrument[]).map((item) => (
            <button
              key={item}
              onClick={() => selectInstrument(item)}
              className={`px-3 py-1 text-xs rounded transition-colors ${instrument === item ? 'bg-purple-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300">
          Open official {selected.label} beacon J-map ↗
        </a>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 mb-4">
        <h3 className="text-sm font-semibold text-neutral-100">{selected.subtitle}</h3>
        <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{selected.description}</p>
        <p className="text-xs text-neutral-500 mt-2">Approximate plotted range: {selected.elongationRange}. Both HI1 and HI2 are viewed from STEREO-A, not Earth.</p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-black/60 overflow-auto max-h-[560px] mb-4">
        {!imageError ? (
          <img
            src={imageSrc}
            alt={`Official STEREO-A beacon ${instrument} latitude-0 J-map`}
            className="w-full min-w-[520px] md:min-w-0 object-contain select-none"
            onLoad={() => setImageLoadedAt(new Date())}
            onError={() => setImageError(true)}
            draggable={false}
          />
        ) : (
          <div className="h-64 flex items-center justify-center text-sm text-neutral-500">J-map image unavailable.</div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3 text-xs leading-relaxed">
        <div className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-3">
          <h3 className="text-sm font-semibold text-neutral-100 mb-2">How to read the image</h3>
          <div className="space-y-2">
            {READ_THE_IMAGE_ITEMS.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[130px_1fr] gap-2">
                <span className="text-neutral-500">{label}</span>
                <span className="text-neutral-300">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-3">
          <h3 className="text-sm font-semibold text-neutral-100 mb-2">What HI1 vs HI2 means</h3>
          <ul className="space-y-2 text-neutral-300 list-disc pl-4">
            <li><span className="text-purple-200 font-semibold">HI1:</span> closer to the Sun, where CME material first enters the heliospheric imager field.</li>
            <li><span className="text-purple-200 font-semibold">HI2:</span> farther out into the heliosphere, sometimes showing material continuing through interplanetary space.</li>
            <li>Both are viewed from STEREO-A along a latitude-0/ecliptic cut.</li>
          </ul>
        </div>

        <div className="rounded-lg bg-sky-950/30 border border-sky-800/50 px-3 py-3 text-sky-100">
          <h3 className="text-sm font-semibold mb-2">Latitude 0 / ecliptic cut</h3>
          <p className="text-sky-100/90">
            Latitude 0 means this is an ecliptic-plane cut — roughly the plane where Earth and the planets orbit. The image is not the full sky; it is a thin strip through the HI images stacked over time.
          </p>
          <p className="mt-3 text-sky-200/80">
            Sun / low elongation → HI1 closer-in view → HI2 farther-out view → Earth direction may be inside or beyond the plotted range depending on STEREO-A geometry.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-3 text-xs text-amber-100/90 leading-relaxed">
        Not every Earth-directed CME will produce a clear J-map track. Beacon imagery can be compressed, low-resolution, or affected by data gaps. Aurora strength still depends on in-situ solar-wind measurements at arrival, especially Bz.
      </div>
    </section>
  );
};

export default StereoCmeVisualTracker;
