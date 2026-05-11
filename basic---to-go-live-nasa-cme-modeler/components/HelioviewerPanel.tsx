// components/HelioviewerPanel.tsx
// Multi-wavelength solar imagery viewer — dashboard card edition
// Drop directly into SolarActivityDashboard as a col-span-12 card.
// Data: api.helioviewer.org (NASA / ESA Helioviewer Project — no API key needed)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface HVSource {
  id: number;
  obs: string;
  inst: string;
  label: string;
  wave: number | null;
  color: string;
  ion: string | null;
  tempK: string | null;
  bestFor: string;
  keyFeatures: string[];
  colorMeaning: string;
}

interface Layer {
  source: HVSource;
  opacity: number;
}

interface FovOption {
  label: string;
  scale: number;
  desc: string;
}

// ── Full source catalogue with science descriptions ───────────────────────────
const SOURCES: HVSource[] = [
  // ── SDO / AIA ───────────────────────────────────────────────────────────────
  {
    id: 8, obs: 'SDO', inst: 'AIA', label: '94 Å', wave: 94, color: '#00ff7f',
    ion: 'Fe XVIII', tempK: '~6 MK',
    bestFor: 'Flare loop arcades & superhot post-flare plasma',
    keyFeatures: [
      'Bright hot loops forming after a flare (post-flare arcade)',
      'Pre-flare coronal sigmoid heating',
      'Coronal rain draining down cooling loops',
      'High-temperature flare kernel brightening',
    ],
    colorMeaning: 'Bright green-white = superhot plasma (6 MK+). Dark = cooler or evacuated loops. Unusual for non-flaring times — if it lights up, something significant happened.',
  },
  {
    id: 9, obs: 'SDO', inst: 'AIA', label: '131 Å', wave: 131, color: '#00e5ff',
    ion: 'Fe VIII / Fe XXI', tempK: '~10 MK',
    bestFor: 'Impulsive flare phase, magnetic reconnection sites & flux rope eruptions',
    keyFeatures: [
      'Flare ribbons at peak phase (brightest channel during strong flares)',
      'Current sheet formation between separating flare loops',
      'Superhot reconnection outflows / plasmoids',
      'Pre-eruption flux rope brightenig — shows the rope before launch',
    ],
    colorMeaning: 'Cyan-white = flare plasma. This channel has two thermal peaks (0.4 MK quiet sun + 10 MK flare), so non-flaring times look dim and texture-rich.',
  },
  {
    id: 10, obs: 'SDO', inst: 'AIA', label: '171 Å', wave: 171, color: '#6eb4ff',
    ion: 'Fe IX', tempK: '~1 MK',
    bestFor: 'Quiet corona structure, coronal holes & EUV wave propagation',
    keyFeatures: [
      'Coronal loop topology — trace from footpoints to apex',
      'Coronal holes appear as distinct dark patches',
      'EUV/Moreton waves rippling outward from a flare site',
      'Filament channels (slightly dark lanes on disk)',
      'Fan-spine null-point systems above parasitic polarity',
    ],
    colorMeaning: 'Blue = 1 MK quiet corona loops. Dark patches = coronal holes or flux rope cavities. Bright = dense, hot loops. Best all-round channel for understanding coronal structure.',
  },
  {
    id: 11, obs: 'SDO', inst: 'AIA', label: '193 Å', wave: 193, color: '#7fff00',
    ion: 'Fe XII / Fe XXIV', tempK: '~1.5 MK',
    bestFor: 'Coronal hole mapping, EUV waves & active region corona',
    keyFeatures: [
      'Coronal holes appear very dark — best channel for CH detection',
      'EUV wave bright fronts visible against quiet sun',
      'Dimming after CME launch (coronal mass leaves a dark region)',
      'Active region corona at 1.5 MK',
      'Flare onset — sudden brightening before other channels respond',
    ],
    colorMeaning: 'Green = 1.5 MK corona. Very dark patches = coronal holes (open-field regions, source of high-speed solar wind). Very bright green-white = flare plasma (>10 MK secondary peak).',
  },
  {
    id: 12, obs: 'SDO', inst: 'AIA', label: '211 Å', wave: 211, color: '#cc44ff',
    ion: 'Fe XIV', tempK: '~2 MK',
    bestFor: 'Hot active region loops & pre-eruption filament channel visibility',
    keyFeatures: [
      'Active region closed-loop structure at 2 MK',
      'Filament channels as darker lanes winding across disk',
      'Post-flare arcade cooling (loops brighten as they cool through 2 MK)',
      'Coronal loop oscillations after a nearby flare',
    ],
    colorMeaning: 'Purple-magenta = 2 MK active region plasma. Dark = coronal holes. Combine with 171 Å and 304 Å for a full-temperature composite.',
  },
  {
    id: 13, obs: 'SDO', inst: 'AIA', label: '304 Å', wave: 304, color: '#ff4500',
    ion: 'He II', tempK: '~50 kK',
    bestFor: 'Filaments, prominences, chromospheric eruptions & spicule forest',
    keyFeatures: [
      'Filaments on disk — dark, snaking ribbons of cool dense plasma',
      'Off-limb prominences — bright orange structures above the limb',
      'Erupting filaments / flux rope launch — watch them lift and unwind',
      'Chromospheric flare ribbons marking where energy hits the lower atmosphere',
      'Surge jets & chromospheric spicule structure',
    ],
    colorMeaning: 'Orange-red = 50,000 K chromospheric plasma. Dark filaments = cool dense material blocking the underlying chromospheric emission. Prominences look bright off the limb but dark on disk.',
  },
  {
    id: 14, obs: 'SDO', inst: 'AIA', label: '335 Å', wave: 335, color: '#1e90ff',
    ion: 'Fe XVI', tempK: '~2.5 MK',
    bestFor: 'Pre-flare hot loop heating & active region thermal structure',
    keyFeatures: [
      'Hot active region loops before a flare (2.5 MK)',
      'Thermal evolution of post-flare loops as they cool',
      'Large-scale hot coronal structures connecting active regions',
    ],
    colorMeaning: 'Blue-white = 2.5 MK hot plasma. Best used alongside 171 Å — the contrast between the two reveals multi-temperature layering in loops.',
  },
  {
    id: 15, obs: 'SDO', inst: 'AIA', label: '1600 Å', wave: 1600, color: '#ffd700',
    ion: 'C IV + UV continuum', tempK: '~0.1 MK',
    bestFor: 'UV flare ribbons, chromospheric network & plage regions',
    keyFeatures: [
      'UV flare ribbons — the most dramatic brightening of any channel in strong flares',
      'Two-ribbon pattern straddling the magnetic neutral line — ribbon separation rate is a proxy for energy release speed',
      'Chromospheric network boundary brightenings',
      'Plage regions surrounding active sunspot groups',
    ],
    colorMeaning: 'Gold = UV chromospheric emission. Very bright white = flare ribbon. Quiet sun shows bright network pattern. This channel saturates in X-class flares.',
  },
  {
    id: 16, obs: 'SDO', inst: 'AIA', label: '1700 Å', wave: 1700, color: '#fff8e7',
    ion: 'UV continuum', tempK: null,
    bestFor: 'Photospheric UV structure, sunspot penumbra & granulation context',
    keyFeatures: [
      'Sunspot umbra and penumbra visible as dark structures',
      'Photospheric granulation texture visible',
      'Chromospheric network faintly visible',
      'Useful reference layer against hotter EUV images',
    ],
    colorMeaning: 'Pale yellow-white = photospheric emission. Dark spots = sunspot umbra. Closest to "true-colour" of any AIA channel. Layer with 304 Å or 171 Å for a striking comparison.',
  },
  // ── SDO / HMI ───────────────────────────────────────────────────────────────
  {
    id: 18, obs: 'SDO', inst: 'HMI', label: 'Continuum', wave: null, color: '#fff8dc',
    ion: 'Visible light (617.3 nm)', tempK: '~5,700 K',
    bestFor: 'Sunspot morphology, size, evolution & penumbra structure',
    keyFeatures: [
      'Sunspot umbra (darkest core, ~3,500 K) and filamentary penumbra',
      'Light bridges crossing the umbra — often signal stability or imminent breakup',
      'Pores — small dark structures that precede sunspot formation',
      'Spot group spatial layout — key context for flare probability',
      'Wilson depression: sunspot is ~1,000 km below the surrounding photosphere',
    ],
    colorMeaning: 'White = normal photosphere (~5,700 K). Dark grey-black = sunspot umbra (~3,500 K). Mid-grey filaments = penumbra. Compare with HMI Magnetogram to link structure to field polarity.',
  },
  {
    id: 19, obs: 'SDO', inst: 'HMI', label: 'Magnetogram', wave: null, color: '#4a90d9',
    ion: 'Line-of-sight B-field', tempK: null,
    bestFor: 'Magnetic polarity, active region complexity & CME trigger risk assessment',
    keyFeatures: [
      'Bipolar active region layout — positive and negative polarities',
      'Delta-class complexity: opposite polarities sharing an umbra → highest flare/CME risk',
      'Magnetic neutral line / polarity inversion line — where eruptions start',
      'Flux emergence over time — watch new field erupt through the surface',
      'Shearing and writhing of field lines before eruption',
    ],
    colorMeaning: 'White/bright = positive (north) magnetic polarity. Black/dark = negative (south) polarity. Grey = weak or horizontal field. The complexity of the mixed region predicts flare class.',
  },
  // ── SOHO / LASCO ────────────────────────────────────────────────────────────
  {
    id: 4, obs: 'SOHO', inst: 'LASCO', label: 'C2', wave: null, color: '#c0c0c0',
    ion: 'White light (Thomson scatter)', tempK: null,
    bestFor: 'CME detection, speed & angular width — inner corona 1.5 to 6 R☉',
    keyFeatures: [
      'Halo CME — a 360° bright ring means an Earth-directed event',
      'CME leading edge tracking to estimate speed (km/s)',
      'Angular width measurement — partial vs. full halo',
      'Helmet streamer belt & streamer blowout events',
      'SEP-associated shock halos',
    ],
    colorMeaning: 'Bright arcs = denser plasma (CME front or streamer). Dark cavity = flux rope interior. The occulting disk blocks the blinding solar disk to reveal the faint corona. Running-difference images make moving CMEs pop.',
  },
  {
    id: 5, obs: 'SOHO', inst: 'LASCO', label: 'C3', wave: null, color: '#808080',
    ion: 'White light (Thomson scatter)', tempK: null,
    bestFor: 'CME propagation & large-scale heliospheric transients — 3.7 to 30 R☉',
    keyFeatures: [
      'CME speed profile as it propagates and decelerates',
      'Halo CME reaching C3 = major, fast event',
      'Heliospheric current sheet disconnection events',
      'Comets diving toward the sun (sun-grazers)',
      'Background solar wind density structure',
    ],
    colorMeaning: 'Bright arc/bubble = CME front at distance. Star field provides speed reference (stars appear to move as the CME sweeps past). Planets and bright stars transiting visible on longer timescales.',
  },
  // ── SOHO / EIT ──────────────────────────────────────────────────────────────
  {
    id: 0, obs: 'SOHO', inst: 'EIT', label: '171 Å', wave: 171, color: '#6eb4ff',
    ion: 'Fe IX (legacy)', tempK: '~1 MK',
    bestFor: 'Historical quiet corona & coronal loops — full solar cycle archive from 1996',
    keyFeatures: [
      '30+ years of EUV data beginning 1996 — the longest coronal dataset',
      'Historical coronal hole tracking across solar cycles',
      'Long-baseline cross-calibration context with SDO/AIA',
    ],
    colorMeaning: 'Same physics as AIA 171 Å but at 2.6 arcsec/px resolution (vs AIA 0.6). Lower cadence (~12 min). Invaluable for historical context.',
  },
  {
    id: 1, obs: 'SOHO', inst: 'EIT', label: '195 Å', wave: 195, color: '#7fff00',
    ion: 'Fe XII (legacy)', tempK: '~1.5 MK',
    bestFor: 'Historical coronal hole mapping & active region EUV survey',
    keyFeatures: [
      'Long-baseline coronal hole area evolution across solar cycle 23–25',
      'Historical EUV wave and dimming catalogue',
      'Solar minimum / maximum coronal contrast comparisons',
    ],
    colorMeaning: 'Similar to AIA 193 Å. Coronal holes very dark vs. bright active regions — excellent CH/quiet-sun contrast.',
  },
  {
    id: 2, obs: 'SOHO', inst: 'EIT', label: '284 Å', wave: 284, color: '#ff69b4',
    ion: 'Fe XV (legacy)', tempK: '~2 MK',
    bestFor: 'Historical hot active region plasma survey — legacy 2 MK channel',
    keyFeatures: [
      'Hot active region loops from solar cycle 23 onward',
      'Multi-thermal context alongside EIT 171 and 195',
    ],
    colorMeaning: 'Pink-magenta = 2 MK plasma. Active regions bright, quiet sun dim. Lower sensitivity than SDO/AIA 211 Å.',
  },
  {
    id: 3, obs: 'SOHO', inst: 'EIT', label: '304 Å', wave: 304, color: '#ff4500',
    ion: 'He II (legacy)', tempK: '~50 kK',
    bestFor: 'Historical filament & prominence archive — from 1996',
    keyFeatures: [
      'Decades of prominence and filament data',
      'Long-term filament channel evolution',
      'Solar cycle latitude drift of prominence bands',
    ],
    colorMeaning: 'Same chromospheric physics as AIA 304 Å at coarser resolution.',
  },
  // ── STEREO-A / EUVI ─────────────────────────────────────────────────────────
  {
    id: 20, obs: 'STEREO-A', inst: 'EUVI', label: '171 Å', wave: 171, color: '#6eb4ff',
    ion: 'Fe IX', tempK: '~1 MK',
    bestFor: 'Far-side corona, off-limb loops & 360° context with SDO',
    keyFeatures: [
      'Active regions on the far side of the sun — early warning before they rotate into Earth view',
      'Off-limb coronal loop height measurements',
      'Combined with AIA 171 gives near-360° coronal coverage',
      'CME initiation from the STEREO-A side perspective',
    ],
    colorMeaning: 'Same physics as AIA 171 Å. What is at the limb from Earth is near disk-centre from STEREO-A — eruptions that look "edge-on" from Earth are face-on from here.',
  },
  {
    id: 21, obs: 'STEREO-A', inst: 'EUVI', label: '195 Å', wave: 195, color: '#7fff00',
    ion: 'Fe XII', tempK: '~1.5 MK',
    bestFor: 'Far-side coronal hole detection & EUV wave context from a second vantage',
    keyFeatures: [
      'Coronal holes on the far side — predicts future fast solar wind arrival',
      'EUV waves from a second perspective — confirms wave propagation direction',
      'CME source region identification on the far hemisphere',
    ],
    colorMeaning: 'Similar to AIA 193 Å. Dark = far-side coronal holes. Active regions bright.',
  },
  {
    id: 22, obs: 'STEREO-A', inst: 'EUVI', label: '284 Å', wave: 284, color: '#ff69b4',
    ion: 'Fe XV', tempK: '~2 MK',
    bestFor: 'Far-side hot active region plasma viewed from the east or west',
    keyFeatures: [
      'Hot loops of far-side active regions not visible from Earth',
      'Pre-eruption heating signatures from another angle',
    ],
    colorMeaning: 'Pink = 2 MK plasma from STEREO-A vantage. Complements AIA 211 Å view.',
  },
  {
    id: 23, obs: 'STEREO-A', inst: 'EUVI', label: '304 Å', wave: 304, color: '#ff4500',
    ion: 'He II', tempK: '~50 kK',
    bestFor: 'Off-limb prominence heights & far-side filament eruptions',
    keyFeatures: [
      'Prominence height above the limb — geometry measurement',
      'Filament eruptions on the far-side before they rotate into Earth view',
      'CME flux rope identification off-limb from the side',
    ],
    colorMeaning: 'Orange-red = chromospheric plasma. Prominences appear bright above the STEREO-A limb. What is on disk from Earth appears at the limb here, enabling true height measurements.',
  },
  // ── Proba-2 / SWAP ──────────────────────────────────────────────────────────
  {
    id: 32, obs: 'Proba-2', inst: 'SWAP', label: '174 Å', wave: 174, color: '#6eb4ff',
    ion: 'Fe IX / Fe X', tempK: '~1 MK',
    bestFor: 'Wide-field EUV corona & post-CME coronal dimming across a larger FOV',
    keyFeatures: [
      'Coronal dimming after a CME — SWAP\'s wide 54-arcmin FOV captures the full extent that AIA misses',
      'EUV wave propagation to large distances from the source',
      'Large-scale coronal structure and connectivity',
      'Quiet-sun EUV context beyond the normal AIA field of view',
    ],
    colorMeaning: 'Similar to AIA 171 Å physics. The larger field of view is the key advantage — shows how the eruption affects the global corona. Compare alongside 193 Å for coronal hole context.',
  },
  // ── Hinode / XRT ────────────────────────────────────────────────────────────
  {
    id: 38, obs: 'Hinode', inst: 'XRT', label: 'X-Ray', wave: null, color: '#ff9900',
    ion: 'Soft X-ray (multiple ions)', tempK: '>1 MK',
    bestFor: 'X-ray bright points, coronal jets & hot loop brightening before flares',
    keyFeatures: [
      'X-ray bright points — ubiquitous small-scale coronal heating sites',
      'Collimated solar X-ray jets shooting outward from coronal holes',
      'Sigmoid (S-shaped) structures that signal a flux rope ready to erupt',
      'Flare arcade formation and post-flare loop cooling',
      'Soft X-ray corona structure at higher resolution than GOES',
    ],
    colorMeaning: 'Orange-white = hot soft X-ray emission (>1 MK). Very bright spots/ribbons = flare. Linear bright features = X-ray jets. Diffuse bright regions = active region loops.',
  },
];

