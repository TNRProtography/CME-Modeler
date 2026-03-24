// --- START OF FILE src/components/docs/DocOverview.tsx ---
import React from 'react';
import { Card, CardGrid, Section, SubHeading } from './DocPrimitives';

const DocOverview: React.FC = () => (
  <Section
    id="s01"
    number="01"
    title="System Overview"
    subtitle="Five architectural layers. Every arrow represents a confirmed, production data flow."
  >
    <SubHeading color="text-sky-400">User Layer — Browser / PWA</SubHeading>
    <CardGrid cols={2}>
      <Card icon="📱" title="Progressive Web App">
        <p>
          Installs to phone home screen with no app store. A service worker caches the UI shell for
          offline startup and handles push delivery when the app is closed. The install prompt is
          deferred until you interact with the app — notifications are only offered after install.
        </p>
      </Card>
      <Card icon="📍" title="Optional GPS">
        <p>
          If granted, latitude adjusts the displayed score ±0.2% per 10 km from Greymouth.
          Also silently refreshed to the Push Worker 3 seconds after page load to keep
          location-aware alerts accurate. Never logged or shared with any third party.
        </p>
      </Card>
      <Card icon="🔔" title="Push Subscriptions">
        <p>
          Browser generates a push endpoint and P-256 key pair via the Web Push API. Preferences
          (8 categories plus overnight mode) stored locally and sent to the Push Worker KV on
          subscribe. Fully opt-in — nothing is sent before the user enables notifications.
        </p>
      </Card>
      <Card icon="📌" title="Aurora Sightings">
        <p>
          Reports (naked eye / phone / DSLR / nothing / cloudy) submitted with optional GPS. One
          report per 5 minutes enforced via localStorage. Feed into the forecast "Now" slot and
          the live Leaflet map.
        </p>
      </Card>
    </CardGrid>

    <SubHeading color="text-green-400">Client Layer — React 18 Browser App</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🔄" title="Parallel Data Fetching">
        <p>
          On load: Forecast API, Solar Wind IMF, GOES-18 Hp, GOES-19 Hp, NZ mag (EY2M), and IPS
          alerts fetched in parallel via <code className="font-mono text-xs bg-neutral-800 px-1.5 py-0.5 rounded text-purple-300">Promise.allSettled</code>. Substorm Risk Worker polled separately.
          All forecast data auto-refreshes every 60 s silently.
        </p>
      </Card>
      <Card icon="🧮" title="Client-Side Calculations">
        <p>
          Newell coupling integral, P30/P60 substorm probabilities, location score adjustment,
          visibility text selection, substorm status classification — all computed in the browser
          from raw API responses. No server round-trip needed for display logic.
        </p>
      </Card>
      <Card icon="☀️" title="SUVI CH Detection">
        <p>
          On the CME Visualization page: fetches GOES-19 SUVI 195 Å image via CORS proxy, draws
          to an off-screen 400×400 canvas, runs a 10-step coronal hole pipeline. Entirely
          client-side — no server compute involved.
        </p>
      </Card>
      <Card icon="🌌" title="3D Scene (60 fps)">
        <p>
          Three.js r128. DBM propagation engine precomputes CME trajectories at 60 s resolution,
          then queries them in O(1) via binary-search interpolation. Parker spiral arms are
          parametric curves. Sun rotation uses{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">ω = 2.61799×10⁻⁶ rad/s</code> (27.27-day synodic period).
        </p>
      </Card>
    </CardGrid>

    <SubHeading color="text-purple-400">Workers Layer — Cloudflare Edge</SubHeading>
    <CardGrid cols={2}>
      <Card icon="⚡" title="Forecast API">
        <p>Cron every 5 min. Fetches solar wind, IMF, Hp, EY2M, IPS. Computes composite aurora score. Returns scored JSON + 24 h history. KV-cached 30 s.</p>
      </Card>
      <Card icon="🔬" title="Substorm Risk">
        <p>Per-request, KV-cached 60 s. Full Newell coupling, Bay onset detection, P30/P60 probabilities, solar loading score, all metrics.</p>
      </Card>
      <Card icon="🛰" title="IMAP Solar Wind">
        <p>Per-request, 60 s cache. Merges IMAP-Hi L1 primary with DSCOVR RTSW fallback. Labels each data point with its source.</p>
      </Card>
      <Card icon="🔭" title="DONKI Proxy">
        <p>Cron hourly. Caches CME, FLR, GST data from NASA. All clients served from KV to protect NASA rate limits.</p>
      </Card>
      <Card icon="🔔" title="Push Notifications">
        <p>Cron every 5 min. Checks 8 alert categories. VAPID JWT + AES-128-GCM encryption via Web Crypto API. No npm dependencies.</p>
      </Card>
      <Card icon="📌" title="Aurora Sightings + Banner">
        <p>Per-request. Single KV key stores all reports as a JSON array. 24-h auto-prune. Admin-controlled sitewide banner on demand.</p>
      </Card>
    </CardGrid>

    <SubHeading color="text-amber-400">External APIs</SubHeading>
    <CardGrid cols={3}>
      <Card icon="🌐" title="NOAA SWPC">
        <p>GOES-18/19 Hp, X-ray flux, proton flux, solar-regions.txt, sunspot JSON, SUVI 195 Å, CCOR-1 video. Updated 1–5 min.</p>
      </Card>
      <Card icon="🚀" title="NASA DONKI">
        <p>CME catalog (activityID, speed, halfAngle, longitude, latitude, type, linkedEvents), FLR list, GST shock events. Proxied through KV.</p>
      </Card>
      <Card icon="🛸" title="IMAP / DSCOVR L1">
        <p>Real-time solar wind at L1 (~1.5M km from Earth). ~45–60 min travel time to Earth at typical speeds. IMAP primary, DSCOVR fallback.</p>
      </Card>
      <Card icon="🌏" title="GeoNet Tilde (EY2M)">
        <p>Eyrewell Observatory, Canterbury — 1-min mean dH (rate of change of horizontal magnetic field). Direct NZ local geomagnetic measurement.</p>
      </Card>
      <Card icon="☁️" title="OpenWeatherMap">
        <p>7-day cloud cover + moon phase + sunrise/sunset. Shown on score trend chart. Used for moon arc chart and overnight-watch notifications.</p>
      </Card>
      <Card icon="🔆" title="SDO/HMI">
        <p>JSOC Stanford primary: HMI Colorized, Magnetogram, Intensitygram at 1024 px and 4096 px. NASA SDO fallback if JSOC fails.</p>
      </Card>
    </CardGrid>

    <SubHeading color="text-teal-400">KV Storage — Cloudflare Edge KV</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🗄" title="Push Subscriptions">
        <p>Key: SHA-256(endpoint). Value: subscription object, category preferences, GPS lat/lon, timezone, overnight_mode. No TTL — deleted on 410/404 from push service.</p>
      </Card>
      <Card icon="🗄" title="Notification State">
        <p><code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">COOLDOWN_</code> per category, <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">STATE_xray</code> flare machine, <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">STATE_substorm</code>, <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">STATE_shock</code>, <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">STATE_cme_sheath</code>. TTLs aligned to cooldown windows.</p>
      </Card>
    </CardGrid>
  </Section>
);

export default DocOverview;