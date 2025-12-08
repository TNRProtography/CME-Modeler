import { CMEParameters } from '../types';

interface Props {
  params: CMEParameters;
  onChange: (updated: CMEParameters) => void;
}

export function ParameterForm({ params, onChange }: Props) {
  const handleNumberChange = (key: keyof CMEParameters) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    onChange({ ...params, [key]: Number.isFinite(value) ? value : 0 });
  };

  return (
    <div className="panel">
      <h2>Launch parameters</h2>
      <div className="grid" style={{ gap: 12 }}>
        <div>
          <label htmlFor="launch">Launch (UTC)</label>
          <input
            id="launch"
            type="datetime-local"
            value={params.launchTime}
            onChange={(event) => onChange({ ...params, launchTime: event.target.value })}
          />
          <p className="helper">Pick a launch window to anchor the propagation timeline.</p>
        </div>
        <div className="grid two">
          <div>
            <label htmlFor="speed">Initial speed (km/s)</label>
            <input
              id="speed"
              type="number"
              min={100}
              max={4000}
              step={10}
              value={params.initialSpeed}
              onChange={handleNumberChange('initialSpeed')}
            />
            <p className="helper">Typical CME speeds range from 300–3000 km/s.</p>
          </div>
          <div>
            <label htmlFor="acceleration">Acceleration (km/s²)</label>
            <input
              id="acceleration"
              type="number"
              step={0.001}
              value={params.acceleration}
              onChange={handleNumberChange('acceleration')}
            />
            <p className="helper">Use negative values for deceleration as CMEs expand.</p>
          </div>
          <div>
            <label htmlFor="width">Angular width (°)</label>
            <input
              id="width"
              type="number"
              min={10}
              max={360}
              value={params.angularWidth}
              onChange={handleNumberChange('angularWidth')}
            />
            <p className="helper">Halo events reach near 360°; narrower events stay closer to the source longitude.</p>
          </div>
          <div>
            <label htmlFor="density">Plasma density (p/cm³)</label>
            <input
              id="density"
              type="number"
              min={1}
              max={60}
              value={params.density}
              onChange={handleNumberChange('density')}
            />
            <p className="helper">Higher densities typically amplify geomagnetic response.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
