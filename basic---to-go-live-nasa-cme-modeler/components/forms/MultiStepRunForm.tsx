import React, { useMemo, useState } from 'react';
import Panel from '../ui/Panel';
import Stepper, { Step } from '../ui/Stepper';
import TabbedLayout from '../ui/TabbedLayout';
import FormField from '../ui/FormField';
import CTAButton from '../ui/CTAButton';
import AlertBanner from '../ui/AlertBanner';
import { useTheme } from '../../theme';

interface EventSelection {
  mode: 'catalog' | 'manual';
  catalogId?: string;
  manualName?: string;
}

interface Parameters {
  speed: number;
  direction: number;
  mass: number;
  drag: number;
}

interface OutputOptions {
  exportCsv: boolean;
  exportImage: boolean;
  enableAlerts: boolean;
}

const presets: Record<string, Parameters> = {
  fastHalo: { speed: 1800, direction: 0, mass: 8.2, drag: 0.4 },
  slowDense: { speed: 600, direction: -40, mass: 12.4, drag: 1.1 }
};

const validateParameters = (params: Parameters) => {
  const errors: Partial<Record<keyof Parameters, string>> = {};
  if (params.speed < 100 || params.speed > 3000) errors.speed = 'Speed must be between 100-3000 km/s';
  if (params.direction < -180 || params.direction > 180) errors.direction = 'Direction must be -180 to 180°';
  if (params.mass <= 0) errors.mass = 'Mass must be positive';
  if (params.drag < 0 || params.drag > 5) errors.drag = 'Drag must be between 0-5';
  return errors;
};

