# Scraper monitoring

[Delivery Tracker — Scraper Health](https://paul-louis-hery.sentry.io/dashboard/10017590/) shows the last 24 hours by default:

- Average and p95 full provider latency, including failed attempts.
- Attempt counts to distinguish a useful comparison from a small sample.
- Average direct HTTP/session latency and direct-path failure counts.
- Browser/TRAWL/page recovery handoffs, latency and failures.

The saved definition is [ops/sentry/scraper-health-dashboard.json](../ops/sentry/scraper-health-dashboard.json). The dashboard is scoped to `delivery-tracker`; its time range can be changed in Sentry. Metrics start with this release, so earlier scraping timings cannot appear retroactively.

## Measurements

`tracking.scrape.duration` is a distribution in milliseconds. `carrier` identifies the adapter actually called (carrier catalog ID, or `Ship24`, `ParcelsApp`, `17TRACK`, `Postal Ninja`), with `phase`, `outcome` and `error_type` attributes. `tracking.scrape.attempts` counts those same attempts. `tracking.scrape.fallbacks` counts each internal recovery handoff with `carrier`, `from_phase`, `to_phase`, and `error_type`.

`phase:total` measures the entire provider call through `CarrierTrackingAdapter` or `UniversalTracker`. The seven hybrid adapters additionally record `direct` and their recovery phase: DHL, DHL eCommerce, UPS, Mondial Relay, DPD, DPD France, and Ship24. A provider's total includes session waiting, retries and internal recovery; it does not include other providers tried by the router. Existing Postgres `tracking_sync_steps` fetch durations cover the whole package lookup, including provider changes.

A direct failure followed by successful browser recovery produces an error direct sample, a recovery-handoff count, a successful browser sample and a successful total sample. Select one phase when counting attempts; summing phases double-counts a lookup. Session refreshes can produce multiple direct samples. Native browser-only providers have total timings; a browser call there is not an API fallback.

Metrics are emitted on success and failure with monotonic elapsed time. They work with `SENTRY_TRACES_SAMPLE_RATE=0`; trace sampling does not disable metrics in the installed SDK. Structured `tracking_scrape` JSON logs carry the same timings even if Sentry is unavailable. Telemetry sink failures preserve the original tracking result/error.

## Investigating regressions

Search Sentry issues for `component:tracking-routing operation:transport_fallback`, optionally adding `provider:Ship24` or a carrier ID. These warning events are emitted before recovery and retain the original exception, stack, cause chain and custom properties. HTTP errors include request and response diagnostics. A successful recovery does not suppress the warning. Existing provider-failure events cover errors that bypass internal recovery, including 429 and service outages.

Compare direct latency/failure counts with recovery usage. A rising recovery count alongside successful total calls identifies a hidden API regression. Average/p95 totals show its user-visible cost. Check attempts and error outcomes before comparing providers; a quick rejection is not a quick successful scrape.

Sentry retains supplied diagnostic context, including user/tracking fields and session headers, without application-level redaction, as requested for this project. Metric calls preserve inherited SDK context too. Metric dimensions explicitly set by this code remain provider/phase/outcome/error class. Byte/time bounds on body reads and Sentry normalization/tag limits protect runtime and ingestion capacity; they do not remove fields by sensitivity. Client-facing tracking data continues to use its normal product schema.

The dashboard uses existing Sentry access and retention. This change adds warning issues and metrics, without changing notification recipients or organization-level alert rules.
