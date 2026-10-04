# Deploying the workers from this repo

Every Cloudflare Worker the app uses lives in this folder, with a settings
file (`wrangler-*.toml`) next to `package.json`. Each settings file matches
the Cloudflare dashboard as it was when the worker was copied in.

**A deploy replaces the worker's bindings, variables and crons with exactly
what its settings file lists.** Change them in the file, not the dashboard,
or the next deploy undoes the dashboard change. Secrets are the exception:
they are set in the dashboard only, are never in this repo (it is public),
and survive deploys.

| Worker | Code | Settings | Cron | Secrets |
| --- | --- | --- | --- | --- |
| spottheaurora | `spottheaurora-worker.js` | `wrangler-spottheaurora.toml` | every 5 min | OWM_API_KEY |
| noaa-enlil-proxy | `noaa-enlil-proxy-worker.js` | `wrangler-noaa-enlil-proxy.toml` | none | none |
| banner-api | `banner-api-worker.js` | `wrangler-banner-api.toml` | none | BANNER_AUTH_TOKEN |
| ch-history-worker | `ch-history-worker.js` | `wrangler-ch-history.toml` | every 2 h | none |
| solo-worker | `solo-worker.js` | `wrangler-solo.toml` | hourly | none |
| aurora-sightings | `aurora-sightings-worker.js` | `wrangler-aurora-sightings.toml` | midnight UTC | none |
| aurora-index-sta | `aurora-index-sta-worker.js` | `wrangler-aurora-index-sta.toml` | none | none |
| nasa-donki-api | `nasa-donki-api-worker.js` | `wrangler-nasa-donki-api.toml` | every minute | NASA_API_KEY |
| imap-solar-data-test | `imap-solar-data-worker.js` | `wrangler-imap-solar-data.toml` | none | none |
| suvi-difference-imagery | `suvi-difference-worker.js` | `wrangler-suvi.toml` | every 2 min | none |
| epam | `epam-worker.js` | `wrangler-epam.toml` | every 3 min | none |
| sdo-imagery | `sdo-imagery-worker.ts` | `wrangler-sdo-imagery.toml` | every 5 min | none |
| cme-orientation | `cme-orientation-worker.js` | `wrangler-cme-orientation.toml` | none (GitHub Action uploads) | INGEST_TOKEN |
| coronagraphy-processing | `coronagraph-worker.js` | `wrangler-coronagraph.toml` | every 5 min | none |
| push-notification-worker | `push-notification-worker.js` | `wrangler-push.toml` | every minute | VAPID_PRIVATE_KEY, TRIGGER_SECRET, BANNER_AUTH_TOKEN |
| spot-the-aurora-forecast-worker | `forecast-entry.js` | `wrangler-forecast.toml` | hourly at :07 | none |
| sunspot-history | `sunspot-history-worker.ts` | `wrangler-sunspot-history.toml` | every 15 min | none |
| spot-the-aurora-image-proxy | `index.ts` | `wrangler.toml` | none | none |

## Connecting a worker (one at a time)

In the dashboard: the worker, then **Settings, Build**, then **Connect** to
`TNRProtography/CME-Modeler`, and set:

- **Branch:** `main`
- **Root directory:** `basic---to-go-live-nasa-cme-modeler`
- **Build command:** leave empty
- **Deploy command:** `npx wrangler deploy -c wrangler-<name>.toml`
- **Build watch paths** (so a push only redeploys workers that changed):
  include `worker/<code file>` and `wrangler-<name>.toml`. For the forecast
  worker use `worker/*` and `utils/*`, since it imports shared code.

After the first deploy, check the worker's Settings page still shows the
same bindings, variables, secrets and cron as before.

## CME orientation (GitHub Action + cme-orientation worker)

The analysis runs in GitHub Actions (`.github/workflows/cme-orientation.yml`,
every 30 minutes, code in `scripts/cme_orientation/`) and uploads to the
`cme-orientation` worker, which the app reads. One-time setup:

1. KV namespace `CME_ORIENTATION` (its ID is in
   `wrangler-cme-orientation.toml`).
2. Make up a long random token. Add it as:
   - the worker secret `INGEST_TOKEN` (on `cme-orientation`), and
   - the GitHub repository secret `ORIENTATION_TOKEN`
     (Settings, Secrets and variables, Actions).
3. Create the worker from this repo like the others, deploy command
   `npx wrangler deploy -c wrangler-cme-orientation.toml`.
4. In GitHub, Actions, "CME orientation", run it once by hand
   (Run workflow). Its summary lists every CME with its status.

Checks: `https://cme-orientation.thenamesrock.workers.dev/api/status`.
Until it has results, the app draws CMEs exactly as before.

## Sunspot history (sunspot-history worker)

Two weeks of every sunspot region with every change timestamped: NOAA's
daily report and probabilities, hourly SDO/HMI flux, and DONKI flares. The
sunspot tracker reads it. One-time setup:

1. KV namespace `SUNSPOT_HISTORY` (its ID is in
   `wrangler-sunspot-history.toml`).
2. Create the worker from this repo like the others: name `sunspot-history`,
   deploy command `npx wrangler deploy -c wrangler-sunspot-history.toml`,
   watch paths `worker/sunspot-history-worker.ts`, `utils/sunspotHistory.ts`,
   `utils/sharpPositions.ts`, `utils/srsTime.ts`, `utils/solarDisk.ts` and
   `wrangler-sunspot-history.toml`.
3. It binds to the `nasa-donki-api` worker for flares (in the settings file;
   nothing to do in the dashboard).
4. Open `https://sunspot-history.thenamesrock.workers.dev/api/run` once to
   fill it straight away (it backfills the last two weeks from NOAA's daily
   history), then `/api/status` to check.

Until it is running, the tracker works exactly as before.

## Page views (page-views worker)

The app's view counter: today, this week, all time (starting at 491,473) and
each visitor's own count, shown in Settings. It keeps everything in one
Durable Object with its own SQLite database, so counts are exact and there is
nothing to create in the dashboard (the migration in the settings file makes
it on the first deploy):

1. Create the worker from this repo like the others: name `page-views`,
   deploy command `npx wrangler deploy -c wrangler-page-views.toml`, watch
   paths `worker/page-views-worker.js` and `wrangler-page-views.toml`.
2. Check: `https://page-views.thenamesrock.workers.dev/page-views` should
   answer with `lifetime` of 491473 or more.

The app already points at that address. A worker with a different name needs
`VITE_PAGE_VIEWS_ENDPOINT` set to its address (no trailing slash) in the
Pages build settings.

Until it is running, Settings shows dashes where the numbers go.
