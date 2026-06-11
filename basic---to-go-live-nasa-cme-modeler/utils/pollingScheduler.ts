type TickHandler = () => Promise<void> | void;

interface DatasetTicker {
  timer: number;
  subscribers: number;
}

const registry = new Map<string, DatasetTicker>();

export const registerDatasetTicker = (key: string, handler: TickHandler, intervalMs = 60_000): (() => void) => {
  const existing = registry.get(key);
  if (existing) {
    existing.subscribers += 1;
    return () => {
      const current = registry.get(key);
      if (!current) return;
      current.subscribers -= 1;
      if (current.subscribers <= 0) {
        window.clearInterval(current.timer);
        registry.delete(key);
      }
    };
  }

  const timer = window.setInterval(() => {
    if (import.meta.env.DEV) console.info('[polling] tick', key);
    void handler();
  }, intervalMs);

  registry.set(key, { timer, subscribers: 1 });

  return () => {
    const current = registry.get(key);
    if (!current) return;
    current.subscribers -= 1;
    if (current.subscribers <= 0) {
      window.clearInterval(current.timer);
      registry.delete(key);
    }
  };
};
