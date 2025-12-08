import React, { useState } from 'react';
import Panel from './ui/Panel';
import { useTheme } from '../theme';
import CTAButton from './ui/CTAButton';

const AnalysisWorkspace: React.FC = () => {
  const { theme } = useTheme();
  const [paneRatio, setPaneRatio] = useState(60);

  return (
    <Panel
      title="Analysis workspace"
      description="Resizable panes for 3D trajectory, arrival timelines, sensitivity sliders, and overlays"
    >
      <div style={{ display: 'grid', gap: theme.spacing.md }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${paneRatio}% 4px ${100 - paneRatio}%`, alignItems: 'stretch' }}>
          <div
            style={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              padding: theme.spacing.md,
              background: theme.colors.surfaceMuted
            }}
            aria-label="3D trajectory viewer"
          >
            3D trajectory placeholder with overlays
          </div>
          <input
            type="range"
            min={30}
            max={70}
            value={paneRatio}
            onChange={(e) => setPaneRatio(Number(e.target.value))}
            aria-label="Resize workspace panes"
            style={{ writingMode: 'vertical-rl', height: '100%' }}
          />
          <div
            style={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              padding: theme.spacing.md,
              background: theme.colors.surfaceMuted
            }}
            aria-label="Arrival timelines"
          >
            Arrival timelines, sensitivity sliders, and overlays
          </div>
        </div>
        <div style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <input type="checkbox" defaultChecked aria-label="Sync crosshair" /> Sync crosshair/zoom
          </label>
          <CTAButton variant="ghost">Copy shareable URL</CTAButton>
        </div>
      </div>
    </Panel>
  );
};

export default AnalysisWorkspace;
