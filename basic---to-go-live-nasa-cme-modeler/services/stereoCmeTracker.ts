import { CMEAnalysis, CMEData } from '../types';

const DONKI_PROXY_BASE_URL = 'https://nasa-donki-api.thenamesrock.workers.dev';
const STEREO_WHERE_URL = 'https://stereo-ssc.nascom.nasa.gov/where.shtml';
const SOLAR_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;
const TIME21_5_AU = (21.5 * SOLAR_RADIUS_KM) / AU_KM;

export type TrackerStatus = 'No active CME' | 'Possible Earth-relevant CME' | 'Strong Earth-relevant CME' | 'Data unavailable';
export type TrackerConfidence = 'none' | 'low' | 'medium' | 'high';

export interface StereoPosition {
  distanceAu: number | null;
  longitudeDeg: number | null;
  separationDeg: number | null;
  updatedAt: string | null;
  source: string;
}

export interface EstimatedFront {
  distanceAu: number;
  rawDistanceAu: number;
  elapsedHours: number;
  label: string;
}

export interface TrackerCmeCandidate {
  id: string;
  startTime: string;
  sourceLocation: string | null;
  link: string | null;
  analysis: CMEAnalysis | null;
  speed: number | null;
  halfAngle: number | null;
  longitude: number | null;
  latitude: number | null;
  time21_5: string | null;
  arrivalTime: string | null;
  arrivalWindowHours: number | null;
  score: number;
  confidence: TrackerConfidence;
  status: TrackerStatus;
  reasons: string[];
  front: EstimatedFront | null;
  linkedEvents: string[];
}

export interface StereoTrackerData {
  stereo: StereoPosition | null;
  stereoError: string | null;
  cme: TrackerCmeCandidate | null;
  cmeError: string | null;
  status: TrackerStatus;
  updatedAt: string;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const proxiedTextUrl = (target: string): string => `/api/proxy/text?url=${encodeURIComponent(target)}&ttl=300`;

const extractNumber = (text: string, patterns: RegExp[]): number | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1].replace(/[,+]/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
};

const cleanHtmlText = (html: string): string => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<\/tr>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&deg;/g, '°')
  .replace(/&minus;/g, '-')
  .replace(/&#8722;/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const parseStereoPosition = (html: string): StereoPosition => {
  const text = cleanHtmlText(html);
  const aheadIndex = text.search(/STEREO\s*-?\s*A|Ahead|AHEAD/i);
  const aheadText = aheadIndex >= 0 ? text.slice(Math.max(0, aheadIndex - 250), aheadIndex + 1200) : text;

  const distanceAu = extractNumber(aheadText, [
    /(?:STEREO\s*-?\s*A|Ahead|AHEAD)[^\n]{0,220}?(?:radius|distance|heliocentric)[^\d-]{0,40}(-?\d+(?:\.\d+)?)\s*AU/i,
    /(?:R|Radius|Distance)\s*=\s*(-?\d+(?:\.\d+)?)\s*AU/i,
    /(-?\d+(?:\.\d+)?)\s*AU/i,
  ]);

  const longitudeDeg = extractNumber(aheadText, [
    /(?:HEE|ecliptic|heliographic|longitude|lon)[^\d-]{0,40}(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)/i,
    /(?:Lon|Longitude)\s*=\s*(-?\d+(?:\.\d+)?)/i,
  ]);

  const separationDeg = extractNumber(aheadText, [
    /(?:separation|sep\.?)[^\d-]{0,40}(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)/i,
    /(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)\s*(?:ahead|from Earth|separation)/i,
  ]);

  const updatedAtMatch = text.match(/(?:Updated|Generated|Last\s+update)[^\d]{0,30}([A-Z][a-z]{2,9}\s+\d{1,2},?\s+\d{4}[^\n<]{0,40}|\d{4}[-/]\d{2}[-/]\d{2}[^\n<]{0,30})/i);

  return {
    distanceAu: distanceAu && distanceAu > 0 && distanceAu < 2 ? distanceAu : null,
    longitudeDeg: longitudeDeg != null ? longitudeDeg : separationDeg,
    separationDeg,
    updatedAt: updatedAtMatch?.[1]?.trim() ?? null,
    source: STEREO_WHERE_URL,
  };
};

