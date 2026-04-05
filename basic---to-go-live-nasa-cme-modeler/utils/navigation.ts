// Centralized navigation helpers and keys used across the app shell.

export const PAGE_PATHS: Record<'forecast' | 'solar-activity' | 'modeler', string> = {
  forecast: '/spot-the-aurora-forecast',
  'solar-activity': '/solar-dashboard',
  modeler: '/cme-visualization',
};

export const SETTINGS_PATH = '/settings';
export const TUTORIAL_PATH = '/tutorial';
export const DEBUG_PATH = '/debug';
export const DEFAULT_MAIN_PAGE_KEY = 'sta_default_main_page';
export const DEFAULT_FORECAST_VIEW_KEY = 'sta_default_forecast_view';

export const FORECAST_SIMPLE_VIEW_SLUG = 'simple-view';
export const FORECAST_ADVANCED_VIEW_SLUG = 'advanced-view';

const VIEW_TO_SLUG: Record<'simple' | 'advanced', string> = {
  simple: FORECAST_SIMPLE_VIEW_SLUG,
  advanced: FORECAST_ADVANCED_VIEW_SLUG,
};

const SLUG_TO_VIEW: Record<string, 'simple' | 'advanced'> = {
  [FORECAST_SIMPLE_VIEW_SLUG]: 'simple',
  [FORECAST_ADVANCED_VIEW_SLUG]: 'advanced',
};

export const getForecastPath = (view: 'simple' | 'advanced', modalSlug?: string | null): string => {
  const suffix = modalSlug ? `-${modalSlug}` : '';
  return `${PAGE_PATHS.forecast}-${VIEW_TO_SLUG[view]}${suffix}`;
};

export const getPageAndSlugFromPathname = (
  pathname: string
): { page: 'forecast' | 'solar-activity' | 'modeler' | null; slug: string | null } => {
  const sortedEntries = Object.entries(PAGE_PATHS).sort((a, b) => b[1].length - a[1].length) as Array<
    ['forecast' | 'solar-activity' | 'modeler', string]
  >;

  for (const [page, basePath] of sortedEntries) {
    if (pathname === basePath) return { page, slug: null };
    if (pathname.startsWith(`${basePath}-`)) {
      const slug = pathname.slice(basePath.length + 1);
      return { page, slug: slug || null };
    }
  }

  return { page: null, slug: null };
};

export const getForecastViewFromSlug = (slug: string | null): 'simple' | 'advanced' | null => {
  if (!slug) return null;
  const [first, second] = slug.split('-');
  if (!first || !second) return null;
  const head = `${first}-${second}`;
  return SLUG_TO_VIEW[head] ?? null;
};

export const getForecastModalSlugFromSlug = (slug: string | null): string | null => {
  if (!slug) return null;
  const parts = slug.split('-');
  if (parts.length <= 2) return null;
  return parts.slice(2).join('-') || null;
};

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
  return getPageAndSlugFromPathname(pathname).page;
};
