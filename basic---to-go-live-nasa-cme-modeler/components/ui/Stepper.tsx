import React from 'react';
import { useTheme, focusStyle } from '../../theme';

type StepState = 'complete' | 'active' | 'upcoming';

export interface Step {
  id: string;
  label: string;
  description?: string;
  state: StepState;
}

interface StepperProps {
  steps: Step[];
  onStepSelect?: (id: string) => void;
}

const Stepper: React.FC<StepperProps> = ({ steps, onStepSelect }) => {
  const { theme } = useTheme();
  return (
    <ol
      style={{
        display: 'grid',
        gap: theme.spacing.sm,
        padding: 0,
        margin: 0,
        listStyle: 'none',
        fontFamily: theme.typography.fontFamily
      }}
    >
      {steps.map((step, index) => (
        <li
          key={step.id}
          style={{
            display: 'grid',
            gap: theme.spacing.xs,
            gridTemplateColumns: '32px 1fr',
            alignItems: 'center'
          }}
        >
          <button
            type="button"
            aria-label={`Step ${index + 1}: ${step.label}`}
            onClick={() => onStepSelect?.(step.id)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `2px solid ${theme.colors.border}`,
              background:
                step.state === 'complete'
                  ? theme.colors.success
                  : step.state === 'active'
                  ? theme.colors.primary
                  : theme.colors.surfaceMuted,
              color: theme.colors.text,
              fontWeight: 700,
              cursor: onStepSelect ? 'pointer' : 'default',
              ...focusStyle(theme)
            }}
          >
            {index + 1}
          </button>
          <div>
            <div style={{ font: theme.typography.headings.h3, color: theme.colors.text }}>{step.label}</div>
            {step.description && (
              <p style={{ margin: 0, color: theme.colors.textSubtle, font: theme.typography.body }}>{step.description}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
};

export default Stepper;