const OBS_LIST = ['SDO', 'SOHO', 'STEREO-A', 'Proba-2', 'Hinode'];

const PRESETS: { name: string; ids: number[]; ops: number[]; desc: string; science: string }[] = [
  { name: 'AIA Classic',   ids:[10,13,11], ops:[100,80,60], desc:'171+304+193 Å',
    science:'The go-to composite. 171 (blue) shows the quiet corona and loop structure; 304 (red-orange) shows filaments and chromospheric eruptions; 193 (green) shows active regions and coronal holes. Together they cover three temperature regimes in one image.' },
  { name: 'Flare Tracker', ids:[8,9,15],   ops:[100,90,55], desc:'94+131+1600 Å',
    science:'Stack the three flare-dedicated channels. 1600 UV ribbons mark where particle energy reaches the chromosphere; 94 and 131 show the superhot reconnection region above. Watch the 1600 ribbons separate as the flare progresses.' },
  { name: 'CME Watch',     ids:[4,5],      ops:[100,85],    desc:'LASCO C2+C3',
    science:'Both white-light coronagraphs stacked. C2 catches a CME close in (1.5–6 R☉); C3 tracks it to 30 R☉. A halo CME visible in both is a major Earth-directed event. Switch FOV to "Extended Corona" or "Far Heliosphere" for best results.' },
  { name: 'Full Context',  ids:[10,4],     ops:[100,90],    desc:'AIA 171+LASCO C2',
    science:'Combines the disk (AIA 171 showing eruption source region) with the inner coronagraph (C2 showing the early CME). Lets you link the eruption site to the developing CME in one frame. Switch FOV to "Inner Corona".' },
  { name: 'Chromosphere',  ids:[13,15],    ops:[100,70],    desc:'304+1600 Å',
    science:'Best combination for filament and flare ribbon science. 304 Å shows the cool chromospheric plasma, filaments, and prominences; 1600 Å highlights UV flare ribbons and the chromospheric network. Watch both channels during a flare for the full picture.' },
  { name: 'Active Regions',ids:[12,14,19], ops:[100,85,55], desc:'211+335+Magneto',
    science:'Overlays hot EUV loops (211 and 335 Å) with the HMI Magnetogram. Lets you trace magnetic field topology and identify Delta-class complexity — opposite polarities sharing an umbra — which is the strongest predictor of X-class flares.' },
  { name: 'Coronal Holes', ids:[11,10],    ops:[100,70],    desc:'193+171 Å',
    science:'193 Å gives the best coronal hole contrast (very dark against bright active regions). 171 Å adds coronal loop structure for context. Coronal holes are open-field regions that are the source of recurring high-speed solar wind streams.' },
  { name: 'Side+Disk',     ids:[20,10],    ops:[100,75],    desc:'STEREO 171+AIA 171',
    science:'STEREO-A sees the far-side; AIA sees the Earth-facing disk — both in 171 Å. Together they provide up to ~270° of the corona in one wavelength. Far-side active regions visible in STEREO will rotate into Earth view in a week or two.' },
];

