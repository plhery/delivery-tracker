# AliExpress / Cainiao notes

## Decisions

- **The action code wins over the parcel token.** Real parcels carry
  parcel-level `status` values from an unestablished vocabulary
  (`DELIVERED`, `CLEAR_CUSTOMS`, `transport`, `pickup`, `delivered`), while
  `latestTrace.actionCode` is a documented per-leg scan code. The token is kept
  only as a fallback for modules that have no trace yet.
- **A station signature is not a delivery.** `GTMS_STA_SIGNED` maps to
  `ready_for_pickup`, not `delivered`: the parcel is at a pickup station and
  the recipient has not collected it.
- **The pickup distinction is derived once per lookup.** Whether
  `out_for_delivery` means "on the van" or "waiting at a pickup point" depends
  on the newest action code, and the same table is then applied to the whole
  history. This is the pre-move behaviour and is preserved deliberately;
  changing it would rewrite the stage of historical events on re-sync.
- **Empty external modules are the only positive not-found.** An empty module
  whose `mailNoSource` is not `EXTERNAL` means the seller has not shipped yet.
  Turning that into a 404 would make the sync give up on a parcel that is
  simply early.
- **The handoff number is read from `copyRealMailNo` first.** `realMailNo` is
  display prose; the identifier is extracted from it only when the
  machine-readable field is missing or malformed.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('Cainiao')` (same message, same
  404) and the payload-shape `TypeError`/`RangeError`s became `SchemaError`
  with their messages unchanged.

## Rejected alternatives

- **Mapping the parcel-level token as the primary signal.** Its vocabulary is
  not established across regions; two parcels in the same state have been seen
  carrying different tokens.
- **Stamping a timezone on the scan strings.** Cainiao returns wall-clock text
  with no offset and no zone. The provider text is passed through unchanged and
  the carrier's catalog timezone is applied by the host, rather than guessing
  UTC here.
- **Inventing scan locations from the description.** The endpoint exposes none;
  an empty location is honest, a parsed one would not be.

## Verification log

- 2026-09-12: 50 status codes recorded in `statuses.json` with their
  provenance; the seven exercised by fixtures are marked `fixture`, the rest
  `prior-art` (ha-cainiao `_ACTION_MAP`).
- 2026-09-12: capability guard added — `history`, `eta`, `eta_window` and
  `delivered_at` are each proved by a fixture-driven result.
