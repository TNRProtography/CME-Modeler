// Page views, counted by the page-views worker rather than on the device.
//
// The numbers are the app's: views today, this week and all time, and the
// visitor's own count. A visitor is an id made on first visit and kept in
// localStorage, so it follows the browser, not the person; clearing site data
// starts a new one. The worker counts a visitor at most once per half hour, so
// switching pages or reloading does not run the number up.

export type PageViewStats = {
  daily: number;
  weekly: number;
  lifetime: number;
  /** This visitor's own views. */
  yours: number;
};

const PAGE_VIEWS_URL = `${import.meta.env.VITE_PAGE_VIEWS_ENDPOINT || 'https://page-views.thenamesrock.workers.dev'}/page-views`;
const VIEWER_ID_KEY = 'sta_viewer_id_v1';
// What older versions counted on this device. Sent once, so a regular's own
// number carries over instead of restarting at 1.
const OLD_LIFETIME_KEY = 'sta_page_view_lifetime_v1';

const newId = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

function viewerId(): string {
  try {
    const stored = localStorage.getItem(VIEWER_ID_KEY);
    if (stored && /^[A-Za-z0-9-]{16,64}$/.test(stored)) return stored;
    const id = newId();
    localStorage.setItem(VIEWER_ID_KEY, id);
    return id;
  } catch {
    // Storage blocked: an id for this visit only.
    return newId();
  }
}

function oldLocalCount(): number {
  try {
    const n = parseInt(localStorage.getItem(OLD_LIFETIME_KEY) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

const normalize = (s: any): PageViewStats => ({
  daily: Number(s?.daily) || 0,
  weekly: Number(s?.weekly) || 0,
  lifetime: Number(s?.lifetime) || 0,
  yours: Number(s?.yours) || 0,
});

/** Count this visit and return the numbers, or null if the counter did not answer. */
export const recordPageView = async (): Promise<PageViewStats | null> => {
  try {
    const res = await fetch(PAGE_VIEWS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: viewerId(), seed: oldLocalCount() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`counter answered ${res.status}`);
    const stats = normalize(await res.json());
    // The server has the old count now; the device's copy is done with.
    try { localStorage.removeItem(OLD_LIFETIME_KEY); localStorage.removeItem('sta_page_view_events_v1'); } catch { /* blocked */ }
    return stats;
  } catch (err) {
    console.warn('Page view counter unavailable', err);
    return null;
  }
};

/** The numbers as they stand, without counting a view. Null if the counter did not answer. */
export const fetchPageViewStats = async (): Promise<PageViewStats | null> => {
  try {
    const res = await fetch(`${PAGE_VIEWS_URL}?id=${encodeURIComponent(viewerId())}`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? normalize(await res.json()) : null;
  } catch {
    return null;
  }
};
