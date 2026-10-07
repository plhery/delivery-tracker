# Observability

`lookup_verification` records the outcome and server verification duration,
without tokens, IP addresses or parcel inputs. Compare rejections and service
failures with completed public lookups and the API's `403`/`429` rates when
tuning protection. Client lookup failures remain in the existing parcel-lookup
analytics event. Configuration belongs in [DEPLOYMENT.md](DEPLOYMENT.md).
`native_verification` records attestation or assertion outcomes and device budget
limits, without key identifiers, challenges, assertions or parcel inputs. Verification, anonymous lookup and detection endpoints omit the incoming request
from error reports because their headers can carry verification credentials.

Each carrier refresh leaves a trace in three places:

1. **Logs**: one-line JSON describing the control flow, including the tracking number.
2. **Postgres audit**: private rows with every step and the evidence behind each status
   decision.
3. **Sentry**: groups failures and suspicious classifications. An opaque `attempt_id`
   links each event back to Postgres.

Metrics (Sentry and Prometheus) cover latency and fallback use.

**Privacy.** Logs and Sentry keep tracking numbers, original errors and upstream
request/response details, with no field redaction in the app. They survive parcel deletion
until retention expires. Restrict access and retention, and sanitize anything you share
publicly.

Parcel link ids and owner keys are the exception, because holding one is enough to read
or forget a parcel. Request logs name those routes without the id
(`/api/public/parcels/:link`, `/api/public/parcels/:link/alerts`), and error reports for
them and for `/api/packages/claim` leave the incoming request out. A reverse proxy in front
of the app still sees the address. The push endpoint and keys of a link's alert are never
logged, and a failed send to one is logged and counted but not reported as an error:
anyone holding a link can add an endpoint.

The delivery email is another: its lines name a parcel by its id and say how the email
ended, never the address, the subject or the parcel's name. A mail server's refusal quotes
the recipient, so only its kind and SMTP status are logged and reported. The token of an
unsubscribe link is the right to switch an account's email: `/api/email/unsubscribe` is
logged without its query, and its error reports leave the request out.

## Postgres audit

All tables and views here are service-role only.

- `tracking_sync_attempts`: one row per check. It holds the configured and actual carrier,
  job and package, previous and selected stage, provider status, event counts, outcome,
  error class, anomaly codes and a bounded private `status_text`.
- `tracking_sync_steps`: `selected`, `fetch`, `normalize`, `persist_events`,
  `persist_package`, `complete`, each with status and duration. A not-yet-announced number
  is a successful `fetch` with disposition `unannounced`, and the attempt ends as
  `waiting`. Real failures end as `error`.

Completed rows are kept for 90 days. Attempts still running after 30 min are marked
`abandoned` and reported. Deleting a package or account deletes its audit.

A check whose parcel is deleted while it runs, or whose next write finds its carrier
changed, ends as `superseded`: nothing is saved and no error is reported. A deleted parcel
takes the check's job and audit rows with it, so the worker drops the job instead of
finishing it. A carrier change that the worker's lease renewal notices before that write
stops the check instead: its attempt stays `running`, and is marked `abandoned` and
reported as above.

`delivery_emails` records what was emailed: one row per parcel claimed for a delivery
email, with the account, the delivered scan, `status` (`claimed`, `sent`, `failed`,
`skipped`), a `reason` code, the attempts and the times. It holds no address and none of
the email. A row outlives its parcel and goes with its account. The delivery email also
reads the attempts above: a delivered scan without a clock time is news only when an
earlier attempt, since the parcel joined the account, ended `updated` on another stage.

**Anomaly codes:**

| Code | Meaning |
| --- | --- |
| `invalid_event_timestamp` | A provider timestamp couldn't be parsed |
| `future_event_timestamp` | An event is over 1 h in the future, usually a local clock read in the wrong zone |
| `observed_without_timestamp` | A synthetic observation was needed to change stage (recorded, not alerted) |
| `terminal_stage_regression` | A delivered/returned parcel moved stage (`exception` excepted) |
| `delivered_status_conflict` | The provider says delivered but the chosen stage doesn't |
| `progress_disappeared` | The carrier's own adapter or the provider its saved summary came from answers without progress; for a carrier without an adapter, exhausted providers return only thin answers and the routing failure threshold is reached. The saved state is kept and the check ends as an error. |
| `fallback_without_progress` | A different fallback provider answers without progress for a carrier with its own adapter, or a thin answer for a carrier without one stays below the routing failure threshold. The saved state is kept and the check ends as waiting (recorded, not alerted). |

