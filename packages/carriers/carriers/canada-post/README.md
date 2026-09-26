# Canada Post

Canada Post tracking from the tracking app's own JSON endpoint, over plain HTTP. No session,
captcha or browser.

## How it works

The adapter accepts 13–24 digits or a UPU S10 number ending in `CA`, and rejects anything
else before any request.

1. `direct`: `GET https://www.canadapost-postescanada.ca/track-reperage/rs/track/json/package?refNbrs={number}`
   with `Authorization: Basic Og==` (an empty Basic credential, as the app sends), a JSON
   `Accept` and `X-Requested-With: XMLHttpRequest`. Without the empty credential the
   endpoint answers 406.

The reply is an array of packages:

- Exactly one item must echo the number in `pin` / `refNbr1`. Reference lookups can alias,
  so zero or several matches are a `SchemaError`, never another parcel's history.
- An error-only envelope (for example `004` "No PIN History" for an expired number) is an
  unlocated `unknown`, not not-found.
- HTTP and network errors propagate through the shared error taxonomy.

## Notes

- Status uses the numeric package `status` (the app's enum, `0` HalfAccepted to `8`
  Delivered) first, then scan wording.
- `7` is stage `ready_for_pickup` with result status `out_for_delivery`, but the wording
  "Available for pickup" is `failed_attempt` (held after an attempt) with result status
  `exception`.
- `6` (HalfDelivered, a partly delivered multi-piece shipment) maps to `in_transit`.
- `delivered_at` is the actual delivery day, else the attempted delivery day.
- Delivered scans are rewritten to "Delivered" because the line may name who signed.

## Rejected approaches

- Driving the lookup page in a browser: the JSON endpoint answers plain HTTP, and the
  details route performs no lookup on direct navigation anyway.
- The reference-number POST (`ref/filter`): needs a destination postcode and a captcha.

## Limitations

- Scan times have no offset and are read as UTC. That is an unverified assumption: the
  backend may send facility-local time.
- Response keys come from the app's bundle. Scan description and location keys are
  unconfirmed, so the parser tries several candidates.
- Events keep the reply's order, assumed newest first.
- Service type, delivery options and recipient details are never read; a test asserts it.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/canada-post` with
`CANADA_POST_LIVE_TRACKING_NUMBER` set.
