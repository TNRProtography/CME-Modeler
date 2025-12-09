export type PageViewStats = {
  daily: number;
  weekly: number;
  yearly: number;
  lifetime: number;
};

const PAGE_VIEW_EVENTS_KEY = 'sta_page_view_events_v1';
const PAGE_VIEW_LIFETIME_KEY = 'sta_page_view_lifetime_v1';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ONE_YEAR_MS = 365 * ONE_DAY_MS;

const loadEvents = (): number[] => {
  try {
    const raw = localStorage.getItem(PAGE_VIEW_EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is number => typeof value === 'number');
    }
    return [];
  } catch (err) {
    console.warn('Failed to parse page view events', err);
    return [];
  }
};

const saveEvents = (events: number[]) => {
  try {
    localStorage.setItem(PAGE_VIEW_EVENTS_KEY, JSON.stringify(events));
  } catch (err) {
    console.warn('Failed to persist page view events', err);
  }
};

const loadLifetimeCount = (): number => {
  try {
    const raw = localStorage.getItem(PAGE_VIEW_LIFETIME_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch (err) {
    console.warn('Failed to parse lifetime page views', err);
    return 0;
  }
};

const saveLifetimeCount = (count: number) => {
  try {
    localStorage.setItem(PAGE_VIEW_LIFETIME_KEY, `${count}`);
  } catch (err) {
    console.warn('Failed to persist lifetime page views', err);
  }
};

export const recordPageView = (): PageViewStats => {
  const now = Date.now();
  const events = loadEvents();
  const lifetime = loadLifetimeCount() + 1;

  // Keep only events from the last year to cap storage while enabling yearly stats
  const trimmedEvents = [...events.filter((ts) => now - ts <= ONE_YEAR_MS), now];
  saveEvents(trimmedEvents);
  saveLifetimeCount(lifetime);

  return calculateStats(trimmedEvents, lifetime, now);
};

export const calculateStats = (
  events: number[] = loadEvents(),
  lifetime = loadLifetimeCount(),
  now: number = Date.now()
): PageViewStats => {
  const withinDay = events.filter((ts) => now - ts <= ONE_DAY_MS).length;
  const withinWeek = events.filter((ts) => now - ts <= ONE_WEEK_MS).length;
  const withinYear = events.filter((ts) => now - ts <= ONE_YEAR_MS).length;

  return {
    daily: withinDay,
    weekly: withinWeek,
    yearly: withinYear,
    lifetime,
  };
};
