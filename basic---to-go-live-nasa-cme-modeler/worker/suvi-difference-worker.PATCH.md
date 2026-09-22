# Keeping SUVI frames for a week

The SUVI difference imagery worker is deployed from the Cloudflare dashboard
and has no repository, so this is the change to paste in rather than a diff
that can be applied. Written against the version pasted on 22 Sept 2026.

## Why it is not one constant

`TWENTY_FOUR_HOURS_MS` is doing four different jobs:

| Used by | What it actually controls |
|---|---|
| `pruneOld` | how long frames are **kept** |
| `listRecent` | how many frames `/api/state` and `/api/frames` **return** |
| `backfillSuvi` | how far back a backfill **looks** |
| `migrateExistingToJpg` | which objects the migration touches |

Only the first is what "keep a week" means. Changing the one constant changes
all four, and the second is the expensive one: at the observed cadence of
about 330 frames a day per source, four sources over seven days is roughly
**9,200 objects**. Every one becomes an entry in `/api/state`, which every
client downloads on load and which `writeStateCache` writes to R2 on every
cron run.

```
/api/state payload      now (24h):  0.53 MB
                        at 7 days:  3.70 MB
```

So retention goes to a week and the summary stays at a day. The full week is
one request away on `/api/frames`, which is what that endpoint is already for
- the built-in UI calls it behind a "Load full frames" button precisely so
the summary stays small.

Storage is about **1.1 GB**, against a 10 GB free allowance. Fine, but it is
real, and it is worth knowing before rather than after.

One thing this cannot do: NOAA's own directory listing only holds about a
day, so a backfill cannot reach back a week. The archive fills forward - you
have a week of history a week from now. `BACKFILL_WINDOW_MS` stays at a day
for that reason; raising it would just re-scan the same listing.

---

## 1. Replace the constant

**Remove:**

```js
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
```

**Add:**

```js
const HOUR_MS = 60 * 60 * 1000;

/** How long frames are kept in R2. This is the retention window. */
const RETENTION_MS = 7 * 24 * HOUR_MS;

/**
 * How much /api/state carries.
 *
 * Retention and payload are separate questions. A week of frames across four
 * sources is roughly 9,200 objects, and putting all of them in the summary
 * makes it several megabytes that every client downloads on load and that
 * writeStateCache re-writes to R2 on every cron run. The summary stays a day;
 * the full week is one request away on /api/frames.
 */
const STATE_WINDOW_MS = 24 * HOUR_MS;

/**
 * The furthest back a backfill looks.
 *
 * NOAA's directory listing only holds about a day, so raising this would
 * re-scan the same listing for nothing. The archive fills forward.
 */
const BACKFILL_WINDOW_MS = 24 * HOUR_MS;
```

## 2. Add a query helper

Put this with the other helpers, near `extensionFromName`:

```js
/**
 * A window in hours from the query string, clamped to what is actually kept.
 *
 * Unclamped, ?hours=100000 would list the whole bucket on every call.
 */
function windowFromQuery(url, fallbackMs) {
  const raw = url.searchParams.get("hours");
  if (!raw) return fallbackMs;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return fallbackMs;
  return Math.min(hours * HOUR_MS, RETENTION_MS);
}
```

## 3. `listRecent` takes a window

```js
async function listRecent(env, prefix, windowMs = STATE_WINDOW_MS) {
```

and inside it:

```js
  const cutoff = Date.now() - windowMs;      // was TWENTY_FOUR_HOURS_MS
```

## 4. `buildStateFast` passes it through

```js
async function buildStateFast(env, windowMs = STATE_WINDOW_MS) {
```

In the `out` object, so a client can tell what it was given:

```js
    window_hours: Math.round(windowMs / HOUR_MS),
    retention_hours: Math.round(RETENTION_MS / HOUR_MS),
```

And in the `Promise.all`:

```js
        listRecent(env, `raw/${source.key}/`, windowMs),
```

## 5. `/api/state` accepts `?hours=`

