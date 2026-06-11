// --- START OF FILE src/components/docs/DocWorkersSightingsTransparency.tsx ---
// Groups the final three sections: Workers, Sightings, and Transparency.
// Each is a self-contained export; the parent imports and renders all three.

import React from 'react';
import { Card, CardGrid, Section, SubHeading, Callout } from './DocPrimitives';

// ── 09: Backend Workers ───────────────────────────────────────────────────────
export const DocWorkers: React.FC = () => (
  <Section
    id="s09"
    number="09"
    title="Backend Workers — Detailed Reference"
    subtitle="All backend logic runs on Cloudflare Workers — serverless JavaScript running at the edge globally. No persistent file system; all state is in Cloudflare KV."
  >
    <CardGrid cols={2}>
      <Card icon="⚡" title="Forecast API (Cron: 5 min)">
        <p>
          On cron: fetches IMAP solar wind, NOAA GOES-18/19 Hp, EY2M geomag, and IPS shock
          events. Runs the composite aurora score algorithm. Writes result to KV with a 30 s
          client-facing TTL. Clients never hit external APIs directly — they read from KV only.
          Score history (24 h array) accumulates in KV and is trimmed on each write.
        </p>
        <p className="mt-2">
          <strong className="text-neutral-200">Response includes:</strong> baseScore (0–100,
          Greymouth reference), all raw inputs (Bz, Bt, speed, density, Hp, EY2M dH), 24 h
          history array with timestamps, moon phase/times, IPS shock flag, lastUpdated epoch.
          Clients compute finalScore (location-adjusted) from baseScore locally.
        </p>
      </Card>
      <Card icon="🔬" title="Substorm Risk (Per-request, 60 s cache)">
        <p>
          Fetches fresh L1 solar wind and EY2M data on every request (result KV-cached 60 s).
          Computes the full Newell integral over 30 and 60-min windows, geomagnetic bay detection,
          solar loading score, substorm status, and P30/P60 probabilities. Returns the complete
          metrics object including every intermediate value.
        </p>
        <p className="mt-2">
          <strong className="text-neutral-200">Why separate from the Forecast API?</strong> The
          substorm bay onset can develop in under 5 minutes. The Forecast Worker runs on a 5-min
          cron — up to 5 minutes of lag is possible. The Substorm Risk Worker is per-request
          (60 s cache), so its status is always within 60 seconds of current conditions. This
          difference is meaningful for real-time bay detection.
        </p>
      </Card>
      <Card icon="🛰" title="IMAP Solar Wind (Per-request, 60 s cache)">
        <p>
          Attempts IMAP-Hi L1 data first. If unavailable or stale (IMAP is a newer NASA mission
          with occasional data gaps), falls back to NOAA DSCOVR RTSW. Each data point in the
          returned 24 h time series is individually labelled with its source — shown on the IMF
          chart.
        </p>
        <p className="mt-2">
          <strong className="text-neutral-200">L1 travel time reminder:</strong> All L1
          measurements reflect conditions that are currently 45–60 minutes from arriving at Earth
          at typical solar wind speeds. A southward Bz in the IMF chart means aurora may develop
          within the hour — not that it is happening right now.
        </p>
      </Card>
      <Card icon="🔭" title="DONKI Proxy (Cron: hourly)">
        <p>
          Fetches CME catalog, FLR list, and GST shock events from NASA DONKI on an hourly cron.
          Stores in KV. All client requests are served from KV — no browser ever calls NASA
          directly. This protects the shared NASA API key from being rate-limited by multiple
          concurrent users.
        </p>
        <p className="mt-2">
          <strong className="text-neutral-200">CME processing:</strong> For each CME, the "most
          accurate" GCS analysis is selected. Only CMEs with valid speed, longitude, and latitude
          are included. Earth-directed classification:{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">|longitude| &lt; 45°</code>.
        </p>
      </Card>
      <Card icon="🌑" title="CH History (Cron: hourly)">
        <p>
          Accepts CH detection snapshots POSTed by the browser. Deduplicates within 10-minute
          windows. Stores with 96 h TTL. Sorted index key for fast range queries. Evicts oldest
          when max 144 snapshots exceeded.
        </p>
        <p className="mt-2">
          Hourly cron scrapes the NOAA SUVI 195 Å animation directory HTML listing. Parses all
          PNG filenames and their ISO timestamps. Selects one frame per 2-hour window. Caches
          result for 30 min. Used by the browser to backfill CH history gaps.
        </p>
      </Card>
      <Card icon="📢" title="Banner API (On demand)">
        <p>
          Admin-controlled sitewide banner (BANNER_AUTH_TOKEN in Worker Secrets). Stores content
          in KV. Fetched on every page load. The dynamic substorm alert in the global header is
          separate — generated entirely client-side from the Substorm Risk Worker response.
        </p>
        <p className="mt-2">
          <strong className="text-neutral-200">Push broadcast limitation:</strong> The admin
          broadcast is sent by the admin's browser calling the Push Worker directly — not routed
          through this API. This is because Cloudflare prohibits worker-to-worker subrequests on
          the same account via public URLs (error 1042).
        </p>
      </Card>
    </CardGrid>
  </Section>
);

// ── 10: Aurora Sightings ──────────────────────────────────────────────────────
export const DocSightings: React.FC = () => (
  <Section
    id="s10"
    number="10"
    title="Aurora Sightings"
    subtitle='User-submitted reports provide real-world ground truth that solar wind models cannot. "Nothing" reports are explicitly valuable — they calibrate when the model over-predicts.'
  >
    <CardGrid cols={2}>
      <Card icon="📝" title="What you submit">
        <p>
          Eight status values: Naked Eye · Phone Camera · DSLR/Mirrorless · Nothing (Naked Eye) ·
          Nothing (Phone) · Nothing (DSLR) · Cloudy.
        </p>
        <p>
          Negative sightings ("Nothing") explicitly confirm clear-sky absence of aurora when the
          model predicts activity — this is calibration data, not noise. Cloudy reports confirm
          obstructed sky rather than absent aurora.
        </p>
      </Card>
      <Card icon="🔒" title="Rate Limiting & Privacy">
        <p>
          One report per 5 minutes via localStorage timestamp. This works offline-then-online
          correctly, unlike server-side IP limiting which fails for mobile users on carrier NAT.
          Name trimmed to 50 chars, HTML stripped. GPS coordinates are stored only in the sighting
          record and used only to position the map dot — not linked to any persistent identity.
        </p>
      </Card>
      <Card icon="🗄" title="Storage Design">
        <p>
          All reports in one JSON array under a single KV key. Each POST: read → append → prune
          entries older than 24 h → write back. This is exactly one KV read + one write per
          submission — very cheap. GET responses served from Cloudflare edge cache with{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">Cache-Control: max-age=60</code>.
          Write invalidates the edge cache immediately so new reports appear globally within
          1–2 seconds.
        </p>
      </Card>
      <Card icon="📊" title="Use in Forecast">
        <p>
          Reports from the past 30 minutes within approximately 200 km of the user's location are
          counted. If ≥2 naked-eye reports exist nearby, the "Now" visibility slot shows a
          sightings-confirmed message alongside the model prediction. Model prediction and sightings
          are displayed as separate, independent information — sightings never override or suppress
          the score.
        </p>
      </Card>
    </CardGrid>
  </Section>
);

// ── 11: Transparency & Limitations ───────────────────────────────────────────
export const DocTransparency: React.FC = () => (
  <Section
    id="s11"
    number="11"
    title="Transparency & Limitations"
    subtitle="Aurora forecasting is hard. This section is a plain-English account of the known limits of each part of this system."
  >
    <CardGrid cols={2}>
      <Card icon="⏱" title="L1 Travel Time Uncertainty">
        <p>
          Solar wind data is measured at L1, approximately 1.5 million km from Earth. At
          400–600 km/s, the data shown in the IMF charts is 45–60 minutes away from arriving at
          Earth. We cannot know if those conditions will persist, intensify, or die out before
          arrival. The "15 min" slot accounts for this lag; the uncertainty cannot be eliminated.
        </p>
      </Card>
      <Card icon="🌎" title="Ionospheric Variability">
        <p>
          Identical solar wind conditions produce different aurora on different nights. Ionospheric
          conductivity, substorm phase, ring current state, and magnetospheric pre-conditioning all
          affect the visible outcome. The score is a probability estimate — not a deterministic
          forecast. A score of 60% means significant aurora is more likely than not, not guaranteed.
        </p>
      </Card>
      <Card icon="🌑" title="CH Detection Accuracy">
        <p>
          Single brightness-threshold detection calibrated to one reference image. CHs near the
          solar limb are foreshortened. Polar holes are partially obscured. Filament channels may
          false-positive. Detected boundaries should be treated as approximate outlines. Multiple
          detections over 72 h provide better confidence than any single frame.
        </p>
      </Card>
      <Card icon="🚀" title="CME Trajectory Deflection">
        <p>
          CME trajectories can deflect significantly between Sun and Earth due to interaction with
          the background solar wind, helmet streamer belts, and other CMEs. A CME modelled as
          Earth-directed from DONKI GCS parameters may still miss Earth. Conversely, a flank CME
          can produce aurora through its compressed sheath. The visualizer shows DONKI catalog
          parameters as-is — no deflection model is included.
        </p>
      </Card>
      <Card icon="📊" title="Score ≠ Kp">
        <p>
          The aurora score is a custom index tuned for South Island New Zealand visibility. It is
          not Kp. Kp is a 3-hourly global planetary average; this score uses sub-minute data from
          local NZ instruments and is calibrated for the subauroral latitude band. The score
          responds faster to changing conditions than Kp and can read higher because local EY2M
          data is incorporated directly.
        </p>
      </Card>
      <Card icon="🔔" title="5-Minute Notification Lag">
        <p>
          Notification checks run every 5 minutes on a cron. A rapid onset can go from quiet to
          naked-eye visible in under 5 minutes — faster than the check cycle. The overnight-watch
          notification around sunset is the practical hedge: it provides advance notice so users
          are already watching when conditions peak.
        </p>
      </Card>
      <Card icon="📐" title="DBM Model Uncertainty">
        <p>
          The drag parameter γ is estimated from CME speed and half-angle — the actual value
          depends on CME mass, cross-section, and ambient density. The DBM arrival time
          uncertainty is typically ±6–12 hours at 1 AU. For confirmed Earth-directed events with
          a DONKI-supplied arrival time, the catalog value is used instead of the model estimate.
        </p>
      </Card>
      <Card icon="🌐" title="Data Source Outages">
        <p>
          All data sources can become unavailable. IMAP is a relatively new mission with
          occasional data gaps — DSCOVR fallback is automatic. NOAA SWPC occasionally has
          maintenance outages. The app is built to degrade gracefully: missing data shows stale
          values with timestamps rather than crashing.
        </p>
      </Card>
    </CardGrid>

    <Callout kind="ok" icon="✅">
      <strong>No ads. No analytics tracking. No data selling.</strong> Spot The Aurora does not
      display advertisements. It does not use analytics tracking beyond Cloudflare's basic access
      logs (which contain no personal data and are not processed). It does not sell, share, or
      transmit user data to any third party. GPS coordinates for push notifications are stored
      only in Cloudflare KV under your subscription record and used solely to compute
      location-relevant alert thresholds. No other system or user can access them.
    </Callout>

    <Callout kind="info" icon="📋">
      <strong>For operational use:</strong> This app is a visual aid and citizen-science tool,
      not an operational space weather service. For critical infrastructure protection, aviation,
      or official warnings, use{' '}
      <a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
        NOAA Space Weather Prediction Center
      </a>{' '}
      and MetService NZ Space Weather.
    </Callout>

    <div className="text-center text-xs text-neutral-600 pt-4 border-t border-neutral-800 space-y-1">
      <p>Data: NOAA SWPC · NASA DONKI · GeoNet Tilde (EY2M) · OpenWeatherMap · GOES-19 SUVI · SDO/HMI (JSOC Stanford) · IMAP / DSCOVR L1</p>
      <p>Physics: Vršnak et al. 2013 Solar Phys. 285 · Vršnak &amp; Žic 2007 A&amp;A 472 · Temmer et al. 2017 ApJ 835 · Werner et al. 2019 Space Weather 17 · Cargill 2004 · Dumbović et al. 2021</p>
      <p>Built with React 18 · Three.js r128 · Cloudflare Pages + Workers · 600+ hours of development</p>
    </div>
  </Section>
);