// "The app is up": the loading screen has gone and the first page is showing.
//
// While the loading screen is up, the network and the main thread belong to
// what it is waiting for - the forecast score and the solar wind. Anything
// the person cannot see yet (a background photo behind the loader, a map
// further down the page, the imagery preload, code for pages they have not
// opened) waits for this, so it does not slow down what they are waiting on.

import { useEffect, useState } from 'react';

let ready = false;
const waiting = new Set<() => void>();

/** Called by App when the loading screen has gone. */
export function markAppReady(): void {
  if (ready) return;
  ready = true;
  waiting.forEach((resolve) => resolve());
  waiting.clear();
}

export const isAppReady = (): boolean => ready;

export function whenAppReady(): Promise<void> {
  return ready ? Promise.resolve() : new Promise((resolve) => { waiting.add(resolve); });
}

/** After the app is up and the browser next has a quiet moment. */
export function whenAppIdle(timeoutMs = 2000): Promise<void> {
  return whenAppReady().then(() => new Promise<void>((resolve) => {
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    else setTimeout(resolve, 300);
  }));
}

/** True once the app is up; for rendering something only after that. */
export function useAppReady(): boolean {
  const [isReady, setIsReady] = useState(ready);
  useEffect(() => {
    if (isReady) return;
    let live = true;
    whenAppReady().then(() => { if (live) setIsReady(true); });
    return () => { live = false; };
  }, [isReady]);
  return isReady;
}
