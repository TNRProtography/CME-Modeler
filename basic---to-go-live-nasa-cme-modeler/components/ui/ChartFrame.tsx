import React, { ReactNode, useState } from 'react';
import { useTheme, focusStyle } from '../../theme';

interface ChartFrameProps {
  title: string;
  description?: string;
  children?: ReactNode;
  isLoading?: boolean;
  onExport?: () => void;
  onDownloadImage?: () => void;
}

const ChartFrame: React.FC<ChartFrameProps> = ({
  title,
  description,
  children,
  isLoading,
  onExport,
  onDownloadImage
}) => {
  const { theme } = useTheme();
  const [showSkeleton] = useState(isLoading);

  return (
    <section aria-label={title} style={{ fontFamily: theme.typography.fontFamily }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm }}>
        <div>
          <div style={{ font: theme.typography.headings.h2 }}>{title}</div>
          {description && (
            <p style={{ margin: 0, color: theme.colors.textSubtle, font: theme.typography.body }}>{description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: theme.spacing.sm }} aria-label="chart controls">
          <button
            type="button"
            aria-label="Export data"
            onClick={onExport}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              background: theme.colors.surfaceMuted,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              color: theme.colors.text,
              cursor: 'pointer',
              ...focusStyle(theme)
            }}
          >
            Export
          </button>
          <button
            type="button"
            aria-label="Download chart image"
            onClick={onDownloadImage}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              background: theme.colors.surfaceMuted,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              color: theme.colors.text,
              cursor: 'pointer',
              ...focusStyle(theme)
            }}
          >
            Image
          </button>
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.md,
          padding: theme.spacing.md,
          minHeight: 220,
          background: theme.colors.surfaceMuted
        }}
      >
        {showSkeleton ? (
          <div
            aria-label="Loading chart"
            style={{
              height: 160,
              borderRadius: theme.radii.sm,
              background: `linear-gradient(90deg, ${theme.colors.surface} 0%, ${theme.colors.surfaceMuted} 50%, ${theme.colors.surface} 100%)`,
              animation: 'pulse 1.5s ease-in-out infinite'
            }}
          />
        ) : (
          children
        )}
      </div>
    </section>
  );
};

export default ChartFrame;
