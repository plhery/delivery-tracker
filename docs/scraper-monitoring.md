# Scraper monitoring

[Delivery Tracker — Scraper Health](https://paul-louis-hery.sentry.io/dashboard/10017590/) shows the last 24 hours by default:

- Average and p95 full provider latency, including failed attempts.
- Attempt counts to distinguish a useful comparison from a small sample.
- Average direct HTTP/session latency and direct-path failure counts.
- Browser/TRAWL/page recovery and immediate HTTP retry counts, latency and failures.

The saved definition is [ops/sentry/scraper-health-dashboard.json](../ops/sentry/scraper-health-dashboard.json). The dashboard is scoped to `delivery-tracker`; its time range can be changed in Sentry. Metrics start with this release, so earlier scraping timings cannot appear retroactively.

## Measurements

`tracking.scrape.duration` is a distribution in milliseconds. `carrier` identifies the adapter actually called (carrier catalog ID, or `Ship24`, `ParcelsApp`, `17TRACK`, `Postal Ninja`), with `phase`, `outcome` and `error_type` attributes. `tracking.scrape.attempts` counts those same attempts. `tracking.scrape.fallbacks` counts each internal recovery handoff with `carrier`, `from_phase`, `to_phase`, and `error_type`.

`phase:total` measures the entire provider call through `CarrierTrackingAdapter` or `UniversalTracker`. Adapters with several tiers additionally record each tier as its own phase: DHL (`direct`, `trawl`), UPS (`direct`, `trawl`), DPD (`direct`, `page`), DPD France (`direct`, `trawl`), La Poste (`direct`, `retry`), Ship24 (`direct`, `browser`); Mondial Relay and DHL eCommerce go straight to their browser tier (`trawl` and `browser`). Single-tier adapters record one `direct` phase per lookup. Each carrier folder's `carrier.json` lists its `tracking.steps`. A provider's total includes session waiting, retries and internal recovery; it does not include other providers tried by the router. Existing Postgres `tracking_sync_steps` fetch durations cover the whole package lookup, including provider changes.

A direct failure followed by successful browser recovery produces an error direct sample, a recovery-handoff count, a successful browser sample and a successful total sample. Select one phase when counting attempts; summing phases double-counts a lookup. Session refreshes can produce multiple direct samples. La Poste records its first request as `direct` and up to two immediate HTTP 403 retries as `retry`, all within its original 15-second deadline. Each retried rejection is reported before the next request, including its bounded response diagnostics. Other HTTP statuses and parsing errors propagate without these retries; after exhaustion, the router reports the final failure and can use universal fallback. Native browser-only providers have total timings; a browser call there is not an API fallback.

Metrics are emitted on success and failure with monotonic elapsed time. They work with `SENTRY_TRACES_SAMPLE_RATE=0`; trace sampling does not disable metrics in the installed SDK. Structured `tracking_scrape` JSON logs carry the same timings even if Sentry is unavailable. Telemetry sink failures preserve the original tracking result/error.

## Investigating regressions

Search Sentry issues for `component:tracking-routing operation:transport_fallback`, optionally adding `provider:Ship24` or a carrier ID. These warning events are emitted before recovery and retain the original exception, stack, cause chain and custom properties. HTTP errors include request and response diagnostics. A successful recovery does not suppress the warning. Existing provider-failure events cover errors that bypass internal recovery, including 429 and service outages.

Compare direct latency/failure counts with recovery usage. A rising recovery count alongside successful total calls identifies a hidden API regression. Average/p95 totals show its user-visible cost. Check attempts and error outcomes before comparing providers; a quick rejection is not a quick successful scrape.

Sentry retains supplied diagnostic context, including user/tracking fields and session headers, without application-level redaction, as requested for this project. Metric calls preserve inherited SDK context too. Metric dimensions explicitly set by this code remain provider/phase/outcome/error class. Byte/time bounds on body reads and Sentry normalization/tag limits protect runtime and ingestion capacity; they do not remove fields by sensitivity. Client-facing tracking data continues to use its normal product schema.

The dashboard uses existing Sentry access and retention. This change adds warning issues and metrics, without changing notification recipients or organization-level alert rules.

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
successful lookups for that carrier: near zero for a month means the tier can
go; near one means the direct path is dead and the adapter should start with
the browser. A rising `stage_source="none"` share for a carrier means new
wording is waiting in `tracking_status_observations` (see OBSERVABILITY.md).

[ops/grafana/carrier-scrapers.json](../ops/grafana/carrier-scrapers.json) is
an importable Grafana dashboard with those panels plus a "silent carriers"
stat: an automatic carrier that had lookups in the last week but none in the
last two days is worth a look, because silence is not success.