const FOV_OPTIONS: FovOption[] = [
  { label: 'Solar Disk',      scale: 4.8,  desc: '±1.3 R☉ — best for AIA / EIT / HMI' },
  { label: 'Inner Corona',    scale: 9.6,  desc: '±2.5 R☉ — LASCO C2 / prominence context' },
  { label: 'Extended Corona', scale: 19.2, desc: '±5 R☉ — CME tracking / C2+C3 overlap' },
  { label: 'Far Heliosphere', scale: 48.0, desc: '±12.5 R☉ — LASCO C3 full field' },
];

// ── API helpers ───────────────────────────────────────────────────────────────
const HV_API = 'https://api.helioviewer.org/v2';
const IMG_PX = 512;

function buildScreenshotUrl(layers: Layer[], isoDate: string, scale: number): string {
  if (!layers.length) return '';
  const layerStr = layers.map(l => `[${l.source.id},1,${l.opacity}]`).join(',');
  const half = (IMG_PX / 2) * scale;
  return (
    `${HV_API}/takeScreenshot/` +
    `?date=${encodeURIComponent(isoDate)}` +
    `&imageScale=${scale}` +
    `&layers=${layerStr}` +
    `&x1=${-half}&y1=${-half}&x2=${half}&y2=${half}` +
    `&display=true`
  );
}

