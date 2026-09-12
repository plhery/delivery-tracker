# Planzer notes

## Decisions

- **One adapter, two routes.** The capability URL decides which route serves a
  lookup; it is not a fallback tier, so both live in the same `direct` step.
  A parcel without a tracking URL always uses the API, which is what the host's
  dispatch chain did before the move.
- **Each milestone is classified on its own.** Planzer's English `Shipped`
  means *delivered*; inheriting the shipment's current status would have
  stamped `delivered` on earlier events and made re-syncs duplicate history
  with different stages.
- **An unfamiliar milestone label is an error.** The label vocabulary is small
  and stable, so new wording is far more likely to be a schema change than a
  new state. Failing loudly surfaces it through the existing sync error
  monitoring instead of guessing.
- **Only matching transport positions are read.** A delivery can carry
  positions of other shipments; showing one would be a privacy failure, not a
  bug.
- **Quickpac shares this adapter.** Quickpac's `44…` identifiers use the same
  API and the same public page. The separate carrier id is kept for detection
  and display, so existing parcels keep their label.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` and
  `src/server/planzerShared.ts`. `PlanzerTrackingError` became
  `NotFoundError('Planzer')` (same message, same 404) and the payload-shape
  `TypeError`/`RangeError`s became `SchemaError` with their messages unchanged.
  One exception: `Planzer returned an unrecognized tracking event status` stays
  a `TypeError`, because the host's grouped Quickpac test asserts that exact
  error object and is deleted with the legacy dispatch chain. It becomes a
  `SchemaError` as soon as that assertion moves to matching the message.

## Rejected alternatives

- **Treating the shared link as a second tier after the API.** The API does not
  know shared shipments at all, so a fallback would only add a guaranteed
  failure and a wasted request per lookup.
- **Mapping `Shipped` to a dispatch stage.** It is the English label Planzer
  prints for `Zugestellt` / `Livré`; the French and German payload fields on the
  same event confirm it.
- **Adding `Expédié` / `Versandt` / `Spedito` to the localization aliases.**
  Those words mean *dispatched* in ordinary usage; only the aliases that are
  semantic equivalents of Planzer's own labels are mapped.
- **Parsing the shared page's localized step labels as the retained
  description.** The page renders them in the recipient's language; our own
  neutral wording per stage keeps the history stable whichever language the
  page was fetched in.

## Verification log

- 2026-09-06: real Quickpac delivery checked; four milestones, sub-second
  offset-less timestamps, `Shipment delivered` as the shipment label.
- 2026-09-12: 26 status entries recorded in `statuses.json` — nine observed API
  labels, twelve generated localization aliases and five shared-route steps.
- 2026-09-12: capability guard added — `history` and `eta` are both proved by
  `fixtures/delivered.json`, which also carries a consignee and a signature to
  prove they are dropped.
