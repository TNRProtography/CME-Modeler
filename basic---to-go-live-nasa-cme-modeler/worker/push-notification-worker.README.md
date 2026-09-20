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
| `TRIGGER_SECRET` | secret | guards every diagnostic and internal route below |
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

A shard budgets **operations**, not sends. Every KV read, write and delete is
a subrequest and a Worker gets about a thousand per invocation, so a shard
holding 1,250 subscribers cannot finish in one go - it stops early, saves both
the page cursor and the last key it processed within that page, and dispatches
itself again. The within-page marker matters: KV cursors only move a page at a
time, so without it a resumed shard would start the page again and send to
everyone in it twice.

A push that fails with a 429, a 408 or a 5xx is held on the shard and tried
first on the next attempt. A 404 or 410 prunes the subscription. A 400 or 403
is not retried, because it will be just as wrong next time.

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

## Who got it, and did they open it

Every finished job leaves a record, so "did the M5 flare go out, and to how
many" is answerable the next morning rather than only from live logs.

    SEND_<jobId>   topic, title, when, how long the fan-out took, how many
                   the push services accepted, failed, and dead endpoints
                   pruned, plus how many people opened the app from it
    SENDS          rolling index of the last 60 sends

    /sends?secret=...            the ledger, newest first, rolled up per topic
    /sends?secret=...&limit=5    fewer
    /sends?secret=...&fold=1     recount clicks before answering

**Accepted** means a push service took the message, not that a phone displayed
it. Nothing short of the device reporting back shows that, which is what the
click count is for.

Clicks are attributed without touching the service worker, which is served from
outside this project: the worker stamps the send id into the notification's
deep link, the app reports it on the next load and strips it from the address
bar. So the number means "opened the app from this alert". Each click is its
own KV key rather than an incremented counter - two workers incrementing one
value lose updates, and a popular alert would lose a lot of them. They are
counted by prefix and folded into the record hourly, recomputed rather than
accumulated, so folding twice cannot double-count.

## Migration

Subscriber records are brought up to the current topic list automatically, once
per `MIGRATION_VERSION`, off the cron. It is sharded like everything else, so it
finishes at 80,000 records instead of timing out half way.

It is additive: a preference somebody actually set is never overwritten, and
someone who turned everything off is left alone. A topic they were never asked
about gets the same default the app's own settings screen would show them -
which is the bug it replaced, where the worker stored `false` while the switch
said on.

    /migration?secret=...   how it went

## Subscriber counts

`STATS` in KV is a single snapshot line, refreshed hourly off the cron:

```json
{ "takenAt": 0, "takenAtNZ": "", "subscribers": 0,
  "subscribedToSomething": 0, "activeLast60Days": 0,
  "withLocation": 0, "withoutLocation": 0,
  "subscribedToNothing": 0, "quietOver60Days": 0,
  "byCategory": { "overnight-watch": 0 },
  "overnightModes": { "eye": 0, "phone": 0, "camera": 0 },
  "byPushService": { "apple": 0, "google": 0 },
  "recentSends": [{ "topic": "", "accepted": 0, "clicked": 0, "clickRate": 0 }] }
```

`subscribers` counts saved push subscriptions. Some belong to devices that
uninstalled long ago; those only come off the list when a send to them returns
410, which the ledger reports as `pruned`. `byPushService` matters because
failures cluster by platform - when a send goes badly, it says whose devices.

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

`npm run test:all` runs all four suites. Worth doing before pasting anything
into the dashboard.

| Suite | What it covers |
| --- | --- |
| `test:topics` | the app and this worker agree about every topic; nothing sends into a void; no topic is live without either a toggle or a written reason |
| `test:worker` | the detectors against synthetic solar wind, including cases that must stay quiet |
| `test:detectors` | a full X5 flare minute by minute, a CME arrival with and without the temperature channel, a quiet day, and a half-configured worker |
| `test:outbox` | delivery, the sweep's recovery, the ledger, click counting, the migration, an oversized shard, a rate-limiting push service and a cron tick racing a send |
| `test:scale` | 80,000 subscribers with dispatches dropped and pushes failing, asserting everyone is reached exactly once. Not in `test:all` - takes half a minute |

The topic list in this worker is generated. To add a notification, add it to
`utils/notificationCategories.ts` and run `npm run sync:topics` - do not edit
`ALL_TOPICS` by hand, `test:topics` will fail if you do.
