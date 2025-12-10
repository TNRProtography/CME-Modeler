import type { Preview } from '@storybook/react';
import React from 'react';
import { ThemeProvider, baseTheme } from '../theme';

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider value={baseTheme}>
        <div style={{ padding: 16, background: baseTheme.colors.surface }}>
          <Story />
        </div>
      </ThemeProvider>
    )
  ]
};

export default preview;
