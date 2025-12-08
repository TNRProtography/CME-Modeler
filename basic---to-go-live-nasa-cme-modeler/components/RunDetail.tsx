import React from 'react';
import Card from './ui/Card';
import DataTable from './ui/DataTable';
import ChartFrame from './ui/ChartFrame';
import { useTheme } from '../theme';

interface TimelineItem {
  label: string;
  status: 'complete' | 'running' | 'pending';
  detail: string;
}

const runTimeline: TimelineItem[] = [
  { label: 'Fetch catalog', status: 'complete', detail: 'SOHO/LASCO - 2024-05-01' },
  { label: 'Model queue', status: 'running', detail: 'ENLIL, DBM (fast track)' },
  { label: 'Monte Carlo', status: 'pending', detail: 'Pending 2k particles' }
];

const modelComparison = [
  { model: 'ENLIL', arrival: '14:22 UTC', speed: 820, kp: '6+' },
  { model: 'DBM', arrival: '15:10 UTC', speed: 790, kp: '6' },
  { model: 'ANM', arrival: '16:45 UTC', speed: 760, kp: '5' }
];

const RunDetail: React.FC = () => {
  const { theme } = useTheme();
  return (
    <div style={{ display: 'grid', gap: theme.spacing.lg }}>
      <Card title="Run detail" actions={<span style={{ color: theme.colors.textSubtle }}>Download CSV/JSON/image</span>}>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: theme.spacing.sm }}>
          {runTimeline.map((item) => (
            <li key={item.label} style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
              <span
                aria-label={`${item.status} status`}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background:
                    item.status === 'complete'
                      ? theme.colors.success
                      : item.status === 'running'
                      ? theme.colors.warning
                      : theme.colors.muted
                }}
              />
              <div>
                <div style={{ fontWeight: 700 }}>{item.label}</div>
                <div style={{ color: theme.colors.textSubtle }}>{item.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Model comparison">
        <DataTable
          caption="Arrival windows and KP estimates"
          data={modelComparison}
          columns=[
            { key: 'model', label: 'Model' },
            { key: 'arrival', label: 'Arrival time' },
            { key: 'speed', label: 'Speed (km/s)' },
            { key: 'kp', label: 'Kp estimate' }
          ]
        />
      </Card>
      <ChartFrame
        title="Arrival probability bands"
        description="Percentile bands derived from Monte Carlo ensemble"
        onExport={() => alert('Exporting CSV...')}
        onDownloadImage={() => alert('Downloading chart image...')}
      >
        <div style={{ color: theme.colors.textSubtle }}>Chart placeholder with percentile ribbons</div>
      </ChartFrame>
      <Card title="Artifacts">
        <ul style={{ margin: 0, paddingLeft: theme.spacing.lg }}>
          <li>CSV of trajectory samples</li>
          <li>JSON model inputs</li>
          <li>PNG export of comparison chart</li>
        </ul>
      </Card>
    </div>
  );
};

export default RunDetail;
