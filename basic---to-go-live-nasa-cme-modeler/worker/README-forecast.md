# Spot The Aurora - Solar Wind Forecast Worker

Computes one solar wind forecast on a schedule, serves it to every client, and
scores it afterwards against what the spacecraft at L1 actually measured.

## Why server-side

Three reasons, and the third is the one that matters.

1. **Phones do no physics.** The arrival ensemble is a few hundred runs.
2. **Every device shows the same numbers.** Two people comparing screens and
   seeing different forecasts is a support problem that simply does not arise
   if there is one forecast.
3. **Notifications can use it.** A forecast that only exists inside an open
   browser tab cannot tell anybody a stream is arriving tonight, and that is
   most of the value.

The app falls back to computing the same forecast on-device when this Worker is
unreachable, so the feature degrades rather than disappearing. It is literally
the same modules - the fallback cannot drift from the server, because there is
only one copy of the physics - and the panel says which one it used.

## What it cannot do

**Detect coronal holes.** That needs canvas pixel access, which a Worker does
not have. Detection stays in the browser and results are posted to
`ch-history-worker`; this reads them back.

If no client has opened the app recently there is nothing fresh to read. The
forecast then marks itself `stale: true` rather than serving old holes as
current, and the UI says so.

## Endpoints

| Route | Returns |
|---|---|
| `GET /forecast` | The current timeline, outlook and streams |
| `GET /track-record` | Scored arrivals and the summary built from them |
| `GET /health` | Whether a forecast exists and how old it is |

All responses are CORS-open and cached for five minutes.

### `/forecast` shape

```jsonc
{
  "ok": true,
  "generatedAtMs": 1758499200000,
  "coronalHolesAsOfMs": 1758495600000,
  "stale": false,
  "streams": [ { "id": "CH96", "centralMeridianMs": 0, "peakSpeedKms": 650,
                 "widthDeg": 56, "bySign": -1, "earthConnection": 0.9 } ],
  "timeline": [ { "atMs": 0, "speedKms": 420, "densityCm3": 5, "btNt": 5,
                  "bzFromSectorNt": -1.8, "bzFluctuationNt": 2.0,
                  "source": "observed", "disturbance": "ambient" } ],
  "outlook":  [ { "atMs": 0, "boundaryLikely": -62.1, "boundaryBest": -58.7 } ]
}
```

Two fields are deliberately separate and must stay that way:

- `bzFromSectorNt` - the southward field the sector geometry **guarantees**.
  Computable, because Earth's dipole tilt is known for any moment.
- `bzFluctuationNt` - the **size** of the swings on top. Their sign is not
  forecastable at any useful range.

Anything that adds these together and calls the result a forecast Bz is
claiming something unknowable. Don't.

## Scheduling

Hourly at minute 7 (`7 * * * *`). The inputs move slower: coronal holes are
re-detected every couple of hours by whichever client is open, and the L1 feed
updates every minute but the forecast depends on its daily shape.

Each run does two things:

1. **Forecast** - read holes and observed wind, build the timeline, store it,
   and record what was promised so it can be marked later.
2. **Score** - mark any forecast whose window has closed against what arrived.

## Scoring, and why it is conservative

The arrival detector wants a sustained rise that stays up, not a spike. Noisy
quiet wind, a two-hour excursion and a 40 km/s drift all return nothing.

The asymmetry is deliberate. A **missed** arrival costs one data point. A
**false** one scores a forecast against something that never happened - and a
corrupted track record is worse than no track record, because people believe
it.

The track record reports the 80 % band hit rate honestly in both directions:
far below 0.8 means the bands are too narrow and the intervals are optimistic;
100 % means they are padded. Below eight scored forecasts it says nothing about
the band at all, rather than quoting a hit rate from three samples.

## Deploying

```bash
npx wrangler kv namespace create FORECAST_KV
# paste the returned id into wrangler-forecast.toml
npx wrangler deploy --config wrangler-forecast.toml
```

Then check:

```bash
curl -s https://solar-forecast-worker.<subdomain>.workers.dev/health
```

`hasForecast: false` immediately after deploy is expected - nothing has run
yet. It fills in on the next cron, or you can trigger one from the Cloudflare
dashboard.

If the Worker name or subdomain differs from
`solar-forecast-worker.thenamesrock.workers.dev`, update `FORECAST_WORKER` in
`hooks/useForecast.ts` to match.

## KV keys

| Key | Contents | Lifetime |
|---|---|---|
| `forecast:timeline:current` | The served forecast | 24 h TTL |
| `forecast:pending` | Forecasts awaiting scoring | 60 most recent |
| `forecast:scores` | Scored arrivals | 200 most recent |

Nothing here is personal data and nothing is secret. It can be wiped at any
time; the next cron rebuilds the forecast, and only the track record is lost.

## Files

| File | Role |
|---|---|
| `worker/forecast-worker.js` | Handlers, KV access, scheduling |
| `worker/forecast-entry.js` | Imports the app's physics modules and wires them in |
| `wrangler-forecast.toml` | Name, cron, KV binding |

The entry point imports from `utils/` rather than reimplementing anything. That
is why those modules are plain functions with no browser dependencies: one drag
model, one coupling function, one definition of which holes can reach Earth. A
second copy living in a Worker is a second thing to drift, and drift between a
server forecast and the same forecast drawn on a phone is the bug nobody can
reproduce.
