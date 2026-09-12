# Scraper monitoring

The Scraper Health dashboard compares provider latency, attempts, errors and
recovery over the selected time range. Import
[scraper-health-dashboard.json](../ops/sentry/scraper-health-dashboard.json)
into your Sentry organization and select your tracking project's ID in the
`projects` filter. The template intentionally contains no deployment-specific
project ID or private dashboard URL.

## Measurements

The host [step recorder](../src/server/stepRecorder.ts) emits
`tracking.scrape.duration` in milliseconds and `tracking.scrape.attempts`, with
`carrier`, `phase`, `outcome` and `error_type`. `tracking.scrape.fallbacks` adds
`from_phase` and `to_phase`. Each completed runner step produces a phase record;
`phase:total` covers that runner invocation, not the whole router or time spent
waiting outside it. Sessions or HTTP retries inside a step are not separately
counted unless implemented as runner steps.

See the generated [carrier overview](../packages/carriers/README.md#carriers)
and [provider table](../packages/carriers/providers/README.md) for declared
steps. La Poste executes `direct` followed by up to two `retry` attempts for
HTTP 403 within its original deadline. A browser-only lookup is not a fallback.
Select a phase when counting attempts; adding phases double-counts lookups.

## Failure timing and diagnostics

Cross-provider failures are reported before the router tries another provider.
Internal recovery differs: `runSteps` records the failed step immediately, but
the Sentry `transport_fallback` warning and handoff counter are emitted from
the subsequent recovery step's completion record. Successful recovery retains
the original exception; an interrupted recovery may never emit that warning.
This is a current limitation relative to reporting every error before recovery.

Search `component:tracking-routing operation:transport_fallback`, optionally
with `provider:Ship24` or a carrier id. Compare direct errors, recovery usage
and total latency with sample counts; a fast rejection is not a fast success.
The [observability policy](OBSERVABILITY.md) owns diagnostic retention and
Sentry context; [HTTP diagnostics](upstream-http-diagnostics.md) describes
request/response fields. Do not infer a challenge vendor from a 403 alone.

Metrics work with `SENTRY_TRACES_SAMPLE_RATE=0` in the installed SDK and retain
inherited context. Structured `tracking_scrape` logs remain available without
Sentry. Telemetry failures are isolated from tracking results.

## Prometheus

The same step records feed a Prometheus registry served at `GET /api/metrics`
when `METRICS_TOKEN` (16+ characters) is configured; the scraper sends it as a
bearer token. Labels are carrier ids, step ids, outcome kinds and error class
names only, so the endpoint never exposes tracking data.

| Series | Labels | Question it answers |
| --- | --- | --- |
| `carrier_step_duration_seconds` (histogram) | carrier, step, outcome | how long each tier takes |
| `carrier_step_total` | carrier, step, outcome, error_type | which tier fails how |
| `carrier_lookup_total` | carrier, final_step, outcome | which tier actually served the result |
| `carrier_fallback_total` | carrier, from_step, to_step, reason | how often recovery is needed |
| `carrier_status_mapping_total` | carrier, stage_source | share of events mapped explicitly, by wording, or not at all |
| `carrier_detection_total` | result | detection confidence served to clients |

"Is the fallback useful" is `carrier_lookup_total{final_step="trawl"}` over all
successful lookups for that carrier. A low share can mean a healthy direct
path; a high share warrants investigating direct failures before changing the
transport order. A rising `stage_source="none"` share for a carrier means new
wording is waiting in `tracking_status_observations` (see OBSERVABILITY.md).

[ops/grafana/carrier-scrapers.json](../ops/grafana/carrier-scrapers.json) is
an importable Grafana dashboard with those panels plus a "silent carriers"
stat: an automatic carrier that had lookups in the last week but none in the
last two days is worth a look, because silence is not success.
