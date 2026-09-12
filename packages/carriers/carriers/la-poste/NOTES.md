# La Poste / Colissimo notes

## Decisions

- **One adapter for four brands.** `suivi-unifie` answers for Colissimo,
  tracked mail, Chronopost and Delivengo, so `chronopost` and `delivengo` set
  `tracking.adapter: "la-poste"` instead of getting adapters of their own. It
  also means Chronopost never needs its SOAP response, which exposes more
  consignment metadata than tracking requires.
- **The shipment identifier is verified before anything is projected.** The
  feed takes an array of numbers and can answer for more than one; the entry
  whose `shipment.idShip` equals the requested number is the only one read.
- **`returnCode` 104 is the only positive not-found.** Every other non-zero code
  means the feed could not answer, and is reported as inconclusive so the router
  can try a universal provider instead of telling the user the parcel does not
  exist.
- **The retries are two extra runner steps with the id `retry`, not a loop.**
  `runSteps` is given `direct`, `retry`, `retry`; step ids do not have to be
  unique, and the runner distinguishes the specs by identity. This reproduces
  exactly what docs/scraper-monitoring.md documents — "La Poste records its
  first request as `direct` and up to two immediate HTTP 403 retries as
  `retry`" — and keeps each retried rejection reported with its own diagnostics.
  Collapsing the two retries into a single `retry` step would have halved the
  fallback records; folding them into `direct` would have hidden them.
  `adapter.steps` and `carrier.json` list the two distinct tiers,
  `["direct", "retry"]`, because they name tiers rather than attempts.
- **The deadline lives in the `recovers` predicate.** A retry is refused once
  the original 15-second deadline is spent, so an exhausted lookup still throws
  the provider's own `UpstreamHttpError` (403, with its bounded body
  diagnostics) rather than a `BudgetExceededError`. The router's behaviour and
  the Sentry issue stay what they were.
- **Only HTTP 403 is retried.** Other statuses and every parsing failure
  propagate immediately: a 429 or a malformed payload is not going to be fixed
  by an instant repeat.
- **Timestamps are passed through, not re-rendered.** The feed already sends an
  offset; `core/time`'s `isoTime` is used to *validate* the value, and the
  provider's own string is what reaches the result.

## Rejected alternatives

- **Scraping the public tracker page.** The page calls this feed itself; the
  feed is keyless, stable and carries the codes the page renders.
- **Using Chronopost's SOAP service for Chronopost numbers.** It exposes more
  consignment metadata than tracking needs and is not intended for automated
  extraction. The unified feed answers the same numbers.
- **Retrying a 403 with a backoff.** The observed outage was a few hundred
  milliseconds of edge trouble; a backoff would spend the user's deadline
  waiting rather than asking again.
- **Treating every non-zero `returnCode` as not-found.** That would report
  missing parcels during a provider outage.

## Verification log

- 2026-09-10: production HTTP 403s contained the "Site indisponible - Incident
  en cours" page and immediately following checks succeeded. Two immediate
  retries inside the original deadline; each rejection reported before the next
  request.
- 2026-09-10: interactive check of the public tracker page (docs/CARRIERS.md).
- 2026-09-12: moved to `packages/carriers/carriers/la-poste`. `TypeError` and
  `RangeError` for invalid or mismatched payloads became `SchemaError`;
  `LaPosteTrackingError` keeps its name and its `code`, now extends
  `CarrierError`, and reports kind `not_found` for 104 and `indeterminate`
  otherwise. Its `status` for a non-104 code changed from `undefined` to `502`,
  which is the taxonomy's HTTP mirror for an inconclusive answer.
- 2026-09-12: `LaPosteTracker` takes an options object (`timeoutMs`, `fetcher`,
  `recorder`) instead of a positional timeout, and reports through the package
  `StepRecorder`. The host wires its Sentry sinks through
  `hostStepRecorder()`; a tracker built without a recorder is silent.
