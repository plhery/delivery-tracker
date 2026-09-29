# Bring / Posten Norway

Tracks single-piece domestic consignments and Norwegian S10 postal parcels through
the current anonymous consumer service. Multiple-piece consignments are inconclusive.

## How it works

One bounded GET reads the JSON route published by the
[consumer portal](https://sporing.bring.no/sporing/). The consignment or parcel
identifier must match exactly. This route is separate from the authenticated
[developer API](https://developer.bring.com/api/tracking/).

## Notes

Current progress follows the latest significant scan identified by the portal.
Notifications remain in history without changing the current milestone. Return
transport and completed return use different codes. Per-scan offsets establish
instants; incomplete clocks remain local evidence.

Status wording comes from public event codes. Free-text descriptions, addresses,
pickup codes and proof images are excluded. Weight and dimensions have explicit
units. Estimates are omitted without verified active-parcel provenance. The
consumer's unbound negative response remains inconclusive.

## Live test

Set `BRING_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/bring-posten/adapter.live.test.ts`.
Optionally set `BRING_UNKNOWN_NUMBER` to check the inconclusive absence response.
