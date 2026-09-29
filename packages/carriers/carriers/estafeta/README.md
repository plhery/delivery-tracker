# Estafeta

Tracks individual parcels using a short tracking code or a full guide.
Reference, pickup-order and international searches use separate form options
and are outside this adapter's scope.

## How it works

A bounded GET must identify one parcel and its canonical guide. A second,
anonymous form POST retrieves history for that guide. Every date group must
identify the same guide, and the first scan must match the latest summary.
No cookies, account bootstrap or API credentials are needed. Colliding codes
and multiple-piece guides require disambiguation and remain inconclusive.

## Notes

Scan clocks have no timezone. They remain local rather than being assigned one
zone across Mexico. The host archives these clocks and asks providers for dated
progress. Missing history stays inconclusive; a terminal summary does not
fabricate a scan. The generic unavailable-information page omits the requested
reference and does not prove absence.

Recipient names, postcodes, signatures, proof images and report actions are
excluded. Scheduled-date controls retain dates after delivery and are omitted.

## Live test

Set `ESTAFETA_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/estafeta/adapter.live.test.ts`.
Optionally set `ESTAFETA_UNKNOWN_NUMBER` and `ESTAFETA_MULTIPIECE_NUMBER` to check
inconclusive unavailable information and multiple-piece guides.