const hasStereoPositionFields = (position: StereoPosition): boolean => (
  position.distanceAu != null || position.longitudeDeg != null || position.separationDeg != null
);

export const fetchStereoPosition = async (): Promise<StereoPosition> => {
  const fetchAndParse = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`STEREO position unavailable (${response.status})`);
    return parseStereoPosition(await response.text());
  };

  try {
    const proxied = await fetchAndParse(proxiedTextUrl(STEREO_WHERE_URL));
    if (hasStereoPositionFields(proxied)) return proxied;
  } catch (error) {
    console.warn('STEREO-A position proxy failed:', error);
  }

  const direct = await fetchAndParse(STEREO_WHERE_URL);
  if (!hasStereoPositionFields(direct)) {
    throw new Error('STEREO-A position could not be parsed');
  }
  return direct;
};

const parseArrivalFromLinkedEvent = (activityID: string): string | null => {
  const match = activityID.match(/(\d{8})T(\d{4}).*-(?:GST|IPS|MPC)/);
  if (!match) return null;
  const [, date, time] = match;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`;
};

const getBestAnalysis = (cme: CMEData): CMEAnalysis | null => {
  if (!cme.cmeAnalyses?.length) return null;
  return cme.cmeAnalyses.find((analysis) => analysis.isMostAccurate) ?? cme.cmeAnalyses[0];
};

const findEnlilArrival = (analysis: CMEAnalysis | null): { arrivalTime: string | null; durationHours: number | null; isEarth: boolean } => {
  const enlilList = Array.isArray(analysis?.enlilList) ? analysis?.enlilList ?? [] : [];
  const earthRun = enlilList.find((run: any) => run?.isEarthGB || run?.estimatedShockArrivalTime || run?.cmeIDs?.length);
  return {
    arrivalTime: earthRun?.estimatedShockArrivalTime ?? null,
    durationHours: isFiniteNumber(earthRun?.estimatedDuration) ? earthRun.estimatedDuration : null,
    isEarth: Boolean(earthRun?.isEarthGB || earthRun?.estimatedShockArrivalTime),
  };
};

const sourceNearDiskCenter = (sourceLocation?: string | null): boolean => {
  if (!sourceLocation) return false;
  const match = sourceLocation.match(/[NS](\d{1,2})[EW](\d{1,2})/i);
  if (!match) return false;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return lat <= 35 && lon <= 45;
};

const estimateFrontDistance = (analysis: CMEAnalysis | null): EstimatedFront | null => {
  if (!analysis?.time21_5 || !isFiniteNumber(analysis.speed) || analysis.speed <= 0) return null;
  const startMs = new Date(analysis.time21_5).getTime();
  if (!Number.isFinite(startMs)) return null;
  const elapsedSeconds = (Date.now() - startMs) / 1000;
  if (elapsedSeconds < 0) return null;
  const rawDistanceAu = TIME21_5_AU + (analysis.speed * elapsedSeconds) / AU_KM;
  const distanceAu = Math.min(1.2, Math.max(0, rawDistanceAu));
  return {
    distanceAu,
    rawDistanceAu,
    elapsedHours: elapsedSeconds / 3600,
    label: `${distanceAu.toFixed(2)} AU rough ballistic estimate`,
  };
};

const scoreCme = (cme: CMEData): TrackerCmeCandidate => {
  const analysis = getBestAnalysis(cme);
  const enlil = findEnlilArrival(analysis);
  const linkedEvents = cme.linkedEvents?.map((event) => event.activityID).filter(Boolean) ?? [];
  const arrivalFromLinkedEvent = linkedEvents.map(parseArrivalFromLinkedEvent).find(Boolean) ?? null;
  const speed = isFiniteNumber(analysis?.speed) ? analysis!.speed : null;
  const halfAngle = isFiniteNumber(analysis?.halfAngle) ? analysis!.halfAngle : null;
  const longitude = isFiniteNumber(analysis?.longitude) ? analysis!.longitude : null;
  const latitude = isFiniteNumber(analysis?.latitude) ? analysis!.latitude : null;
  const reasons: string[] = [];
  let score = 0;

  if (enlil.isEarth || arrivalFromLinkedEvent) { score += 45; reasons.push('DONKI/ENLIL or linked events suggest Earth relevance.'); }
  if (longitude != null && Math.abs(longitude) <= 35) { score += 25; reasons.push('CME longitude is close to the Sun–Earth line.'); }
  else if (longitude != null && Math.abs(longitude) <= 60) { score += 12; reasons.push('CME longitude is moderately near Earth-facing longitudes.'); }
  if (halfAngle != null && halfAngle >= 60) { score += 20; reasons.push('Wide or halo-like CME geometry.'); }
  else if (halfAngle != null && halfAngle >= 35) { score += 10; reasons.push('Moderately wide CME.'); }
  if (speed != null && speed >= 1000) { score += 20; reasons.push('Fast CME speed.'); }
  else if (speed != null && speed >= 600) { score += 10; reasons.push('Moderately fast CME speed.'); }
  if (sourceNearDiskCenter(cme.sourceLocation)) { score += 12; reasons.push('Source location is near disk centre.'); }
  if (analysis) { score += 8; reasons.push('DONKI CMEAnalysis has direction/speed data.'); }
  if (linkedEvents.length > 0) { score += 5; reasons.push('DONKI links this CME to other space-weather events.'); }

  const confidence: TrackerConfidence = score >= 80 ? 'high' : score >= 55 ? 'medium' : score >= 25 ? 'low' : 'none';
  const status: TrackerStatus = score >= 80 ? 'Strong Earth-relevant CME' : score >= 25 ? 'Possible Earth-relevant CME' : 'No active CME';

  return {
    id: cme.activityID,
    startTime: cme.startTime,
    sourceLocation: cme.sourceLocation || null,
    link: cme.link || null,
    analysis,
    speed,
    halfAngle,
    longitude,
    latitude,
    time21_5: analysis?.time21_5 ?? null,
    arrivalTime: enlil.arrivalTime ?? arrivalFromLinkedEvent,
    arrivalWindowHours: enlil.durationHours,
    score,
    confidence,
    status,
    reasons: reasons.length ? reasons : ['No strong Earth-relevance signals found in the recent DONKI record.'],
    front: estimateFrontDistance(analysis),
    linkedEvents,
  };
};

export const fetchRecentDonkiCmeCandidate = async (days = 7): Promise<TrackerCmeCandidate | null> => {
  const response = await fetch(`${DONKI_PROXY_BASE_URL}/CME`);
  if (!response.ok) throw new Error(`DONKI CME unavailable (${response.status})`);
  const data: CMEData[] = await response.json();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = data.filter((cme) => {
    const start = new Date(cme.startTime).getTime();
    return Number.isFinite(start) && start >= cutoff;
  });
  const ranked = recent.map(scoreCme).sort((a, b) => b.score - a.score || new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const best = ranked[0] ?? null;
  return best && best.score >= 25 ? best : null;
};

export const fetchStereoTrackerData = async (): Promise<StereoTrackerData> => {
  const [stereoResult, cmeResult] = await Promise.allSettled([
    fetchStereoPosition(),
    fetchRecentDonkiCmeCandidate(7),
  ]);

  const stereo = stereoResult.status === 'fulfilled' ? stereoResult.value : null;
  const cme = cmeResult.status === 'fulfilled' ? cmeResult.value : null;
  const cmeError = cmeResult.status === 'rejected' ? (cmeResult.reason as Error).message : null;
  const stereoError = stereoResult.status === 'rejected' ? (stereoResult.reason as Error).message : null;

  return {
    stereo,
    stereoError,
    cme,
    cmeError,
    status: cmeError ? 'Data unavailable' : cme?.status ?? 'No active CME',
    updatedAt: new Date().toISOString(),
  };
};
