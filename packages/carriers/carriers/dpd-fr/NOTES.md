# DPD France notes

## Decisions

- **The direct request is kept even though Cloudflare usually blocks it.**
  It succeeds often enough — and costs one bounded GET — that going straight to
  the browser service would spend a browser on every sync. Mondial Relay made
  the opposite call because its direct path was blocked from every network
  tested; DPD France's is not.
- **The requested number selects the leg.** A trace page can carry an outbound
  parcel and its return. Reading `#infos1`/`tabTraceColisAller` for the outbound
  number and `#infos2`/`tabTraceColisRetour` for the return keeps one recipient
  from seeing the other leg's history, and makes a page for a different shipment
  a hard `SchemaError` rather than a silent mismatch.
- **Wording is matched on a normalized form.** DPD France varies accents,
  apostrophes and trailing punctuation between rows, so every comparison runs on
  the lowercase, diacritic-free, punctuation-free text.
- **Order of the wording rules is load-bearing.** Returns, then incidents, then
  delivery: "votre colis sera retourné à l'expéditeur" would otherwise fall
  through to a delivery rule, and "nous avons reçu une réclamation" would
  otherwise look like ordinary movement.
- **The missing browser tier is a disabled step, not a failed one.** When
  `FLARESOLVERR_URL` is unset the `trawl` step is skipped and the challenge
  thrown by `direct` carries the message
  "DPD France requires a browser challenge solver; configure FLARESOLVERR_URL",
  so telemetry shows one attempted step and the operator still gets the hint.
- **Timestamps use `core/time`'s `zonedTime`.** Rows print naive
  `dd/MM/yyyy HH:mm` wall clock; Europe/Paris is applied explicitly rather than
  guessing UTC.

## Rejected alternatives

- **Looking for a JSON feed behind the page.** The trace page is server-rendered
  and exposes no reusable JSON endpoint; the timeline only exists as markup.
- **Keeping the proof-of-delivery and address blocks "for diagnostics".**
  PRIVACY.md rules them out, and the parser never visits those nodes, so a
  change to them cannot leak them by accident.
- **Assigning `in_transit` to unrecognized wording as a considered mapping.**
  The classifier still returns that stage today, which predates the package's
  rule that unmapped wording must carry no stage. It is kept for now so the
  move stays behaviour-preserving; the honest fix is to return no stage and let
  the sync's classifier record the wording. Tracked here rather than silently
  changed.

## Verification log

- 2026-09-10: direct anonymous requests are challenged by Cloudflare from
  several networks; the same private browser service used for UPS solves the
  page (docs/CARRIERS.md).
- 2026-09-12: moved to `packages/carriers/carriers/dpd-fr`. `TypeError` and
  `RangeError` for empty, missing or mismatched pages became `SchemaError`; the
  plain `Error` for a non-OK response became `IndeterminateError`; the
  "configure FLARESOLVERR_URL" `RangeError` became `DPDFranceChallengeError`
  with the same message. `DPDFranceChallengeError` and
  `DPDFranceTrackingError` keep their names and now extend `ChallengeError` and
  `NotFoundError`.
- 2026-09-12: the hand-rolled TRAWL request became `TrawlClient.scrape()`. The
  endpoint, request body and solved-tier requirement are identical; the
  rejection messages now come from the shared client.
