# GOFO Express

Tracks individual US parcels through the official anonymous tracking service.
Other regional services are outside this adapter's scope.

## How it works

One bounded JSON POST asks for Pacific clocks, one of the public page's time
options. The waybill must be the requested GFUS number; the tracking number
repeats it or is the shipper's own reference, never another GOFO number. The
latest summary must agree with the first scan.

The public page renders the whole list without paging and ignores the event
counter, which can count scans the list omits. A larger counter is accepted only
while the list still starts at label creation, so a list cut at either end stays
inconclusive, as do contradictory counts, regional reroutes and empty responses.
Only the explicit US error list proves absence.

## Notes

The page's default "Local Time" setting prints each scan's local clock with
Pacific's offset, which would put Mountain, Central and Eastern scans one to
three hours late. Each requested clock must carry Pacific's offset at that time,
and the instant is expressed in the scan's own zone when GOFO names a valid one.
Clocks without offsets remain local; incomplete clocks retain provider text
without advancing freshness. Current status comes from the latest scan, and
delivery requires confirming wording.
As on the public page, scan wording drops the support contact line GOFO appends
to some scans.
Detailed delivery prose and proof images are excluded. The weight has no
verified unit, and estimates have no verified active-parcel provenance, so both
are omitted. Proof lookup requires a postcode and is not queried.

## Live test

Set `GOFO_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/gofo/adapter.live.test.ts`.
Optionally set `GOFO_UNKNOWN_NUMBER` to check explicit absence.
