# GOFO Express

Tracks individual US parcels through the official anonymous tracking service.
Other regional services are outside this adapter's scope.

## How it works

One bounded JSON POST uses the public page's local-time setting. The waybill
must be the requested GFUS number; the tracking number repeats it or is the
shipper's own reference, never another GOFO number. The latest summary must
agree with the first scan.
The public page renders the whole list without paging and ignores the event
counter, which can count scans the list omits. A larger counter is accepted only
while the list still starts at label creation, so a list cut at either end stays
inconclusive, as do contradictory counts, regional reroutes and empty responses.
Only the explicit US error list proves absence.

## Notes

Each scan carries its own offset. Valid clocks without offsets remain local;
incomplete clocks retain provider text without advancing freshness. Current
status comes from the latest scan, and delivery requires confirming wording.
Detailed delivery prose and proof images are excluded. The weight has no
verified unit, and estimates have no verified active-parcel provenance, so both
are omitted. Proof lookup requires a postcode and is not queried.

## Live test

Set `GOFO_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/gofo/adapter.live.test.ts`.
Optionally set `GOFO_UNKNOWN_NUMBER` to check explicit absence.
