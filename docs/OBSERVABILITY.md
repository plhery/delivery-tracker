# Observability

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

**Anomaly codes:**

| Code | Meaning |
| --- | --- |
| `invalid_event_timestamp` | A provider timestamp couldn't be parsed |
| `future_event_timestamp` | An event is over 1 h in the future, usually a local clock read in the wrong zone |
| `observed_without_timestamp` | A synthetic observation was needed to change stage (recorded, not alerted) |
| `terminal_stage_regression` | A delivered/returned parcel moved stage (`exception` excepted) |
| `delivered_status_conflict` | The provider says delivered but the chosen stage doesn't |
| `progress_disappeared` | A parcel with progress suddenly has no usable evidence; the last known state is kept |

## Unmapped wording

`tracking_status_observations` collects carrier wording whose stage didn't come from a
carrier status map, so it can be mapped instead of guessed forever. There is one row per
carrier, provider code and normalized description. `count` and `last_seen` grow on repeat
sightings. It holds no tracking number or account reference. Each refresh records at most
32 observations, and a failed write never fails the refresh.

Each event records its stage source in `tracking_events.raw_data.stage_source`:
`carrier_map` (explicit adapter stage), `wording:<rule>` (classifier rule that matched), or
`none` (fallback).

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

For each row: map the code or wording in the carrier's `status.ts` (or add a generic
classifier rule), add a fixture, run the carrier's tests, then mark it:

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

-- Stuck attempts (maintenance clears these after 30 min)
select id, job_id, package_id, configured_carrier, current_step, started_at, now() - started_at as age
from public.tracking_sync_attempts where outcome = 'running' order by started_at;
```

## Logs

Every deploy replaces the app container, and Docker deletes a container's logs with it.
Production therefore keeps them in Loki for 30 days: the Coolify service
`delivery-tracker-logs` runs Loki beside Grafana and Alloy, which follows the app's
containers. Query them in Grafana through the "Loki (delivery tracker logs)" data source.
Lines carry `app`, `container`, `event` and `level` labels, for example
`{app="delivery-tracker", event="tracking_scrape"} | json | outcome != "success"`.

Key JSON events:

- `tracking_sync_started`, `tracking_sync_step`, `tracking_sync_completed` (by `attempt_id`);
- `tracking_sync_audit_write_failed`, `tracking_sync_audit_maintenance_failed`,
  `tracking_status_observation_write_failed`;
- `sync_claim_failed`, `sync_job_failed`, `sync_job_finish_failed` (by `job_id`). Alert on
  these;
- `http_request` (by `request_id`, matching Sentry for server errors). A failed request
  carries `error_class`; a 502 that wraps an upstream failure also names that failure's
  class in `error_cause`;
- `carrier_recognition`: how many carriers the Add sheet's recognition asked, how many
  knew the number or failed, and what it settled on (a carrier, `choice` or `none`).
- `parcel_links_forgotten`: how many expired lookups, and parcels with them, a maintenance
  pass forgot, how many stopped links from accounts it purged and how many alerts of
  finished journeys it ended. `parcel_link_maintenance_failed` when it could not run.
- `parcel_link_alerts_failed`: how many alerts of parcel links a dispatch could not send.

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
metrics. Steps are declared per carrier in `carrier.json` (`direct`, `retry`, `trawl`,
`browser`…). `phase:total` is one runner invocation, not the whole refresh. Filter by one
phase when counting attempts; summing phases double-counts.

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
| `public_lookup_total` (outcome) | Lookups without an account: `created`, `reused` (the number was already stored), `limited_burst`, `limited_daily` (the client's day is used up), `limited_global` |
| `public_parcel_read_total` (outcome) | Reads of a parcel link: `ok`, `not_found` or `stopped` (its sharing was stopped) |
| `parcel_claim_total` (outcome) | Links kept after sign-in: `kept`, `already`, `quota`, `unavailable` |
| `parcel_forgotten_total` (kind, reason) | Forgotten links and parcels (`kind`): `asked` by their owner, `expired`, or `stopped` 30 days ago |
| `parcel_share_total` (kind, change) | Sharing `started`, `changed` (what the link shows) or `stopped`, through a `lookup`'s link or an `account`'s |
| `parcel_alert_set_total` (outcome) | Requests to turn on an alert for a link: `added`, `updated`, `full` (ten already), `finished` (journey over), `stopped`, `unavailable` |
| `parcel_alert_sent_total` (outcome) | Batches of new scans per alert: `sent`, `skipped` (not in its preset, backfilled, or the owner's own browser), `failed`, `expired` (the push service says the subscription is gone) |
| `parcel_alert_removed_total` (reason) | Alerts ended: `asked`, `delivered` (journey over), `expired`, `failed` (three failed sends in a row) |
| `public_lookup_clients` | Clients that made a lookup yesterday (UTC) |
| `public_lookups_per_client` (stat) | Yesterday's lookups per client: `p50`, `p90`, `max` |

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
  maintenance pass after each scheduled sync.

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
