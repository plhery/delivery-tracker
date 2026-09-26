# Paack

Last-mile carrier for online retailers in Spain, Portugal, France and the UK. Tracked through
the public recipient page, which needs the order number and the delivery postcode.

## How it works

1. `direct`: one bounded `GET https://mydeliveries.paack.app/tracking/order?tracking_number=…&postal_code=…`
   with `redirect: 'manual'`. The page is a Remix app, so the `routes/tracking.order` loader
   response is already embedded in `window.__remixContext`; reading it avoids a second
   undocumented API call and gives exactly what the page renders.
   - A 3xx back to the form or an HTTP 404 is not-found. Following the redirect would only
     return a generic page.
   - "Order not found" / "Incorrect order number or postal code" (and French and Spanish
     variants) in the HTML or loader payload is also not-found.
   - `orderTrackData.external_id` must equal the requested number.
   - An empty HTTP 200 is `IndeterminateError`.
   - No postcode on the parcel raises `InputRequiredError`.

## Notes

- Numbers are retailer order numbers with no stable shape, so there is no detection rule:
  a rule would cost precision for every other carrier. Paack is picked manually or through a
  `mydeliveries.paack.app` link.
- The postcode is half of the lookup key, so it is a credential: never log it, commit it or
  put it in an issue.
- Stages come from each entry's stable `id` and `label` (a translation key), never from the
  localized text. Both are reduced to letters and digits and matched by substring, so
  suffixed variants (`scannedAtOriginHeader`) land on the same stage.
- Failure rules run before delivery rules: `notDelivered` contains `delivered`.
- Scheduled returns (`returnToSenderScheduled`, `returnAbsent`, `returnOther`) are
  `failed_attempt`, not `returned`, so a parcel that can still be delivered stays active.
- `activeEvent` decides the overall status when it maps: the banner can be ahead of the
  timeline. The timeline keeps its own per-event stages.
- Entries flagged `timeline: false` are skipped; the rest are de-duplicated, sorted newest
  first and capped at 100.
- Event descriptions are our own English wording. Unknown identifiers read "Shipment update".
- Event times are parsed locally, not with `core/time`: the loader mixes epoch seconds,
  epoch milliseconds and ISO strings with offsets in one field, and the result keeps
  millisecond precision.
- `expected_delivery` is the end of the delivery window, dropped once delivered or in
  exception. The window start is not kept.
- Retailer, recipient name, e-mail, phone, address and per-event `variables` (which
  interpolate them) are never read; a test asserts it.

## Limitations

- No event locations: the loader exposes none.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/paack` (no env vars). It checks
that Paack's own retired API examples return not-found.
