// One download for the whole app, however many panels want it.
//
// The same file is often wanted by several parts of the page at once - the
// L1 solar wind feed is read by five of them on their own timers - and each
// used to download it separately. This shares one request between everyone
// who asks for the same address within a few seconds of each other, and
// hands each of them the result.
//
// The request itself always goes to the source (a cache-buster is added), so
// sharing never means showing something old: at worst a panel gets data a
// few seconds younger than it would have fetched itself.

const inflight = new Map<string, { at: number; promise: Promise<string> }>();

declare global {
  interface Window {
    /** Requests index.html started before the app loaded, by address. */
    __stBoot?: Record<string, { at: number; promise: Promise<string> }>;
  }
}

/**
 * A request index.html already started for this address, handed over once.
 * index.html starts the landing page's core feeds while the JavaScript is
 * still downloading; the first panel to ask takes the request over rather
 * than making its own.
 */
function takeBootRequest(key: string, maxAgeMs: number, timeoutMs?: number): { at: number; promise: Promise<string> } | null {
  const boot = typeof window !== 'undefined' ? window.__stBoot?.[key] : undefined;
  if (!boot) return null;
  delete window.__stBoot![key];
  if (Date.now() - boot.at >= maxAgeMs) return null;
  if (!timeoutMs) return boot;
  // The same limit the caller would have put on its own request.
  const waited = Date.now() - boot.at;
  const promise = Promise.race([
    boot.promise,
    new Promise<string>((_, reject) => setTimeout(
      () => reject(new Error(`Timed out: ${key}`)), Math.max(0, timeoutMs - waited))),
  ]);
  return { at: boot.at, promise };
}

/** Strip the cache-buster callers add, so the same file is the same key. */
const keyOf = (url: string) => url.replace(/([?&])_=\d+&?/, '$1').replace(/[?&]$/, '');

/**
 * The response body as text. Shared with any other request for the same
 * address made within `maxAgeMs`.
 */
export function sharedFetchText(url: string, opts: { maxAgeMs?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxAgeMs = opts.maxAgeMs ?? 10000;
  const key = keyOf(url);
  const now = Date.now();
  const hit = inflight.get(key);
  if (hit && now - hit.at < maxAgeMs) return hit.promise;
  const boot = takeBootRequest(key, maxAgeMs, opts.timeoutMs);
  if (boot) {
    inflight.set(key, boot);
    boot.promise.catch(() => { if (inflight.get(key) === boot) inflight.delete(key); });
    return boot.promise;
  }

  const bust = `${key}${key.includes('?') ? '&' : '?'}_=${now}`;
  const controller = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
  const promise = fetch(bust, { signal: controller.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
      return res.text();
    })
    .finally(() => { if (timer) clearTimeout(timer); });
  inflight.set(key, { at: now, promise });
  // A failure is not worth sharing: the next caller should try again.
  promise.catch(() => { if (inflight.get(key)?.promise === promise) inflight.delete(key); });
  return promise;
}

export async function sharedFetchJson<T = unknown>(url: string, opts: { maxAgeMs?: number; timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await sharedFetchText(url, opts)) as T;
}
