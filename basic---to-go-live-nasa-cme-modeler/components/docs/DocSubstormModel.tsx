// --- START OF FILE src/components/docs/DocSubstormModel.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, DataTable, Pill } from './DocPrimitives';

const DocSubstormModel: React.FC = () => (
  <Section
    id="s04"
    number="04"
    title="Substorm Risk Model"
    subtitle="Substorm forecasting is a separate system from the headline score. It runs in the Substorm Risk Worker on every request (KV-cached 60 s) and provides near-real-time probability estimates with sub-5-minute latency."
  >
    <CardGrid cols={2}>
      <Card icon="🌊" title="Newell Coupling Integral">
        <p>
          The same Newell function computed in the client (see §03) is integrated over a rolling
          30-minute and 60-minute window using the L1 time series. This accumulated integral
          quantifies total magnetospheric loading over recent minutes — a stronger predictor of
          substorm onset than any instantaneous measurement.
        </p>
        <Formula note="Historical threshold for significant NZ aurora activity: ~5–10 sustained over 30 min at typical solar wind speeds.">
{`dΦ/dt = V^(4/3) · BT^(2/3) · |sin(θ/2)|^(8/3)

newell_now     = current-point value
newell_avg_30m = mean over last 30 min
newell_avg_60m = mean over last 60 min`}
        </Formula>
      </Card>
      <Card icon="🔍" title="Magnetic Bay Onset Detection">
        <p>
          A magnetic bay is the ground-level signature of a substorm: a sharp negative deflection
          of the horizontal geomagnetic field as the auroral electrojet activates overhead. The
          worker scans the EY2M dH time series for:
        </p>
        <Formula note="If the bay flag is raised, substorm status advances directly to ONSET regardless of probability values. The auroral oval boundary is also shifted equatorward.">
{`bay_onset = true  if:
  max_drop > 50 nT  AND
  drop occurs within any 15-min window
  in the recent EY2M data`}
        </Formula>
      </Card>
      <Card icon="📊" title="Probability Model — Exact Formulas">
        <p>
          Probability of substorm onset in the next 30 and 60 minutes, computed client-side from
          Substorm Risk Worker metrics in{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">useForecastData.ts</code>:
        </p>
        <Formula note="The tanh saturation prevents overconfident probabilities at extreme inputs. P30 is more sensitive to current coupling rate (higher 0.7 coefficient), while P60 gives more weight to sustained conditions. Probabilities are always clamped to [0.01, 0.90].">
{`base = tanh(0.015 × dΦ_15min_avg
           + 0.01 × dΦ_now)

bzBoost = Bz < −3 nT : +0.10
          Bz < −1 nT : +0.05
          else       :  0

P60 = clamp(0.25 + 0.6×base + bzBoost,
            0.01, 0.90)

P30 = clamp(0.15 + 0.7×base + bzBoost,
            0.01, 0.90)`}
        </Formula>
      </Card>
      <Card icon="🚦" title="Status Classification">
        <div className="space-y-2.5 mt-1">
          {[
            { pill: 'QUIET',      color: 'neutral' as const, desc: 'P30 <15% — solar wind coupling low, energy not loading' },
            { pill: 'WATCH',      color: 'blue'    as const, desc: 'P30 ≥15% — energy loading, monitor closely' },
            { pill: 'LIKELY_60',  color: 'amber'   as const, desc: 'P60 ≥50% — high probability within the hour' },
            { pill: 'IMMINENT_30',color: 'red'     as const, desc: 'P30 ≥60% — very likely within 30 min' },
            { pill: 'ONSET',      color: 'red'     as const, desc: 'Bay onset confirmed in EY2M — substorm in progress now' },
          ].map(({ pill, color, desc }) => (
            <div key={pill} className="flex items-center gap-3">
              <Pill color={color}>{pill}</Pill>
              <span className="text-xs text-neutral-400">{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </CardGrid>

    <SubHeading color="text-purple-400">Visibility Forecast Time Slots</SubHeading>
    <DataTable
      headers={['Slot', 'Primary source', 'Secondary source', 'Confidence']}
      rows={[
        ['Now',    'Substorm Risk current status + aurora score from Forecast Worker', 'Confirmed sighting reports from within ~200 km in the last 30 min', 'High — reflects current measured conditions'],
        ['15 min', 'P30 probability + Newell coupling trend + Bay onset flag', 'L1 data reflects conditions ~45–60 min from Earth (partially overlaps)', 'High — primary window of reliable near-term forecasting'],
        ['30 min', 'P30 and P60 interpolated + Bz persistence model', 'Sustained southward Bz extrapolation from current trend', 'Medium — conditions can change significantly in 30 min'],
        ['60 min', 'P60 probability projection', 'Aurora score composite', 'Low — guidance only. Treat as "conditions are currently building" rather than a specific prediction'],
      ]}
    />
  </Section>
);

export default DocSubstormModel;