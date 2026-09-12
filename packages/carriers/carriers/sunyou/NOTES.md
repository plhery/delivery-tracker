# SunYou notes

## Decisions

- **Order by absolute instant, never by wall-clock string.** Origin scans carry
  `+08:00` and destination scans a European offset; comparing the raw strings
  put a Chinese scan before a later European one. Applying each leg's own
  offset and sorting by instant fixes the order without touching the text of
  scans that have no offset.
- **A scan without a usable offset keeps the provider's text.** This is
  deliberately not `core/time`'s `explicitOffsetTime`, which rejects a value it
  cannot resolve: a naive string is still the only thing the carrier said about
  that scan, and dropping it would lose history while inventing a zone would be
  worse. The local helper carries that reasoning in a comment.
- **Only the newest scan inherits the shipment stage.** `displayStatus` is a
  shipment-level code; stamping it on every event would claim the parcel was
  delivered at each of its earlier scans.
- **`displayStatus: "0"` and `has !== true` are both a clean 404.** Those are
  the two ways the endpoint says it does not know the shipment.
- **The JSONP envelope is unwrapped before parsing.** An outage or challenge
  page does not unwrap, so it is reported as an invalid response and stays
  retryable instead of being mistaken for a not-found.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('SunYou')` (same message, same
  404) and the payload-shape `TypeError`/`RangeError`s became `SchemaError`
  with their messages unchanged.

## Rejected alternatives

- **Assuming Asia/Shanghai for offset-less origin scans.** Most scans do carry
  an offset; guessing a zone for the rest would produce timestamps that look
  authoritative and are not.
- **Treating an HTML response as "shipment unknown".** It is far more likely to
  be an outage or a bot challenge; classifying it as a not-found would make the
  sync stop checking a parcel that still exists.
- **Mapping the scan descriptions here.** They are free text in several
  languages; the sync's shared wording classifier already handles them and
  records what it could not map.

## Verification log

- 2026-09-12: the per-leg timezone behaviour replayed from the public prior-art
  payloads at https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
  (a 2021-07 shipment whose origin scans carry `+08:00`).
- 2026-09-12: all six mapped display statuses plus the not-found code covered
  by fixture-driven tests; capability guard added for `history`, with
  `fixtures/delivered.json` carrying a recipient block and a signature URL to
  prove they are dropped.
