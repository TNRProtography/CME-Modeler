# Push Notification Worker

Source of truth for `push-notification-worker.thenamesrock.workers.dev`.

Until now this worker existed only in the Cloudflare dashboard, with no
history and nothing to roll back to. It holds the subscriber list, so that was
the riskiest file in the whole system to have untracked. `push-notification-worker.js`
is that worker, with the September 2026 fixes applied and delivery rebuilt as
a durable outbox so an alert reaches every subscriber rather than the first
couple of thousand.

## Deploying

It is still a dashboard-managed worker. To deploy, paste the contents of
`push-notification-worker.js` into the dashboard editor and save. Nothing else
needs to change: the bindings, secrets and cron trigger already exist there.

Check afterwards with:

    curl "https://push-notification-worker.thenamesrock.workers.dev/health"

## What it needs

| Binding | Kind | Purpose |
| --- | --- | --- |
| `SUBSCRIPTIONS_KV` | KV namespace | subscribers, cooldowns, detector state |
| `rtsw` | service binding | the IMAP/RTSW merged solar wind proxy |
| `FORECAST_SERVICE` | service binding | the Spot The Aurora forecast worker |
| `TRIGGER_SECRET` | secret | guards `/status`, `/diagnostics`, `/trigger-test-push`, `/run-shard`, `/run-census-shard`, `/job`, `/stats` |
| `BANNER_AUTH_TOKEN` | secret | also accepted for `/send-broadcast` and `/migrate-preferences` |
| `VAPID_PUBLIC_KEY` | secret | web push |
| `VAPID_PRIVATE_KEY` | secret | web push |
| `VAPID_SUBJECT` | secret | web push, a `mailto:` |
| `SELF_URL` | var | the worker's own origin. **Required.** Without it nothing fans out except on the cron sweep |

`CONFIG_THRESHOLDS` must exist in KV as JSON or the scheduled run aborts
before it does anything. It should carry at least:

```json
{ "substorm": { "cooldownMinutes": 30 } }
```

## How an alert gets delivered

A detector never sends anything itself. It writes a job and returns:

    JOB_<id>              the alert, and what kind of judgement each
                          subscriber needs (topic, overnight, visibility)
    JOBSHARD_<id>_<ch>    64 of these, one per shard: state, cursor,
                          sent, failed, attempts, lease

Subscriber keys are the base64url SHA-256 of the push endpoint, so their first
character is uniform across the 64-character alphabet. That gives 64 disjoint
`list({ prefix })` slices for free. Each one is drained by its own `/run-shard`
invocation with its own subrequest budget, so the fan-out is 64 times wider
than a single invocation could ever be, and a shard that runs out of budget
saves its cursor and dispatches itself again.

Durability is the cron sweep, not the dispatch. Every scheduled run
re-dispatches any shard that is pending, or leased past the point a worker
could still be alive, or failed and due a retry. So a dropped dispatch, an
evicted worker or a push service having a bad minute costs a delay, not a
missed alert. Jobs expire after six hours.

Per-subscriber rules (overnight mode and score, visibility tier and location,
the cooldowns, the once-a-night marker) live in `decideForSubscriber` and run
inside the shard, unchanged from before.

    /job?secret=...&id=<id>   progress for one job
    /job?secret=...           the jobs still in flight

## Subscriber counts

`STATS` in KV is a single snapshot line, refreshed hourly off the cron:

```json
{ "takenAt": 0, "takenAtNZ": "", "subscribers": 0,
  "subscribedToSomething": 0, "activeLast60Days": 0,
  "withLocation": 0, "withoutLocation": 0,
  "byCategory": { "overnight-watch": 0 },
  "overnightModes": { "eye": 0, "phone": 0, "camera": 0 } }
```

    /stats?secret=...           read the snapshot
    /stats?secret=...&force=1   take a fresh one now

The census shards the same way as delivery, so it never walks the whole list
in one invocation. `/diagnostics` reads this snapshot rather than counting
subscribers itself.

## Telling whether it is working

```
/health                      is the cron still running
/diagnostics?secret=...      why each detector did or did not fire
/status?secret=...           raw detector state
```

`/diagnostics` is the one to reach for. It reports, for the last scheduled
run, every detector's outcome and the reason, plus how many subscribers are
opted in to each topic, how many have GPS, and which cooldowns are currently
holding a topic back. All four of the bugs fixed in September 2026 were
invisible without reading Cloudflare logs; this makes them visible.

A detector reporting `quiet` means it ran and found nothing. `skipped` means
it could not run and says why. `suppressed` means it found something but a
cooldown stopped it. `error` means it threw.

## Testing changes

`npm run test:worker` from the app directory runs the detectors against
synthetic solar wind, including cases that must stay quiet.

`npm run test:outbox` seeds several thousand subscribers, runs a real sunset
through the nightly path, and insists everyone who asked for it is notified
exactly once - then throws away a quarter of the shard dispatches and checks a
single cron sweep still reaches all of them.

Both are worth running before pasting anything into the dashboard.
