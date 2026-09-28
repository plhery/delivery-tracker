# Canpar

Tracks individual full parcel barcodes through the official anonymous tracker.

## How it works

One bounded JSON POST requests parcel history without expanding the shipment.
The response must contain one matching barcode. Empty placeholder packages and
provider errors remain inconclusive.

## Notes

Scans retain the provider's newest-first order and local clocks. The public
client ignores the ambiguous clock-shift field; no instant or delivery timestamp
is inferred from it. The host retains those scans and asks providers for dated
progress. Each scan uses its own code. A completed return does not override later
movement or delivery. Estimates, references, full addresses, comments, contacts,
signatures and proof images are excluded.

Delivery notices, short barcodes and reference searches require different lookup
inputs and are outside this adapter's scope.

## Live test

Set `CANPAR_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/canpar/adapter.live.test.ts`.
Optionally set `CANPAR_UNKNOWN_NUMBER` to check an inconclusive empty result.
