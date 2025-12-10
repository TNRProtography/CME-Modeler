export type ColorTokens = {
  primary: string;
  secondary: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  muted: string;
  danger: string;
  warning: string;
  success: string;
  text: string;
  textSubtle: string;
  focus: string;
};

export type TypographyTokens = {
  fontFamily: string;
  headings: { [key: string]: string };
  body: string;
  mono: string;
};

export type SpacingScale = {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
};

export type ZIndexTokens = {
  base: number;
  overlay: number;
  modal: number;
  popover: number;
};

export type ChartPalette = {
  primary: string[];
  diverging: string[];
  sequential: string[];
};

export interface ThemeTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingScale;
  zIndex: ZIndexTokens;
  chartPalette: ChartPalette;
  radii: {
    sm: string;
    md: string;
    lg: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

export const baseTheme: ThemeTokens = {
  colors: {
    primary: '#1b74e4',
    secondary: '#0b3d91',
    surface: '#0c1220',
    surfaceMuted: '#11182a',
    border: '#2b3550',
    muted: '#7b88a8',
    danger: '#ff4d6d',
    warning: '#f6c15b',
    success: '#5ed89b',
    text: '#f0f4ff',
    textSubtle: '#aeb9d5',
    focus: '#9bd5ff'
  },
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    headings: {
      h1: '700 28px/36px',
      h2: '700 22px/30px',
      h3: '600 18px/26px'
    },
    body: '400 16px/24px',
    mono: "'JetBrains Mono', 'SFMono-Regular', monospace"
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px'
  },
  zIndex: {
    base: 1,
    overlay: 10,
    modal: 20,
    popover: 30
  },
  chartPalette: {
    primary: ['#5ed89b', '#9bd5ff', '#f6c15b', '#ff8fa3', '#8ec5ff'],
    diverging: ['#ff6b6b', '#ff9f43', '#6c5ce7', '#2ed573'],
    sequential: ['#0b3d91', '#1b74e4', '#5ed89b', '#f6c15b']
  },
  radii: {
    sm: '6px',
    md: '10px',
    lg: '14px'
  },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.2)',
    md: '0 6px 16px rgba(0,0,0,0.25)',
    lg: '0 12px 32px rgba(0,0,0,0.35)'
  }
};
