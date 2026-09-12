# Quickpac notes

## Decisions

- **No adapter of its own.** Quickpac's `44…` identifiers resolve through the
  Planzer API and the Planzer public page, so `tracking.adapter` points at
  `planzer` and the generated registry maps `quickpac` to that factory. Copying
  the adapter here would have created two implementations to keep in step.
- **The carrier id stays.** Detection, the carrier chip and existing parcels
  still say Quickpac; only the tracking route is shared. Renaming the id would
  have rewritten stored parcels for no user-visible gain.
- **The status vocabulary is repeated in this folder.** `statuses.json` and the
  README restate Planzer's labels so a reader who opens `carriers/quickpac/`
  sees what a Quickpac parcel can report without following a link.
- 2026-09-12: written when the Planzer adapter moved into
  `carriers/planzer/adapter.ts`; no behaviour change for Quickpac parcels.

## Rejected alternatives

- **Keeping the legacy Quickpac adapter.** Its own endpoint stopped serving
  these identifiers; the Planzer API answers them, and the tracking page the
  link opens is the Planzer one.
- **Folding Quickpac into the Planzer carrier id.** Stored parcels, the
  detection corpus and the native catalog all carry `quickpac`; merging would
  be a migration with no benefit.

## Verification log

- 2026-09-06: real Quickpac delivery checked against the Planzer API — four
  milestones, correct delivered classification.
- 2026-09-12: folder documented; `carrier.json` enriched with the steps,
  capabilities and portal facts it inherits from Planzer.
