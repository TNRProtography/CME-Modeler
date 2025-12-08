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
    <div className="panel">
      <h2>Milestone guide</h2>
      <div className="grid two">
        {milestones.map((milestone) => (
          <div key={milestone.label} className="stat-card">
            <div className="label">{milestone.label}</div>
            <div className="value">{milestone.distanceAU.toFixed(2)} AU</div>
            <div className="helper">
              {milestone.timeHours.toFixed(1)} h after launch · ~{Math.max(milestone.speed, 0).toFixed(0)} km/s
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
      <header className="header">
        <div className="badge">Rebuilt CME modeling workspace</div>
        <h1>CME Modeler</h1>
        <p>
          Configure a hypothetical coronal mass ejection, visualize its propagation, and inspect the implied arrival
          conditions at Earth.
        </p>
      </header>

      <div className="grid two">
        <ParameterForm params={params} onChange={setParams} />
        <SummaryStats stats={stats} />
      </div>

      <div className="grid two" style={{ marginTop: 12 }}>
        <PropagationChart milestones={forecast.milestones} />
        <MilestoneList milestones={forecast.milestones} />
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h2>Scenario notes</h2>
        <div className="grid two">
          <div>
            <h3>Width & coverage</h3>
            <p className="helper">
              Angular width influences whether the ejecta envelops the Earth-facing hemisphere. Wider halos push the
              estimated Kp upward by increasing coupling probability.
            </p>
          </div>
          <div>
            <h3>Density & deceleration</h3>
            <p className="helper">
              Plasma density and the sign of acceleration shift both the final speed and the shock strength. Negative
              acceleration represents aerodynamic drag from the ambient solar wind.
            </p>
          </div>
        </div>
      </div>

      <EventTable events={sampleEvents} />

      <div className="footer">
        Built from scratch with React, Chart.js, and a lightweight propagation model intended for quick explorations.
      </div>
    </div>
  );
}
