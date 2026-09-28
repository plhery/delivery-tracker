# YTO Express

Tracks Chinese domestic waybills through the official website's consumer feed.

## How it works

One anonymous JSON POST returns an identity-bound scan list. The website displays
a slider before querying; the feed accepts reads without cookies or a challenge token.
The adapter uses each scan's operation code and preserves the feed's newest-first order.

## Notes

Domestic scan clocks use China time. Invalid dates remain unresolved. Return dispatch
keeps subsequent movement, collection and signature scans on the return to the sender.
Return transit remains active; only a completed sender signature is terminal.
Short operation labels and depot names are retained; expanded descriptions containing
courier contacts, recipient details and collection addresses are excluded.

Relayed Chinese labels and their ParcelsApp translations use the same vocabulary as
direct scans. ParcelsApp's UTC-labelled China clocks are read in the catalog timezone.

## Limitations

An echoed number with no scans is inconclusive. Archived histories and international
YTO Global shipments use separate website flows and are outside this adapter's scope.

## Testing

Set `YTO_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/yto/adapter.live.test.ts`.