A universal answer with progress resets the consecutive-check count, even when it has
no new scan. Thin answers keep the previous provider preference and event watermark.

## Tracking support backlog

`tracking_support_cases` keeps one private case per normalized tracking number when
recognition is unknown, ambiguous or generic postal, the carrier has no direct adapter,
or its number points elsewhere. The audit captures recognition before fetching, so a
successful fallback still leaves the gap visible. Known-carrier outages stay in health
monitoring.

Cases and their bounded `tracking_support_observations` are service-role only. They
survive parcel deletion and audit pruning. Repeating an audit write does not count the
same check twice. Cases retain sightings, fallback counts, detection candidates, the
last outcome and direct verification evidence.

Unresolved detection requests also retain their normalized number in this backlog,
including cached answers and choices between carriers, before any parcel is saved.
Invalid, refused and cancelled checks do not create observations. A failed backlog write
does not change the detection answer. `carrier_detection_support` logs the number and
the carriers asked, unanswered or offered as choices.

Review open cases:

```sql
select id, tracking_number, reasons, detection_candidates, seen_count, fallback_count,
       last_outcome, last_provider, first_seen, last_seen, fix_status, fix_reference
from public.tracking_support_cases
where fix_status = 'open'
order by last_seen desc;
```

After shipping support, set `fix_status = 'fixed'`, `fixed_at` to its deployment time
and `fix_reference` to the commit or release. A later successful direct check with
accepted, timestamped progress for that same number promotes it to `verified`.
Provider answers, thin results, preserved older summaries and a different handoff
number cannot verify a fix. Use `ignored` with a note for a case that needs no change;
future sightings still accumulate.

## Unmapped wording

`tracking_status_observations` collects carrier wording whose stage didn't come from a
carrier status map, so it can be mapped instead of guessed forever. There is one row per
carrier, provider code and normalized description. `count` and `last_seen` grow on repeat
sightings. It holds no tracking number or account reference. Each refresh records at most
32 observations, and a failed write never fails the refresh.

Classifier corrections also need guarded migrations for stored events. Completed parcels
no longer refresh, so parser fixes alone leave their histories unchanged. Repairs preserve
raw evidence, event identities, timestamps and notification receipts, and recompute the
current stage only when the newest milestone changes.

Each event records its stage source in `tracking_events.raw_data.stage_source`:
`carrier_map` (explicit carrier vocabulary or provider-code mapping), `wording:<rule>`
(classifier rule that matched), or `none` (fallback). The sync preserves the scraper's
source, including on unresolved `pending` scans and observed milestones. Universal
wording rules remain eligible for review even when their adapter already assigned a stage.
Local-clock wording is recorded without a sample timeline event when its instant is
unresolved. It never creates a timestamped scan just to populate the review queue.

Review, most frequent first:

```sql
select carrier, count(*) as wordings, sum(count) as sightings, max(last_seen) as last_seen
from public.tracking_status_observations
where reviewed_at is null
group by carrier
order by sightings desc, wordings desc;

select provider_code, description_normalized, chosen_stage, stage_source,
       count, first_seen, last_seen, sample_event_id
from public.tracking_status_observations
where reviewed_at is null and carrier = 'CARRIER_ID'
order by count desc, last_seen desc;
```

For each row, in the scraper: map the code or wording in the carrier's `status.ts` (or add
a generic classifier rule), add a fixture and run the carrier's tests. Once the app uses
that release, mark it:

```sql
update public.tracking_status_observations
set reviewed_at = now(), resolution = 'mapped'  -- or 'wording_rule', 'ignored'
where observation_key = 'OBSERVATION_KEY';
```

A reviewed wording that keeps appearing keeps counting up, which shows whether the mapping
took effect.

## First-response queries

