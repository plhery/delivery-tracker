# Tracking observability

Delivery Tracker records a carrier refresh in three deliberately separate
places:

1. one-line JSON logs explain the live control flow without parcel data;
2. private Postgres audit rows retain the classification evidence and every
   completed step; and
3. Sentry groups actionable failures and suspicious classifications, using an
   opaque `attempt_id` to link back to Postgres.

Sentry is a protected diagnostic data store for this project. Original errors,
their causes, custom error properties, and SDK diagnostic context are retained
there without application-level sanitization. Structured console logs still
omit parcel and credential fields; Postgres retains the complete refresh audit.

## What is recorded

`public.tracking_sync_attempts` stores one row per parcel check. It records the
configured and actual carrier, job and package references, previous stage,
provider status, reported and selected stages, event counts, outcome, error
class, and anomaly codes. The bounded `status_text` is private database data;
it exists specifically to explain a mistaken classifier decision. The audit
writer does not automatically copy it into logs or Sentry.

`public.tracking_sync_steps` records `selected`, `fetch`, `normalize`,
`persist_events`, `persist_package`, and `complete` with status and duration.
An expected not-yet-announced or wrong tracking number is a successful `fetch`
whose disposition is `unannounced`; the attempt finishes as `waiting`. A
network, challenge, parser, or storage failure has a failed step and finishes
as `error`.

Completed audit rows are retained for 90 days. A running attempt older than 30
minutes is marked `abandoned`, and that condition is sent to Sentry. Package or
account deletion cascades immediately through its audit history.

Anomalies currently mean:

- `invalid_event_timestamp`: at least one non-empty provider timestamp could
  not be parsed;
- `future_event_timestamp`: a normalized event is more than 24 hours ahead;
- `observed_without_timestamp`: a stage-changing synthetic observation was
  needed (recorded in Postgres, intentionally not alerted by itself);
- `terminal_stage_regression`: a delivered/returned parcel moved to another
  stage;
- `delivered_status_conflict`: provider status says delivered while the chosen
  stage does not; and
- `progress_disappeared`: a parcel with prior progress suddenly has no usable
  provider evidence.

When progress disappears, the refresh is marked as an error and the last known
stage, status text, estimated delivery and carrier data are retained. The empty
provider response remains visible in the audit and Sentry anomaly.

## Carrier check frequency

GLS Germany, Switzerland and France are checked at most once an
hour per parcel. After a failed check, they wait four hours. Both scheduled and
manual refreshes use the persisted `last_synced_at` and `sync_status`, so a
worker restart or repeated Refresh action does not bypass the cooldown. New or
reconfigured parcels are checked immediately. From 08:00–22:00 in Europe/Zurich,
other carriers refresh in-transit parcels every two minutes and other stages
every ten minutes, with hourly checks overnight. Parcels that are not yet due
do not consume the five-parcel per-owner scheduled quota.
PostNL uses the thirty-minute daytime and
hourly overnight schedule, including after a failed check; manual refreshes
are available without the GLS cooldown.

HTTP 429 responses without `Retry-After` are not immediately retried. Explicit
retry windows up to one minute are still honored by adapters that enable a
single transient retry; longer windows fail the attempt rather than blocking
the worker. Each attempted check still has its own audit and Sentry event when
it fails; issue grouping does not discard repeated events.

## First-response queries

Run these with the Supabase service role or directly as a database operator.
The tables and views are inaccessible to browser roles.

Carrier health over the last day:

```sql
select *
from public.tracking_sync_health_24h
order by error_percent desc nulls last, attempts desc;
```

Open an alert by its Sentry `attempt_id`:

```sql
select *
from public.tracking_sync_attempts
where id = 'SENTRY_ATTEMPT_ID';

select sequence, step, status, duration_ms, details, error_type, occurred_at
from public.tracking_sync_steps
where attempt_id = 'SENTRY_ATTEMPT_ID'
order by sequence;
```

Recent suspicious decisions:

