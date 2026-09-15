type TickHandler = () => Promise<void> | void;

interface DatasetTicker {
  handler: TickHandler;
  intervalMs: number;
  timer: number;
  subscribers: number;
  running: boolean; // guards against overlapping fetches when a request is slow (e.g. weak rural signal)
  lastRunAt: number;
}

const registry = new Map<string, DatasetTicker>();

let listenersBound = false;

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;
const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

// Paused while the tab is backgrounded or the device is offline - no point spending
// bandwidth refreshing data nobody can see, or retrying into a dead connection.
const runTicker = (key: string, ticker: DatasetTicker) => {
  if (ticker.running || isHidden() || !isOnline()) return;
  ticker.running = true;
  if (import.meta.env.DEV) console.info('[polling] tick', key);
  Promise.resolve()
    .then(() => ticker.handler())
    .catch(() => {})
    .finally(() => {
      ticker.running = false;
      ticker.lastRunAt = Date.now();
    });
};

// When the tab regains focus or the connection comes back, immediately refresh
// anything that's gone stale rather than waiting up to a full interval - keeps the
// app feeling live without polling any harder while backgrounded.
const catchUpStale = () => {
  if (isHidden() || !isOnline()) return;
  const now = Date.now();
  registry.forEach((ticker, key) => {
    if (now - ticker.lastRunAt >= ticker.intervalMs) {
      runTicker(key, ticker);
    }
  });
};

const bindGlobalListenersOnce = () => {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) catchUpStale();
  });
  window.addEventListener('online', catchUpStale);
  // Returning to a page restored from the back/forward cache - common on
  // mobile Safari, where it can happen without a usable visibilitychange.
  // Without this the tab comes back showing however old the data was when
  // it was frozen.
  window.addEventListener('pageshow', catchUpStale);
};

export const registerDatasetTicker = (key: string, handler: TickHandler, intervalMs = 60_000): (() => void) => {
  bindGlobalListenersOnce();

  const existing = registry.get(key);
  if (existing) {
    existing.subscribers += 1;
    return () => unregister(key);
  }

  const ticker: DatasetTicker = {
    handler,
    intervalMs,
    timer: window.setInterval(() => runTicker(key, ticker), intervalMs),
    subscribers: 1,
    running: false,
    lastRunAt: Date.now(),
  };
  registry.set(key, ticker);

  return () => unregister(key);
};

const unregister = (key: string) => {
  const current = registry.get(key);
  if (!current) return;
  current.subscribers -= 1;
  if (current.subscribers <= 0) {
    window.clearInterval(current.timer);
    registry.delete(key);
  }
};