```sql
-- Carrier health, last 24 h
select * from public.tracking_sync_health_24h
order by error_percent desc nulls last, attempts desc;

-- One Sentry event
select * from public.tracking_sync_attempts where id = 'SENTRY_ATTEMPT_ID';
select sequence, step, status, duration_ms, details, error_type, occurred_at
from public.tracking_sync_steps where attempt_id = 'SENTRY_ATTEMPT_ID' order by sequence;

-- Recent suspicious decisions
select * from public.tracking_sync_recent_anomalies order by started_at desc limit 100;

-- Repeated failures by carrier, last 7 days
select configured_carrier, error_type, count(*) as failures,
       min(started_at) as first_seen, max(started_at) as last_seen
from public.tracking_sync_attempts
where outcome in ('error', 'abandoned') and started_at >= now() - interval '7 days'
group by configured_carrier, error_type
order by failures desc, last_seen desc;

-- Delivery emails of the last day, by how they ended
select status, reason, count(*) as emails, max(claimed_at) as last_claimed
from public.delivery_emails
where claimed_at >= now() - interval '24 hours'
group by status, reason order by emails desc;

-- Stuck attempts (maintenance clears these after 30 min)
select id, job_id, package_id, configured_carrier, current_step, started_at, now() - started_at as age
from public.tracking_sync_attempts where outcome = 'running' order by started_at;
```

## Logs

Every deploy replaces the app container, and Docker deletes a container's logs with it.
Production therefore keeps them in Loki for 30 days: the Coolify service
`delivery-tracker-logs` runs Loki beside Grafana and Alloy, which follows the app's
containers. Alloy finds them by the `coolify.name` label of the Coolify application that
runs the app, so moving the app to another application means changing that label in the
service's `alloy/config.alloy`; until then Loki receives nothing. Query the logs in
Grafana through the "Loki (delivery tracker logs)" data source.
Lines carry `app`, `container`, `event` and `level` labels, for example
`{app="delivery-tracker", event="tracking_scrape"} | json | outcome != "success"`.

Key JSON events:

- `tracking_sync_started`, `tracking_sync_step`, `tracking_sync_completed` (by `attempt_id`);
- `tracking_sync_audit_write_failed`, `tracking_sync_audit_maintenance_failed`,
  `tracking_status_observation_write_failed`;
- `sync_claim_failed`: the sync worker could not claim a job, with its `failure_count` and
  `failing_for_ms`, how long claims have been failing. A database restart leaves a few of
  them. Alert when they repeat for two minutes (`failing_for_ms` of 120000 or more).
  `sync_claim_recovered` follows with the first claim that works again and says how long
  the streak lasted;
- `sync_job_failed`, `sync_job_finish_failed` (by `job_id`). Alert on these;
- `sync_job_dropped` (by `job_id`): a package job had nothing left to finish, with the
  `reason`: `parcel_deleted` before its check, or `job_withdrawn` when a deletion or a
  carrier change took the job during it. `tracking_sync_audit_skipped` (by `attempt_id`):
  an audit write found its rows deleted with the parcel. Neither is a failure;
- `http_request` (by `request_id`, matching Sentry for server errors). A failed request
  carries `error_class`; a 502 that wraps an upstream failure also names that failure's
  class in `error_cause`;
- `carrier_recognition`: how many carriers the Add sheet's recognition asked, how many
  knew the number or failed, and what it settled on (a carrier, `choice` or `none`).
- `parcel_links_forgotten`: how many expired lookups, and parcels with them, a maintenance
  pass forgot, how many stopped links from accounts it purged and how many alerts of
  finished journeys it ended. `parcel_link_maintenance_failed` when it could not run.
- `parcel_link_alerts_failed`: how many alerts of parcel links a dispatch could not send.
- `public_allowance`: an overall daily allowance without an account (`kind`: `lookup` or
  `detection`) is `running_out` at 80% or `used_up`, with `used` and `limit`.
- `delivery_email` (by `package_id`): how one delivery email ended, with its `outcome` and
  `reason`; a refusal by the mail server adds `error_code` and `smtp_status`.
  `delivery_emails_capped` when emails were skipped for a daily allowance, and
  `delivery_email_finish_failed` when an ending could not be recorded: that email stays
  claimed and is not sent again.
  `delivery_email_card_failed` (warning, with `error_type`) when the map card could not be
  drawn: the email goes out without its picture.

The logger allows `tracking_number` explicitly. It drops other fields whose names look
like parcel, user, label, location, status text, URL, token, cookie or secret data. Keep
new fields scalar and bounded.

## Sentry

The SDK is enabled only when `SENTRY_DSN` is set. Default integrations are on, tracing is
off by default, and there is no `beforeSend` scrubber. Sentry's own limits and project-side
scrubbing still apply. Automatic lookups wrap each provider failure in an `AggregateError`
so every cause is visible.

