# GLS Germany

GLS parcels in Germany. Same GROUP recipient service as GLS Switzerland, so the
parser, status map and URL builders are imported from `../gls-ch/`; see
[gls-ch](../gls-ch/README.md) for the endpoints, identity checks and status
handling. This folder only adds what differs.

## How it works

`direct`, always two requests, because the postcode is required here: the
`rstt029` overview, then `rstt028` with the parcel number, postcode and
`REQUEST` owner code. The overview's identity is validated before the postcode
is sent, so a wrong or expired number never transmits it.

## Notes

- HTTP 404 is a not-found only when the body has GLS's `lastError: E000`.
  Otherwise it stays an upstream error: the service also returns 404 for
  challenges and invalid postcodes, which must not look like an expired parcel.
  Delivered parcels age out of public history and then return `E000`.
- Postcodes may be four or five digits: the same parcel can be delivered on
  either side of the Swiss–German border.
- The result's timezone is relabelled `Europe/Berlin`. Both services run on
  CET/CEST, so only the label changes.
- `recognizes(number)` queries the overview on the `/DE/en/` variant. It
  returns false only for a clean not-found and rethrows everything else. The
  detect route (`app/api/carriers/detect/route.ts`) uses it to promote a bare
  11–12 digit number to `gls-de`, so an outage must not read as "not GLS". It
  never sends a postcode.
- `GLSGermanyTrackingError` keeps its name because
  `src/server/expandedCarriers.live.test.ts` asserts it. The constructor still
  accepts a positional timeout because the detect route calls
  `new GLSGermanyTracker(5_000)`.

## Testing

No live test in this folder. `npm run test:carriers:live -- src/server/expandedCarriers.live.test.ts`
checks that an expired public number returns `GLSGermanyTrackingError` before any
detail request.
