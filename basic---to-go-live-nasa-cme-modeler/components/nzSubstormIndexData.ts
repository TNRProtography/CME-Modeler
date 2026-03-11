import { useEffect, useState } from 'react';

const TILDE_BASE = 'https://tilde.geonet.org.nz/v4';
const SOLAR_WIND_IMF_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/';
const DOMAIN = 'geomag';
const SCALE_FACTOR = 100;
const DISPLAY_DIVISOR = 10;
const AGGREGATION_MINUTES = 5;
export const CHART_LOOKBACK_HOURS = 24;
const BASELINE_WINDOW_MINUTES = 180;

// Geographic Config
const OBAN_LAT = -46.9;
const AKL_LAT = -36.85;
const LAT_DELTA = AKL_LAT - OBAN_LAT;

// Thresholds (Display Units)
const REQ_CAM = { start: -300, end: -1000 };
const REQ_PHN = { start: -450, end: -1100 };
const REQ_EYE = { start: -800, end: -1500 };

export interface NzTown {
  name: string;
  lat: number;
  lon: number;
  cam?: string;
  phone?: string;
  eye?: string;
}

export const NZ_TOWNS: NzTown[] = [
  { name: 'Oban', lat: -46.9, lon: 168.12 },
  { name: 'Halfmoon Bay', lat: -46.9, lon: 168.128 },
  { name: 'Horseshoe Bay', lat: -46.895, lon: 168.104 },
  { name: 'Invercargill', lat: -46.413, lon: 168.354 },
  { name: 'Bluff', lat: -46.601, lon: 168.337 },
  { name: 'Gore', lat: -46.098, lon: 168.944 },
  { name: 'Winton', lat: -46.147, lon: 168.323 },
  { name: 'Riverton', lat: -46.353, lon: 168.009 },
  { name: 'Wyndham', lat: -46.321, lon: 168.855 },
  { name: 'Lumsden', lat: -45.741, lon: 168.449 },
  { name: 'Te Anau', lat: -45.415, lon: 167.716 },
  { name: 'Manapouri', lat: -45.567, lon: 167.627 },
  { name: 'Milford Sound', lat: -44.673, lon: 167.926 },
  { name: 'Tuatapere', lat: -46.134, lon: 167.685 },
  { name: 'Nightcaps', lat: -45.966, lon: 168.023 },
  { name: 'Mataura', lat: -46.192, lon: 168.863 },
  { name: 'Otautau', lat: -46.153, lon: 167.997 },
  { name: 'Queenstown', lat: -45.031, lon: 168.662 },
  { name: 'Arrowtown', lat: -44.944, lon: 168.83 },
  { name: 'Frankton', lat: -45.017, lon: 168.726 },
  { name: 'Glenorchy', lat: -44.85, lon: 168.395 },
  { name: 'Wānaka', lat: -44.701, lon: 169.132 },
  { name: 'Hawea Flat', lat: -44.608, lon: 169.264 },
  { name: 'Albert Town', lat: -44.677, lon: 169.189 },
  { name: 'Cromwell', lat: -45.049, lon: 169.196 },
  { name: 'Clyde', lat: -45.191, lon: 169.317 },
  { name: 'Alexandra', lat: -45.248, lon: 169.374 },
  { name: 'Roxburgh', lat: -45.539, lon: 169.318 },
  { name: 'Lawrence', lat: -45.923, lon: 169.693 },
  { name: 'Milton', lat: -46.119, lon: 169.969 },
  { name: 'Balclutha', lat: -46.232, lon: 169.747 },
  { name: 'Kaitangata', lat: -46.279, lon: 169.848 },
  { name: 'Palmerston', lat: -45.481, lon: 170.72 },
  { name: 'Mosgiel', lat: -45.876, lon: 170.345 },
  { name: 'Dunedin', lat: -45.874, lon: 170.504 },
  { name: 'South Dunedin', lat: -45.903, lon: 170.494 },
  { name: 'St Kilda', lat: -45.911, lon: 170.503 },
  { name: 'Green Island', lat: -45.929, lon: 170.421 },
  { name: 'Brighton', lat: -45.962, lon: 170.338 },
  { name: 'Taieri Mouth', lat: -46.046, lon: 170.174 },
  { name: 'Portobello', lat: -45.847, lon: 170.659 },
  { name: 'Broad Bay', lat: -45.854, lon: 170.623 },
  { name: 'Macandrew Bay', lat: -45.867, lon: 170.586 },
  { name: 'Port Chalmers', lat: -45.818, lon: 170.627 },
  { name: 'Waitati', lat: -45.745, lon: 170.556 },
  { name: 'Waikouaiti', lat: -45.613, lon: 170.663 },
  { name: 'Karitane', lat: -45.638, lon: 170.648 },
  { name: 'Middlemarch', lat: -45.534, lon: 170.11 },
  { name: 'Ranfurly', lat: -45.133, lon: 170.093 },
  { name: 'Naseby', lat: -45.027, lon: 170.133 },
  { name: 'Oamaru', lat: -45.097, lon: 170.97 },
  { name: 'Kurow', lat: -44.726, lon: 170.468 },
  { name: 'Duntroon', lat: -44.861, lon: 170.68 },
  { name: 'Twizel', lat: -44.258, lon: 170.099 },
  { name: 'Lake Tekapo', lat: -44.004, lon: 170.476 },
  { name: 'Aoraki / Mt Cook Village', lat: -43.736, lon: 170.099 },
  { name: 'Fairlie', lat: -44.101, lon: 170.832 },
  { name: 'Geraldine', lat: -44.092, lon: 171.237 },
  { name: 'Timaru', lat: -44.397, lon: 171.255 },
  { name: 'Temuka', lat: -44.239, lon: 171.278 },
  { name: 'Ashburton', lat: -43.903, lon: 171.731 },
  { name: 'Methven', lat: -43.625, lon: 171.646 },
  { name: 'Rakaia', lat: -43.756, lon: 172.023 },
  { name: 'Darfield', lat: -43.482, lon: 171.783 },
  { name: 'Christchurch', lat: -43.532, lon: 172.637 },
  { name: 'Riccarton', lat: -43.533, lon: 172.601 },
  { name: 'Hornby', lat: -43.554, lon: 172.54 },
  { name: 'Rolleston', lat: -43.59, lon: 172.378 },
  { name: 'Prebbleton', lat: -43.58, lon: 172.478 },
  { name: 'Halswell', lat: -43.588, lon: 172.567 },
  { name: 'Wigram', lat: -43.56, lon: 172.556 },
  { name: 'Sockburn', lat: -43.547, lon: 172.575 },
  { name: 'Fendalton', lat: -43.516, lon: 172.599 },
  { name: 'Merivale', lat: -43.509, lon: 172.617 },
  { name: 'St Albans', lat: -43.513, lon: 172.633 },
  { name: 'Papanui', lat: -43.498, lon: 172.618 },
  { name: 'Bishopdale', lat: -43.49, lon: 172.602 },
  { name: 'Bryndwr', lat: -43.502, lon: 172.6 },
  { name: 'Shirley', lat: -43.502, lon: 172.657 },
  { name: 'New Brighton', lat: -43.496, lon: 172.733 },
  { name: 'North Beach', lat: -43.481, lon: 172.731 },
  { name: 'Southshore', lat: -43.563, lon: 172.735 },
  { name: 'Sumner', lat: -43.573, lon: 172.757 },
  { name: 'Lyttelton', lat: -43.603, lon: 172.723 },
  { name: 'Diamond Harbour', lat: -43.624, lon: 172.701 },
  { name: 'Akaroa', lat: -43.803, lon: 172.969 },
  { name: 'Little River', lat: -43.756, lon: 172.794 },
  { name: 'Lincoln', lat: -43.645, lon: 172.484 },
  { name: 'Tai Tapu', lat: -43.666, lon: 172.518 },
  { name: 'Leeston', lat: -43.76, lon: 172.293 },
  { name: 'Southbridge', lat: -43.816, lon: 172.254 },
  { name: 'Amberley', lat: -43.157, lon: 172.731 },
  { name: 'Rangiora', lat: -43.306, lon: 172.592 },
  { name: 'Kaiapoi', lat: -43.381, lon: 172.659 },
  { name: 'Woodend', lat: -43.32, lon: 172.672 },
  { name: 'Pegasus', lat: -43.321, lon: 172.697 },
  { name: 'Waikuku Beach', lat: -43.303, lon: 172.717 },
  { name: 'Leithfield Beach', lat: -43.185, lon: 172.748 },
  { name: 'Waipara', lat: -43.058, lon: 172.756 },
  { name: 'Waikari', lat: -43.007, lon: 172.64 },
  { name: 'Hanmer Springs', lat: -42.524, lon: 172.833 },
  { name: 'Kaikōura', lat: -42.4, lon: 173.68 },
  { name: 'Cheviot', lat: -42.818, lon: 173.266 },
  { name: 'Culverden', lat: -42.778, lon: 172.84 },
  { name: 'Greymouth', lat: -42.453, lon: 171.207 },
  { name: 'Hokitika', lat: -42.716, lon: 170.964 },
  { name: 'Westport', lat: -41.76, lon: 171.6 },
  { name: 'Karamea', lat: -41.245, lon: 172.104 },
  { name: 'Haast', lat: -43.88, lon: 169.042 },
  { name: 'Fox Glacier', lat: -43.464, lon: 170.017 },
  { name: 'Franz Josef', lat: -43.388, lon: 170.183 },
  { name: 'Ross', lat: -42.894, lon: 170.818 },
  { name: 'Hari Hari', lat: -43.145, lon: 170.962 },
  { name: 'Whataroa', lat: -43.301, lon: 170.378 },
  { name: 'Reefton', lat: -42.116, lon: 171.862 },
  { name: 'Runanga', lat: -42.406, lon: 171.248 },
  { name: 'Hokitika Gorge', lat: -42.721, lon: 170.873 },
  { name: 'Blenheim', lat: -41.513, lon: 173.96 },
  { name: 'Picton', lat: -41.296, lon: 174.001 },
  { name: 'Havelock', lat: -41.283, lon: 173.779 },
  { name: 'Renwick', lat: -41.509, lon: 173.832 },
  { name: 'Seddon', lat: -41.668, lon: 174.071 },
  { name: 'Ward', lat: -41.833, lon: 174.118 },
  { name: 'Rarangi', lat: -41.366, lon: 174.052 },
  { name: 'Spring Creek', lat: -41.483, lon: 173.914 },
  { name: 'Nelson', lat: -41.27, lon: 173.284 },
  { name: 'Richmond', lat: -41.336, lon: 173.179 },
  { name: 'Stoke', lat: -41.288, lon: 173.229 },
  { name: 'Tahunanui', lat: -41.286, lon: 173.247 },
  { name: 'Motueka', lat: -41.117, lon: 172.996 },
  { name: 'Mapua', lat: -41.26, lon: 173.084 },
  { name: 'Murchison', lat: -41.802, lon: 172.336 },
  { name: 'St Arnaud', lat: -41.806, lon: 172.84 },
  { name: 'Takaka', lat: -40.86, lon: 172.808 },
  { name: 'Collingwood', lat: -40.676, lon: 172.679 },
  { name: 'Kaiteriteri', lat: -41.054, lon: 173.0 },
  { name: 'Marahau', lat: -40.983, lon: 172.982 },
  { name: 'Wellington', lat: -41.286, lon: 174.776 },
  { name: 'Lower Hutt', lat: -41.212, lon: 174.907 },
  { name: 'Upper Hutt', lat: -41.124, lon: 175.071 },
  { name: 'Porirua', lat: -41.134, lon: 174.843 },
  { name: 'Johnsonville', lat: -41.228, lon: 174.797 },
  { name: 'Karori', lat: -41.285, lon: 174.74 },
  { name: 'Newtown', lat: -41.302, lon: 174.78 },
  { name: 'Island Bay', lat: -41.33, lon: 174.771 },
  { name: 'Lyall Bay', lat: -41.325, lon: 174.799 },
  { name: 'Miramar', lat: -41.311, lon: 174.821 },
  { name: 'Seatoun', lat: -41.33, lon: 174.839 },
  { name: 'Petone', lat: -41.229, lon: 174.872 },
  { name: 'Eastbourne', lat: -41.301, lon: 174.907 },
  { name: 'Wainuiomata', lat: -41.263, lon: 174.959 },
  { name: 'Paraparaumu', lat: -40.914, lon: 174.988 },
  { name: 'Waikanae', lat: -40.876, lon: 175.064 },
  { name: 'Ōtaki', lat: -40.756, lon: 175.148 },
  { name: 'Masterton', lat: -40.952, lon: 175.658 },
  { name: 'Carterton', lat: -41.019, lon: 175.527 },
  { name: 'Greytown', lat: -41.079, lon: 175.46 },
  { name: 'Martinborough', lat: -41.214, lon: 175.454 },
  { name: 'Featherston', lat: -41.117, lon: 175.332 },
  { name: 'Makara', lat: -41.296, lon: 174.692 },
  { name: 'Napier', lat: -39.493, lon: 176.912 },
  { name: 'Hastings', lat: -39.639, lon: 176.84 },
  { name: 'Havelock North', lat: -39.659, lon: 176.878 },
  { name: 'Waipawa', lat: -39.938, lon: 176.59 },
  { name: 'Waipukurau', lat: -40.003, lon: 176.555 },
  { name: 'Wairoa', lat: -39.038, lon: 177.418 },
  { name: 'Gisborne', lat: -38.663, lon: 178.018 },
  { name: 'Wainui Beach', lat: -38.641, lon: 178.058 },
  { name: 'Palmerston North', lat: -40.352, lon: 175.608 },
  { name: 'Feilding', lat: -40.228, lon: 175.567 },
  { name: 'Levin', lat: -40.622, lon: 175.276 },
  { name: 'Foxton', lat: -40.466, lon: 175.305 },
  { name: 'Dannevirke', lat: -40.204, lon: 176.102 },
  { name: 'Woodville', lat: -40.334, lon: 175.867 },
  { name: 'Whanganui', lat: -39.93, lon: 175.047 },
  { name: 'Bulls', lat: -40.173, lon: 175.385 },
  { name: 'Marton', lat: -40.07, lon: 175.375 },
  { name: 'Taihape', lat: -39.676, lon: 175.79 },
  { name: 'New Plymouth', lat: -39.057, lon: 174.075 },
  { name: 'Inglewood', lat: -39.129, lon: 174.189 },
  { name: 'Stratford', lat: -39.335, lon: 174.284 },
  { name: 'Ōpunake', lat: -39.455, lon: 173.854 },
  { name: 'Hāwera', lat: -39.591, lon: 174.283 },
  { name: 'Waitara', lat: -38.999, lon: 174.232 },
  { name: 'Eltham', lat: -39.432, lon: 174.299 },
  { name: 'Hamilton', lat: -37.787, lon: 175.279 },
  { name: 'Cambridge', lat: -37.884, lon: 175.472 },
  { name: 'Te Awamutu', lat: -38.01, lon: 175.328 },
  { name: 'Morrinsville', lat: -37.654, lon: 175.533 },
  { name: 'Ngāruawāhia', lat: -37.666, lon: 175.153 },
  { name: 'Huntly', lat: -37.558, lon: 175.156 },
  { name: 'Te Kūiti', lat: -38.341, lon: 175.165 },
  { name: 'Ōtorohanga', lat: -38.18, lon: 175.214 },
  { name: 'Taumarunui', lat: -38.879, lon: 175.258 },
  { name: 'Tūrangi', lat: -38.994, lon: 175.81 },
  { name: 'Taupō', lat: -38.685, lon: 176.07 },
  { name: 'Putāruru', lat: -38.051, lon: 175.789 },
  { name: 'Tokoroa', lat: -38.233, lon: 175.872 },
  { name: 'Tauranga', lat: -37.687, lon: 176.166 },
  { name: 'Mount Maunganui', lat: -37.637, lon: 176.189 },
  { name: 'Papamoa', lat: -37.72, lon: 176.297 },
  { name: 'Te Puke', lat: -37.784, lon: 176.321 },
  { name: 'Rotorua', lat: -38.137, lon: 176.251 },
  { name: 'Whakatāne', lat: -37.953, lon: 176.99 },
  { name: 'Ōhope', lat: -37.968, lon: 177.1 },
  { name: 'Ōpōtiki', lat: -38.008, lon: 177.287 },
  { name: 'Kawerau', lat: -38.1, lon: 176.699 },
  { name: 'Ngongotahā', lat: -38.089, lon: 176.179 },
  { name: 'Thames', lat: -37.138, lon: 175.545 },
  { name: 'Whitianga', lat: -36.831, lon: 175.703 },
  { name: 'Coromandel', lat: -36.762, lon: 175.497 },
  { name: 'Tairua', lat: -37.001, lon: 175.851 },
  { name: 'Whangamatā', lat: -37.2, lon: 175.874 },
  { name: 'Hahei', lat: -36.867, lon: 175.791 },
  { name: 'Hot Water Beach', lat: -36.895, lon: 175.825 },
  { name: 'Auckland', lat: -36.848, lon: 174.763 },
  { name: 'Manukau', lat: -36.993, lon: 174.879 },
  { name: 'Henderson', lat: -36.875, lon: 174.628 },
  { name: 'Waitākere', lat: -36.9, lon: 174.579 },
  { name: 'Papakura', lat: -37.064, lon: 174.944 },
  { name: 'Pukekohe', lat: -37.2, lon: 174.9 },
  { name: 'Warkworth', lat: -36.402, lon: 174.661 },
  { name: 'Silverdale', lat: -36.611, lon: 174.678 },
  { name: 'Orewa', lat: -36.593, lon: 174.695 },
  { name: 'Waiwera', lat: -36.564, lon: 174.718 },
  { name: 'Devonport', lat: -36.83, lon: 174.8 },
  { name: 'Takapuna', lat: -36.789, lon: 174.772 },
  { name: 'Browns Bay', lat: -36.717, lon: 174.745 },
  { name: 'Howick', lat: -36.904, lon: 174.939 },
  { name: 'Māngere', lat: -36.974, lon: 174.797 },
  { name: 'Ōtāhuhu', lat: -36.952, lon: 174.861 },
  { name: 'Beachlands', lat: -36.9, lon: 175.002 },
  { name: 'Clevedon', lat: -37.016, lon: 175.066 },
  { name: 'Waiheke Island', lat: -36.793, lon: 175.077 },
  { name: 'Great Barrier Island', lat: -36.197, lon: 175.437 },
  { name: 'Whangārei', lat: -35.725, lon: 174.324 },
  { name: 'Kerikeri', lat: -35.228, lon: 173.948 },
  { name: 'Paihia', lat: -35.278, lon: 174.09 },
  { name: 'Russell', lat: -35.266, lon: 174.128 },
  { name: 'Dargaville', lat: -35.934, lon: 173.885 },
  { name: 'Kaitāia', lat: -35.113, lon: 173.267 },
  { name: 'Mangonui', lat: -34.988, lon: 173.521 },
  { name: 'Whangaroa', lat: -35.007, lon: 173.741 },
  { name: 'Kawakawa', lat: -35.383, lon: 174.072 },
  { name: 'Mt Ruapehu', lat: -39.283, lon: 175.566 },
  { name: 'Mt Ngāuruhoe', lat: -39.157, lon: 175.632 },
  { name: 'Tongariro', lat: -39.107, lon: 175.673 },
  { name: 'Mt Taranaki', lat: -39.296, lon: 174.064 },
  { name: 'Mt Hutt', lat: -43.498, lon: 171.573 },
  { name: 'Ben Lomond', lat: -45.006, lon: 168.73 },
  { name: 'The Remarkables', lat: -45.083, lon: 168.812 },
  { name: 'Crown Range', lat: -44.857, lon: 168.898 },
  { name: 'Lindis Pass', lat: -44.572, lon: 169.653 },
  { name: 'Lewis Pass', lat: -42.374, lon: 172.399 },
  { name: 'Arthurs Pass', lat: -42.94, lon: 171.565 },
  { name: 'Haast Pass', lat: -44.101, lon: 169.377 },
  { name: 'Homer Tunnel', lat: -44.769, lon: 167.943 },
  { name: 'Nugget Point', lat: -46.413, lon: 169.822 },
  { name: 'Slope Point', lat: -46.671, lon: 168.946 },
  { name: 'Cape Reinga', lat: -34.43, lon: 172.68 },
  { name: 'Cape Palliser', lat: -41.612, lon: 175.291 },
  { name: 'Farewell Spit', lat: -40.555, lon: 172.677 },
];

