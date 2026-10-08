// Where the CMEs heading for Earth are now, for the STEREO J-plot panel.
//
// The CMEs are the ones the CME Visualization has reaching Earth
// (utils/cmeEarthArrivals), and each front is where the scene draws it: the
// same propagation (utils/cmePropagation) from the same launch time and
// speed. So the J-plot's Sun-Earth guide, the 3D scene and the 3-day forecast
// all agree on where a CME is and when it gets here.
//
// Also when each front is inside each imager's range, which is when to look
// for it as a track on that J-plot.

import { cmeDistanceAU, cmeSpeedAt, cmeTransitSeconds } from './cmePropagation';
import { CME_EASE_MS, CME_FULL_MS, type CmeEarthArrival } from './cmeEarthArrivals';

/** An imager's range along the Sun-Earth line, AU from the Sun. */
export interface FovRange {
  key: string;
  startAu: number;
  endAu: number;
}

export interface JplotCmeView {
  key: string;
  /** When the front reaches the start and the end of the range; null if not inside a fortnight. */
  enterMs: number | null;
  leaveMs: number | null;
  inViewNow: boolean;
}

export interface JplotCme {
  id: string;
  launchMs: number;
  arrivalMs: number;
  /** Speed at launch and now, km/s. */
  launchSpeedKms: number;
  speedNowKms: number;
  /** The front, AU from the Sun. */
  distanceAu: number;
  /** How far through its trip to Earth, by time: 0 at launch, 1 on arrival. */
  progress: number;
  arrived: boolean;
  views: JplotCmeView[];
}

/** How long a CME stays on the guide after it arrives: while the scene's storm from it lasts. */
export const JPLOT_KEEP_AFTER_ARRIVAL_MS = CME_FULL_MS + CME_EASE_MS;

/** The CMEs on their way, or arrived within the storm's length, soonest arrival first. */
export function jplotCmes(arrivals: CmeEarthArrival[], nowMs: number, fovs: FovRange[]): JplotCme[] {
  return arrivals
    .filter((a) => a.launchMs <= nowMs && nowMs <= a.arrivalMs + JPLOT_KEEP_AFTER_ARRIVAL_MS)
    .map((a) => {
      const sec = (nowMs - a.launchMs) / 1000;
      const reaches = (au: number): number | null => {
        const s = cmeTransitSeconds(a.speedKms, au);
        return s == null ? null : a.launchMs + s * 1000;
      };
      const trip = a.arrivalMs - a.launchMs;
      return {
        id: a.id,
        launchMs: a.launchMs,
        arrivalMs: a.arrivalMs,
        launchSpeedKms: a.speedKms,
        speedNowKms: cmeSpeedAt(a.speedKms, sec),
        distanceAu: cmeDistanceAU(a.speedKms, sec),
        progress: trip > 0 ? Math.max(0, Math.min(1, (nowMs - a.launchMs) / trip)) : 1,
        arrived: nowMs >= a.arrivalMs,
        views: fovs.map((f) => {
          const enterMs = reaches(f.startAu), leaveMs = reaches(f.endAu);
          return {
            key: f.key, enterMs, leaveMs,
            inViewNow: enterMs != null && enterMs <= nowMs && (leaveMs == null || nowMs < leaveMs),
          };
        }),
      };
    })
    .sort((x, y) => x.arrivalMs - y.arrivalMs);
}
