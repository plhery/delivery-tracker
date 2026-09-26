# PostNL

Dutch S10 numbers ending in `NL` and PostNL's international `3S…` barcodes, tracked through
the keyless API behind `postnl.post`. The folder id stays `spring-gds` (PostNL's international
subsidiary) because stored parcels, the detection corpus, the published contract and the
native catalog all carry it; everything user-facing says PostNL.

## How it works

1. `direct`: two POSTs on the same host.
   - `postnl.post/api/v1/auth/token` returns a short-lived visitor token. An empty or
     implausibly long token is refused.
   - `postnl.post/api/v1/tracking-items` takes the barcode with that token. The answer echoes
     a batch; only the item whose `item` equals the requested number is read.
   - Each call replays once after a transport failure or HTTP 502/503/504, and after a 429
     only when it carries a short, valid `Retry-After`. Other errors are not retried.
   - Unknown barcode: an ordinary item with no events and "barcode was not found" in
     `message`. That phrase is the only part of `message` read; the rest is provider prose
     that must not reach an error or log.

## Notes

- Token and lookup are one step: same host, same failure modes, so a second tier would add
  telemetry without a recovery path.
- A fresh token per lookup: it is free and short-lived, and caching it would add an expiry
  path to get wrong.
- `datetime_local` is the scan's local time even though PostNL appends `Z`. Each scan is
  re-read in the zone of its own `country_code`. Countries spanning several zones (US, CA,
  BR…) keep the provider's text, which the host reads as UTC.
- Only `category` is mapped; `status_description` is localized prose. An unknown category
  leaves the event unstaged and the shipment `in_transit`, so the sync records it for review.
- `unsuccesfull` is PostNL's own spelling. The corrected spelling is mapped too, so an
  upstream fix loses nothing.
- The item's `destination_code` becomes `destination_country`. The host uses it as a hint to
  propose one national-post confirmation for S10 numbers (see
  [routing](../../../../docs/ROUTING.md)).
- Sender name is kept only as a webshop or business name, whitespace-collapsed and capped at
  200 characters. Recipient name, address and signature link are dropped; the fixture carries
  them so the test can assert it.
- `mailingtechnology.com/tracking?tn=` (Spring GDS) and retired `postnl.post/details/{n}`
  links are recognized when pasted. New links use `/track?barcodes=`.
- Not used: the Spring GDS portal. It shows extra internal legs for the same barcode, but it
  is a second undocumented surface for a marginal gain.

## Limitations

- No delivery estimate: the endpoint publishes none, so `expected_delivery` is always null.
- The endpoints are undocumented and can change without notice.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/spring-gds` (no env vars). It checks
that a never-issued S10 number returns a clean 404.
