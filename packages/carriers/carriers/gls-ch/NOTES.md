# GLS Switzerland notes

## Decisions

- 2026-08-30: use the two endpoints the official frontend uses — `rstt029` for
  the anonymous overview, `rstt028` with the recipient postcode for the history
  — rather than scraping the tracking page.
- 2026-08-30: keep this folder as the shared GLS implementation. `../gls-de/`
  imports the parser, the status map and the URL builders from here, because
  both countries are served by the same GROUP service and two copies would
  drift.
- 2026-08-30: return the overview alone when no postcode is stored, instead of
  failing. A status with no history is still worth showing, and it is all the
  anonymous endpoint has.
- 2026-08-30: let the newest history row outrank the progress-bar heading. The
  heading goes stale — a ParcelShop drop sticks at "Delivered" upstream — so
  `DELIVEREDPS` maps to `ready_for_pickup` with status `out_for_delivery`, and
  the newest event's own wording is what the app shows.
- 2026-08-30: bind the 12-digit printed number to an 11-digit echo by exact
  prefix only. GLS's own ShipIT documentation describes that truncation; without
  the exact-prefix rule, an unrelated numeric parcel in the same response could
  be accepted as a match.
- 2026-08-30: treat "The parcel has not been handed over to GLS." as unmapped.
  It is a negative statement about possession, and any wording rule that sees
  "handed over to GLS" would read it as an acceptance scan.
- 2026-08-30: keep coarse scan locations (ParcelShop name, country, city) and
  drop the street and postcode that sit in the same `address` object.
- 2026-09-12: `GLSSwitzerlandTrackingError` now extends `NotFoundError` and
  keeps its own name; `../gls-de/adapter.ts` narrows on it with `instanceof`.
  The remaining `TypeError`/`RangeError`s became `SchemaError` with their
  original messages. The wording fallback now imports `trackingLanguageStage`
  from `core/status` instead of the host's `src/server/trackingLanguage.ts`.

## Rejected alternatives

- Asking for the postcode before the overview: the overview is what translates a
  Track ID into the parcel number the detail call needs, and it is what carries
  the Swiss Post handoff, so it has to run first either way.
- Sending the postcode to the overview endpoint: it does not need one, and a
  credential should not be sent to an endpoint that has no use for it.
- Trusting the progress bar's `statusInfo` alone: see the locker case above.
- Classifying wording before codes: codes are stable across the service's
  languages; wording is not. Wording is only consulted for rows that carry no
  code.

## Verification log

- 2026-08-30: `gls_group_witt002_js.js` read for the endpoint names, the
  `caller=witt002` parameter and the cache-busting `millis` parameter.
- 2026-08-30: wrong-number response confirmed as HTTP 404 with
  `lastError: E206`; 400 and 403 observed for the same condition.
- 2026-09-08: Swiss Post's published GLS example `993990103198` no longer has
  retained history and answers with the clean not-found path; the live test
  asserts exactly that.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed results match those asserted before the move, and new fixture-driven
  tests cover the pickup point, the weight and the estimate, which the previous
  tests did not exercise.
