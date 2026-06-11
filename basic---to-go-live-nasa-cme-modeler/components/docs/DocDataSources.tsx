// --- START OF FILE src/components/docs/DocDataSources.tsx ---
import React from 'react';
import { Section, SubHeading, DataTable, Callout } from './DocPrimitives';

const DocDataSources: React.FC = () => (
  <Section
    id="s02"
    number="02"
    title="Data Sources"
    subtitle="Every data point shown in the app traces back to one of the entries below. Refresh rates are exact values from the source code."
  >
    <SubHeading color="text-sky-400">Forecast Page</SubHeading>
    <DataTable
      headers={['Source', 'What is fetched', 'Refresh', 'Used for']}
      rows={[
        ['Forecast Worker', 'Aurora baseScore (0–100, Greymouth ref), all gauge inputs, 24 h score history, IPS flag, moon phase/times, lastUpdated', 'Auto 60 s', 'Primary score, all gauges, score history chart'],
        ['Substorm Risk Worker', 'Status (QUIET→ONSET), P30/P60, Newell coupling now/30m/60m, Bay onset flag, geomag score, solar loading score, full metrics object', 'Auto 60 s', 'Substorm panel, visibility forecast slots, substorm badge'],
        ['IMAP Solar Wind Worker', '24 h merged Bz/Bt/Bx/By (nT), speed (km/s), density (cm⁻³), temperature (K) — per-point source label', 'Auto 60 s', 'IMF chart, IMF clock angle, solar wind charts'],
        ['NOAA GOES-18', '1-day Hp magnetometer: time_tag, Hp (GW auroral power proxy)', 'Auto 60 s', 'Hemispheric power gauge (averaged with GOES-19)'],
        ['NOAA GOES-19', 'Same structure as GOES-18', 'Auto 60 s', 'Hemispheric power gauge'],
        ['GeoNet Tilde EY2M', '1-day dH at 1-min mean intervals, Eyrewell station, Canterbury', 'Auto 60 s', 'NZ Magnetometer chart, geomag score input, Bay onset detection'],
        ['Forecast Worker /ips', 'DONKI GST shock events from last 24 h', 'Auto 60 s', 'IPS alert banner when shock present'],
        ['OpenWeatherMap', '7-day hourly cloud cover %, moon phase (0–1), moonrise/moonset, sunrise/sunset', 'On demand', 'Cloud overlay on trend chart, moon arc chart, overnight-watch notification'],
      ]}
    />

    <SubHeading color="text-sky-400">Solar Activity Page</SubHeading>
    <DataTable
      headers={['Source', 'What is fetched', 'Refresh', 'Used for']}
      rows={[
        ['NOAA GOES (primary)', 'X-ray flux 1-day: energy band 0.1–0.8 nm and 0.05–0.4 nm, flux (W/m²), time_tag — 5 min cadence', 'On open / manual', 'GOES X-ray chart, flare class labels (A/B/C/M/X)'],
        ['NOAA GOES (secondary)', 'Proton flux 1-day: ≥10 MeV, ≥50 MeV, ≥100 MeV channels (pfu)', 'On open / manual', 'Proton flux chart, S-scale event threshold at 10 pfu'],
        ['NASA DONKI (via proxy)', 'FLR list: classType, beginTime, peakTime, endTime, sourceLocation, activeRegionNum, linkedEvents', 'On open / manual', 'Flares list, X-ray chart annotation, CME link button in flare modal'],
        ['NOAA solar-regions.txt', 'Plain-text: region number, location string, area (MSH), classification, spot count, magnetic class — one line per region', 'On open / manual', 'Sunspot Tracker — authoritative region list. Defines which regions exist and their positions'],
        ['NOAA sunspot_report.json', 'Per-region M/X/proton flare probabilities, spot count, magnetic class, observedTime', 'On open / manual', 'Sunspot detail panel — latest entry per region wins by observedTime'],
        ['SDO/HMI (JSOC Stanford)', 'HMI_latest_color_Mag_1024×1024.jpg, Mag, colInt — and 4096 px versions', 'On open / manual', 'Sunspot Tracker solar disk imagery. 4096 px prefetched when a dot is selected for close-up'],
        ['NASA SDO (nasa.gov)', 'latest_1024_HMIBC/HMIB/HMII.jpg — alternate host', 'On JSOC failure', 'Automatic fallback if JSOC images fail to load'],
        ['NOAA SUVI 195 Å + CCOR-1', 'Latest EUV coronal image and coronagraph video', 'On open / manual', 'SUVI imagery panel, CCOR-1 video player'],
      ]}
    />

    <Callout kind="info" icon="ℹ️">
      <strong>Sunspot dot positioning:</strong> Region dots are mapped using the known native HMI
      coordinate constants — <code className="font-mono text-xs">cx=2048, cy=2048, radius=1980</code> for 4096 px images —
      scaled proportionally to the displayed image size. Pixel-brightness scanning was deliberately
      dropped: it produced incorrect results on colourised magnetogram images because the
      false-colour mapping created misleading brightness gradients. The native constants are stable
      across all HMI products.
    </Callout>

    <SubHeading color="text-sky-400">CME Visualization Page</SubHeading>
    <DataTable
      headers={['Source', 'What is fetched', 'Refresh', 'Used for']}
      rows={[
        ['NASA DONKI (via proxy)', 'CME catalog: activityID, startTime, speed (km/s), halfAngle (°), longitude, latitude, type, linkedEvents — "most accurate" GCS analysis used per event', 'On page load; manual after', '3D CME objects, CME list panel, DBM propagation input, impact forecast'],
        ['IMAP Solar Wind Worker', 'Latest solar wind speed reading — single most-recent 5-min point', 'On page load', 'Ambient wind parameter w for the DBM engine. Calibrates drag model to current conditions'],
        ['GOES-19 SUVI 195 Å', 'Latest coronal image via CORS proxy (/api/proxy/image)', 'Every 15 min on page', 'Coronal hole detection pipeline input'],
        ['CH History Worker', '72 h snapshot archive of CH detections; SUVI 195 Å frame index (one per 2 h)', 'After each live detection; on page load', '72 h CH history tracking, historical backfill analysis'],
      ]}
    />
  </Section>
);

export default DocDataSources;