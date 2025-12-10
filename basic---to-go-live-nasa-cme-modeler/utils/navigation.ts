// Centralized navigation helpers and keys used across the app shell.

export const PAGE_PATHS: Record<'forecast' | 'solar-activity' | 'modeler', string> = {
  forecast: '/spot-the-aurora-forecast',
  'solar-activity': '/solar-dashboard',
  modeler: '/cme-visualization',
};

export const SETTINGS_PATH = '/settings';
export const TUTORIAL_PATH = '/tutorial';
export const DEFAULT_MAIN_PAGE_KEY = 'sta_default_main_page';
export const DEFAULT_FORECAST_VIEW_KEY = 'sta_default_forecast_view';

export const getForecastViewFromSearch = (
  search: string
): 'simple' | 'advanced' | null => {
  const params = new URLSearchParams(search);
  const viewParam = params.get('view');
  if (viewParam === 'advanced' || viewParam === 'simple') return viewParam;
  return null;
};

export const getPageFromPathname = (
  pathname: string
): 'forecast' | 'solar-activity' | 'modeler' | null => {
  if (pathname.startsWith(PAGE_PATHS['solar-activity'])) return 'solar-activity';
  if (pathname.startsWith(PAGE_PATHS['modeler'])) return 'modeler';
  if (pathname.startsWith(PAGE_PATHS['forecast'])) return 'forecast';
  return null;
};
