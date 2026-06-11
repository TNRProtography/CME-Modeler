// --- START OF FILE src/components/docs/DocExecutiveSummary.tsx ---
import React from 'react';
import { Card, CardGrid, Callout, Section, Pill } from './DocPrimitives';

const DocExecutiveSummary: React.FC = () => (
  <Section
    id="exec"
    number="00"
    title="Executive Summary"
    subtitle="Everything you need to know about how Spot The Aurora works, in plain English. Skip ahead to any numbered section for the full technical detail."
  >
    <Card icon="🌌" title="What this app is">
      <p>
        Spot The Aurora is a real-time aurora forecasting progressive web app built specifically for
        New Zealand. It combines solar wind measurements from NASA and NOAA satellites, a direct
        geomagnetic measurement from Canterbury, and a custom scoring algorithm to estimate aurora
        visibility on a 0–100% scale referenced to the South Island. It is free, ad-free, and
        entirely transparent about how it works.
      </p>
    </Card>

    <CardGrid cols={2}>
      <Card icon="📡" title="Where the data comes from">
        <p>
          Every number in the app traces to a real sensor. Solar wind speed, density, and magnetic
          field direction (IMF Bz) come from NASA's IMAP spacecraft and NOAA's DSCOVR — both sitting
          at the L1 Lagrange point, about 1.5 million km from Earth. Auroral power comes from
          GOES-18 and GOES-19 satellites. The most locally relevant measurement — a direct
          Canterbury geomagnetic reading — comes from GeoNet's Eyrewell Observatory (EY2M). Solar
          flare and CME data comes from NASA DONKI.
        </p>
      </Card>
      <Card icon="🧮" title="How the score is calculated">
        <p>
          The score is a composite: IMF Bz and the Newell coupling function (a physics-derived
          energy input rate) drive it up when solar wind couples into the magnetosphere. GOES
          hemispheric power confirms that coupling is actually happening. The Canterbury EY2M
          geomagnetic reading adds local ground truth. GPS adjusts the score ±0.2% per 10 km of
          latitude from Greymouth (−42.45°) — Invercargill sees a higher score, Northland lower.
        </p>
      </Card>
      <Card icon="⚡" title="The substorm model">
        <p>
          Separate from the headline score, a substorm risk engine integrates the Newell coupling
          function over 30 and 60-minute windows and scans EY2M for magnetic bay onsets (the ground
          signature of a substorm). This produces P30 and P60 probability estimates and a status
          ladder from QUIET through to ONSET. Substorm onset is the single most reliable predictor
          of sudden aurora activity at NZ latitudes.
        </p>
      </Card>
      <Card icon="🚀" title="CME Visualization">
        <p>
          A real-time 3D heliospheric scene in Three.js showing NASA DONKI CMEs propagating from
          the Sun with physics-based deceleration (the Drag-Based Model of Vršnak et al. 2013).
          CME colour tracks current speed. The scene includes a coronal hole detector that runs
          entirely in-browser from the live GOES-19 SUVI 195 Å image, Parker spiral arms, and a
          7-day impact forecast for Earth.
        </p>
      </Card>
      <Card icon="🔔" title="How notifications work">
        <p>
          All push notifications are sent from a Cloudflare Worker on a 5-minute cron. There is no
          third-party push service. The full RFC 8291 Web Push stack — VAPID JWT signing, ECDH key
          agreement, AES-128-GCM encryption — is implemented from scratch using the Web Crypto API.
          Visibility alerts (DSLR / Phone / Naked Eye) are per-subscriber based on GPS location and
          the auroral oval boundary geometry.
        </p>
      </Card>
      <Card icon="🏗️" title="The backend">
        <p>
          Seven Cloudflare Workers handle all backend logic: Forecast API, Substorm Risk, IMAP
          Solar Wind merger, DONKI proxy, Push Notifications, CH History, and Banner. No persistent
          file system — all state lives in Cloudflare KV. Clients never call external APIs directly;
          everything is served through KV caches to protect rate limits and ensure reliability even
          during NOAA/NASA outages.
        </p>
      </Card>
    </CardGrid>

    <div className="bg-neutral-900/50 border border-neutral-700/40 rounded-xl p-5">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">Score thresholds — South Island NZ reference</p>
      <div className="space-y-1.5">
        {[
          { range: '80–100%', label: 'Go outside now — significant display, possible curtains overhead', color: '#ef4444', w: 100 },
          { range: '65–79%',  label: 'Visible naked eye — distinct glow or pillars to the south',       color: '#f97316', w: 80 },
          { range: '50–64%',  label: 'Faint glow possible to the south in a very dark spot',             color: '#eab308', w: 65 },
          { range: '35–49%',  label: 'Phone night mode will detect it — not reliably naked-eye',         color: '#84cc16', w: 48 },
          { range: '20–34%',  label: 'Very faint — long-exposure DSLR on a tripod only',                 color: '#22c55e', w: 32 },
          { range: '0–19%',   label: 'Conditions too quiet — nothing to see tonight',                    color: '#16a34a', w: 18 },
        ].map(item => (
          <div key={item.range} className="flex items-center gap-3">
            <span className="font-mono text-xs w-16 text-neutral-300 flex-shrink-0">{item.range}</span>
            <div className="flex-shrink-0 h-2 rounded-full" style={{ width: `${item.w * 1.4}px`, background: item.color }} />
            <span className="text-xs text-neutral-400">{item.label}</span>
          </div>
        ))}
      </div>
    </div>

    <Callout kind="info" icon="📋">
      <strong>For operational use:</strong> This app is a visual aid and citizen-science tool,
      not an operational space weather service. For critical infrastructure protection or official
      warnings, use <strong>NOAA SWPC</strong> and MetService NZ Space Weather.
    </Callout>

    <div className="flex flex-wrap gap-2 pt-2">
      {['React 18 + Vite PWA','Cloudflare Pages + Workers','Three.js r128','Chart.js','Leaflet',
        'NOAA SWPC','NASA DONKI','GeoNet EY2M','GOES-18/19','IMAP / DSCOVR L1'].map(t => (
        <Pill key={t} color="neutral">{t}</Pill>
      ))}
    </div>
  </Section>
);

export default DocExecutiveSummary;