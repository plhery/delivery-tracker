# Swiss Post

Swiss Post domestic parcels and inbound international letter-post (`…CH` S10
numbers), tracked through the anonymous API behind the public `service.post.ch`
tracker. AliExpress/Cainiao letter-post that ends in Switzerland is handed off
here (`src/server/carrierHandoff.ts`). Freight goes to
[swiss-post-cargo](../swiss-post-cargo/README.md) and PostLogistics
track-and-trace to [postlogistics](../postlogistics/README.md).

## How it works

`direct`: four calls on one cookie jar under `https://service.post.ch/ekp-web/api`,
each bounded at 10 s.

1. `GET /user` creates a throwaway anonymous user and returns an `x-csrf-token` header.
2. `POST /history?userId=…` with `{ searchQuery }` returns a search `hash`.
3. `GET /history/not-included/{hash}?userId=…` returns matching shipments.
   An empty array is the clean not-found.
4. `GET /shipment/id/{identity}/events` returns the scans. Optional: if it fails,
   the shipment summary is still returned.

Event wording comes from `core/rest/translations/en/shipment-text-messages`,
fetched once per process and only when there are events. Keys are dotted
patterns with `*` wildcards; the most specific match of the same length wins,
and the `INLAND`/`IMPORT`/`EXPORT` segment comes from the shipment's own flags.

## Notes

- One cookie jar per lookup — the user, CSRF token and hash are only valid
  together, and a shared jar could leak one search's hash into another.
- Exactly one result must match the number, on `shipmentNumber` or the echoed
  `internationalBarcode` — the endpoint is a search and can return neighbouring
  shipments. None or two matches are refused. Numbers are compared without
  spaces, dots or dashes, so the portal's dotted form matches.
- The newest event code overrides `globalStatus`, which lags: a MyPost24 locker
  deposit (`2102`) reads `DELIVERED` at shipment level while the parcel still
  waits for pickup.
- `LETTER.*.90.*` import scans have their own code table. The same numbers mean
  different things for parcels, and their wording ("Completion of customs
  clearance", "Arrival at the collection/delivery point") reads like active
  customs or a delivery when it is neither.
- Codes are classified, not wording: wording depends on the translation table.
  Unmapped codes get no stage and are left to the sync.
- Timestamps are kept exactly as sent and parsed only to sort (offset-less
  values read as UTC for that comparison). `core/time` is not used for this reason.
- Wording is only trimmed, not whitespace-collapsed, so `core/transport`'s
  `clean()` is not used.
- Scan locations keep the depot's city and postcode: it separates same-named
  Swiss towns, and it is the scanning facility's postcode, not the recipient's
  (see [PRIVACY.md](../../../../PRIVACY.md)). Recipient name, address, signature
  and delivery instructions are never read; a test asserts it.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/swiss-post` (no env
vars; checks that a valid-shaped unknown number returns a clean 404). The
fixture is constructed in the public result shape with a synthetic number.