function buildShareUrl(layers: Layer[], isoDate: string, scale: number): string {
  const ls = layers.map(l => `[${l.source.id},1,${l.opacity}]`).join(',');
  return `https://helioviewer.org/?date=${encodeURIComponent(isoDate)}&imageScale=${scale}&layers=${encodeURIComponent(ls)}&centerX=0&centerY=0`;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toISO(localDt: string): string { return new Date(localDt).toISOString().replace('.000Z', 'Z'); }
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function stepDate(dt: string, minutes: number): string {
  const d = new Date(dt); d.setMinutes(d.getMinutes() + minutes); return toLocalInput(d);
}

// ── Mini components ───────────────────────────────────────────────────────────
const Dot: React.FC<{ color: string; size?: number }> = ({ color, size = 8 }) => (
  <span className="rounded-full flex-shrink-0 inline-block"
    style={{ width: size, height: size, backgroundColor: color }} />
);

const Spinner: React.FC<{ colorClass?: string }> = ({ colorClass = 'border-sky-500' }) => (
  <div className={`w-5 h-5 border-2 ${colorClass} border-t-transparent rounded-full animate-spin`} />
);

// ── Science info panel ────────────────────────────────────────────────────────
const SciencePanel: React.FC<{ layers: Layer[] }> = ({ layers }) => {
  const [tab, setTab] = useState(0);
  const activeTab = Math.min(tab, layers.length - 1);

  useEffect(() => { setTab(0); }, [layers.length]);

  if (!layers.length) return null;
  const src = layers[activeTab]?.source;
  if (!src) return null;

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/50">
      {/* Tab row */}
      {layers.length > 1 && (
        <div className="flex gap-1 px-3 pt-2">
          {layers.map((l, i) => (
            <button key={i} onClick={() => setTab(i)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t text-[10px] border-b-2 transition-colors ${
                activeTab === i
                  ? 'border-sky-500 text-white bg-neutral-800/60'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}>
              <Dot color={l.source.color} size={6} />
              {l.source.obs} {l.source.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-4 py-3">

        {/* Column 1: Best for */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold flex items-center gap-1.5">
            <Dot color={src.color} size={6} />
            {src.obs} / {src.inst} {src.label}
          </p>
          <p className="text-sm text-neutral-100 font-semibold leading-snug mb-1">{src.bestFor}</p>
          {src.ion && (
            <p className="text-[10px] text-neutral-500 mt-1.5">
              Emitting ion: <span className="text-neutral-300 font-mono">{src.ion}</span>
              {src.tempK && <span className="ml-2 text-amber-400/80">{src.tempK}</span>}
            </p>
          )}
        </div>

        {/* Column 2: What to look for */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold">What to look for</p>
          <ul className="space-y-1">
            {src.keyFeatures.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-neutral-300 leading-snug">
                <span className="text-sky-600 flex-shrink-0 mt-0.5">›</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Column 3: Reading the colours */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold">Reading the colours</p>
          <p className="text-[11px] text-neutral-300 leading-relaxed">{src.colorMeaning}</p>
        </div>

      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const HelioviewerPanel: React.FC = () => {

  const defaultDate = useMemo(
    () => toLocalInput(new Date(Date.now() - 3 * 3600 * 1000)),
    []
  );

  const [selectedObs, setSelectedObs]   = useState('SDO');
  const [hoveredSrc, setHoveredSrc]     = useState<HVSource | null>(null);
  const [layers, setLayers]             = useState<Layer[]>([
    { source: SOURCES.find(s => s.id === 10)!, opacity: 100 },
    { source: SOURCES.find(s => s.id === 13)!, opacity: 80  },
  ]);
  const [dateInput, setDateInput]       = useState(defaultDate);
  const [fovIdx, setFovIdx]             = useState(0);
  const [showGuide, setShowGuide]       = useState(true);

  // Viewer
  const [imgUrl, setImgUrl]             = useState('');
  const [imgKey, setImgKey]             = useState(0);
  const [isLoading, setIsLoading]       = useState(false);
  const [imgError, setImgError]         = useState(false);

  // Animation
  const [animMode, setAnimMode]         = useState(false);
  const [animFrames, setAnimFrames]     = useState<string[]>([]);
  const [animFrame, setAnimFrame]       = useState(0);
  const [animPlaying, setAnimPlaying]   = useState(false);
  const [animBuilding, setAnimBuilding] = useState(false);
  const [animLoaded, setAnimLoaded]     = useState(0);
  const [animStep, setAnimStep]         = useState(30);
  const [animCount, setAnimCount]       = useState(24);
  const [animFps, setAnimFps]           = useState(8);
  const animIntervalRef                 = useRef<number|null>(null);
  const cancelBuild                     = useRef(false);

  const fov = FOV_OPTIONS[fovIdx];

  // Debounced apply
  const debounceRef = useRef<number|null>(null);
  const applyView = useCallback(() => {
    if (!layers.length) { setImgUrl(''); return; }
    setImgUrl(buildScreenshotUrl(layers, toISO(dateInput), fov.scale));
    setImgKey(k => k + 1);
    setIsLoading(true);
    setImgError(false);
  }, [layers, dateInput, fov.scale]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(applyView, 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [applyView]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { applyView(); }, []);

  // Layer ops
  const addLayer    = (src: HVSource) => { if (layers.length >= 3 || layers.some(l => l.source.id === src.id)) return; setLayers(p => [...p, { source: src, opacity: 80 }]); };
  const removeLayer = (idx: number)  => setLayers(p => p.filter((_, i) => i !== idx));
  const setOpacity  = (idx: number, v: number) => setLayers(p => p.map((l, i) => i === idx ? { ...l, opacity: v } : l));
  const moveLayer   = (idx: number, dir: -1|1) => {
    const next = idx + dir;
    if (next < 0 || next >= layers.length) return;
    setLayers(p => { const a = [...p]; [a[idx], a[next]] = [a[next], a[idx]]; return a; });
  };
  const applyPreset = (p: typeof PRESETS[0]) => {
    setLayers(p.ids.map((id, i) => { const src = SOURCES.find(s => s.id === id); return src ? { source: src, opacity: p.ops[i] } : null; }).filter(Boolean) as Layer[]);
  };

  // Animation
  const stopAnim = useCallback(() => {
    cancelBuild.current = true;
    setAnimPlaying(false); setAnimMode(false); setAnimFrames([]);
    setAnimFrame(0); setAnimBuilding(false); setAnimLoaded(0);
    if (animIntervalRef.current) { clearInterval(animIntervalRef.current); animIntervalRef.current = null; }
  }, []);

  const buildAnim = useCallback(async () => {
    if (!layers.length) return;
    cancelBuild.current = false;
    setAnimMode(true); setAnimBuilding(true); setAnimFrames([]);
    setAnimFrame(0); setAnimLoaded(0); setAnimPlaying(false);
    const scale = fov.scale;
    const baseMs = new Date(dateInput).getTime();
    const urls = Array.from({ length: animCount }, (_, i) => {
      const ms = baseMs - (animCount - 1 - i) * animStep * 60_000;
      return buildScreenshotUrl(layers, new Date(ms).toISOString().replace('.000Z','Z'), scale);
    });
    const loaded: string[] = [];
    for (const url of urls) {
      if (cancelBuild.current) return;
      await new Promise<void>(resolve => {
        const img = new Image();
        img.onload = img.onerror = () => { loaded.push(url); setAnimLoaded(n => n + 1); resolve(); };
        img.src = url;
      });
    }
    if (cancelBuild.current) return;
    setAnimFrames(loaded); setAnimBuilding(false); setAnimPlaying(true);
  }, [layers, dateInput, fov.scale, animCount, animStep]);

  useEffect(() => {
    if (animPlaying && animFrames.length > 0) {
      animIntervalRef.current = window.setInterval(() => setAnimFrame(p => (p + 1) % animFrames.length), 1000 / animFps);
    } else {
      if (animIntervalRef.current) { clearInterval(animIntervalRef.current); animIntervalRef.current = null; }
    }
    return () => { if (animIntervalRef.current) { clearInterval(animIntervalRef.current); animIntervalRef.current = null; } };
  }, [animPlaying, animFrames.length, animFps]);

  const displayUrl    = animMode && animFrames.length > 0 ? animFrames[animFrame] : imgUrl;
  const obsSourceList = SOURCES.filter(s => s.obs === selectedObs);
  const instGroups    = [...new Set(obsSourceList.map(s => s.inst))];
  const shareUrl      = layers.length ? buildShareUrl(layers, toISO(dateInput), fov.scale) : 'https://helioviewer.org';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="col-span-12 card bg-neutral-950/80 p-0 overflow-hidden flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-white">☀️ Helioviewer — Multi-Wavelength Imagery</h2>
          <span className="text-[10px] text-neutral-500">NASA / ESA · 24 sources across 7 instruments · no API key needed</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowGuide(g => !g)}
            className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${showGuide ? 'bg-sky-900/60 border-sky-700 text-sky-300' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200'}`}>
            {showGuide ? '📖 Guide ▲' : '📖 Guide ▼'}
          </button>
          <button onClick={applyView}
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300">
            ⟳ Refresh
          </button>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer"
            className="px-2.5 py-1 text-[10px] rounded border border-neutral-700 bg-neutral-800 hover:bg-sky-900 hover:border-sky-700 text-sky-400 transition-colors">
            Open in Helioviewer ↗
          </a>
        </div>
      </div>

      {/* Presets strip */}
      <div className="px-4 py-2 border-b border-neutral-800 bg-neutral-900/30 flex items-center gap-2 flex-wrap flex-shrink-0">
        <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold flex-shrink-0">⚡ Presets</span>
        {PRESETS.map(p => (
          <button key={p.name} onClick={() => applyPreset(p)} title={`${p.desc}\n\n${p.science}`}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded bg-neutral-800 hover:bg-sky-900/50 border border-neutral-700 hover:border-sky-700 text-neutral-300 hover:text-white transition-colors">
            <span className="flex gap-0.5">
              {p.ids.slice(0,3).map(id => { const s = SOURCES.find(x => x.id === id); return s ? <Dot key={id} color={s.color} size={5} /> : null; })}
            </span>
            {p.name}
          </button>
        ))}
      </div>

      {/* Main body */}
      <div className="flex min-h-0 overflow-hidden" style={{ minHeight: 520 }}>

        {/* LEFT sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-neutral-800 flex flex-col overflow-hidden">

          {/* Observatory tabs */}
          <div className="p-2.5 border-b border-neutral-800 flex-shrink-0">
            <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1.5 font-semibold">🛰 Observatory</p>
            <div className="flex flex-wrap gap-1">
              {OBS_LIST.map(obs => (
                <button key={obs} onClick={() => setSelectedObs(obs)}
                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors font-mono ${
                    selectedObs === obs ? 'bg-sky-800/80 border-sky-600 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
                  }`}>{obs}</button>
              ))}
            </div>
          </div>

          {/* Source list */}
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {instGroups.map(inst => (
              <div key={inst} className="mb-3">
                <p className="text-[9px] uppercase tracking-widest text-neutral-600 mb-1 font-semibold px-0.5">{inst}</p>
                <div className="flex flex-col gap-0.5">
                  {obsSourceList.filter(s => s.inst === inst).map(src => {
                    const activeIdx = layers.findIndex(l => l.source.id === src.id);
                    const isActive  = activeIdx !== -1;
                    const canAdd    = layers.length < 3;
                    return (
                      <button key={src.id}
                        onClick={() => isActive ? removeLayer(activeIdx) : addLayer(src)}
                        onMouseEnter={() => setHoveredSrc(src)}
                        onMouseLeave={() => setHoveredSrc(null)}
                        disabled={!isActive && !canAdd}
                        className={`flex items-start gap-1.5 px-2 py-1.5 rounded text-left border transition-colors ${
                          isActive   ? 'bg-sky-900/50 border-sky-700/70 text-sky-200'
                          : canAdd   ? 'bg-neutral-800/60 border-neutral-700/50 hover:bg-neutral-700 text-neutral-300 hover:text-white'
                                     : 'bg-neutral-900/30 border-neutral-800 text-neutral-600 cursor-not-allowed'
                        }`}>
                        <Dot color={src.color} size={7} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-[10px]">{src.label}</span>
                            {src.tempK && <span className="text-[8px] text-neutral-500">{src.tempK}</span>}
                            {isActive && <span className="text-sky-400 text-[8px] ml-auto">✓</span>}
                          </div>
                          <p className="text-[9px] text-neutral-500 leading-tight mt-0.5 line-clamp-2">{src.bestFor}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Hover card */}
            {hoveredSrc && (
              <div className="mt-1 p-2 rounded-md bg-neutral-800 border border-neutral-700">
                <div className="flex items-center gap-1.5 mb-1">
                  <Dot color={hoveredSrc.color} size={7} />
                  <span className="text-[10px] font-bold text-white">{hoveredSrc.obs}/{hoveredSrc.inst} {hoveredSrc.label}</span>
                </div>
                {hoveredSrc.ion && <p className="text-[9px] text-amber-400/90 mb-1 font-mono">{hoveredSrc.ion}{hoveredSrc.tempK ? ` · ${hoveredSrc.tempK}` : ''}</p>}
                <p className="text-[9px] text-neutral-200 leading-snug font-medium mb-1.5">{hoveredSrc.bestFor}</p>
                {hoveredSrc.keyFeatures.slice(0,3).map((f,i) => (
                  <p key={i} className="text-[9px] text-neutral-400 leading-snug">› {f}</p>
                ))}
              </div>
            )}
          </div>

          {/* Active layers */}
          <div className="border-t border-neutral-800 p-2.5 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold">🎞 Active Layers</p>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${
                layers.length === 3 ? 'bg-amber-900/40 border-amber-800 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'
              }`}>{layers.length}/3</span>
            </div>

            {layers.length === 0 && <p className="text-[10px] text-neutral-600 italic">Select a wavelength above</p>}

            {layers.map((layer, idx) => (
              <div key={`${layer.source.id}-${idx}`} className="mb-2 bg-neutral-800/50 rounded-md p-1.5 border border-neutral-700/40">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Dot color={layer.source.color} size={7} />
                    <span className="text-[10px] font-semibold text-neutral-200 leading-none">
                      {layer.source.obs}/{layer.source.inst} {layer.source.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => moveLayer(idx, -1)} disabled={idx === 0} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-neutral-200 disabled:opacity-20">↑</button>
                    <button onClick={() => moveLayer(idx, 1)} disabled={idx === layers.length-1} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-neutral-200 disabled:opacity-20">↓</button>
                    <button onClick={() => removeLayer(idx)} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-red-400 transition-colors">×</button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-neutral-500 w-10 flex-shrink-0">Opacity</span>
                  <input type="range" min={10} max={100} step={5} value={layer.opacity}
                    onChange={e => setOpacity(idx, Number(e.target.value))}
                    className="flex-1 h-1 cursor-pointer"
                    style={{ accentColor: layer.source.color }} />
                  <span className="text-[9px] text-neutral-400 w-7 text-right flex-shrink-0">{layer.opacity}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: viewer column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Date + FOV controls */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/40 flex-shrink-0 flex-wrap">
            <button onClick={() => setDateInput(d => stepDate(d, -60))} title="Back 1 hour"
              className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">◀◀</button>
            <button onClick={() => setDateInput(d => stepDate(d, -15))} title="Back 15 min"
              className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">◀</button>
            <input type="datetime-local" value={dateInput} onChange={e => setDateInput(e.target.value)} max={toLocalInput(new Date())}
              className="flex-1 min-w-[170px] bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-[11px] text-neutral-200 [color-scheme:dark]" />
            <button onClick={() => setDateInput(d => stepDate(d, 15))} title="Forward 15 min"
              className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">▶</button>
            <button onClick={() => setDateInput(d => stepDate(d, 60))} title="Forward 1 hour"
              className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700">▶▶</button>
            <button onClick={() => setDateInput(toLocalInput(new Date(Date.now() - 3 * 3600 * 1000)))}
              className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 hover:bg-sky-900 border border-neutral-700 hover:border-sky-700 text-sky-400 transition-colors">
              Latest
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[9px] text-neutral-500">FOV</span>
              <select value={fovIdx} onChange={e => setFovIdx(Number(e.target.value))} title={fov.desc}
                className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-200">
                {FOV_OPTIONS.map((f,i) => <option key={f.label} value={i}>{f.label}</option>)}
              </select>
            </div>
          </div>

          {/* Image viewer */}
          <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden min-h-0" style={{ minHeight: 320 }}>

            {isLoading && !animMode && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10 gap-3">
                <Spinner />
                <p className="text-[11px] text-neutral-400">Fetching from Helioviewer…</p>
                <p className="text-[9px] text-neutral-600">First request may take 5–15 s to render server-side</p>
              </div>
            )}

            {animBuilding && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 gap-3">
                <Spinner colorClass="border-amber-500" />
                <p className="text-[11px] text-neutral-300">Building animation frames…</p>
                <div className="w-48 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-amber-500 h-full transition-all duration-200" style={{ width: `${(animLoaded/animCount)*100}%` }} />
                </div>
                <p className="text-[10px] text-neutral-500">{animLoaded} / {animCount} frames loaded</p>
                <button onClick={stopAnim} className="px-3 py-1 text-[10px] rounded bg-red-900/60 border border-red-700 text-red-300 hover:bg-red-800">Cancel</button>
              </div>
            )}

            {imgError && !isLoading && !animMode && (
              <div className="text-center p-8 max-w-sm">
                <p className="text-neutral-400 mb-2">⚠️ No imagery found</p>
                <p className="text-neutral-600 text-[11px] leading-relaxed">Helioviewer may not have data for this date / wavelength. Try stepping time or switching instrument.</p>
                <button onClick={applyView} className="mt-3 px-3 py-1 text-xs bg-sky-800 hover:bg-sky-700 rounded border border-sky-700">Retry</button>
              </div>
            )}

            {!displayUrl && !isLoading && !imgError && (
              <p className="text-neutral-600 text-sm">Select at least one wavelength to view imagery</p>
            )}

            {displayUrl && !imgError && (
              <img key={`${imgKey}-${animMode ? animFrame : 'still'}`}
                src={displayUrl} alt="Solar imagery composite"
                className="max-w-full max-h-full object-contain"
                style={{ imageRendering: 'crisp-edges' }}
                onLoad={() => setIsLoading(false)}
                onError={() => { setIsLoading(false); if (!animMode) setImgError(true); }} />
            )}

            {/* Layer badge overlay */}
            {layers.length > 0 && (
              <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
                {layers.map((l,i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5">
                    <Dot color={l.source.color} size={6} />
                    <span className="text-[9px] text-neutral-200 font-mono">{l.source.obs} {l.source.label}</span>
                    <span className="text-[8px] text-neutral-500">{l.opacity}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="absolute top-2 right-2 pointer-events-none">
              <span className="text-[8px] text-neutral-600 bg-black/50 px-1.5 py-0.5 rounded">{fov.label} · {fov.scale}″/px</span>
            </div>

            {animMode && animFrames.length > 0 && (
              <div className="absolute bottom-2 left-2 pointer-events-none">
                <span className="text-[8px] text-neutral-400 bg-black/60 px-1.5 py-0.5 rounded font-mono">{animFrame+1}/{animFrames.length}</span>
              </div>
            )}
          </div>

          {/* Science guide (collapsible) */}
          {showGuide && layers.length > 0 && <SciencePanel layers={layers} />}

          {/* Animation strip */}
          <div className="border-t border-neutral-800 bg-neutral-900/60 px-3 py-2 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold flex-shrink-0">🎬 Animation</span>
              {!animMode && (
                <>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">Step</label>
                    <select value={animStep} onChange={e => setAnimStep(Number(e.target.value))}
                      className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-[10px] text-neutral-200">
                      {[5,10,15,30,60,120,360].map(v => <option key={v} value={v}>{v < 60 ? `${v}m` : `${v/60}h`}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">Frames</label>
                    <select value={animCount} onChange={e => setAnimCount(Number(e.target.value))}
                      className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-[10px] text-neutral-200">
                      {[6,12,24,48].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <span className="text-[9px] text-neutral-600">covers ~{((animCount*animStep)/60).toFixed(1)} h</span>
                  <button onClick={buildAnim} disabled={!layers.length}
                    className="px-3 py-0.5 text-[10px] rounded border bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-amber-900/50 hover:border-amber-700 hover:text-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    ▶ Build Animation
                  </button>
                </>
              )}
              {animMode && (
                <button onClick={stopAnim}
                  className="px-3 py-0.5 text-[10px] rounded border bg-red-900/50 border-red-700 text-red-300 hover:bg-red-800">
                  ⏹ Stop
                </button>
              )}
              {animMode && !animBuilding && animFrames.length > 0 && (
                <>
                  <button onClick={() => setAnimPlaying(p => !p)} className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">{animPlaying ? '⏸' : '▶'}</button>
                  <button onClick={() => { setAnimPlaying(false); setAnimFrame(p => Math.max(0,p-1)); }} className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">◀</button>
                  <button onClick={() => { setAnimPlaying(false); setAnimFrame(p => Math.min(animFrames.length-1,p+1)); }} className="px-2 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700">▶</button>
                  <input type="range" min={0} max={animFrames.length-1} value={animFrame}
                    onChange={e => { setAnimPlaying(false); setAnimFrame(Number(e.target.value)); }}
                    className="flex-1 min-w-[60px] h-1 cursor-pointer" style={{ accentColor: '#f59e0b' }} />
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">FPS</label>
                    <select value={animFps} onChange={e => setAnimFps(Number(e.target.value))}
                      className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-[10px] text-neutral-200">
                      {[4,6,8,12,15].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>{/* end right column */}
      </div>{/* end body row */}

    </div>/* end card */
  );
};

export default HelioviewerPanel;