export interface NzSubstormIndexData {
  strength: number;
  slope: number;
  points: { t: number; v: number }[];
  towns: NzTown[];
  outlook: string;
  solarWind: { bz: number; speed: number };
  solarWindSource?: string;
  trends: { m5: number };
  stationCount: number;
  lastUpdated: number | null;
}

const parseIso = (ts: string | number) => {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const getSourceLabel = (source?: string | null) => {
  if (!source) return '—';
  return source.includes('IMAP') ? 'IMAP' : 'NOAA RTSW';
};

const splitTopLevelArrayEntries = (raw: string): string[] => {
  const entries: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    current += ch;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const candidate = current.slice(0, -1).trim();
      if (candidate) entries.push(candidate);
      current = '';
    }
  }

  const trailing = current.trim();
  if (trailing) entries.push(trailing);
  return entries;
};

const parseJsonWithRowRecovery = (rawText: string) => {
  const text = rawText.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // fall through to row-level recovery
  }

  const parseArrayEntries = (arrayBody: string) => {
    const recovered: any[] = [];
    for (const entryText of splitTopLevelArrayEntries(arrayBody)) {
      try {
        recovered.push(JSON.parse(entryText));
      } catch {
        // Skip malformed row and continue
      }
    }
    return recovered;
  };

  if (text.startsWith('[') && text.endsWith(']')) {
    return parseArrayEntries(text.slice(1, -1));
  }

  const dataKeyIndex = text.indexOf('"data"');
  if (dataKeyIndex >= 0) {
    const arrayStart = text.indexOf('[', dataKeyIndex);
    if (arrayStart >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let arrayEnd = -1;

      for (let i = arrayStart; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            arrayEnd = i;
            break;
          }
        }
      }

      if (arrayEnd > arrayStart) {
        const recoveredData = parseArrayEntries(text.slice(arrayStart + 1, arrayEnd));
        const okMatch = text.match(/"ok"\s*:\s*(true|false)/i);
        return { ok: okMatch ? okMatch[1].toLowerCase() === 'true' : recoveredData.length > 0, data: recoveredData };
      }
    }
  }

  return null;
};