const MultiStepRunForm: React.FC = () => {
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const [event, setEvent] = useState<EventSelection>({ mode: 'catalog', catalogId: '2024-05-01' });
  const [parameters, setParameters] = useState<Parameters>(presets.fastHalo);
  const [models, setModels] = useState<string[]>(['ENLIL', 'DBM']);
  const [outputOptions, setOutputOptions] = useState<OutputOptions>({ exportCsv: true, exportImage: false, enableAlerts: true });
  const errors = useMemo(() => validateParameters(parameters), [parameters]);

  const steps: Step[] = [
    { id: 'event', label: 'Event', description: 'Pick catalog entry or manual', state: step === 0 ? 'active' : 'complete' },
    { id: 'parameters', label: 'Parameters', description: 'Adjust speed, mass, drag', state: step === 1 ? 'active' : step > 1 ? 'complete' : 'upcoming' },
    { id: 'models', label: 'Models', description: 'Select model ensemble', state: step === 2 ? 'active' : step > 2 ? 'complete' : 'upcoming' },
    { id: 'outputs', label: 'Outputs', description: 'Exports & alerts', state: step === 3 ? 'active' : 'upcoming' }
  ];

  const toggleModel = (name: string) => {
    setModels((list) => (list.includes(name) ? list.filter((m) => m !== name) : [...list, name]));
  };

  return (
    <Panel title="CME Run Setup" description="Guide operators through selecting events, parameters, and outputs">
      <div style={{ display: 'grid', gap: theme.spacing.lg, gridTemplateColumns: '320px 1fr' }}>
        <Stepper steps={steps} onStepSelect={(id) => setStep(steps.findIndex((s) => s.id === id))} />
        <div>
          {step === 0 && (
            <TabbedLayout
              ariaLabel="Event selection"
              tabs={[
                {
                  id: 'catalog',
                  label: 'Catalog picker',
                  content: (
                    <div style={{ display: 'grid', gap: theme.spacing.sm }}>
                      <FormField
                        name="catalog"
                        label="Catalog entry"
                        value={event.catalogId}
                        onChange={(e) => setEvent({ mode: 'catalog', catalogId: e.target.value })}
                        hint="Pull recent SOHO/LASCO events"
                      />
                      <CTAButton onClick={() => setStep(1)}>Use selection</CTAButton>
                    </div>
                  )
                },
                {
                  id: 'manual',
                  label: 'Manual entry',
                  content: (
                    <div style={{ display: 'grid', gap: theme.spacing.sm }}>
                      <FormField
                        name="manualName"
                        label="Event label"
                        value={event.manualName}
                        onChange={(e) => setEvent({ mode: 'manual', manualName: e.target.value })}
                        hint="Describe the CME manually when catalog data is missing"
                      />
                      <CTAButton onClick={() => setStep(1)}>Use manual event</CTAButton>
                    </div>
                  )
                }
              ]}
            />
          )}
          {step === 1 && (
            <div style={{ display: 'grid', gap: theme.spacing.md }}>
              <AlertBanner
                tone="info"
                title="Inline help"
                message="Use presets to quickly seed realistic values; validation runs live as you type."
              />
              <div style={{ display: 'flex', gap: theme.spacing.sm }}>
                <CTAButton variant="ghost" onClick={() => setParameters(presets.fastHalo)}>
                  Use fast halo preset
                </CTAButton>
                <CTAButton variant="ghost" onClick={() => setParameters(presets.slowDense)}>
                  Use slow dense preset
                </CTAButton>
              </div>
              <div style={{ display: 'grid', gap: theme.spacing.sm, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <FormField
                  name="speed"
                  type="number"
                  label="Speed (km/s)"
                  value={parameters.speed}
                  onChange={(e) => setParameters({ ...parameters, speed: Number(e.target.value) })}
                  error={errors.speed}
                  hint="100-3000"
                />
                <FormField
                  name="direction"
                  type="number"
                  label="Direction (°)"
                  value={parameters.direction}
                  onChange={(e) => setParameters({ ...parameters, direction: Number(e.target.value) })}
                  error={errors.direction}
                  hint="-180 to 180"
                />
                <FormField
                  name="mass"
                  type="number"
                  label="Mass (10^15 g)"
                  value={parameters.mass}
                  onChange={(e) => setParameters({ ...parameters, mass: Number(e.target.value) })}
                  error={errors.mass}
                  hint="Positive values"
                />
                <FormField
                  name="drag"
                  type="number"
                  label="Drag coefficient"
                  value={parameters.drag}
                  onChange={(e) => setParameters({ ...parameters, drag: Number(e.target.value) })}
                  error={errors.drag}
                  hint="0-5"
                />
              </div>
              <CTAButton onClick={() => setStep(2)} disabled={Object.keys(errors).length > 0}>
                Continue to models
              </CTAButton>
            </div>
          )}
          {step === 2 && (
            <div style={{ display: 'grid', gap: theme.spacing.md }}>
              <p style={{ margin: 0, color: theme.colors.textSubtle }}>Choose default models to run</p>
              {['ENLIL', 'DBM', 'ANM'].map((model) => (
                <label key={model} style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={models.includes(model)}
                    onChange={() => toggleModel(model)}
                    aria-label={`Toggle ${model}`}
                  />
                  <span>{model}</span>
                </label>
              ))}
              <CTAButton onClick={() => setStep(3)}>Continue to outputs</CTAButton>
            </div>
          )}
          {step === 3 && (
            <div style={{ display: 'grid', gap: theme.spacing.md }}>
              <label style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={outputOptions.exportCsv}
                  onChange={(e) => setOutputOptions({ ...outputOptions, exportCsv: e.target.checked })}
                />
                Export CSV
              </label>
              <label style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={outputOptions.exportImage}
                  onChange={(e) => setOutputOptions({ ...outputOptions, exportImage: e.target.checked })}
                />
                Export image
              </label>
              <label style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={outputOptions.enableAlerts}
                  onChange={(e) => setOutputOptions({ ...outputOptions, enableAlerts: e.target.checked })}
                />
                Enable arrival alerts
              </label>
              <CTAButton>Submit run</CTAButton>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
};

export default MultiStepRunForm;
