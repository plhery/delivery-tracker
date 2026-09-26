# Tracking incidents

Carrier and provider outages open a single Sentry incident, and a recovery event closes it.
Postgres (`record_tracking_health`) decides when, from scheduled refreshes only. Manual
refreshes, unsupported carriers and superseded work don't count. Samples last 24 hours and
hold only provider ids, outcome categories, HTTP statuses and opaque ids.

Individual attempts, retries and fallbacks go to logs, metrics and Prometheus instead. A
failure that recovers never opens an issue. See [OBSERVABILITY.md](../../docs/OBSERVABILITY.md).

| Incident | Opens when | Recovers when |
| --- | --- | --- |
| Shipment refresh | 3 failed scheduled checks of one parcel in 24 h, or ≥ 5 failures and > 20 % of checks in one hour | The 3 latest checks succeed and no threshold is still breached |
| Direct transport | > 50 % of ≥ 10 direct probes failed in 24 h | The 3 latest direct probes succeed |
| Provider lookup | > 50 % of ≥ 10 lookups failed in 24 h | The 3 latest lookups succeed |

## Counting rules

- One sample per provider per scheduled refresh, so retries don't inflate the rate.
- A direct failure rescued by the browser counts as a failed *direct* sample and a
  successful *provider* sample. A carrier with only a direct step records the provider
  sample alone, so one outage opens one incident.
- Missing input and genuine not-found are healthy. They count toward recovery, never toward
  an outage.
- A step skipped during a cooldown is not a success. A check that contacted nobody because
  everything was cooling down records nothing.
- A parcel whose own carrier says not-found stays `waiting` even if every fallback fails.
  The fallbacks can't know a parcel the carrier hasn't announced.
- If a tier stops being probed (no parcels left), its incident closes once its last sample
  ages out, **without** a recovery event. Resolve that Sentry issue by hand.

## Delivery

Postgres serializes transitions. A repeated incident notifies at most once per 6 hours;
recovery is sent at once. Events are delivered at least once (2-minute lease, acknowledged
after the SDK flushes), and duplicates group under the same fingerprint.

Events carry `component:tracking-health`, `incident_kind`, `incident_state` and `provider`
tags, plus a `tracking_health` context with counts, impact, evidence and next steps.
Recovery events say "recovered" but don't change the issue status.

**Alert rule:** match `component:tracking-health` at all levels, informational recoveries
included. Don't add a frequency threshold, because Postgres already applied one. Keep
infrastructure alerts in separate rules.

If the health functions are missing, the audit reports an evaluation failure; saving
shipments is never affected.

[`scraper-health-dashboard.json`](scraper-health-dashboard.json) is an importable Sentry
dashboard for step latency, errors and recovery.