const fetchJsonWithRecovery = async (url: string) => {
  const response = await fetch(url);
  const raw = await response.text();
  const parsed = parseJsonWithRowRecovery(raw);
  if (parsed === null) {
    throw new Error(`Unable to parse JSON from ${url}`);
  }
  return parsed;
};

export const calculateReachLatitude = (strengthNt: number, mode: 'camera' | 'phone' | 'eye') => {
  if (strengthNt >= 0) return -65.0;
  const curve = mode === 'phone' ? REQ_PHN : mode === 'eye' ? REQ_EYE : REQ_CAM;
  const slope = (curve.end - curve.start) / LAT_DELTA;
  const lat = OBAN_LAT + (strengthNt - curve.start) / slope;
  return Math.max(-48, Math.min(-34, lat));
};

const getTownStatus = (town: NzTown, currentStrength: number, category: 'camera' | 'phone' | 'eye') => {
  if (currentStrength >= 0) return undefined;
  const reqs = category === 'phone' ? REQ_PHN : category === 'eye' ? REQ_EYE : REQ_CAM;
  const slope = (reqs.end - reqs.start) / LAT_DELTA;
  const required = reqs.start + (town.lat - OBAN_LAT) * slope;

  if (currentStrength <= required) {
    const excess = Math.abs(currentStrength) - Math.abs(required);
    if (excess < 50) return 'red';
    if (excess < 150) return 'yellow';
    return 'green';
  }
  return undefined;
};

