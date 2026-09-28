# DTDC

Tracks shipments available in the official MyDTDC consumer feed.

## How it works

One anonymous GET returns the current state and scan history. The returned
consignment must contain the requested booking reference or waybill. Related
forward and return scans stay on their own legs, and the current state remains
a separate dated snapshot when it is absent from the scan list.

## Limitations

Some legacy consignments are unavailable in this feed. Its generic failure
message does not prove that a number is unknown. Recipient details, addresses,
booking information and unlabelled weight values are excluded.

## Live test

Set `DTDC_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/dtdc/adapter.live.test.ts`.
