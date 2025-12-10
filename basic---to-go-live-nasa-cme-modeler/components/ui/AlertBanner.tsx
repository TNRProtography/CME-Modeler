import React from 'react';
import { useTheme } from '../../theme';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const toneMap: Record<Tone, { background: string; text: string }> = {
  info: { background: '#10243f', text: '#c8e1ff' },
  warning: { background: '#3a2a10', text: '#f6c15b' },
  danger: { background: '#3f1021', text: '#ff8fa3' },
  success: { background: '#0f2b22', text: '#5ed89b' }
};

interface AlertBannerProps {
  tone?: Tone;
  title: string;
  message: string;
}

const AlertBanner: React.FC<AlertBannerProps> = ({ tone = 'info', title, message }) => {
  const { theme } = useTheme();
  const palette = toneMap[tone];
  return (
    <div
      role="alert"
      style={{
        background: palette.background,
        color: palette.text,
        borderRadius: theme.radii.md,
        padding: theme.spacing.md,
        border: `1px solid ${theme.colors.border}`,
        fontFamily: theme.typography.fontFamily
      }}
    >
      <strong style={{ display: 'block', marginBottom: theme.spacing.xs }}>{title}</strong>
      <span>{message}</span>
    </div>
  );
};

export default AlertBanner;