```sql
select *
from public.tracking_sync_recent_anomalies
order by started_at desc
limit 100;
```

Repeated failures by carrier and error class:

```sql
select configured_carrier, error_type, count(*) as failures,
       min(started_at) as first_seen, max(started_at) as last_seen
from public.tracking_sync_attempts
where outcome in ('error', 'abandoned')
  and started_at >= now() - interval '7 days'
group by configured_carrier, error_type
order by failures desc, last_seen desc;
```

Attempts that have not completed (maintenance should empty this after 30
minutes):

```sql
select id, job_id, package_id, configured_carrier, current_step, started_at,
       now() - started_at as age
from public.tracking_sync_attempts
where outcome = 'running'
order by started_at;
```

When a classifier appears wrong, use `package_id` from the attempt to inspect
the account-private package and its already-normalized events. Relevant evidence
can also be attached to the protected Sentry issue when needed for diagnosis.

## Logs and correlation

Important JSON events are:

- `tracking_sync_started`, `tracking_sync_step`, and
  `tracking_sync_completed`, correlated by `attempt_id`;
- `tracking_sync_audit_write_failed` and
  `tracking_sync_audit_maintenance_failed`;
- `sync_claim_failed`, `sync_job_failed`, and `sync_job_finish_failed`,
  correlated by `job_id`; and
- `http_request`, correlated with Sentry by `request_id` for server errors.

The logging helper drops any field whose name looks like tracking, parcel,
package, user, label, description, location, status text, URL, token, cookie,
authorization, secret, or password data. Keep new fields scalar and bounded.

## Sentry behavior

The Node SDK is enabled only when `SENTRY_DSN` is set. Its normal non-performance
integrations are enabled, including request/fetch instrumentation, breadcrumbs,
source context, and linked errors. Diagnostic data collection includes user
information; tracing still defaults to zero. There is no application-level
`beforeSend` scrubber or replacement exception: original messages, stacks,
causes, requests, contexts, tags, and extras reach the SDK event pipeline.
`ExtraErrorData` also records custom error properties. The SDK's own field
limits and built-in sensitive-key filtering, plus any Sentry project-side data
scrubbing, still apply.

Automatic carrier lookup retains each provider's original failure inside an
`AggregateError`, allowing Sentry to show the individual causes while the app
continues to display a readable lookup summary. Previously ingested, sanitized
events cannot recover their discarded details; this behavior applies to new
events after deployment.

Issue fingerprints group by component, operation, carrier, anomaly/error type.
Opaque `attempt_id`, `job_id`, and `request_id` tags make individual executions
searchable. Known upstream HTTP failures also include `upstream_status`; known
database failures include `database_status` and a strictly validated
`database_code`. Production builds retain source maps only in the standalone
server image, where Node uses them to produce source-level stack traces; they
are never copied to browser assets or `public`. Daytime and overnight scheduled
jobs send Sentry Cron check-ins; the SDK creates monitors for the Zurich
schedules and reports a missed or failed run after one occurrence.

Recommended project alerts:

- notify on every new issue in the `production` environment;
- notify when a resolved issue regresses; and
- keep the automatically-created Cron monitor alerts enabled.

An issue-frequency rule such as "more than 0 times in 5 minutes" with a
five-minute action interval alerts on each ten-minute failed check, even when
all events share one fingerprint and issue. Use new-issue and regression
conditions for incident notifications instead of that per-occurrence rule.

## Incident sequence

1. Read the Sentry component, operation, carrier, and error/anomaly type.
2. If present, copy only the opaque attempt id into the attempt and step
   queries above.
3. Confirm whether failure happened in carrier fetch, normalization, event
   persistence, or package persistence.
4. For classification anomalies, compare provider status, reported stage,
   selected stage, private status text, and normalized events.
5. Check nearby attempts for the same carrier to separate a single malformed
   shipment from a provider-wide change.
6. After remediation, run the provider tests and one controlled refresh, then
   verify the new audit row and Sentry recovery.
