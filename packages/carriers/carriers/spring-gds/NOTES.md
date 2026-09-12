# PostNL notes

## Decisions

- **The folder id stays `spring-gds`.** Stored parcels, the detection corpus,
  the published contract and the native catalog all carry it. The display name,
  the diagnostics and this documentation say PostNL; only the identifier is
  historical.
- **The category is the signal, not the free text.** `status_description` is
  localized display prose; `category` is stable and is the only field mapped.
  An unfamiliar category leaves the event unmapped so the sync can classify its
  wording and record it for review.
- **`unsuccesfull` and `unsuccessful` are both mapped.** The first is PostNL's
  own spelling; keeping the corrected one next to it means an upstream fix
  loses no classification.
- **Token and lookup are one step.** Both are keyless POSTs on the same host
  with the same failure modes, so splitting them into two runner tiers would
  add telemetry without adding a recovery path. Each replays once inside the
  step.
- **A fresh visitor token per lookup.** The token is short-lived and free to
  obtain; caching it would add an expiry path to get wrong for no measurable
  gain.
- **Only the recognized not-found phrase is read from `message`.** The rest of
  the field is provider prose that must not reach an error, a log or an issue.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('PostNL')` (same message, same
  404) and the payload-shape `TypeError`/`RangeError`s became `SchemaError`
  with their messages unchanged.

## Rejected alternatives

- **Publishing an estimated delivery date.** The international endpoint returns
  none; deriving one from the events would be an invention presented as a
  carrier statement.
- **Retaining the recipient fields the item carries.** They are exactly what
  PRIVACY.md forbids; the fixture keeps them so the test can prove they are
  dropped.
- **Scraping the Spring GDS portal for the extra transport history.** It shows
  the same barcode with more internal legs, but it is a second undocumented
  surface for a marginal gain; the PostNL endpoint stays the single source.
- **Using the retired `/details/` link shape for new parcels.** It is still
  recognized when pasted and repaired when stored, but new links use
  `/track?barcodes=`.

## Verification log

- 2026-09-12: all sixteen mapped categories replayed through the adapter in
  `adapter.test.ts`; the rate-limit recovery path replayed for both the token
  and the tracking call.
- 2026-09-12: capability guard added — `history`, `location`, `sender_name` and
  `delivered_at` are each proved by `fixtures/delivered.json`, which also
  carries a recipient name, an address and a signature URL to prove they are
  dropped.
