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
