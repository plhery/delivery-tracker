# NZ Post

Tracks domestic parcel barcodes and postal references through the anonymous
consumer service used by NZ Post's tracking page.

## How it works

One GET returns the parcel reference and actual tracking events. No account,
API license, cookie or browser is required. Only one exact returned reference
is accepted; consignments that expand into several parcels are inconclusive.

## Notes

The short status and depot name provide the timeline. Longer descriptions,
signatures and delivery assets contain recipient data and are excluded.
Pickup requests remain pre-advice until a collection scan occurs. Empty history
is inconclusive; only the service's specific absence response is negative.

## Limitations

Explicit offsets establish event instants. Missing, malformed or offsetless
clocks preserve the source order without borrowing an older scan's timestamp.
See [ROUTING.md](../../../../docs/ROUTING.md) for unresolved history handling.
Delivery estimates and account-only delivery controls are not retrieved.

## Testing

Run `npm run test:carriers:live -- packages/carriers/carriers/nz-post`.
Set `NZ_POST_TRACKING_NUMBER` outside the repository for a real parcel.
