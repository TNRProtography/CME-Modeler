# Deploying the workers from this repo

Every Cloudflare Worker the app uses lives in this folder, with a settings
file (`wrangler-*.toml`) next to `package.json`. Each settings file matches
the Cloudflare dashboard as it was when the worker was copied in.

**A deploy replaces the worker's bindings, variables and crons with exactly
what its settings file lists.** Change them in the file, not the dashboard,
or the next deploy undoes the dashboard change. Secrets are the exception:
they are set in the dashboard only, are never in this repo (it is public),
and survive deploys.

| Worker | Code | Settings | Cron | Secrets | Dev copy |
| --- | --- | --- | --- | --- | --- |
| spottheaurora | `spottheaurora-worker.js` | `wrangler-spottheaurora.toml` | every 5 min | OWM_API_KEY | no |
| noaa-enlil-proxy | `noaa-enlil-proxy-worker.js` | `wrangler-noaa-enlil-proxy.toml` | none | none | no |
| banner-api | `banner-api-worker.js` | `wrangler-banner-api.toml` | none | BANNER_AUTH_TOKEN | no |
| ch-history-worker | `ch-history-worker.js` | `wrangler-ch-history.toml` | every 2 h | none | no |
| solo-worker | `solo-worker.js` | `wrangler-solo.toml` | every 6 h | none | no |
| aurora-sightings | `aurora-sightings-worker.js` | `wrangler-aurora-sightings.toml` | midnight UTC | none | no |
| aurora-index-sta | `aurora-index-sta-worker.js` | `wrangler-aurora-index-sta.toml` | none | none | no |
| nasa-donki-api | `nasa-donki-api-worker.js` | `wrangler-nasa-donki-api.toml` | every minute | NASA_API_KEY | no |
| imap-solar-data-test | `imap-solar-data-worker.js` | `wrangler-imap-solar-data.toml` | none | none | no |
| suvi-difference-imagery | `suvi-difference-worker.js` | `wrangler-suvi.toml` | every 2 min | none | no |
| epam | `epam-worker.js` | `wrangler-epam.toml` | every 3 min | none | no |
| coronagraphy-processing | `coronagraph-worker.js` | `wrangler-coronagraph.toml` | every 5 min | none | no |
| push-notification-worker | `push-notification-worker.js` | `wrangler-push.toml` | every minute | VAPID_PRIVATE_KEY, TRIGGER_SECRET, BANNER_AUTH_TOKEN | **yes** |
| spot-the-aurora-forecast-worker | `forecast-entry.js` | `wrangler-forecast.toml` | hourly at :07 | none | **yes** |
| spot-the-aurora-image-proxy | `index.ts` | `wrangler.toml` | none | none | no |

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

## The two dev copies

`dev-push-notification-worker` and `dev-spot-the-aurora-forecast-worker`
are the `[env.dev]` sections of their settings files. Before the first
deploy of either:

1. Create a KV namespace (`dev-SUBSCRIPTIONS_KV` or `dev-FORECAST_KV`) and
   paste its ID over the `REPLACE_WITH_...` placeholder.
2. For the push worker, add the same three secrets as live. Use the same
   `VAPID_PRIVATE_KEY`: the app has the public key built in, so both copies
   must share the key pair.

Deploy command: `npx wrangler deploy -c wrangler-push.toml --env dev`
(or `wrangler-forecast.toml`).

Everything else has no dev copy: it only reads public space weather data,
so dev and live read the same one.
