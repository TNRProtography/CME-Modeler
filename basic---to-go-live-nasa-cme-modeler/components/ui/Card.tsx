import React, { ReactNode } from 'react';
import { useTheme } from '../../theme';

interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const Card: React.FC<CardProps> = ({ title, actions, children }) => {
  const { theme } = useTheme();
  return (
    <section
      style={{
        background: theme.colors.surfaceMuted,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radii.md,
        padding: theme.spacing.lg,
        boxShadow: theme.shadows.md,
        color: theme.colors.text,
        fontFamily: theme.typography.fontFamily
      }}
      aria-label={title}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: theme.spacing.md
          }}
        >
          {title && (
            <h3 style={{ font: theme.typography.headings.h3, margin: 0, color: theme.colors.text }}>{title}</h3>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
};

export default Card;
