# GLS Germany notes

## Decisions

- 2026-08-30: import the parser, the status map and the URL builders from
  `../gls-ch/adapter` rather than copying them. Both countries are served by the
  same GROUP recipient service; two copies would drift on the next status code.
- 2026-08-30: validate the overview's identity before sending the postcode. The
  postcode is the user's credential, and a wrong or expired number must not
  cause it to be transmitted at all.
- 2026-08-30: accept four- or five-digit postcodes here (Swiss or German), where
  the Swiss folder accepts four. The same GLS parcel can be delivered on either
  side of the border.
- 2026-08-30: relabel the result's timezone as `Europe/Berlin`. Both services
  run on CET/CEST, so the instant is identical; only what the client displays
  changes.
- 2026-08-30: require GLS's own `lastError: E000` before turning an HTTP 404
  into a not-found. The service also answers 404 for challenges and for invalid
  postcodes, and treating those as "no such parcel" would hide an outage and
  stop the parcel being retried.
- 2026-08-30: keep `recognizes()` strict — false only for a clean not-found,
  re-throw everything else. The carrier-detection route promotes an ambiguous
  numeric shape to `gls-de` on the strength of this answer, so a challenge must
  not read as "not a GLS number".
- 2026-09-12: `GLSGermanyTrackingError` now extends `NotFoundError` and keeps
  its own name, because the host's grouped `expandedCarriers.live.test.ts`
  asserts `{ name: 'GLSGermanyTrackingError', status: 404 }` and that file is
  not ours to change. The constructor keeps a positional timeout for
  `app/api/carriers/detect/route.ts`, which is also not ours to change; it
  additionally accepts an options object so the adapter factory can inject a
  fetcher. Both forms are covered by a test.

## Rejected alternatives

- A separate German status map: the codes are the service's, not the country's.
- Guessing `gls-de` from an 11- or 12-digit number: the shape collides with
  several carriers, which is why detection keeps it low confidence and the route
  asks GLS first.
- Sending the postcode on the `recognizes()` probe: recognition only needs the
  anonymous overview, so the probe never handles a credential.

## Verification log

- 2026-09-08: Paketda forum sample `28286849236` returned the explicit
  retired/not-found response (`E000`, HTTP 404); no detail request was made.
- 2026-09-12: offline tests re-run from the carrier folder after the move,
  including a new test for the positional-timeout constructor form the
  carrier-detection route uses.
