import React from 'react';
import { CMEParameters } from '../types';

interface Props {
  params: CMEParameters;
  onChange: (updated: CMEParameters) => void;
}

const fieldCopy: Record<keyof CMEParameters, string> = {
  launchTime: 'Anchor the scenario to any moment to see how the shock front advances.',
  initialSpeed: 'Fast CMEs reach >2000 km/s and compress the solar wind ahead of them.',
  acceleration: 'Drag-like deceleration slows the ejecta as it travels through heliospheric plasma.',
  angularWidth: 'Higher widths indicate halo events likely to envelop Earth\'s longitude.',
  density: 'Particle density influences magnetic pressure and auroral potential.',
};

export function ParameterForm({ params, onChange }: Props) {
  const handleNumberChange = (key: keyof CMEParameters) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    onChange({ ...params, [key]: Number.isFinite(value) ? value : 0 });
  };

  const renderField = (
    key: keyof CMEParameters,
    config: {
      label: string;
      type?: string;
      min?: number;
      max?: number;
      step?: number;
      helper?: string;
    },
  ) => {
    const { label, type = 'number', min, max, step } = config;
    const value = params[key];

    const inputProps = {
      id: key,
      type,
      min,
      max,
      step,
      value: type === 'datetime-local' ? (value as string) : (value as number),
      onChange: type === 'datetime-local'
        ? (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...params, launchTime: event.target.value })
        : handleNumberChange(key),
    } as const;

    return (
      <div key={key} className="field-tile">
        <div className="field-heading">
          <label htmlFor={key}>{label}</label>
          <span className="chip">{key === 'launchTime' ? 'time' : 'value'}</span>
        </div>
        <input {...inputProps} />
        <p className="helper">{config.helper ?? fieldCopy[key]}</p>
      </div>
    );
  };

  return (
    <div className="parameter-grid">
      {renderField('launchTime', { label: 'Launch timestamp (UTC)', type: 'datetime-local' })}
      {renderField('initialSpeed', {
        label: 'Initial speed (km/s)',
        min: 100,
        max: 4000,
        step: 10,
        helper: 'Seed the trajectory with a launch speed; the chart shows drag-adjusted evolution.',
      })}
      {renderField('acceleration', {
        label: 'Acceleration (km/s²)',
        step: 0.001,
        helper: 'Negative acceleration represents drag; positive values indicate additional thrust.',
      })}
      {renderField('angularWidth', {
        label: 'Angular width (°)',
        min: 10,
        max: 360,
      })}
      {renderField('density', {
        label: 'Plasma density (p/cm³)',
        min: 1,
        max: 60,
      })}
    </div>
  );
}
