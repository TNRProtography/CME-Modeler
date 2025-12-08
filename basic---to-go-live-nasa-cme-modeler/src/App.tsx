import { useMemo, useState } from 'react';
import { ParameterForm } from './components/ParameterForm';
import { SummaryStats } from './components/SummaryStats';
import { PropagationChart } from './components/PropagationChart';
import { EventTable } from './components/EventTable';
import { sampleEvents } from './data/sampleEvents';
import { CMEParameters } from './types';
import { formatDate, predictCMEArrival } from './utils/model';

const buildLocalDateTimeString = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const defaultParameters: CMEParameters = {
  launchTime: buildLocalDateTimeString(),
  initialSpeed: 1200,
  acceleration: -0.002,
  angularWidth: 140,
  density: 18,
};

function MilestoneList({
  milestones,
}: {
  milestones: ReturnType<typeof predictCMEArrival>['milestones'];
}) {
  return (
    <div className="panel milestone-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Trajectory guide</p>
          <h2>Milestones through the heliosphere</h2>
        </div>
        <div className="legend-note">Time markers for when the ejecta crosses key distances.</div>
      </div>
      <div className="milestone-list">
        {milestones.map((milestone, idx) => (
          <div key={milestone.label} className="milestone-item">
            <div className="milestone-marker">{idx + 1}</div>
            <div className="milestone-body">
              <div className="milestone-label">{milestone.label}</div>
              <div className="milestone-meta">
                <span>{milestone.distanceAU.toFixed(2)} AU</span>
                <span>Launch + {milestone.timeHours.toFixed(1)} h</span>
                <span>{Math.max(milestone.speed, 0).toFixed(0)} km/s</span>
              </div>
              <div className="progress" aria-hidden>
                <span style={{ width: `${(milestone.distanceAU / 1) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [params, setParams] = useState<CMEParameters>(defaultParameters);

  const forecast = useMemo(() => predictCMEArrival(params), [params]);

  const stats = useMemo(
    () => [
      {
        label: 'Predicted arrival',
        value: formatDate(forecast.arrival),
        detail: `Launch + ${forecast.transitHours.toFixed(1)} h`,
      },
      {
        label: 'Transit time',
        value: `${forecast.transitHours.toFixed(1)} hours`,
        detail: `${(forecast.transitHours / 24).toFixed(1)} days door-to-door`,
      },
      {
        label: 'Final speed',
        value: `${Math.max(forecast.finalSpeed, 0).toFixed(0)} km/s`,
        detail: 'Linear acceleration across 1 AU segment',
      },
      {
        label: 'Impact potential',
        value: `Kp ${forecast.kpEstimate}`,
        detail: 'Quick-look geomagnetic severity index',
      },
    ],
    [forecast],
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="pill-row">
          <span className="pill">Solar storm atelier</span>
          <span className="pill">Live controls</span>
          <span className="pill">Chart-first layout</span>
        </div>
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Keep the unique tools, remix the presentation</p>
            <h1>CME Forecast Lab</h1>
            <p className="lede">
              Sculpt a coronal mass ejection with new controls, watch the updated dual-scale propagation chart,
              and scan milestone markers in a vertical timeline.
            </p>
            <div className="hero-note">Earth-directed modeling · Drag-based propagation · Quick-look geomagnetic signal</div>
          </div>
          <div className="hero-card">
            <div className="hero-card__title">Live snapshot</div>
            <div className="hero-metrics">
              <div>
                <div className="helper">Transit time</div>
                <div className="value">{forecast.transitHours.toFixed(1)} h</div>
              </div>
              <div>
                <div className="helper">Arrival Kp est.</div>
                <div className="value">{forecast.kpEstimate}</div>
              </div>
              <div>
                <div className="helper">Final speed</div>
                <div className="value">{Math.max(forecast.finalSpeed, 0).toFixed(0)} km/s</div>
              </div>
            </div>
            <div className="hero-card__footer">Model tuned to the parameters you set below.</div>
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="workspace-main">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Scenario builder</p>
                <h2>Launch conditions</h2>
              </div>
              <div className="legend-note">Adjust the key knobs; everything else updates instantly.</div>
            </div>
            <ParameterForm params={params} onChange={setParams} />
          </div>

          <PropagationChart milestones={forecast.milestones} />
        </div>

        <aside className="insight-rail">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Quick metrics</p>
                <h2>Impact glance</h2>
              </div>
              <div className="legend-note">Arrival, transit, and geomagnetic potential in one place.</div>
            </div>
            <SummaryStats stats={stats} />
          </div>

          <MilestoneList milestones={forecast.milestones} />
        </aside>
      </section>

      <section className="panel note-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reference hints</p>
            <h2>What shifts the curve?</h2>
          </div>
          <div className="legend-note">Context to interpret the updated chart and milestone layout.</div>
        </div>
        <div className="note-grid">
          <div className="note-card">
            <div className="chip ghost">Width & coverage</div>
            <p>
              Angular width drives how fully the ejecta envelops the Earth-facing hemisphere. Broad halos increase
              coupling probability and push the Kp expectation upward.
            </p>
          </div>
          <div className="note-card">
            <div className="chip ghost">Density & drag</div>
            <p>
              Elevated plasma density amplifies shock strength, while negative acceleration values model drag from the
              ambient solar wind—both alter the distance and speed curves.
            </p>
          </div>
          <div className="note-card">
            <div className="chip ghost">Launch cadence</div>
            <p>
              Changing the launch timestamp reanchors the entire timeline, updating the dual-scale plot and the milestone
              rail simultaneously.
            </p>
          </div>
        </div>
      </section>

      <EventTable events={sampleEvents} />

      <div className="footer">
        Reimagined CME modeling studio with preserved capabilities and a fully fresh presentation layer.
      </div>
    </div>
  );
}
