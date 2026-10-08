# Tracking incidents

Carrier and provider outages open a single Sentry issue, and their recovery opens another.
Postgres (`record_tracking_health`) decides when, from scheduled refreshes only. Manual
refreshes, unsupported carriers and superseded work don't count. Samples last 24 hours and
hold only provider ids, outcome categories, HTTP statuses and opaque ids. A sample's
`http_status` is one a provider answered with; a carrier error the adapter raised on its
own, such as not-found, has none.

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
- Missing input, genuine not-found and a provider's answer that it has no history for the
  number yet are healthy. They count toward recovery, never toward an outage, so a parcel
  added before its first scan can't open a provider incident.
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
Opening and reminders share one issue per incident kind and provider. The recovery is an
informational issue of its own (its fingerprint ends in `recovered`), so it neither reopens
the outage's issue once resolved nor keeps it looking active. It doesn't resolve it either:
resolve the outage's issue when the recovery arrives. The next outage of the same kind and
provider then shows as a regression.

**Alert rule:** match `component:tracking-health` at all levels, informational recoveries
included. Don't add a frequency threshold, because Postgres already applied one. Keep
infrastructure alerts in separate rules.

If the health functions are missing, the audit reports an evaluation failure; saving
shipments is never affected.

[`scraper-health-dashboard.json`](scraper-health-dashboard.json) is an importable Sentry
dashboard for step latency, errors and recovery.
