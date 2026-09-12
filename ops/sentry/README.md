# Tracking incidents and notifications

The host records individual adapter attempts, retries and fallbacks in logs,
Sentry metrics and Prometheus. A recovered transport failure does not create a
Sentry issue. The router still reports carrier corrections and input/coverage
observations separately; those are not outage notifications.

Scheduled refreshes feed `record_tracking_health` in Postgres. Manual refreshes,
unsupported carriers and superseded work do not contribute to incident thresholds.
Samples last 24 hours and contain only provider identifiers, outcome categories,
HTTP statuses and opaque internal identifiers, not tracking payloads.

| Incident | Opens when | Recovery |
| --- | --- | --- |
| Shipment refresh | Three failed scheduled checks of the same parcel in 24 hours, or at least five failures and more than 20% of checks in one hour | Three latest checks succeeded and no refresh threshold remains breached |
| Direct transport | More than 50% failed, at least ten direct probes in 24 hours | Three latest direct probes succeeded |
| Provider lookup | More than 50% failed, at least ten lookups in 24 hours | Three latest lookups succeeded |

One sample per provider and scheduled refresh prevents retries from inflating the
rate. Direct transport and provider totals are distinct: a direct failure followed
by a successful browser result is a failed direct sample and a successful provider
sample. Missing input and positive not-found results are excluded from provider
outage rates. A skipped direct probe during UPS cooldown is not a success.

Postgres serializes incident transitions. Repeated incidents notify at most once
per six hours; a recovery is emitted once without that delay. A pending event has
a two-minute delivery lease and is acknowledged only after the Sentry SDK flushes.
A crashed worker or failed flush can retry the pending event on a later check.
Delivery is at least once: a crash between send and acknowledgement may duplicate
an event. The SDK fingerprint groups it with the same incident.

Sentry events use `component:tracking-health`, `incident_kind`, `incident_state`
and `provider` tags. The `tracking_health` context includes counts, impact,
evidence, suppression policy and next steps. Recovery events share the incident
fingerprint and say “recovered”; they do not change Sentry's issue status.
Configure the production notification rule to match `component:tracking-health`
and all levels, including informational recovery events. Do not apply another
frequency threshold to these events: Postgres already made that decision.
Keep infrastructure notification rules separate from recovered carrier attempts.
Grafana's carrier dashboard remains useful for investigation without sending a
second copy of the same carrier alert.

## Retry policy

- DPD parcel-details reads retry one 502/503/504 after 1–3 seconds of jitter,
  within the original HTTP request budget. Authentication, parsing, 404 and 429
  are not retried by this policy. An explicit Retry-After suppresses this immediate retry.
- UPS reads the status reply the browser made from the tracking page (the
  `ops/trawl` compatibility build captures it). Plain HTTP runs only without a
  browser service: since 2026-09-10 Akamai holds that status call open until the
  timeout for any session a browser did not establish, so no direct probe runs and
  no `direct` sample is recorded while a browser service is configured.
- La Poste's explicit maintenance page goes to provider fallback and cooldown.
- TRAWL retries a confirmed closed-browser response once, only if `/health` reports
  a live, available browser and time remains in the original scrape budget. Other
  HTTP 500s and a still-busy/unhealthy pool are not retried by this policy.

Deploy the health migration before deploying the application. Missing RPCs report
an audit/health evaluation failure instead of breaking shipment persistence.
