// --- START OF FILE src/components/docs/DocAuroraScore.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, ScoreBar } from './DocPrimitives';

const DocAuroraScore: React.FC = () => (
  <Section
    id="s03"
    number="03"
    title="Aurora Scoring Algorithm"
    subtitle="The aurora score (0–100%) is a composite metric computed by the Forecast Worker every 5 minutes and served from KV cache. It combines solar wind coupling physics, direct geomagnetic measurements, and hemispheric power into a single visibility probability estimate for the South Island of New Zealand."
  >
    <SubHeading color="text-purple-400">Primary Inputs</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🌀" title="IMF Bz — the critical driver">
        <p>
          The southward component of the Interplanetary Magnetic Field. When Bz is negative
          (pointing toward Earth's south magnetic pole) it drives magnetic reconnection at the
          dayside magnetopause, allowing solar wind kinetic energy to couple directly into the
          magnetosphere.
        </p>
        <p>
          Both instantaneous Bz and rolling 10 and 30-minute averages are used. Sustained Bz
          below −5 nT for 15+ minutes is the strongest single predictor of aurora at subauroral
          latitudes. Brief southward excursions that immediately recover contribute much less.
        </p>
      </Card>
      <Card icon="⚡" title="Newell Coupling Function dΦ/dt">
        <p>
          A physics-derived magnetospheric energy input rate, computed from L1 solar wind data in{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">useForecastData.ts</code>:
        </p>
        <Formula note="Result divided by 1000 for normalisation. Higher values indicate more energy being injected into the magnetosphere per unit time. Averaged over 30 and 60-minute windows for substorm probability estimates.">
{`dΦ/dt = V^(4/3) · BT^(2/3) · |sin(θ/2)|^(8/3)

V  = solar wind speed (km/s)
BT = sqrt(By² + Bz²)  [total transverse IMF, nT]
θ  = atan2(By, Bz)    [IMF clock angle]`}
        </Formula>
      </Card>
      <Card icon="🌎" title="Hemispheric Power (GOES Hp)">
        <p>
          NOAA's GOES-18 and GOES-19 satellites directly measure the total auroral power being
          deposited into Earth's ionosphere in gigawatts, via particle precipitation measurements
          over the auroral zones. GOES-18 (primary) and GOES-19 (secondary) values are averaged.
        </p>
        <p>
          This is a direct measurement of how much aurora energy is being produced right now —
          not a model prediction from solar wind. &gt;20 GW: active. &gt;50 GW: significant.
          &gt;100 GW: major storm.
        </p>
      </Card>
      <Card icon="📡" title="NZ Geomagnetic dH (EY2M)">
        <p>
          Eyrewell Observatory (Canterbury, NZ) 1-minute dH — rate of change of the horizontal
          magnetic field component. This is the only data source in the scoring system that is
          geographically specific to New Zealand.
        </p>
        <p>
          A sharp negative bay in dH (−50 nT or more over 15 min) indicates a substorm
          electrojet is active directly overhead, meaning aurora is happening at that latitude right
          now. This is why the NZ score can differ significantly from global Kp.
        </p>
      </Card>
    </CardGrid>

    <SubHeading color="text-purple-400">Location Adjustment — Exact Formula</SubHeading>
    <Card icon="📍" title="GPS Latitude Correction">
      <p>
        The Forecast Worker produces a <strong className="text-neutral-200">baseScore</strong> referenced
        to Greymouth, NZ (latitude −42.45°). When GPS is granted, a{' '}
        <strong className="text-neutral-200">finalScore</strong> is computed client-side and used for all display:
      </p>
      <Formula note="Conservative by design: ±0.2% per 10 km of latitude separation. Northland (further from the auroral oval) sees a lower score; Invercargill (closer) sees a higher one. The baseScore is stored in the score history and sent to the Push Worker for server-side location filtering.">
{`GREYMOUTH_LATITUDE = -42.45°

dLat_rad    = (user_lat - GREYMOUTH_LATITUDE) × π / 180
distance_km = |dLat_rad| × 6371

segments   = floor(distance_km / 10)
adjustment = segments × 0.2%

user_lat > GREYMOUTH  →  finalScore = baseScore − adjustment
user_lat < GREYMOUTH  →  finalScore = baseScore + adjustment`}
      </Formula>
    </Card>

    <SubHeading color="text-purple-400">Visibility Scale</SubHeading>
    <div className="bg-neutral-900/70 border border-neutral-700/50 rounded-xl p-5">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">Score thresholds — South Island NZ reference point</p>
      <div className="space-y-2.5">
        <ScoreBar range="80–100%" color="#ef4444" width={100} label="Go outside now — significant display, possible curtains and colour overhead" />
        <ScoreBar range="65–79%"  color="#f97316" width={80}  label="Visible naked eye — distinct glow or pillars to the south" />
        <ScoreBar range="50–64%"  color="#eab308" width={65}  label="Faint glow possible to the south in a very dark spot" />
        <ScoreBar range="35–49%"  color="#84cc16" width={48}  label="Phone camera night mode will pick it up — not reliably naked-eye" />
        <ScoreBar range="20–34%"  color="#22c55e" width={32}  label="Very faint — long-exposure DSLR on a tripod only" />
        <ScoreBar range="0–19%"   color="#16a34a" width={18}  label="Conditions too quiet — nothing to see tonight" />
      </div>
    </div>
  </Section>
);

export default DocAuroraScore;