# Hermes Germany notes

## Decisions

- 2026-09-08: map by `parcelStatus` code only, with no wording rules. The
  recipient service labels every row with a stable enum, so wording adds
  nothing but a chance to be wrong in a language we do not verify.
- 2026-09-08: leave unknown codes unmapped and report the shipment as `unknown`
  rather than defaulting it to `in_transit`. The events still reach the app, and
  the sync records the wording for review; guessing here would silently promote
  a new "delivery failed" code to "in transit".
- 2026-09-08: accept the `parcelAttributes.delivered` flag as a second delivery
  signal, so a delivery announced by a code we do not know yet is still
  recognized as delivery.
- 2026-09-08: drop `EDL_BOOKED_DROPOFF`. It is a preference booking that fires
  before collection, and as the newest row it would drag the parcel backwards.
- 2026-09-08: never call the postcode-protected address endpoint. It returns the
  delivery address, which this app does not store, and calling it would mean
  asking users for a postcode this carrier does not otherwise need.
- 2026-09-12: `HermesGermanyTrackingError` now extends `NotFoundError` and keeps
  its own name. The host's grouped live suite asserts that name and the 404
  status, and that file is not ours to change.

## Rejected alternatives

- Using the row's `status` field for display: it only carries generic
  HAPPY/FINISHED buckets, never customer-facing text. `historyText` is the
  display wording, and the mapped milestone description is the fallback.
- Treating HTTP 404 as an outage: the service answers 404 for expired and
  unknown numbers alike, and treating that as an error would keep retrying a
  parcel whose history no longer exists.
- Keeping a separate stage for Evri-style `H` + alphanumeric numbers: Evri is a
  different carrier in the catalog, and the detection rules already separate
  `H` + digits from `H` + alphanumerics.

## Verification log

- 2026-09-08: `tnt-bundle-v2.js` read for the `parcelStatus` enum and the search
  endpoint; anonymous request confirmed to need only `X-Language`.
- 2026-09-08: Paketda forum sample returned five dated events, delivered to a
  neighbour; recorded in `docs/CARRIERS.md` § Public sample checks.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed results match those asserted before the move.
