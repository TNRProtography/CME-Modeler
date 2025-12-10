import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import Card from './Card';
import Panel from './Panel';
import CTAButton from './CTAButton';
import AlertBanner from './AlertBanner';
import ChartFrame from './ChartFrame';
import TabbedLayout from './TabbedLayout';
import Stepper from './Stepper';
import DataTable from './DataTable';
import { ThemeProvider, baseTheme } from '../../theme';

const meta: Meta = {
  title: 'Primitives/Layout',
  decorators: [(Story) => <ThemeProvider value={baseTheme}>{Story()}</ThemeProvider>]
};

export default meta;

export const Cards: StoryObj = {
  render: () => (
    <Card title="Card title" actions={<CTAButton variant="ghost">Action</CTAButton>}>
      Content with shared surface styles
    </Card>
  )
};

export const Panels: StoryObj = {
  render: () => (
    <Panel title="Panel" description="Used for form steps">
      <CTAButton>Call to action</CTAButton>
    </Panel>
  )
};

export const Alerts: StoryObj = {
  render: () => <AlertBanner tone="warning" title="Threshold alert" message="Speed above configured Kp" />
};

export const ChartFrames: StoryObj = {
  render: () => <ChartFrame title="Chart" description="Exportable" isLoading />
};

export const TabsAndStepper: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <TabbedLayout
        ariaLabel="Demo tabs"
        tabs={[
          { id: 'a', label: 'A', content: 'Tab A content' },
          { id: 'b', label: 'B', content: 'Tab B content' }
        ]}
      />
      <Stepper
        steps={[
          { id: 'one', label: 'One', state: 'complete' },
          { id: 'two', label: 'Two', state: 'active' },
          { id: 'three', label: 'Three', state: 'upcoming' }
        ]}
      />
    </div>
  )
};

export const Tables: StoryObj = {
  render: () => (
    <DataTable
      caption="Sample table"
      data={[{ name: 'ENLIL', status: 'complete' }]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' }
      ]}
    />
  )
};
