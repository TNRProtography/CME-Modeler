export interface ForecastCamera {
  name: string;
  url: string;
  type: 'image' | 'iframe';
  sourceUrl: string;
}

export const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';

export const CAMERAS: ForecastCamera[] = [
  { name: 'Oban', url: 'https://weathercam.southloop.net.nz/Oban/ObanOldA001.jpg', type: 'image', sourceUrl: 'weathercam.southloop.net.nz' },
  { name: 'Queenstown', url: 'https://queenstown.roundshot.com/#/', type: 'iframe', sourceUrl: 'queenstown.roundshot.com' },
  { name: 'Twizel', url: 'https://www.trafficnz.info/camera/737.jpg', type: 'image', sourceUrl: 'trafficnz.info' },
  { name: 'Taylors Mistake', url: 'https://metdata.net.nz/lpc/camera/taylorsmistake1/image.php', type: 'image', sourceUrl: 'metdata.net.nz' },
  { name: 'Opiki', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Opiki_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'Rangitikei', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Rangitikeicarpark_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'New Plymouth', url: 'https://www.primo.nz/webcameras/snapshot_twlbuilding_sth.jpg', type: 'image', sourceUrl: 'primo.nz' },
];

const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 70 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 60 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 },
};

export const GAUGE_COLORS = {
  gray: { solid: '#808080' },
  yellow: { solid: '#FFD700' },
  orange: { solid: '#FFA500' },
  red: { solid: '#FF4500' },
  purple: { solid: '#800080' },
  pink: { solid: '#FF1493' },
};

const GAUGE_EMOJIS = {
  gray: '😐',
  yellow: '🙂',
  orange: '🙂',
  red: '😄',
  purple: '😍',
  pink: '🤩',
  error: '❓',
};

export const getForecastScoreColorKey = (score: number) => {
  if (score >= 80) return 'pink';
  if (score >= 50) return 'purple';
  if (score >= 40) return 'red';
  if (score >= 25) return 'orange';
  if (score >= 10) return 'yellow';
  return 'gray';
};

export const getGaugeStyle = (
  value: number | null,
  type: 'power' | 'speed' | 'density' | 'bt' | 'bz',
) => {
  if (value === null || !Number.isFinite(value)) {
    return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.gray, percentage: 0 };
  }

  const thresholds = GAUGE_THRESHOLDS[type];
  let key: keyof typeof GAUGE_COLORS = 'gray';

  if (type === 'bz') {
    if (value <= thresholds.pink) key = 'pink';
    else if (value <= thresholds.purple) key = 'purple';
    else if (value <= thresholds.red) key = 'red';
    else if (value <= thresholds.orange) key = 'orange';
    else if (value <= thresholds.yellow) key = 'yellow';
  } else {
    if (value >= thresholds.pink) key = 'pink';
    else if (value >= thresholds.purple) key = 'purple';
    else if (value >= thresholds.red) key = 'red';
    else if (value >= thresholds.orange) key = 'orange';
    else if (value >= thresholds.yellow) key = 'yellow';
  }

  const maxExpected =
    type === 'bz'
      ? Math.abs(thresholds.maxNegativeExpected ?? thresholds.pink)
      : thresholds.maxExpected ?? Math.abs(thresholds.pink);

  const percentage = Math.max(0, Math.min(100, (Math.abs(value) / maxExpected) * 100));

  return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
};

export const getAuroraEmoji = (score: number | null) => {
  if (score === null) return '❓';
  if (score >= 80) return '🤩';
  if (score >= 50) return '🌌';
  if (score >= 35) return '📱';
  if (score >= 20) return '📷';
  if (score >= 10) return '😐';
  return '😴';
};

export const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
  if (isDaylight) {
    return {
      overall: 'It is currently daylight. Camera settings are not applicable until after sunset.',
      phone: {
        android: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
        apple: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
      },
      dslr: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
    };
  }

  const strength = score ?? 0;
  const strong = strength >= 50;
  const moderate = strength >= 25;

  return {
    overall: strong
      ? 'Strong activity expected. Shorter exposures reduce blowout.'
      : moderate
      ? 'Moderate activity. Start with a balanced exposure and adjust as needed.'
      : 'Low activity. Longer exposures and higher ISO may be required.',
    phone: {
      android: {
        iso: strong ? '800-1600' : moderate ? '1600-3200' : '3200-6400',
        shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
        aperture: 'Wide open',
        focus: 'Infinity',
        wb: '3500-4200K',
      },
      apple: {
        iso: 'Auto',
        shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
        aperture: 'Wide open',
        focus: 'Infinity',
        wb: '3500-4200K',
      },
    },
    dslr: {
      iso: strong ? '1600-3200' : moderate ? '3200-6400' : '6400+',
      shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
      aperture: 'f/1.4 – f/2.8',
      focus: 'Infinity',
      wb: '3500-4200K',
    },
  };
};

export const isImapSource = (source?: string) => source === 'IMAP';

export const formatTimeHHMM = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export const getLatestPointTime = (series: Array<{ x?: number; time?: number; timestamp?: number }>): number | null => {
  let latest: number | null = null;
  for (const point of series) {
    const t = point?.x ?? point?.time ?? point?.timestamp;
    if (typeof t === 'number' && Number.isFinite(t) && (latest === null || t > latest)) {
      latest = t;
    }
  }
  return latest;
};