const getVisibleTowns = (strength: number): NzTown[] =>
  NZ_TOWNS.map((town) => ({
    ...town,
    cam: getTownStatus(town, strength, 'camera'),
    phone: getTownStatus(town, strength, 'phone'),
    eye: getTownStatus(town, strength, 'eye'),
  }));

const getProjectedBaseline = (samples: Array<{ t: number; val: number }>, targetTime: number) => {
  const endWindow = targetTime - 5 * 60000;
  const startWindow = targetTime - BASELINE_WINDOW_MINUTES * 60000;
  const windowPoints: Array<{ t: number; val: number }> = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const t = samples[i].t;
    if (t > endWindow) continue;
    if (t < startWindow) break;
    windowPoints.push(samples[i]);
  }
  if (windowPoints.length < 10) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = windowPoints.length;
  for (let i = 0; i < n; i++) {
    const x = (windowPoints[i].t - startWindow) / 60000;
    const y = windowPoints[i].val;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const targetX = (targetTime - startWindow) / 60000;
  return slope * targetX + intercept;
};

const selectNorthSeriesKey = (stationCode: string, stationData: any) => {
  if (!stationData?.sensorCodes) return null;
  const aspectPriority = ['X', 'north', 'N', 'x', 'nil'];
  const nameMatches = (name: string) => {
    const lower = name.toLowerCase();
    return lower.includes('north') || lower === 'x' || lower.includes('magnetic-field');
  };

  const seriesCandidates: string[] = [];

  for (const sensorCode of Object.keys(stationData.sensorCodes)) {
    const names = stationData.sensorCodes[sensorCode]?.names;
    if (!names) continue;
    for (const name of Object.keys(names)) {
      if (!nameMatches(name)) continue;
      const methods = names[name]?.methods;
      if (!methods) continue;
      for (const method of Object.keys(methods)) {
        if (!method.includes('60s') && !method.includes('1m')) continue;
        const aspects = methods[method]?.aspects;
        if (!aspects) continue;
        for (const aspect of aspectPriority) {
          if (aspects[aspect]) {
            return `${stationCode}/${name}/${sensorCode}/${method}/${aspect}`;
          }
        }
        const fallbackAspect = Object.keys(aspects)[0];
        if (fallbackAspect) {
          seriesCandidates.push(`${stationCode}/${name}/${sensorCode}/${method}/${fallbackAspect}`);
        }
      }
    }
  }

  return seriesCandidates[0] ?? null;
};

