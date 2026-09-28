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
     only when it carries a short, valid `Retry-After`. Both calls share a cancellable
     deadline; other errors are not retried.
   - Unknown barcode: an ordinary item with no events and "barcode was not found" in
     `message`. That phrase is the only part of `message` read; the rest is provider prose
     that must not reach an error or log.
   - An empty history without that message is inconclusive. Duplicate matching identities
     are refused. HTTP 404/410 means the endpoint is unavailable, not the parcel missing.

## Notes

- Token and lookup are one step: same host, same failure modes, so a second tier would add
  telemetry without a recovery path.
- A fresh token per lookup: it is free and short-lived, and caching it would add an expiry
  path to get wrong.
- `datetime_local` is the scan's local time even though PostNL appends `Z`. Each scan is
  re-read in the zone of its own `country_code`. Countries spanning several zones (US, CA,
  BR…), Spain and Portugal's mainland/island clocks, missing countries and ambiguous
  daylight-saving clocks retain `local_time`.
  Invalid date text and unexpected nonzero offsets remain separate. The host
  archives these rows and asks providers for dated progress when the current clock
  cannot be resolved.
- Categories supply the status, with one precise English refinement: "The item is out
  for delivery" distinguishes delivery from other `Processing` scans. Unknown categories
  leave the event unstaged and the shipment status unknown.
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
