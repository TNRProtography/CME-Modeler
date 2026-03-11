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
  { name: 'Mason Bay', lat: -46.952, lon: 167.858 },
  { name: 'Paterson Inlet', lat: -46.933, lon: 168.078 },
  { name: 'Lord\'s River', lat: -46.98, lon: 167.99 },
  { name: 'Edendale', lat: -46.316, lon: 168.774 },
  { name: 'Fortrose', lat: -46.567, lon: 168.803 },
  { name: 'Tokanui', lat: -46.554, lon: 168.952 },
  { name: 'Waikawa', lat: -46.616, lon: 168.407 },
  { name: 'Colac Bay', lat: -46.37, lon: 167.936 },
  { name: 'Orepuki', lat: -46.275, lon: 167.726 },
  { name: 'Clifden', lat: -46.03, lon: 167.532 },
  { name: 'Pahia', lat: -45.988, lon: 167.612 },
  { name: 'Centre Bush', lat: -45.985, lon: 168.187 },
  { name: 'Dipton', lat: -45.87, lon: 168.274 },
  { name: 'Mandeville', lat: -46.023, lon: 168.437 },
  { name: 'Mossburn', lat: -45.674, lon: 168.244 },
  { name: 'Five Rivers', lat: -45.627, lon: 168.398 },
  { name: 'Kingston', lat: -45.332, lon: 168.717 },
  { name: 'Walter Peak', lat: -45.121, lon: 168.53 },
  { name: 'Garston', lat: -45.464, lon: 168.711 },
  { name: 'Athol', lat: -45.531, lon: 168.561 },
  { name: 'Balfour', lat: -45.825, lon: 168.538 },
  { name: 'Waikaia', lat: -45.73, lon: 168.791 },
  { name: 'Otapiri', lat: -45.941, lon: 168.235 },
  { name: 'Cascade Creek', lat: -44.972, lon: 167.828 },
  { name: 'Deep Cove', lat: -45.457, lon: 166.904 },
  { name: 'Doubtful Sound', lat: -45.296, lon: 167.027 },
  { name: 'Wilmot Pass', lat: -45.381, lon: 167.143 },
  { name: 'Lake Monowai', lat: -45.825, lon: 167.547 },
  { name: 'Borland Lodge', lat: -45.726, lon: 167.559 },
  { name: 'Gibbston', lat: -44.98, lon: 169.034 },
  { name: 'Bannockburn', lat: -45.057, lon: 169.132 },
  { name: 'Lowburn', lat: -44.954, lon: 169.322 },
  { name: 'Tarras', lat: -44.826, lon: 169.546 },
  { name: 'Luggate', lat: -44.789, lon: 169.244 },
  { name: 'Makarora', lat: -44.232, lon: 169.228 },
  { name: 'Hāwea', lat: -44.61, lon: 169.285 },
  { name: 'Lake Hāwea', lat: -44.511, lon: 169.276 },
  { name: 'Pemberton', lat: -44.688, lon: 169.194 },
  { name: 'Bendigo', lat: -45.008, lon: 169.364 },
  { name: 'Ophir', lat: -45.113, lon: 169.584 },
  { name: 'Lauder', lat: -45.056, lon: 169.686 },
  { name: 'Omakau', lat: -45.117, lon: 169.72 },
  { name: 'Blackstone Hill', lat: -45.181, lon: 169.814 },
  { name: 'Becks', lat: -45.217, lon: 169.721 },
  { name: 'Oturehua', lat: -44.986, lon: 169.984 },
  { name: 'Poolburn', lat: -45.095, lon: 169.937 },
  { name: 'Wedderburn', lat: -45.052, lon: 170.058 },
  { name: 'Kyeburn', lat: -45.121, lon: 170.18 },
  { name: 'Paerau', lat: -45.227, lon: 170.06 },
  { name: 'Patearoa', lat: -45.291, lon: 170.082 },
  { name: 'Strath Taieri', lat: -45.418, lon: 170.222 },
  { name: 'Outram', lat: -45.848, lon: 170.232 },
  { name: 'Henley', lat: -45.877, lon: 170.165 },
  { name: 'Allanton', lat: -45.93, lon: 170.196 },
  { name: 'Berwick', lat: -45.966, lon: 170.239 },
  { name: 'Waihola', lat: -46.011, lon: 170.091 },
  { name: 'Taieri Lake', lat: -46.064, lon: 170.024 },
  { name: 'Tokomairiro', lat: -46.141, lon: 169.893 },
  { name: 'Clinton', lat: -46.199, lon: 169.383 },
  { name: 'Waitahuna', lat: -46.016, lon: 169.662 },
  { name: 'Tapanui', lat: -46.132, lon: 169.262 },
  { name: 'Kelso', lat: -45.911, lon: 169.373 },
  { name: 'Raes Junction', lat: -45.79, lon: 169.506 },
  { name: 'Roxburgh Gorge', lat: -45.627, lon: 169.336 },
  { name: 'Millers Flat', lat: -45.64, lon: 169.27 },
  { name: 'Ettrick', lat: -45.699, lon: 169.367 },
  { name: 'Beaumont', lat: -45.866, lon: 169.529 },
  { name: 'Clydevale', lat: -46.093, lon: 169.491 },
  { name: 'Stirling', lat: -46.194, lon: 169.63 },
  { name: 'Benhar', lat: -46.211, lon: 169.803 },
  { name: 'Lovells Flat', lat: -46.214, lon: 169.554 },
  { name: 'Balmoral', lat: -46.117, lon: 169.619 },
  { name: 'Heriot', lat: -45.961, lon: 169.246 },
  { name: 'Conical Hill', lat: -45.921, lon: 169.183 },
  { name: 'Warepa', lat: -46.278, lon: 169.539 },
  { name: 'Inch Clutha', lat: -46.196, lon: 169.843 },
  { name: 'Owaka', lat: -46.451, lon: 169.661 },
  { name: 'Pounawea', lat: -46.498, lon: 169.736 },
  { name: 'Surat Bay', lat: -46.531, lon: 169.793 },
  { name: 'Tawanui', lat: -46.346, lon: 169.553 },
  { name: 'Romahapa', lat: -46.314, lon: 169.622 },
  { name: 'Rosebank', lat: -46.316, lon: 169.5 },
  { name: 'Pukeawa', lat: -46.36, lon: 169.414 },
  { name: 'Matai', lat: -46.371, lon: 169.355 },
  { name: 'Catlins', lat: -46.5, lon: 169.55 },
  { name: 'Papatowai', lat: -46.573, lon: 169.47 },
  { name: 'Tahakopa', lat: -46.587, lon: 169.338 },
  { name: 'Waikawa Valley', lat: -46.624, lon: 169.148 },
  { name: 'Tokanui Coast', lat: -46.573, lon: 168.968 },
  { name: 'Curio Bay', lat: -46.676, lon: 169.032 },
  { name: 'Porpoise Bay', lat: -46.671, lon: 169.038 },
  { name: 'Lake Waihola', lat: -46.011, lon: 170.093 },
  { name: 'Lake Tuakitoto', lat: -46.161, lon: 169.78 },
  { name: 'Tasman Bay', lat: -41.0, lon: 173.3 },
  { name: 'Lake Wakatipu', lat: -45.12, lon: 168.56 },
  { name: 'Lake Wānaka', lat: -44.63, lon: 169.1 },
  { name: 'Lake Dunstan', lat: -45.025, lon: 169.27 },
  { name: 'Lake Mahinerangi', lat: -45.772, lon: 170.038 },
  { name: 'Lake Waipori', lat: -45.948, lon: 170.035 },
  { name: 'Cave', lat: -44.253, lon: 170.96 },
  { name: 'Washdyke', lat: -44.373, lon: 171.281 },
  { name: 'Seadown', lat: -44.428, lon: 171.25 },
  { name: 'Pareora', lat: -44.467, lon: 171.289 },
  { name: 'Pleasant Point', lat: -44.266, lon: 171.128 },
  { name: 'Hanging Rock', lat: -44.267, lon: 171.048 },
  { name: 'Grantham', lat: -44.19, lon: 170.991 },
  { name: 'Orari', lat: -44.2, lon: 171.168 },
  { name: 'Peel Forest', lat: -43.906, lon: 171.228 },
  { name: 'Arundel', lat: -43.986, lon: 171.375 },
  { name: 'Alford Forest', lat: -43.68, lon: 171.424 },
  { name: 'Mount Somers', lat: -43.713, lon: 171.443 },
  { name: 'Staveley', lat: -43.703, lon: 171.528 },
  { name: 'Highbank', lat: -43.771, lon: 171.734 },
  { name: 'Ruapuna', lat: -43.755, lon: 171.877 },
  { name: 'Aylesbury', lat: -43.624, lon: 172.034 },
  { name: 'Dunsandel', lat: -43.729, lon: 172.134 },
  { name: 'Doyleston', lat: -43.764, lon: 172.184 },
  { name: 'Birdlings Flat', lat: -43.826, lon: 172.539 },
  { name: 'Kaituna', lat: -43.77, lon: 172.543 },
  { name: 'Tai Tapu Hills', lat: -43.693, lon: 172.555 },
  { name: 'Templeton', lat: -43.564, lon: 172.456 },
  { name: 'Islington', lat: -43.564, lon: 172.53 },
  { name: 'Addington', lat: -43.547, lon: 172.61 },
  { name: 'Sydenham', lat: -43.555, lon: 172.633 },
  { name: 'Beckenham', lat: -43.568, lon: 172.641 },
  { name: 'Hillmorton', lat: -43.566, lon: 172.595 },
  { name: 'Spreydon', lat: -43.561, lon: 172.614 },
  { name: 'Cashmere', lat: -43.578, lon: 172.638 },
  { name: 'Huntsbury', lat: -43.572, lon: 172.665 },
  { name: 'Mount Pleasant', lat: -43.562, lon: 172.707 },
  { name: 'Redcliffs', lat: -43.56, lon: 172.731 },
  { name: 'Southnew Brighton', lat: -43.537, lon: 172.733 },
  { name: 'Waimairi Beach', lat: -43.484, lon: 172.705 },
  { name: 'Spencerville', lat: -43.432, lon: 172.682 },
  { name: 'Brooklands', lat: -43.405, lon: 172.673 },
  { name: 'Clarkville', lat: -43.355, lon: 172.632 },
  { name: 'Mandeville North', lat: -43.334, lon: 172.601 },
  { name: 'Cust', lat: -43.287, lon: 172.389 },
  { name: 'Waikuku', lat: -43.297, lon: 172.716 },
  { name: 'Sefton', lat: -43.244, lon: 172.605 },
  { name: 'Fernside', lat: -43.27, lon: 172.537 },
  { name: 'Ohoka', lat: -43.357, lon: 172.524 },
  { name: 'Swannanoa', lat: -43.31, lon: 172.469 },
  { name: 'West Eyreton', lat: -43.329, lon: 172.423 },
  { name: 'Springbank', lat: -43.489, lon: 172.325 },
  { name: 'Weedons', lat: -43.567, lon: 172.343 },
  { name: 'Ladbrooks', lat: -43.609, lon: 172.45 },
  { name: 'McLeans Island', lat: -43.493, lon: 172.548 },
  { name: 'Yaldhurst', lat: -43.527, lon: 172.49 },
  { name: 'Hawkins Hill', lat: -43.499, lon: 172.452 },
  { name: 'West Melton', lat: -43.534, lon: 172.371 },
  { name: 'Halkett', lat: -43.491, lon: 171.974 },
  { name: 'Terrace Station', lat: -43.398, lon: 171.976 },
  { name: 'Springfield', lat: -43.345, lon: 171.929 },
  { name: 'Glentunnel', lat: -43.476, lon: 171.82 },
  { name: 'Bankside', lat: -43.786, lon: 171.966 },
  { name: 'Kirwee', lat: -43.538, lon: 172.178 },
  { name: 'Courtenay', lat: -43.585, lon: 172.183 },
  { name: 'Charing Cross', lat: -43.667, lon: 172.105 },
  { name: 'Burnham', lat: -43.617, lon: 172.311 },
  { name: 'Selwyn', lat: -43.659, lon: 172.319 },
  { name: 'Coalgate', lat: -43.468, lon: 171.691 },
  { name: 'Homebush', lat: -43.631, lon: 171.609 },
  { name: 'Windwhistle', lat: -43.474, lon: 171.751 },
  { name: 'Porters Pass', lat: -43.294, lon: 171.744 },
  { name: 'Castle Hill', lat: -43.221, lon: 171.749 },
  { name: 'Flock Hill', lat: -43.176, lon: 171.797 },
  { name: 'Cass', lat: -43.041, lon: 171.734 },
  { name: 'Otira', lat: -42.801, lon: 171.56 },
  { name: 'Jacksons', lat: -42.703, lon: 171.484 },
  { name: 'Kumara', lat: -42.624, lon: 171.172 },
  { name: 'Dillmanstown', lat: -42.596, lon: 171.202 },
  { name: 'Ahaura', lat: -42.373, lon: 171.695 },
  { name: 'Ikamatua', lat: -42.278, lon: 171.694 },
  { name: 'Ngahere', lat: -42.318, lon: 171.603 },
  { name: 'Dobson', lat: -42.379, lon: 171.419 },
  { name: 'Blackball', lat: -42.38, lon: 171.436 },
  { name: 'Taylorville', lat: -42.419, lon: 171.216 },
  { name: 'Lake Brunner', lat: -42.62, lon: 171.453 },
  { name: 'Moana', lat: -42.353, lon: 171.428 },
  { name: 'Inchbonnie', lat: -42.556, lon: 171.623 },
  { name: 'Rotomanu', lat: -42.637, lon: 171.476 },
  { name: 'Jacksons Creek', lat: -42.704, lon: 171.473 },
  { name: 'Stillwater', lat: -42.417, lon: 171.282 },
  { name: 'Ngakawau', lat: -41.626, lon: 171.818 },
  { name: 'Granity', lat: -41.638, lon: 171.852 },
  { name: 'Hector', lat: -41.676, lon: 171.876 },
  { name: 'Waimangaroa', lat: -41.727, lon: 171.721 },
  { name: 'Mokihinui', lat: -41.627, lon: 171.963 },
  { name: 'Seddonville', lat: -41.697, lon: 171.959 },
  { name: 'Inangahua', lat: -41.867, lon: 171.948 },
  { name: 'Springs Junction', lat: -41.751, lon: 172.163 },
  { name: 'Lake Sumner', lat: -42.6, lon: 172.213 },
  { name: 'Waiau', lat: -42.647, lon: 173.045 },
  { name: 'Rotherham', lat: -42.725, lon: 172.974 },
  { name: 'Omihi', lat: -43.085, lon: 172.719 },
  { name: 'Greta Valley', lat: -43.06, lon: 172.878 },
  { name: 'Hurunui', lat: -42.917, lon: 172.869 },
  { name: 'Hawarden', lat: -43.041, lon: 172.471 },
  { name: 'Waikari River', lat: -43.027, lon: 172.598 },
  { name: 'Loburn', lat: -43.228, lon: 172.492 },
  { name: 'Ashley Gorge', lat: -43.314, lon: 172.223 },
  { name: 'Oxford', lat: -43.297, lon: 172.196 },
  { name: 'Lake Coleridge', lat: -43.362, lon: 171.543 },
  { name: 'Windermere', lat: -43.327, lon: 171.82 },
  { name: 'Lake Ellesmere', lat: -43.757, lon: 172.416 },
  { name: 'Kaikōura Peninsula', lat: -42.421, lon: 173.694 },
  { name: 'Goose Bay', lat: -42.523, lon: 173.716 },
  { name: 'Mangamaunu', lat: -42.343, lon: 173.702 },
  { name: 'Linkwater', lat: -41.326, lon: 173.887 },
  { name: 'Canvastown', lat: -41.292, lon: 173.713 },
  { name: 'Rai Valley', lat: -41.252, lon: 173.61 },
  { name: 'Pelorus Bridge', lat: -41.299, lon: 173.597 },
  { name: 'Rai Saddle', lat: -41.209, lon: 173.513 },
  { name: 'Anakiwa', lat: -41.243, lon: 174.047 },
  { name: 'Kenepuru Sound', lat: -41.115, lon: 173.878 },
  { name: 'Ngakuta Bay', lat: -41.278, lon: 174.008 },
  { name: 'Waikawa Bay', lat: -41.273, lon: 174.026 },
  { name: 'Diversion Bay', lat: -41.29, lon: 174.015 },
  { name: 'Grove Arm', lat: -41.27, lon: 173.98 },
  { name: 'Pelorus Sound', lat: -41.086, lon: 173.894 },
  { name: 'Queen Charlotte Sound', lat: -41.244, lon: 174.078 },
  { name: 'Te Mahia', lat: -41.368, lon: 174.038 },
  { name: 'Tuamarina', lat: -41.457, lon: 173.966 },
  { name: 'Wairau Valley', lat: -41.641, lon: 173.524 },
  { name: 'Waihopai Valley', lat: -41.55, lon: 173.714 },
  { name: 'Riverlands', lat: -41.531, lon: 173.98 },
  { name: 'Grovetown', lat: -41.499, lon: 173.951 },
  { name: 'Witherlea', lat: -41.528, lon: 173.945 },
  { name: 'Mayfield', lat: -41.555, lon: 173.931 },
  { name: 'Woodbourne', lat: -41.521, lon: 173.871 },
  { name: 'Fairhall', lat: -41.546, lon: 173.854 },
  { name: 'Rarangi Beach', lat: -41.373, lon: 174.063 },
  { name: 'Lake Grassmere', lat: -41.726, lon: 174.095 },
  { name: 'Flaxbourne', lat: -41.776, lon: 174.095 },
  { name: 'Taylor Pass', lat: -41.56, lon: 173.7 },
  { name: 'Marlborough Sounds', lat: -41.1, lon: 173.9 },
  { name: 'Brightwater', lat: -41.376, lon: 173.128 },
  { name: 'Wakefield', lat: -41.4, lon: 173.052 },
  { name: 'Foxhill', lat: -41.444, lon: 172.964 },
  { name: 'Hope', lat: -41.319, lon: 173.185 },
  { name: 'Nayland', lat: -41.268, lon: 173.28 },
  { name: 'Atawhai', lat: -41.244, lon: 173.318 },
  { name: 'Enner Glynn', lat: -41.281, lon: 173.305 },
  { name: 'The Brook', lat: -41.294, lon: 173.273 },
  { name: 'Tahuna', lat: -41.29, lon: 173.277 },
  { name: 'Annesbrook', lat: -41.313, lon: 173.234 },
  { name: 'Saxton', lat: -41.303, lon: 173.242 },
  { name: 'Kina', lat: -41.209, lon: 173.027 },
  { name: 'Riwaka', lat: -41.085, lon: 172.959 },
  { name: 'Ngatimoti', lat: -41.102, lon: 172.917 },
  { name: 'Lower Moutere', lat: -41.17, lon: 172.972 },
  { name: 'Upper Moutere', lat: -41.204, lon: 172.953 },
  { name: 'Redwood Valley', lat: -41.318, lon: 173.037 },
  { name: 'Dovedale', lat: -41.397, lon: 172.894 },
  { name: 'Kohatu', lat: -41.476, lon: 172.685 },
  { name: 'Tapawera', lat: -41.454, lon: 172.772 },
  { name: 'Belgrave', lat: -41.526, lon: 172.717 },
  { name: 'Bainham', lat: -40.835, lon: 172.527 },
  { name: 'Puponga', lat: -40.513, lon: 172.659 },
  { name: 'Pakawau', lat: -40.614, lon: 172.617 },
  { name: 'Parapara', lat: -40.727, lon: 172.67 },
  { name: 'Onekaka', lat: -40.81, lon: 172.692 },
  { name: 'Tata Beach', lat: -40.83, lon: 172.861 },
  { name: 'Pohara', lat: -40.851, lon: 172.851 },
  { name: 'Ligar Bay', lat: -40.841, lon: 172.839 },
  { name: 'Sandy Bay', lat: -40.875, lon: 172.852 },
  { name: 'Wainui', lat: -40.927, lon: 172.981 },
  { name: 'Torrent Bay', lat: -40.972, lon: 173.003 },
  { name: 'Bark Bay', lat: -41.005, lon: 173.01 },
  { name: 'Awaroa', lat: -40.875, lon: 173.019 },
  { name: 'Totaranui', lat: -40.83, lon: 173.01 },
  { name: 'Whanganui Inlet', lat: -40.64, lon: 172.57 },
  { name: 'Separation Point', lat: -40.778, lon: 172.985 },
  { name: 'Lake Rotoiti', lat: -41.826, lon: 172.825 },
  { name: 'Lake Rotoroa', lat: -41.833, lon: 172.648 },
  { name: 'Lewis Pass Village', lat: -42.391, lon: 172.395 },
  { name: 'Tophouse', lat: -41.826, lon: 172.748 },
  { name: 'Tawa', lat: -41.178, lon: 174.827 },
  { name: 'Grenada', lat: -41.199, lon: 174.815 },
  { name: 'Churton Park', lat: -41.225, lon: 174.789 },
  { name: 'Glenside', lat: -41.228, lon: 174.783 },
  { name: 'Newlands', lat: -41.206, lon: 174.806 },
  { name: 'Paparangi', lat: -41.207, lon: 174.791 },
  { name: 'Woodridge', lat: -41.225, lon: 174.798 },
  { name: 'Khandallah', lat: -41.24, lon: 174.79 },
  { name: 'Ngaio', lat: -41.253, lon: 174.773 },
  { name: 'Crofton Downs', lat: -41.253, lon: 174.779 },
  { name: 'Broadmeadows', lat: -41.136, lon: 174.852 },
  { name: 'Paremata', lat: -41.097, lon: 174.879 },
  { name: 'Pāuatahanui', lat: -41.067, lon: 174.921 },
  { name: 'Camborne', lat: -41.077, lon: 174.876 },
  { name: 'Plimmerton', lat: -41.081, lon: 174.854 },
  { name: 'Pukerua Bay', lat: -41.033, lon: 174.892 },
  { name: 'Paekākāriki', lat: -40.978, lon: 174.957 },
  { name: 'Raumati Beach', lat: -40.934, lon: 174.982 },
  { name: 'Raumati South', lat: -40.946, lon: 174.979 },
  { name: 'Peka Peka Beach', lat: -40.875, lon: 175.03 },
  { name: 'Te Horo', lat: -40.826, lon: 175.1 },
  { name: 'Manakau', lat: -40.778, lon: 175.161 },
  { name: 'Ōtaki Beach', lat: -40.737, lon: 175.122 },
  { name: 'Te Araroa Beach', lat: -40.741, lon: 175.118 },
  { name: 'Waikanae Beach', lat: -40.875, lon: 175.028 },
  { name: 'Peka Peka', lat: -40.862, lon: 175.04 },
  { name: 'Ōhau', lat: -40.685, lon: 175.177 },
  { name: 'Feilding Road', lat: -40.61, lon: 175.25 },
  { name: 'Foxton Beach', lat: -40.47, lon: 175.232 },
  { name: 'Hokio Beach', lat: -40.53, lon: 175.215 },
  { name: 'Ōtaki River Mouth', lat: -40.74, lon: 175.097 },
  { name: 'Paekakariki Hill', lat: -41.001, lon: 174.948 },
  { name: 'Titahi Bay', lat: -41.1, lon: 174.832 },
  { name: 'Whitby', lat: -41.071, lon: 174.908 },
  { name: 'Hobsonville', lat: -41.073, lon: 174.884 },
  { name: 'Judgeford', lat: -41.085, lon: 174.977 },
  { name: 'Riverstone Terraces', lat: -41.086, lon: 174.968 },
  { name: 'Akatarawa', lat: -41.08, lon: 175.122 },
  { name: 'Te Marua', lat: -41.107, lon: 175.083 },
  { name: 'Maymorn', lat: -41.119, lon: 175.099 },
  { name: 'Birchville', lat: -41.118, lon: 175.077 },
  { name: 'Mangaroa', lat: -41.115, lon: 175.055 },
  { name: 'Whitemans Valley', lat: -41.158, lon: 175.076 },
  { name: 'Pakuratahi', lat: -41.13, lon: 175.126 },
  { name: 'Silverstream', lat: -41.157, lon: 175.019 },
  { name: 'Pinehaven', lat: -41.143, lon: 175.025 },
  { name: 'Heretaunga', lat: -41.14, lon: 175.015 },
  { name: 'Trentham', lat: -41.133, lon: 175.038 },
  { name: 'Clouston Park', lat: -41.116, lon: 175.051 },
  { name: 'Normandale', lat: -41.2, lon: 174.951 },
  { name: 'Naenae', lat: -41.208, lon: 174.938 },
  { name: 'Stokes Valley', lat: -41.177, lon: 174.972 },
  { name: 'Wingate', lat: -41.219, lon: 174.922 },
  { name: 'Alicetown', lat: -41.22, lon: 174.902 },
  { name: 'Moera', lat: -41.221, lon: 174.912 },
  { name: 'Gracefield', lat: -41.225, lon: 174.924 },
  { name: 'Seaview', lat: -41.222, lon: 174.915 },
  { name: 'Pomare', lat: -41.193, lon: 174.934 },
  { name: 'Kelson', lat: -41.186, lon: 174.952 },
  { name: 'Belmont', lat: -41.184, lon: 174.937 },
  { name: 'Korokoro', lat: -41.21, lon: 174.874 },
  { name: 'Maungaraki', lat: -41.203, lon: 174.888 },
  { name: 'Tirohanga', lat: -41.193, lon: 174.898 },
  { name: 'Woburn', lat: -41.214, lon: 174.906 },
  { name: 'Epuni', lat: -41.218, lon: 174.92 },
  { name: 'Wainuiomata Coast', lat: -41.329, lon: 174.963 },
  { name: 'Blue Mountains', lat: -41.283, lon: 174.981 },
  { name: 'Remutaka Pass', lat: -41.134, lon: 175.193 },
  { name: 'Palliser Bay', lat: -41.531, lon: 175.315 },
  { name: 'Lake Ferry', lat: -41.396, lon: 175.148 },
  { name: 'Pirinoa', lat: -41.357, lon: 175.24 },
  { name: 'Ngawi', lat: -41.586, lon: 175.327 },
  { name: 'White Rock', lat: -41.558, lon: 175.311 },
  { name: 'Kaitoke', lat: -41.076, lon: 175.18 },
  { name: 'Ōrongorongo', lat: -41.363, lon: 174.952 },
  { name: 'Mt Victoria', lat: -41.295, lon: 174.794 },
  { name: 'Hataitai', lat: -41.305, lon: 174.793 },
  { name: 'Kilbirnie', lat: -41.317, lon: 174.798 },
  { name: 'Rongotai', lat: -41.32, lon: 174.808 },
  { name: 'Strathmore Park', lat: -41.322, lon: 174.818 },
  { name: 'Breaker Bay', lat: -41.338, lon: 174.828 },
  { name: 'Houghton Bay', lat: -41.335, lon: 174.776 },
  { name: 'Owhiro Bay', lat: -41.337, lon: 174.76 },
  { name: 'Brooklyn', lat: -41.31, lon: 174.759 },
  { name: 'Mount Cook', lat: -41.306, lon: 174.769 },
  { name: 'Aro Valley', lat: -41.295, lon: 174.765 },
  { name: 'Te Aro', lat: -41.295, lon: 174.775 },
  { name: 'Thorndon', lat: -41.274, lon: 174.775 },
  { name: 'Wadestown', lat: -41.265, lon: 174.769 },
  { name: 'Wilton', lat: -41.281, lon: 174.755 },
  { name: 'Kaiwharawhara', lat: -41.262, lon: 174.792 },
  { name: 'Ngauranga', lat: -41.245, lon: 174.804 },
  { name: 'Taupo Quay', lat: -39.94, lon: 175.037 },
  { name: 'Eketāhuna', lat: -40.649, lon: 175.712 },
  { name: 'Pahiatua', lat: -40.449, lon: 175.837 },
  { name: 'Ōrautea', lat: -40.52, lon: 175.655 },
  { name: 'Norsewood', lat: -40.087, lon: 176.215 },
  { name: 'Ormondville', lat: -40.113, lon: 176.186 },
  { name: 'Matamau', lat: -40.144, lon: 176.087 },
  { name: 'Herbertville', lat: -40.454, lon: 176.56 },
  { name: 'Pongaroa', lat: -40.538, lon: 176.184 },
  { name: 'Akitio', lat: -40.619, lon: 176.421 },
  { name: 'Weber', lat: -40.234, lon: 176.2 },
  { name: 'Alfredton', lat: -40.681, lon: 175.89 },
  { name: 'Kopuaranga', lat: -40.72, lon: 175.85 },
  { name: 'Mangatainoka', lat: -40.401, lon: 175.786 },
  { name: 'Woodville Gorge', lat: -40.364, lon: 175.925 },
  { name: 'Ballance', lat: -40.378, lon: 175.92 },
  { name: 'Ashhurst', lat: -40.29, lon: 175.757 },
  { name: 'Longburn', lat: -40.391, lon: 175.543 },
  { name: 'Bunnythorpe', lat: -40.278, lon: 175.621 },
  { name: 'Awahuri', lat: -40.283, lon: 175.555 },
  { name: 'Rongotea', lat: -40.294, lon: 175.47 },
  { name: 'Sanson', lat: -40.237, lon: 175.409 },
  { name: 'Halcombe', lat: -40.152, lon: 175.505 },
  { name: 'Kimbolton', lat: -40.05, lon: 175.786 },
  { name: 'Cheltenham', lat: -40.029, lon: 175.668 },
  { name: 'Colyton', lat: -40.036, lon: 175.604 },
  { name: 'Kairanga', lat: -40.348, lon: 175.6 },
  { name: 'Te Maunga', lat: -40.326, lon: 175.632 },
  { name: 'Himatangi', lat: -40.397, lon: 175.298 },
  { name: 'Himatangi Beach', lat: -40.389, lon: 175.26 },
  { name: 'Tangimoana', lat: -40.301, lon: 175.26 },
  { name: 'Waitarere', lat: -40.548, lon: 175.218 },
  { name: 'Waitarere Beach', lat: -40.536, lon: 175.19 },
  { name: 'Bay View', lat: -39.43, lon: 176.862 },
  { name: 'Meeanee', lat: -39.543, lon: 176.837 },
  { name: 'Clive', lat: -39.584, lon: 176.909 },
  { name: 'Haumoana', lat: -39.61, lon: 176.937 },
  { name: 'Te Awanga', lat: -39.639, lon: 176.956 },
  { name: 'Clifton', lat: -39.636, lon: 176.925 },
  { name: 'Waimarama', lat: -39.779, lon: 177.035 },
  { name: 'Ocean Beach', lat: -39.697, lon: 177.033 },
  { name: 'Pakipaki', lat: -39.7, lon: 176.764 },
  { name: 'Taradale', lat: -39.557, lon: 176.876 },
  { name: 'Onekawa', lat: -39.555, lon: 176.867 },
  { name: 'Marewa', lat: -39.524, lon: 176.896 },
  { name: 'Ahuriri', lat: -39.483, lon: 176.897 },
  { name: 'Westshore', lat: -39.479, lon: 176.877 },
  { name: 'Pandora', lat: -39.494, lon: 176.904 },
  { name: 'Maraenui', lat: -39.512, lon: 176.879 },
  { name: 'Puketapu', lat: -39.461, lon: 176.811 },
  { name: 'Dartmoor', lat: -39.454, lon: 176.779 },
  { name: 'Longlands', lat: -39.628, lon: 176.821 },
  { name: 'Mahora', lat: -39.634, lon: 176.855 },
  { name: 'Flaxmere', lat: -39.643, lon: 176.805 },
  { name: 'Whakatu', lat: -39.627, lon: 176.872 },
  { name: 'Wairoa River Mouth', lat: -39.034, lon: 177.478 },
  { name: 'Mahia Peninsula', lat: -39.131, lon: 177.88 },
  { name: 'Mahia', lat: -39.096, lon: 177.894 },
  { name: 'Nuhaka', lat: -39.049, lon: 177.758 },
  { name: 'Morere', lat: -38.906, lon: 177.66 },
  { name: 'Tutira', lat: -39.208, lon: 176.895 },
  { name: 'Tangoio', lat: -39.354, lon: 176.905 },
  { name: 'Eskdale', lat: -39.414, lon: 176.819 },
  { name: 'Esk Valley', lat: -39.387, lon: 176.793 },
  { name: 'Bayview', lat: -39.435, lon: 176.863 },
  { name: 'Patoka', lat: -39.325, lon: 176.58 },
  { name: 'Puketitiri', lat: -39.177, lon: 176.643 },
  { name: 'Waikare', lat: -39.14, lon: 176.82 },
  { name: 'Raupunga', lat: -39.017, lon: 177.391 },
  { name: 'Frasertown', lat: -38.978, lon: 177.448 },
  { name: 'Kotemaori', lat: -38.907, lon: 177.338 },
  { name: 'Whakaki', lat: -38.999, lon: 177.512 },
  { name: 'Manutuke', lat: -38.685, lon: 177.909 },
  { name: 'Ormond', lat: -38.551, lon: 177.961 },
  { name: 'Matawai', lat: -38.34, lon: 177.519 },
  { name: 'Motu', lat: -38.225, lon: 177.62 },
  { name: 'Te Karaka', lat: -38.441, lon: 177.762 },
  { name: 'Patutahi', lat: -38.625, lon: 177.855 },
  { name: 'Whatatutu', lat: -38.361, lon: 177.776 },
  { name: 'Tolaga Bay', lat: -38.368, lon: 178.308 },
  { name: 'Tokomaru Bay', lat: -38.133, lon: 178.299 },
  { name: 'Waipiro Bay', lat: -37.935, lon: 178.321 },
  { name: 'Ruatoria', lat: -37.887, lon: 178.33 },
  { name: 'Tikitiki', lat: -37.807, lon: 178.289 },
  { name: 'Te Araroa', lat: -37.632, lon: 178.37 },
  { name: 'Hicks Bay', lat: -37.574, lon: 178.296 },
  { name: 'Te Puia Springs', lat: -37.828, lon: 177.78 },
  { name: 'Matata', lat: -37.895, lon: 176.748 },
  { name: 'Oakura', lat: -39.141, lon: 173.955 },
  { name: 'Ōkato', lat: -39.189, lon: 173.861 },
  { name: 'Pungarehu', lat: -39.361, lon: 173.794 },
  { name: 'Manaia', lat: -39.552, lon: 174.128 },
  { name: 'Kaponga', lat: -39.447, lon: 174.136 },
  { name: 'Eltham Road', lat: -39.385, lon: 174.308 },
  { name: 'Midhirst', lat: -39.278, lon: 174.24 },
  { name: 'Okaiawa', lat: -39.502, lon: 174.248 },
  { name: 'Normanby', lat: -39.513, lon: 174.212 },
  { name: 'Warea', lat: -39.227, lon: 173.833 },
  { name: 'Pukearuhe', lat: -38.928, lon: 174.607 },
  { name: 'Urenui', lat: -38.989, lon: 174.406 },
  { name: 'Onaero', lat: -38.986, lon: 174.414 },
  { name: 'Mōkau', lat: -38.698, lon: 174.635 },
  { name: 'Tongaporutu', lat: -38.82, lon: 174.576 },
  { name: 'Awakino', lat: -38.642, lon: 174.657 },
  { name: 'Mahoenui', lat: -38.507, lon: 174.91 },
  { name: 'Aria', lat: -38.562, lon: 175.024 },
  { name: 'Whangamomona', lat: -39.111, lon: 174.737 },
  { name: 'Strathmore Park', lat: -39.134, lon: 174.742 },
  { name: 'Pohokura', lat: -39.196, lon: 174.725 },
  { name: 'Tariki', lat: -39.196, lon: 174.2 },
  { name: 'Tikorangi', lat: -39.029, lon: 174.175 },
  { name: 'Lepperton', lat: -39.06, lon: 174.143 },
  { name: 'Bell Block', lat: -39.028, lon: 174.124 },
  { name: 'Piopio', lat: -38.474, lon: 174.976 },
  { name: 'Benneydale', lat: -38.524, lon: 175.385 },
  { name: 'Ōtorohanga South', lat: -38.216, lon: 175.21 },
  { name: 'Kāwhia', lat: -38.072, lon: 174.815 },
  { name: 'Raglan', lat: -37.799, lon: 174.879 },
  { name: 'Port Waikato', lat: -37.393, lon: 174.741 },
  { name: 'Tuakau', lat: -37.261, lon: 174.952 },
  { name: 'Pokeno', lat: -37.247, lon: 175.017 },
  { name: 'Meremere', lat: -37.415, lon: 175.054 },
  { name: 'Mercer', lat: -37.277, lon: 175.068 },
  { name: 'Glen Murray', lat: -37.465, lon: 175.184 },
  { name: 'Ngatea', lat: -37.266, lon: 175.491 },
  { name: 'Paeroa', lat: -37.373, lon: 175.678 },
  { name: 'Waihi', lat: -37.389, lon: 175.834 },
  { name: 'Waihi Beach', lat: -37.428, lon: 175.937 },
  { name: 'Athenree', lat: -37.459, lon: 175.949 },
  { name: 'Katikati', lat: -37.55, lon: 175.924 },
  { name: 'Te Puna', lat: -37.614, lon: 176.028 },
  { name: 'Apata', lat: -37.656, lon: 176.062 },
  { name: 'Aongatete', lat: -37.583, lon: 175.97 },
  { name: 'Ōmokoroa', lat: -37.617, lon: 176.017 },
  { name: 'Pyes Pa', lat: -37.745, lon: 176.09 },
  { name: 'Matua', lat: -37.657, lon: 176.151 },
  { name: 'Ohauiti', lat: -37.738, lon: 176.13 },
  { name: 'Welcome Bay', lat: -37.716, lon: 176.196 },
  { name: 'Hairini', lat: -37.71, lon: 176.2 },
  { name: 'Greerton', lat: -37.723, lon: 176.168 },
  { name: 'Maungatapu', lat: -37.706, lon: 176.2 },
  { name: 'Bethlehem', lat: -37.664, lon: 176.099 },
  { name: 'Pāpāmoa Beach', lat: -37.716, lon: 176.333 },
  { name: 'Maketu', lat: -37.757, lon: 176.457 },
  { name: 'Te Puke Township', lat: -37.783, lon: 176.321 },
  { name: 'Paengaroa', lat: -37.829, lon: 176.459 },
  { name: 'Ōtamarākau', lat: -37.842, lon: 176.602 },
  { name: 'Matata Village', lat: -37.897, lon: 176.754 },
  { name: 'Edgecumbe', lat: -37.982, lon: 176.832 },
  { name: 'Awakeri', lat: -37.985, lon: 176.919 },
  { name: 'Waimana', lat: -38.118, lon: 177.148 },
  { name: 'Taneatua', lat: -38.048, lon: 177.002 },
  { name: 'Rūātoki', lat: -38.11, lon: 177.074 },
  { name: 'Tāneatua', lat: -38.048, lon: 177.003 },
  { name: 'Hamurana', lat: -38.03, lon: 176.183 },
  { name: 'Ōhau Channel', lat: -38.059, lon: 176.264 },
  { name: 'Mourea', lat: -38.047, lon: 176.283 },
  { name: 'Okere Falls', lat: -38.003, lon: 176.374 },
  { name: 'Rotoma', lat: -38.029, lon: 176.558 },
  { name: 'Reporoa', lat: -38.446, lon: 176.348 },
  { name: 'Waiotapu', lat: -38.358, lon: 176.363 },
  { name: 'Wairakei', lat: -38.624, lon: 176.091 },
  { name: 'Ātiamuri', lat: -38.444, lon: 176.031 },
  { name: 'Whakarewarewa', lat: -38.162, lon: 176.253 },
  { name: 'Tikitere', lat: -38.042, lon: 176.318 },
  { name: 'Kinloch', lat: -38.601, lon: 175.904 },
  { name: 'Wharewaka', lat: -38.716, lon: 176.116 },
  { name: 'Waitahanui', lat: -38.774, lon: 176.12 },
  { name: 'Ōruanui', lat: -38.561, lon: 175.997 },
  { name: 'Hatepe', lat: -38.817, lon: 175.998 },
  { name: 'Motutere', lat: -38.785, lon: 175.953 },
  { name: 'Kuratau', lat: -38.858, lon: 175.818 },
  { name: 'Omori', lat: -38.876, lon: 175.798 },
  { name: 'Tokaanu', lat: -38.97, lon: 175.777 },
  { name: 'Ātiamuri', lat: -38.444, lon: 176.031 },
  { name: 'Oruanui', lat: -38.556, lon: 176.001 },
  { name: 'Poihipi', lat: -38.598, lon: 175.958 },
  { name: 'Lake Taupō', lat: -38.75, lon: 175.97 },
  { name: 'Lake Rotoaira', lat: -39.028, lon: 175.74 },
  { name: 'National Park Village', lat: -39.184, lon: 175.388 },
  { name: 'Ohakune', lat: -39.415, lon: 175.415 },
  { name: 'Raetihi', lat: -39.432, lon: 175.282 },
  { name: 'Mangaohane', lat: -39.635, lon: 175.742 },
  { name: 'Waiouru', lat: -39.481, lon: 175.672 },
  { name: 'Karioi', lat: -39.508, lon: 175.531 },
  { name: 'Owhango', lat: -38.985, lon: 175.265 },
  { name: 'Manunui', lat: -38.892, lon: 175.319 },
  { name: 'Matatā', lat: -37.882, lon: 176.766 },
  { name: 'Thornton', lat: -37.967, lon: 176.824 },
  { name: 'Mōtū', lat: -38.225, lon: 177.619 },
  { name: 'Tāneatua Valley', lat: -38.053, lon: 177.01 },
  { name: 'Te Teko', lat: -37.993, lon: 176.87 },
  { name: 'Waimana Valley', lat: -38.107, lon: 177.162 },
  { name: 'Whanarua Bay', lat: -37.799, lon: 177.54 },
  { name: 'Ōhiwa', lat: -38.001, lon: 177.148 },
  { name: 'Kutarere', lat: -37.968, lon: 177.106 },
  { name: 'Waiotahe', lat: -37.951, lon: 177.153 },
  { name: 'Ōhiwa Harbour', lat: -38.0, lon: 177.136 },
  { name: 'Matarangi', lat: -36.731, lon: 175.617 },
  { name: 'Kuaotunu', lat: -36.776, lon: 175.634 },
  { name: 'Opito Bay', lat: -36.778, lon: 175.751 },
  { name: 'Ōpito', lat: -36.778, lon: 175.751 },
  { name: 'Cooks Beach', lat: -36.849, lon: 175.749 },
  { name: 'Ferry Landing', lat: -36.841, lon: 175.72 },
  { name: 'Whenuakite', lat: -36.888, lon: 175.801 },
  { name: 'Pāuanui', lat: -37.017, lon: 175.873 },
  { name: 'Ōhinemuri', lat: -37.105, lon: 175.562 },
  { name: 'Kopu', lat: -37.171, lon: 175.535 },
  { name: 'Tapu', lat: -37.012, lon: 175.457 },
  { name: 'Coroglen', lat: -36.874, lon: 175.694 },
  { name: 'Hikuai', lat: -37.018, lon: 175.809 },
  { name: 'Whiritoa', lat: -37.256, lon: 175.91 },
  { name: 'Whangapoua', lat: -36.696, lon: 175.534 },
  { name: 'Colville', lat: -36.62, lon: 175.428 },
  { name: 'Port Jackson', lat: -36.551, lon: 175.36 },
  { name: 'Stony Bay', lat: -36.561, lon: 175.452 },
  { name: 'Kennedy Bay', lat: -36.787, lon: 175.401 },
  { name: 'Helensville', lat: -36.672, lon: 174.457 },
  { name: 'Kaukapakapa', lat: -36.614, lon: 174.509 },
  { name: 'Kumeū', lat: -36.779, lon: 174.562 },
  { name: 'Huapai', lat: -36.791, lon: 174.571 },
  { name: 'Taupaki', lat: -36.829, lon: 174.546 },
  { name: 'Muriwai', lat: -36.818, lon: 174.452 },
  { name: 'Bethells Beach', lat: -36.852, lon: 174.444 },
  { name: 'Piha', lat: -36.956, lon: 174.468 },
  { name: 'Karekare', lat: -36.976, lon: 174.461 },
  { name: 'Huia', lat: -37.02, lon: 174.551 },
  { name: 'Titirangi', lat: -36.944, lon: 174.629 },
  { name: 'New Lynn', lat: -36.908, lon: 174.686 },
  { name: 'Glen Eden', lat: -36.919, lon: 174.647 },
  { name: 'Swanson', lat: -36.887, lon: 174.587 },
  { name: 'Massey', lat: -36.869, lon: 174.618 },
  { name: 'Te Atatū', lat: -36.859, lon: 174.66 },
  { name: 'Hobsonville', lat: -36.802, lon: 174.665 },
  { name: 'West Harbour', lat: -36.815, lon: 174.643 },
  { name: 'Whenuapai', lat: -36.788, lon: 174.631 },
  { name: 'Paremoremo', lat: -36.74, lon: 174.641 },
  { name: 'Ōrewa', lat: -36.593, lon: 174.693 },
  { name: 'Stanmore Bay', lat: -36.64, lon: 174.68 },
  { name: 'Whangaparāoa', lat: -36.628, lon: 174.703 },
  { name: 'Gulf Harbour', lat: -36.627, lon: 174.741 },
  { name: 'Arkles Bay', lat: -36.637, lon: 174.71 },
  { name: 'Red Beach', lat: -36.61, lon: 174.681 },
  { name: 'Hatfields Beach', lat: -36.572, lon: 174.697 },
  { name: 'Ōrewa River', lat: -36.597, lon: 174.697 },
  { name: 'Algies Bay', lat: -36.456, lon: 174.674 },
  { name: 'Mahurangi', lat: -36.443, lon: 174.694 },
  { name: 'Sandspit', lat: -36.405, lon: 174.731 },
  { name: 'Snells Beach', lat: -36.432, lon: 174.71 },
  { name: 'Omaha', lat: -36.334, lon: 174.741 },
  { name: 'Matakana', lat: -36.358, lon: 174.713 },
  { name: 'Leigh', lat: -36.283, lon: 174.798 },
  { name: 'Goat Island', lat: -36.272, lon: 174.795 },
  { name: 'Pakiri', lat: -36.253, lon: 174.737 },
  { name: 'Mangawhai', lat: -36.129, lon: 174.59 },
  { name: 'Mangawhai Heads', lat: -36.094, lon: 174.621 },
  { name: 'Kaiwaka', lat: -36.162, lon: 174.434 },
  { name: 'Maungaturoto', lat: -36.103, lon: 174.376 },
  { name: 'Ruakaka', lat: -35.917, lon: 174.461 },
  { name: 'One Tree Point', lat: -35.894, lon: 174.493 },
  { name: 'Marsden Point', lat: -35.847, lon: 174.466 },
  { name: 'Bream Bay', lat: -35.935, lon: 174.466 },
  { name: 'Langs Beach', lat: -36.054, lon: 174.542 },
  { name: 'Waipu', lat: -36.001, lon: 174.478 },
  { name: 'Waipu Cove', lat: -36.041, lon: 174.537 },
  { name: 'Reotahi', lat: -35.78, lon: 174.36 },
  { name: 'Parua Bay', lat: -35.783, lon: 174.377 },
  { name: 'Ngunguru', lat: -35.636, lon: 174.498 },
  { name: 'Tutukaka', lat: -35.618, lon: 174.546 },
  { name: 'Matapouri', lat: -35.597, lon: 174.575 },
  { name: 'Sandy Bay', lat: -35.584, lon: 174.558 },
  { name: 'Woolley\'s Bay', lat: -35.588, lon: 174.562 },
  { name: 'Hikurangi', lat: -35.614, lon: 174.297 },
  { name: 'Poroti', lat: -35.681, lon: 174.251 },
  { name: 'Maungakaramea', lat: -35.747, lon: 174.28 },
  { name: 'Otaika', lat: -35.768, lon: 174.29 },
  { name: 'Onerahi', lat: -35.768, lon: 174.368 },
  { name: 'Tirau', lat: -37.98, lon: 175.75 },
  { name: 'Lichfield', lat: -38.0, lon: 175.66 },
  { name: 'Pukeatua', lat: -37.945, lon: 175.678 },
  { name: 'Maungaturoto', lat: -36.103, lon: 174.376 },
  { name: 'Ruawai', lat: -36.136, lon: 173.959 },
  { name: 'Paparoa', lat: -36.126, lon: 174.227 },
  { name: 'Matakohe', lat: -36.089, lon: 174.201 },
  { name: 'Pahi', lat: -36.081, lon: 174.173 },
  { name: 'Tinopai', lat: -36.06, lon: 174.027 },
  { name: 'Pōuto', lat: -36.193, lon: 174.005 },
  { name: 'Aranga', lat: -35.894, lon: 173.752 },
  { name: 'Mākā', lat: -35.893, lon: 173.823 },
  { name: 'Te Kōpuru', lat: -35.954, lon: 173.891 },
  { name: 'Awakino Point', lat: -35.952, lon: 174.011 },
  { name: 'Whangārei Heads', lat: -35.836, lon: 174.54 },
  { name: 'Pataua', lat: -35.71, lon: 174.498 },
  { name: 'Bland Bay', lat: -35.528, lon: 174.553 },
  { name: 'Tūtūkākā Coast', lat: -35.618, lon: 174.546 },
  { name: 'Oakura Bay', lat: -35.295, lon: 174.218 },
  { name: 'Whananaki', lat: -35.511, lon: 174.461 },
  { name: 'Helena Bay', lat: -35.377, lon: 174.401 },
  { name: 'Mimiwhangata', lat: -35.432, lon: 174.412 },
  { name: 'Ngunguru Valley', lat: -35.65, lon: 174.479 },
  { name: 'Ōtāmure', lat: -35.648, lon: 174.483 },
  { name: 'Whangarei Falls', lat: -35.691, lon: 174.338 },
  { name: 'Glenbervie', lat: -35.664, lon: 174.285 },
  { name: 'Mangakahia', lat: -35.82, lon: 173.949 },
  { name: 'Tangowahine', lat: -35.837, lon: 173.82 },
  { name: 'Maungatapere', lat: -35.739, lon: 174.16 },
  { name: 'Maungatūroto', lat: -36.103, lon: 174.375 },
  { name: 'Arapohue', lat: -35.972, lon: 173.984 },
  { name: 'Ōtāhuhu Heights', lat: -36.082, lon: 174.053 },
  { name: 'Wāipu Gorge', lat: -35.965, lon: 174.397 },
  { name: 'Mangapai', lat: -35.803, lon: 174.291 },
  { name: 'Waiotira', lat: -35.83, lon: 174.154 },
  { name: 'Titoki', lat: -35.899, lon: 174.14 },
  { name: 'Ruaroa', lat: -35.852, lon: 173.849 },
  { name: 'Tūtūkaka', lat: -35.618, lon: 174.546 },
  { name: 'Matarau', lat: -35.854, lon: 174.026 },
  { name: 'Māngakāhia', lat: -35.817, lon: 173.949 },
  { name: 'Pipiwai', lat: -35.784, lon: 174.045 },
  { name: 'Whiria', lat: -35.702, lon: 173.928 },
  { name: 'Ōtātāra', lat: -35.669, lon: 173.851 },
  { name: 'Kaikohe', lat: -35.406, lon: 173.796 },
  { name: 'Ōkaihau', lat: -35.33, lon: 173.778 },
  { name: 'Horeke', lat: -35.3, lon: 173.598 },
  { name: 'Ōmāpere', lat: -35.529, lon: 173.44 },
  { name: 'Ōpononi', lat: -35.51, lon: 173.421 },
  { name: 'Rawene', lat: -35.391, lon: 173.502 },
  { name: 'Kohukohu', lat: -35.361, lon: 173.512 },
  { name: 'Broadwood', lat: -35.36, lon: 173.449 },
  { name: 'Herekino', lat: -35.261, lon: 173.269 },
  { name: 'Awaroa', lat: -35.132, lon: 173.275 },
  { name: 'Takahue', lat: -35.206, lon: 173.493 },
  { name: 'Whangaroa Harbour', lat: -34.99, lon: 173.74 },
  { name: 'Totara North', lat: -34.97, lon: 173.695 },
  { name: 'Kaeo', lat: -35.103, lon: 173.78 },
  { name: 'Matauri Bay', lat: -35.017, lon: 173.828 },
  { name: 'Tauranga Bay', lat: -35.017, lon: 173.861 },
  { name: 'Ōtaua', lat: -35.053, lon: 173.853 },
  { name: 'Cable Bay', lat: -35.192, lon: 173.937 },
  { name: 'Coopers Beach', lat: -35.012, lon: 173.533 },
  { name: 'Taipa', lat: -35.014, lon: 173.555 },
  { name: 'Cable Bay', lat: -35.192, lon: 173.935 },
  { name: 'Ahipara', lat: -35.165, lon: 173.158 },
  { name: 'Houhora', lat: -34.818, lon: 173.144 },
  { name: 'Ngataki', lat: -34.743, lon: 173.033 },
  { name: 'Pukenui', lat: -34.819, lon: 173.135 },
  { name: 'Te Hapua', lat: -34.551, lon: 172.988 },
  { name: 'Spirits Bay', lat: -34.44, lon: 172.951 },
  { name: 'Tūtūkākā', lat: -35.618, lon: 174.546 },
  { name: 'Lake Taupo', lat: -38.75, lon: 175.97 },
  { name: 'Lake Rotorua', lat: -38.085, lon: 176.267 },
  { name: 'Lake Rotoiti', lat: -38.028, lon: 176.43 },
  { name: 'Lake Rotoehu', lat: -37.993, lon: 176.52 },
  { name: 'Lake Rotomā', lat: -38.019, lon: 176.557 },
  { name: 'Lake Ōkāreka', lat: -38.134, lon: 176.272 },
  { name: 'Lake Ōkataina', lat: -38.123, lon: 176.414 },
  { name: 'Lake Tarawera', lat: -38.228, lon: 176.432 },
  { name: 'Lake Rotomahana', lat: -38.268, lon: 176.367 },
  { name: 'Lake Ōhakuri', lat: -38.427, lon: 176.094 },
  { name: 'Lake Ātiamuri', lat: -38.432, lon: 176.023 },
  { name: 'Lake Maraetai', lat: -38.466, lon: 176.22 },
  { name: 'Lake Whakamaru', lat: -38.438, lon: 175.857 },
  { name: 'Lake Waipapa', lat: -38.544, lon: 175.809 },
  { name: 'Lake Arapuni', lat: -37.991, lon: 175.606 },
  { name: 'Lake Karapiro', lat: -37.937, lon: 175.553 },
  { name: 'Lake Waikare', lat: -37.45, lon: 175.185 },
  { name: 'Lake Waikato', lat: -37.412, lon: 175.155 },
  { name: 'Lake Mahinapua', lat: -42.752, lon: 170.913 },
  { name: 'Lake Kaniere', lat: -42.723, lon: 171.144 },
  { name: 'Lake Ianthe', lat: -43.025, lon: 170.575 },
  { name: 'Lake Mapourika', lat: -43.283, lon: 170.216 },
  { name: 'Lake Paringa', lat: -43.706, lon: 169.344 },
  { name: 'Lake Moeraki', lat: -43.734, lon: 169.226 },
  { name: 'Lake Hāwea', lat: -44.511, lon: 169.276 },
  { name: 'Lake Ōhau', lat: -44.261, lon: 169.869 },
  { name: 'Lake Pūkaki', lat: -44.174, lon: 170.158 },
  { name: 'Lake Ōpua', lat: -44.131, lon: 170.444 },
  { name: 'Lake Alexandrina', lat: -43.931, lon: 170.57 },
  { name: 'Lake McGregor', lat: -43.937, lon: 170.53 },
  { name: 'Lake Benmore', lat: -44.391, lon: 170.142 },
  { name: 'Lake Aviemore', lat: -44.619, lon: 170.226 },
  { name: 'Lake Waitaki', lat: -44.734, lon: 170.58 },
  { name: 'Lake Roxburgh', lat: -45.423, lon: 169.422 },
  { name: 'Lake Onslow', lat: -45.748, lon: 169.678 },
  { name: 'Lake Waihola', lat: -46.011, lon: 170.093 },
  { name: 'Lake Tuakitoto', lat: -46.157, lon: 169.78 },
  { name: 'Lake Ellesmere', lat: -43.757, lon: 172.416 },
  { name: 'Lake Forsyth', lat: -43.765, lon: 172.73 },
  { name: 'Lake Taylor', lat: -42.597, lon: 171.837 },
  { name: 'Lake Pearson', lat: -43.145, lon: 171.69 },
  { name: 'Lake Lyndon', lat: -43.3, lon: 171.65 },
  { name: 'Lake Selfe', lat: -43.334, lon: 171.6 },
  { name: 'Lake Coleridge', lat: -43.362, lon: 171.543 },
  { name: 'Lake Ida', lat: -43.405, lon: 171.438 },
  { name: 'Lake Heron', lat: -43.506, lon: 171.162 },
  { name: 'Lake Stream', lat: -43.489, lon: 171.132 },
  { name: 'Lake Clearwater', lat: -43.551, lon: 171.054 },
  { name: 'Lake Āmuri', lat: -42.514, lon: 172.86 },
  { name: 'Lake Grassmere', lat: -41.726, lon: 174.095 },
  { name: 'Lake Waikareiti', lat: -38.735, lon: 177.133 },
  { name: 'Lake Waikaremoana', lat: -38.756, lon: 177.068 },
  { name: 'Lake Tutira', lat: -39.208, lon: 176.895 },
  { name: 'Lake Ngaroto', lat: -37.986, lon: 175.307 },
  { name: 'Lake Waikato', lat: -37.412, lon: 175.155 },
  { name: 'Lake Rotokawau', lat: -35.231, lon: 173.982 },
  { name: 'Lake Ōmāpere', lat: -35.536, lon: 173.719 },
  { name: 'Waihora', lat: -43.757, lon: 172.416 },
  { name: 'Kaikōura Ranges', lat: -42.35, lon: 173.3 },
  { name: 'Seaward Kaikōura Range', lat: -42.294, lon: 173.583 },
  { name: 'Inland Kaikōura Range', lat: -42.185, lon: 173.261 },
  { name: 'Spencer Mountains', lat: -42.1, lon: 172.4 },
  { name: 'St Arnaud Range', lat: -41.9, lon: 172.85 },
  { name: 'Richmond Range', lat: -41.5, lon: 173.2 },
  { name: 'Bryant Range', lat: -41.6, lon: 173.05 },
  { name: 'Wairau Hills', lat: -41.7, lon: 173.5 },
  { name: 'Raglan Range', lat: -42.8, lon: 171.6 },
  { name: 'Victoria Range', lat: -42.2, lon: 171.6 },
  { name: 'Paparoa Range', lat: -42.0, lon: 171.43 },
  { name: 'Southern Alps', lat: -43.5, lon: 170.8 },
  { name: 'Two Thumb Range', lat: -43.78, lon: 170.65 },
  { name: 'Liebig Range', lat: -43.4, lon: 170.27 },
  { name: 'Malte Brun Range', lat: -43.64, lon: 170.25 },
  { name: 'Ben Ohau Range', lat: -44.12, lon: 169.88 },
  { name: 'Hāwkdun Range', lat: -45.02, lon: 170.0 },
  { name: 'Rock and Pillar Range', lat: -45.419, lon: 170.179 },
  { name: 'Lammermoor Range', lat: -45.48, lon: 170.42 },
  { name: 'Lammerlaw Range', lat: -45.643, lon: 170.13 },
  { name: 'Umbrella Mountains', lat: -45.582, lon: 169.126 },
  { name: 'Garvie Mountains', lat: -45.435, lon: 168.738 },
  { name: 'Hector Mountains', lat: -44.885, lon: 168.515 },
  { name: 'Richardson Mountains', lat: -44.66, lon: 168.13 },
  { name: 'Thomson Mountains', lat: -45.321, lon: 167.77 },
  { name: 'Takitimu Mountains', lat: -45.843, lon: 168.157 },
  { name: 'Longwood Range', lat: -46.178, lon: 168.047 },
  { name: 'Tararua Range', lat: -40.71, lon: 175.41 },
  { name: 'Rimutaka Range', lat: -41.175, lon: 175.218 },
  { name: 'Ruahine Range', lat: -39.95, lon: 176.2 },
  { name: 'Kaweka Range', lat: -39.355, lon: 176.6 },
  { name: 'Ahimanawa Range', lat: -39.13, lon: 176.71 },
  { name: 'Huiarau Range', lat: -38.53, lon: 177.2 },
  { name: 'Raukūmara Range', lat: -37.8, lon: 177.8 },
  { name: 'Kaimanawa Range', lat: -39.05, lon: 175.9 },
  { name: 'Hauhangaroa Range', lat: -38.7, lon: 175.48 },
  { name: 'Hauhungaroa Range', lat: -38.697, lon: 175.479 },
  { name: 'Mamaku Plateau', lat: -38.09, lon: 176.075 },
  { name: 'Urewera', lat: -38.59, lon: 177.05 },
  { name: 'Coromandel Range', lat: -36.95, lon: 175.56 },
  { name: 'Hunua Ranges', lat: -37.1, lon: 175.09 },
  { name: 'Waitākere Ranges', lat: -36.94, lon: 174.51 },
  { name: 'Brynderwyn Hills', lat: -36.133, lon: 174.413 },
  { name: 'Tutamoe Range', lat: -35.65, lon: 173.6 },
  { name: 'Maungataniwha Range', lat: -35.463, lon: 173.617 },
  { name: 'Manaia', lat: -36.105, lon: 174.135 },
  { name: 'Tokatoka', lat: -36.05, lon: 174.026 },
  { name: 'Nelson Lakes Range', lat: -41.825, lon: 172.83 },
  { name: 'Clarence River Valley', lat: -42.0, lon: 173.5 },
  { name: 'Waimakariri Gorge', lat: -43.16, lon: 172.0 },
  { name: 'Rangitata Gorge', lat: -43.748, lon: 171.028 },
  { name: 'Waitaki Valley', lat: -44.8, lon: 170.35 },
  { name: 'Pelorus Sound', lat: -41.086, lon: 173.894 },
  { name: 'Kenepuru Sound', lat: -41.115, lon: 173.878 },
  { name: 'Endeavour Inlet', lat: -41.235, lon: 174.134 },
  { name: 'Tory Channel', lat: -41.236, lon: 174.115 },
  { name: 'Akaroa Harbour', lat: -43.803, lon: 172.969 },
  { name: 'Lyttelton Harbour', lat: -43.617, lon: 172.73 },
  { name: 'Whanganui Inlet', lat: -40.64, lon: 172.57 },
  { name: 'Tasman Bay', lat: -41.1, lon: 173.3 },
  { name: 'Golden Bay', lat: -40.75, lon: 172.75 },
  { name: 'Westland Petrel Colony', lat: -42.553, lon: 171.077 },
  { name: 'Lake Ellesmere', lat: -43.757, lon: 172.416 },
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