```js
      if (url.pathname === "/api/state") {
        const windowMs = windowFromQuery(url, STATE_WINDOW_MS);
        // The cache holds the default window only. Anything wider is built
        // live - caching every window somebody might ask for is how a cache
        // turns into the slow path.
        const stateData = windowMs === STATE_WINDOW_MS
          ? (await readStateCache(env)) || (await buildStateFast(env, windowMs))
          : await buildStateFast(env, windowMs);
        return jsonCacheable(stateData, 30);
      }
```

`writeStateCache` needs no change: it calls `buildStateFast(env)` and so
caches the default window, which is the one worth caching.

## 6. `/api/frames` serves the full week

```js
        const windowMs = windowFromQuery(url, RETENTION_MS);
        const frames = await listRecent(env, `raw/${source}/`, windowMs);
        return json({
          ok: true,
          source,
          window_hours: Math.round(windowMs / HOUR_MS),
          retention_hours: Math.round(RETENTION_MS / HOUR_MS),
          diff_defaults: DEFAULT_DIFF_CONFIG,
          storage_format: STORAGE_FORMAT,
          frames,
        });
```

## 7. `pruneOld` keeps a week, and deletes in batches

```js
async function pruneOld(env) {
  const cutoff = Date.now() - RETENTION_MS;
  let cursor;
  const toDelete = [];

  do {
    const page = await env.SUVI_BUCKET.list({ limit: 1000, cursor });
    for (const obj of page.objects) {
      if (obj.key.startsWith("meta/")) continue;
      const ts = compactKeyToIso(obj.key);
      if (ts && Date.parse(ts) < cutoff) toDelete.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // R2 takes up to 1000 keys per delete. One at a time was fine against a
  // day of frames; against a week it is a thousand round trips inside a
  // waitUntil that can be cut off, which silently leaves the bucket growing.
  for (let i = 0; i < toDelete.length; i += 1000) {
    await env.SUVI_BUCKET.delete(toDelete.slice(i, i + 1000));
  }
  return { ok: true, deleted: toDelete.length, retention_hours: RETENTION_MS / HOUR_MS };
}
```

## 8. The other two cutoffs, said explicitly

In `backfillSuvi`:

```js
  const cutoff = Date.now() - BACKFILL_WINDOW_MS;
```

In `migrateExistingToJpg` - this one should follow retention, so a week of
PNGs can still be converted rather than skipped as "outside window":

```js
  const cutoff = Date.now() - RETENTION_MS;
```

## 9. `/health` reports it

```js
          retention_hours: RETENTION_MS / HOUR_MS,
          state_window_hours: STATE_WINDOW_MS / HOUR_MS,
```

## 10. The built-in UI text

In `renderAppHtml`, the description reads "24-hour rolling archive". It is a
week now:

```
        7-day rolling archive of official NOAA SWPC SUVI imagery with duplicate filtering.
```

and the two buttons that say 24h:

```js
      <button id="backfillNow">Backfill last 24 hours</button>
```
stays as it is - backfill genuinely only reaches a day - but the frame loader
should ask for the week:

```js
    const res = await fetch(`/api/frames?source=${encodeURIComponent(sourceKey)}&hours=168`, { cache: "no-store" });
```

with its label changed from `"Load full 24h frames"` to `"Load full history"`.

---

## Checking it worked

```
curl -s https://suvi-difference-imagery.thenamesrock.workers.dev/health | jq
```
should show `retention_hours: 168`.

```
curl -s ".../api/frames?source=suvi_195_primary&hours=168" | jq '.frames | length'
```
returns what is actually stored - about 330 the day you deploy this, growing
to about 2,300 after a week. That growth is how you know pruning is no longer
cutting at a day.

```
curl -s ".../api/state" | jq '.window_hours, (.sources.suvi_195_primary.frames | length)'
```
should stay at 24 and about 330. If that number starts climbing, the summary
is carrying the full week and step 5 did not take.
