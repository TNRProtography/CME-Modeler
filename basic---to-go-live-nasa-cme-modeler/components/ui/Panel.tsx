import React, { ReactNode } from 'react';
import { useTheme } from '../../theme';

interface PanelProps {
  title: string;
  description?: string;
  children: ReactNode;
}

const Panel: React.FC<PanelProps> = ({ title, description, children }) => {
  const { theme } = useTheme();
  return (
    <div
      role="group"
      aria-label={title}
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
        boxShadow: theme.shadows.sm,
        color: theme.colors.text,
        fontFamily: theme.typography.fontFamily
      }}
    >
      <div style={{ marginBottom: theme.spacing.sm }}>
        <div style={{ font: theme.typography.headings.h2, marginBottom: theme.spacing.xs }}>{title}</div>
        {description && (
          <p style={{ margin: 0, color: theme.colors.textSubtle, font: theme.typography.body }}>{description}</p>
        )}
      </div>
      {children}
    </div>
  );
};

export default Panel;
