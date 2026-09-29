# Ninja Van

Tracks Malaysian NLMY parcels through the anonymous request used by Ninja
Van's public tracking page.

## How it works

One bounded GET returns an order identified by the requested tracking ID. A
404 is treated as absence only when its error explicitly echoes that ID; other
errors and empty histories are inconclusive. Other country and parcel formats
still use universal providers.

## Notes

The public page hides internal routing and shipment bookkeeping events. Its
oldest-first event feed is reversed after those rows are removed. UTC scan
clocks need no zone guess; invalid clocks retain provider text. An explicit
return scan starts the return leg, and a return-marked delivery scan completes
it. The stale delivery window, merchant name and detailed order data are not
retained.

## Live test

Set `NINJA_VAN_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/ninja-van/adapter.live.test.ts`.
Optionally set `NINJA_VAN_UNKNOWN_NUMBER` to check an explicitly absent parcel.