- **Titles**: messages are sent without a stack trace (`attachStacktrace: false`), so an
  issue is titled by its message rather than by a minified function name.
- **Grouping**: by component, operation, carrier and error/anomaly type. `attempt_id`,
  `job_id`, `request_id`, `tracking_number`, `upstream_status` and `database_code` are
  searchable tags.
- **Source maps** stay in the server image only, never in browser assets.
- **Crons**: daytime and overnight schedules send check-ins; a missed or failed run alerts.
- **Alerts**: notify on new issues and regressions in `production`, and keep the Cron
  alerts. Avoid "more than 0 times in 5 minutes" rules: they fire on every failed check.
- **Incidents**: carrier and provider outages open once, with a recovery event, from
  thresholds computed in Postgres. See [ops/sentry](../ops/sentry/README.md).
- **Input requirements**: requests for a postcode or other tracking input stay in logs
  and breadcrumbs without opening Sentry issues.
- **Database outages**: when the database does not answer (`database_code:unreachable`), or
  its gateway answers 502, 503 or 504, the sync worker's claims, the scheduler and the
  friendship notifications keep it in the logs. The sync worker reports it once its claims
  have failed for two minutes, and again each time the outage has doubled. A claim the
  database refuses is also reported at once. The scheduler and the friendship
  notifications report refusals only. Work that is running when the database goes away
  still reports its own failed writes.
- **Allowances without an account**: `component:public-allowance` warns once a day when
  an overall allowance is 80% used, and reports an error when it is used up: every visitor
  without an account is then refused until midnight UTC. One issue per allowance and
  state.
- **Routing searches**: see [ROUTING.md](ROUTING.md).

### Upstream HTTP diagnostics

Rejected responses from `fetchBounded` carry `UpstreamHttpError.diagnostics`, attached to
Sentry's `upstream_http` context before fallback. It contains:

- content type, server header, request/correlation IDs and `Retry-After`;
- recognized body signatures and error codes, plus a text excerpt of the body;
- all response headers, and the request URL, method, headers, body and timeout.

Body inspection stops after 8 KiB or 200 ms. `body_read` says whether the body was
complete, empty, truncated, timed out, unreadable or skipped as binary. `body_signals` are
hints, not proof: a bare 403 or `access_denied` doesn't identify an anti-bot vendor.
Request IDs and excerpts don't affect grouping.

## Metrics

The host [step recorder](../src/server/stepRecorder.ts) turns each adapter step into
metrics. Steps are declared per carrier in the scraper's `carrier.json` (`direct`, `retry`,
`trawl`, `browser`…). `phase:total` is one runner invocation, not the whole refresh. Filter
by one phase when counting attempts; summing phases double-counts.

**Sentry metrics**, which work with tracing off:
- `tracking.scrape.duration` (ms) and `tracking.scrape.attempts`, tagged `carrier`,
  `phase`, `outcome`, `error_type`;
- `tracking.scrape.fallbacks`, with `from_phase` and `to_phase`.

Import [the Scraper Health dashboard](../ops/sentry/scraper-health-dashboard.json) and set
your project ID.

A step failure is recorded immediately, but the `transport_fallback` warning is sent when
the recovery step completes. An interrupted recovery may never send it.

**Prometheus** metrics are served at `GET /api/metrics` when `METRICS_TOKEN` (16+ chars) is
set, sent as a bearer token. Labels never contain tracking data, link ids or client
addresses.
Every deploy restarts the counters, so a new series is served at 0 on its first scrape and
counts from the next one. `increase()` then still sees an event that happens once per
container.

