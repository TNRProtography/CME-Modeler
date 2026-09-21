/**
 * Entry point for the forecast worker.
 *
 * The physics is imported from the app's own modules rather than reimplemented
 * here. That is the whole reason those modules are plain functions with no
 * browser dependencies: one copy of the drag model, one coupling function, one
 * definition of which coronal holes can reach Earth. A second copy living in a
 * worker is a second thing to drift, and drift between a server forecast and
 * the same forecast drawn on a phone is exactly the bug nobody can reproduce.
 */

import { buildForecastTimeline } from '../utils/forecastTimeline';
import { chEarthConnection } from '../utils/coronalHoleDynamics';
import { hssArrivalEnsemble, measurementConfidence } from '../utils/arrivalEnsemble';
import { buildOutlook } from '../utils/auroraOutlook';
import { solarDiskOrientation } from '../utils/solarEphemeris';
import { detectArrival, scoreForecast, dueForScoring, buildTrackRecord } from '../utils/forecastScoring';
import { makeHandler } from './forecast-worker';

export default makeHandler({
  buildForecastTimeline,
  chEarthConnection,
  hssArrivalEnsemble,
  measurementConfidence,
  buildOutlook,
  solarDiskOrientation,
  detectArrival,
  scoreForecast,
  dueForScoring,
  buildTrackRecord,
});
