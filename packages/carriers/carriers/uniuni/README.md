# UniUni

Tracks individual parcels recognized by the official anonymous tracking page.

## How it works

One bounded GET uses the site's fixed public web configuration. No browser,
account or session bootstrap is needed. The response must identify one matching
parcel; master shipments with multiple pieces remain inconclusive.

## Notes

Corrected per-scan seconds provide instants. The older numeric clock field
encodes local wall time and is excluded. Missing corrected seconds retain local
clocks in provider order without advancing freshness. Impossible local dates retain
their original text. Current status comes from
the latest actual scan. The legacy estimate field is excluded because the
current page uses a separate service with an explicit enabled flag. That
optional estimate service is not queried. Detailed delivery prose, addresses,
coordinates, operators and proof images are excluded.

## Live test

Set `UNIUNI_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/uniuni/adapter.live.test.ts`.
Optionally set `UNIUNI_UNKNOWN_NUMBER` to check an absent parcel.