| Series | Answers |
| --- | --- |
| `carrier_step_duration_seconds` (carrier, step, outcome) | How long each step takes |
| `carrier_step_total` (+ error_type) | Which step fails, and how |
| `carrier_lookup_total` (carrier, final_step, outcome, attempts) | Which step served the result, after how many attempts |
| `carrier_fallback_total` (from_step, to_step, reason) | How often recovery is needed |
| `carrier_status_mapping_total` (carrier, stage_source) | Share of events mapped explicitly, by wording, or not at all |
| `carrier_detection_total` (result) | Detection confidence served to clients |
| `carrier_refresh_total` (carrier, served_by, outcome) | Who served each refresh: `adapter`, `other_adapter`, `provider` or `none` |
| `public_lookup_total` (outcome) | Lookups without an account: `created`, `reused` (the number was already stored), `limited_burst`, `limited_daily` (the client's day is used up), `limited_network` (its IPv6 /48's day), `limited_global` |
| `public_detection_total` (outcome) | Detections without an account that needed a carrier's answer: `asked`, or refused first as `limited_burst`, `limited_daily` or `limited_global` |
| `public_parcel_read_total` (outcome) | Reads of a parcel link: `ok`, `not_found` or `stopped` (its sharing was stopped) |
| `parcel_claim_total` (outcome) | Links kept after sign-in: `kept`, `already`, `quota`, `unavailable` |
| `parcel_forgotten_total` (kind, reason) | Forgotten links and parcels (`kind`): `asked` by their owner, `expired`, or `stopped` 30 days ago |
| `parcel_share_total` (kind, change) | Sharing `started`, `changed` (what the link shows) or `stopped`, through a `lookup`'s link or an `account`'s |
| `parcel_alert_set_total` (outcome) | Requests to turn on an alert for a link: `added`, `updated`, `full` (ten already), `finished` (journey over), `stopped`, `unavailable` |
| `parcel_alert_sent_total` (outcome) | Batches of new scans per alert: `sent`, `skipped` (not in its preset, backfilled, or the owner's own browser), `failed`, `expired` (the push service says the subscription is gone) |
| `parcel_alert_removed_total` (reason) | Alerts ended: `asked`, `delivered` (journey over), `expired`, `failed` (three failed sends in a row) |
| `delivery_email_total` (outcome, reason) | Delivery emails: `sent`; `failed` and tried again later (`smtp`, `content`, `account`, `parcel`, `interrupted`); `skipped` for good (`no_address`, `relay_address`, `parcel_gone`, `account_cap`, `service_cap`) |
| `public_lookup_clients` | Clients that made a lookup yesterday (UTC) |
| `public_lookups_per_client` (stat) | Yesterday's lookups per client: `p50`, `p90`, `max` |
| `public_detection_clients` | Clients that had carriers asked about a number yesterday (UTC) |
| `public_detections_per_client` (stat) | Yesterday's such numbers per client: `p50`, `p90`, `max` |

Useful questions:

- **Is the browser fallback earning its cost?**
  `carrier_lookup_total{final_step="trawl"}` over all successful lookups.
- **Is a carrier's adapter actually serving it?**
  `carrier_refresh_total{served_by="provider",outcome="updated"}` over all `updated`. It
  should stay near zero for carriers with their own adapter. One direct failure benches the
  adapter for its cooldown, so small failure rates show up amplified.
- **Does an in-adapter retry ever help?**
  `carrier_lookup_total{final_step="retry",outcome="ok",attempts=~"[2-9]"}`.
- **New unmapped wording?** A rising `stage_source="none"` share. See
  [Unmapped wording](#unmapped-wording).
- **Is the daily lookup allowance right?** `public_lookups_per_client{stat="p90"}` is
  what nine clients in ten stayed at or under yesterday. Well below
  `PUBLIC_LOOKUPS_PER_DAY`, the limit only stops outliers. At the limit, ordinary use is
  being refused: refused lookups are not counted, so the value cannot go higher, and
  `public_lookup_total{outcome="limited_daily"}` rises with it. The gauges are set by the
  maintenance pass after each scheduled sync. `public_detections_per_client` and
  `PUBLIC_DETECTIONS_PER_DAY` read the same way.

- **Are delivery emails going out?** `delivery_email_total{outcome="failed",reason="smtp"}`
  rising means the mail server refuses them: the log lines say how. A reason ending in
  `_cap` means a daily allowance is too small for the traffic, and those emails are lost.

[ops/grafana/carrier-scrapers.json](../ops/grafana/carrier-scrapers.json) is an importable
Grafana dashboard with these panels. Its "silent carriers" stat flags carriers with lookups
last week but none in two days: silence isn't success.

## Incident checklist

1. Read the Sentry component, operation, carrier and error/anomaly type.
2. Put the `attempt_id` into the attempt and step queries above.
3. Find where it failed: fetch, normalize, event persistence or package persistence.
4. For classification anomalies, compare provider status, reported and selected stage,
   `status_text` and the normalized events.
5. Check nearby attempts for the same carrier: one odd shipment, or a provider change?
6. After the fix, run the carrier's tests and one controlled refresh, then check the new
   audit row and the Sentry recovery.