export const useNzSubstormIndexData = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<NzSubstormIndexData | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const summary = await fetchJsonWithRecovery(`${TILDE_BASE}/dataSummary/${DOMAIN}`);
        const stations = summary?.domain?.[DOMAIN]?.stations ?? {};
        const stationEntries = Object.keys(stations)
          .map((stationCode) => ({
            stationCode,
            seriesKey: selectNorthSeriesKey(stationCode, stations[stationCode]),
          }))
          .filter((entry) => entry.seriesKey);
        if (stationEntries.length === 0) throw new Error('No magnetometer stations found.');

        const aggregationParams = `aggregationPeriod=${AGGREGATION_MINUTES}m&aggregationFunction=mean`;
        const [stationSeries, solarWindRes] = await Promise.all([
          Promise.all(
            stationEntries.map(async (entry) => {
              const tildeUrl = `${TILDE_BASE}/data/${DOMAIN}/${entry.seriesKey}/latest/2d?${aggregationParams}`;
              const series = await fetchJsonWithRecovery(tildeUrl);
              return { station: entry.stationCode, seriesKey: entry.seriesKey, data: series };
            })
          ),
          fetchJsonWithRecovery(SOLAR_WIND_IMF_URL),
        ]);
        const solarWindData = solarWindRes;

        const now = Date.now();
        const chartCutoff = now - CHART_LOOKBACK_HOURS * 3600 * 1000;
        const bucketMs = AGGREGATION_MINUTES * 60000;
        const combinedMap = new Map<number, number[]>();
        let latestTimestamp: number | null = null;

        const validStationCount = stationSeries.reduce((count, stationSeriesEntry) => {
          const rawSamples = (stationSeriesEntry.data[0]?.data || [])
            .map((d: any) => ({ t: parseIso(d.ts), val: d.val }))
            .filter((d: any) => d.t && d.val != null)
            .sort((a: any, b: any) => a.t - b.t);
          if (rawSamples.length < 10) return count;

          for (let i = 0; i < rawSamples.length; i++) {
            if (rawSamples[i].t < chartCutoff - BASELINE_WINDOW_MINUTES * 60000) continue;
            const base = getProjectedBaseline(rawSamples, rawSamples[i].t);
            if (base === null) continue;

            let s = (rawSamples[i].val - base) * SCALE_FACTOR;
            if (s > 0 && s < 1500) s = s * 0.1;
            s = clamp(s, -250000, 250000);

            const bucket = Math.round(rawSamples[i].t / bucketMs) * bucketMs;
            if (bucket < chartCutoff) continue;
            const existing = combinedMap.get(bucket) ?? [];
            existing.push(s);
            combinedMap.set(bucket, existing);
            if (!latestTimestamp || bucket > latestTimestamp) {
              latestTimestamp = bucket;
            }
          }
          return count + 1;
        }, 0);

        const points = Array.from(combinedMap.entries())
          .map(([t, values]) => ({ t, v: Math.min(...values) / DISPLAY_DIVISOR }))
          .sort((a, b) => a.t - b.t);

        if (points.length < 10) throw new Error('Insufficient Ground Data');

        const currentPoint = points[points.length - 1];
        const currentStrength = currentPoint.v;

        const slopeWindowMs = 20 * 60000;
        const slopeStart = currentPoint.t - slopeWindowMs;
        const slopeSet = points.filter((s: any) => s.t >= slopeStart);
        let slope = 0;
        if (slopeSet.length > 1) {
          const first = slopeSet[0];
          const dt = (currentPoint.t - first.t) / 60000;
          if (dt > 0) slope = (currentPoint.v - first.v) / dt;
        }

        let bz = 0;
        let speed = 0;
        let solarWindSource = '—';
        if (solarWindData?.ok && Array.isArray(solarWindData.data)) {
          const latestEntry = [...solarWindData.data].reverse().find((entry: any) => entry && entry.speed != null && entry.bz != null);
          if (latestEntry) {
            bz = Number(latestEntry.bz) || 0;
            speed = Number(latestEntry.speed) || 0;
            solarWindSource = getSourceLabel(latestEntry?.src?.bz ?? latestEntry?.src?.speed);
          }
        }

        let outlook = '';
        const delay = speed > 0 ? Math.round(1500000 / speed / 60) : 60;
        if (bz < -15 && speed > 500) outlook = `⚠️ WARNING: Severe shock (Bz ${bz}, ${speed}km/s). Major impact in ${delay} mins.`;
        else if (bz < -10) outlook = `🚨 Incoming: Strong negative field (Bz ${bz}). Intensification in ${delay} mins.`;
        else if (bz < -5) outlook = `📡 Watch: Favorable wind (Bz ${bz}). Substorm building, arrival ~${delay} mins.`;
        else if (currentStrength < -200 / DISPLAY_DIVISOR) outlook = '👀 Ground: Active conditions detected.';
        else outlook = '🌙 Quiet: Currently quiet.';

        const towns = getVisibleTowns(currentStrength);

        setData({
          strength: currentStrength,
          slope,
          points,
          towns,
          outlook,
          solarWind: { bz, speed },
          solarWindSource,
          trends: {
            m5: currentStrength,
          },
          stationCount: validStationCount,
          lastUpdated: latestTimestamp,
        });
        setLoading(false);
      } catch (e) {
        console.error('NZ Substorm Fetch Error', e);
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};