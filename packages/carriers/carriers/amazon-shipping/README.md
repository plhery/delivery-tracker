# Amazon Shipping

Amazon Shipping (SWA) and Multi-Channel Fulfillment (MCF) parcels, tracked anonymously
through Amazon's public tracker. The number formats are shared with the account-only
[`amazon-logistics`](../amazon-logistics/README.md), so this carrier is never picked by
detection or by the user (`selectable: false`). A parcel reaches it only after the host
check proves the tracker knows it.

## How it works

1. `direct`: `GET {origin}/api/tracker/{number}` with the public tracking page as `Referer`
   (15 s timeout, 2 MB cap). The origin comes from the number's prefix
   (`core/catalog/amazon.ts`): `IT`, `ES` and `UK`/`GB` have their own `track.amazon.*`
   host, `TBA` uses `.com`, every other European prefix uses `track.amazon.fr`.

Checks, before any history is read:

- `TRACKING_ID_NOT_FOUND` or `INVALID_TRACKING_ID` in `progressTracker.errors`:
  `AmazonShippingNotFoundError`. The tracker answers unknown ids with HTTP 200, not 404.
- A tracking id echoed anywhere in the payload that differs from the request: `SchemaError`.
- `trackerSource` other than `SWA` or `MCF`: not found. A generic page proves nothing.
- Only `SHIPMENT_OLDER_THAN_SUPPORTED_AGE`: `AmazonShippingHistoryExpiredError`. The shipment
  exists but its history is gone; the `IN_TRANSIT` summary that comes with it is a
  placeholder, not movement. The host stores a history-expired marker and stops syncing.

## Notes

- Promotion from `amazon-logistics` needs a structured `SWA` or `MCF` reply. The check lives
  in the host ([`src/server/amazonShippingEligibility.ts`](../../../../src/server/amazonShippingEligibility.ts))
  because it uses host observability and `HttpError`s. It runs again when a parcel is created
  or its carrier changes; a client-supplied carrier name is never trusted. Guessing
  optimistically would show an account-only parcel as trackable and then never update it.
- `progressTracker`, `eventHistory` and `addresses` arrive as JSON strings inside the JSON.
  An unparseable one is a `SchemaError`, never an empty success.
- The host narrows on both error classes with `instanceof`, so keep their names.
  `AmazonShippingHistoryExpiredError` extends `IndeterminateError`, not `NotFoundError`: the
  host's `isUnannouncedTrackingError()` treats any 404 as "not announced yet", the opposite
  of what expiry means.
- Timezone comes from the prefix (default `Europe/Paris`). `TBA` numbers identify no country,
  so offset-free event times are dropped and the result has no `timezone`: stamping UTC would
  shift every event by hours.
- Dates mix ISO-8601, RFC 2822 and US long form ("Aug 11, 2026, 4:31:56 PM"), so the adapter
  uses its own parser instead of a `core/time` helper.
- `DELAYED` / `LATE` map to `in_transit`: a delay is not an exception.
- Events are deduplicated on (time, location, code, description), sorted newest first and
  capped at 100. Shipment status comes from the summary, else from the newest event that
  classifies.
- No universal-provider fallback: Amazon is the only source for these numbers.

## Limitations

- Merchant name, recipient name and contact, the `addresses` block and the proof-of-delivery
  image are never read. From the event `location` only city, region and country are kept; it
  also carries street and postcode.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/amazon-shipping` probes a wrong
number. Set `AMAZON_SHIPPING_LIVE_TRACKING_NUMBER` for a real shipment, plus
`AMAZON_SHIPPING_EXPECT_NOT_FOUND=true` or `AMAZON_SHIPPING_EXPECT_EXPIRED=true` when that
is the expected outcome.
