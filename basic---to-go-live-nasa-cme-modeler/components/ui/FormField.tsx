import React from 'react';
import { useTheme } from '../../theme';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

const FormField: React.FC<FormFieldProps> = ({ label, hint, error, ...rest }) => {
  const { theme } = useTheme();
  const describedBy = error ? `${rest.name}-error` : hint ? `${rest.name}-hint` : undefined;
  return (
    <label style={{ display: 'grid', gap: theme.spacing.xs, fontFamily: theme.typography.fontFamily }}>
      <span style={{ color: theme.colors.text }}>{label}</span>
      <input
        {...rest}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        style={{
          padding: theme.spacing.sm,
          borderRadius: theme.radii.sm,
          border: `1px solid ${error ? theme.colors.danger : theme.colors.border}`,
          background: theme.colors.surfaceMuted,
          color: theme.colors.text,
          font: theme.typography.body
        }}
      />
      {hint && !error && (
        <span id={`${rest.name}-hint`} style={{ color: theme.colors.textSubtle, fontSize: 12 }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={`${rest.name}-error`} role="alert" style={{ color: theme.colors.danger, fontSize: 12 }}>
          {error}
        </span>
      )}
    </label>
  );
};

export default FormField;
