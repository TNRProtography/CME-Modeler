# Push Notification Worker

Source of truth for `push-notification-worker.thenamesrock.workers.dev`.

Until now this worker existed only in the Cloudflare dashboard, with no
history and nothing to roll back to. It holds the subscriber list, so that was
the riskiest file in the whole system to have untracked. `push-notification-worker.js`
is that worker, with the September 2026 fixes applied.

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
| `TRIGGER_SECRET` | secret | guards `/status`, `/diagnostics`, `/trigger-test-push`, `/broadcast-batch` |
| `BANNER_AUTH_TOKEN` | secret | also accepted for `/send-broadcast` and `/migrate-preferences` |
| `VAPID_PUBLIC_KEY` | secret | web push |
| `VAPID_PRIVATE_KEY` | secret | web push |
| `VAPID_SUBJECT` | secret | web push, a `mailto:` |
| `SELF_URL` | var | the worker's own origin, used to chain broadcast batches |

`CONFIG_THRESHOLDS` must exist in KV as JSON or the scheduled run aborts
before it does anything. It should carry at least:

```json
{ "substorm": { "cooldownMinutes": 30 } }
```

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
synthetic solar wind, including cases that must stay quiet. Worth running
before pasting anything into the dashboard.
