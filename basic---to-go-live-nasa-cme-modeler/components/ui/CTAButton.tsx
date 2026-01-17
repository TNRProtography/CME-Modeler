import React from 'react';
import { useTheme, focusStyle } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

interface CTAButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: React.ReactNode;
}

const CTAButton: React.FC<CTAButtonProps> = ({ variant = 'primary', children, ...rest }) => {
  const { theme } = useTheme();
  const palette = {
    primary: {
      background: theme.colors.primary,
      color: theme.colors.text
    },
    secondary: {
      background: theme.colors.secondary,
      color: theme.colors.text
    },
    ghost: {
      background: 'transparent',
      color: theme.colors.text
    }
  }[variant];

  return (
    <button
      {...rest}
      style={{
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        borderRadius: theme.radii.sm,
        border: `1px solid ${theme.colors.border}`,
        background: palette.background,
        color: palette.color,
        fontWeight: 700,
        cursor: 'pointer',
        ...focusStyle(theme)
      }}
    >
      {children}
    </button>
  );
};

export default CTAButton;
