# India Post notes

## Decisions

- 2026-09-01: track through MySpeedPost's Livewire flow. It is the surface that
  answers without an account, and its `tracking-request` attribute carries the
  whole history as JSON once the lookup completes.
- 2026-09-01: use a per-lookup cookie jar (`fetch-cookie` + `tough-cookie`).
  Livewire is stateful: the session cookie issued with the page must travel with
  every `/livewire/update` call, and one jar per lookup keeps concurrent
  lookups from sharing a component snapshot.
- 2026-09-01: short-circuit when the page already reports `Completed`. A cached
  consignment then costs exactly one request.
- 2026-09-01: bind identity twice — the Livewire snapshot's
  `consignment_number` and the rendered fragment's `#consignment_search` value
  must both echo the requested number.
- 2026-09-01: classify from `event_type`, `event` and `remarks` joined into one
  normalized key, most specific rule first. There is no stable code, and offices
  word the same event differently.
- 2026-09-01: keep Cloudflare interstitials as a distinct challenge outcome so
  they stay retryable and never turn into a day-long not-found cooldown.
- 2026-09-12: an exhausted poll budget became `IndeterminateError` instead of a
  bare `Error`. The backend answered, it simply never finished, which proves
  nothing about the shipment.
- 2026-09-12: the classifier moved to `status.ts` and now uses `cleanScalar`
  from `core/transport` in place of the module's own number-tolerant `clean`.
  India Post sends pincodes and ids as numbers as often as strings, so the
  number-tolerant helper is required; the only difference from the old local
  copy is that `cleanScalar` does not truncate a numeric value to `maxLength`.
- 2026-09-12: `normalizeIndiaPostTrackingNumber` keeps throwing `TypeError`; it
  validates an argument, not a provider response.

## Rejected alternatives

- Polling India Post's own tracking site: it is interactive and rate-limited,
  and it does not answer anonymous programmatic requests reliably.
- Treating a still-`Processing` component as not-found: it would put a working
  consignment into a not-found cooldown for a day.
- Dropping rows whose wording is unrecognized: every row is a physical scan, so
  losing it would make the history look emptier than the portal's.

## Open items

- The live test's real-consignment case is now gated on
  `INDIA_POST_TRACKING_NUMBER`. It previously used `JN067614884IN`, which
  `numbers.json` records as a synthetic number built to the published shape — so
  as written it could only ever have 404ed. A real number must not be committed;
  the operator supplies one through the environment variable.
- Only the booking, dispatch and delivery wordings are fixture-confirmed. The
  failure, return, customs and pickup keys come from prior art and have not been
  re-observed.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-01: Livewire flow, CSRF handling, cookie requirement and Cloudflare
  detection confirmed against the live site.
- 2026-09-12: moved to `packages/carriers/carriers/india-post/`; behavior
  unchanged apart from the error class names and the poll-timeout class.
