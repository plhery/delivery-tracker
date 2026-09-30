# PostLogistics

Swiss Post's logistics arm, tracked through the keyless endpoint behind
`tracking.postlogistics.ch`. It accepts barcodes and customer references. A
printed eight-digit reference with a dashed three-digit suffix identifies this
carrier. Compact 11-digit numbers are ambiguous; carrier recognition checks
them when tracking has no confirmed carrier. Other identifier shapes need the
carrier to be picked. Ordinary Swiss Post parcels go to
[swiss-post](../swiss-post/README.md).

## How it works

`direct`: `POST https://eosapi.postlogistics.ch/api/trackandtrace/public?culture=fr-FR`
with `{"Identifier": "…"}`. No session, cookie or token; 15 s total timeout.
Stored numbers omit punctuation, so an unknown 11-digit lookup tries the dashed
eight-plus-three spelling before returning 404. A successful undashed lookup
is kept. Same protocol as [swiss-post-cargo](../swiss-post-cargo/README.md).
Recognition uses the same lookup and requires a scan before claiming a match.

- `Data: null` is the explicit unknown-identifier answer and becomes a 404.
- `Type: 1` is a barcode lookup: only the shipment whose `Identifier` equals the
  requested barcode is read, because the answer can include neighbouring shipments.
- `Type: 2` is a customer reference: every returned shipment belongs to the
  lookup and their histories are merged. A `Type: 2` answer with no resolved
  barcode is refused — nothing ties the history to the reference.
- `Type: 3`, which the tracker's published source map does not name, is a Swiss
  Post parcel barcode PostLogistics does not hold. The endpoint relays Swiss Post's
  own scans, each coded `PST`, with no place and in German whatever the culture.
  Once the echo matches the barcode, it becomes a 404 and routing moves the parcel
  to [swiss-post](../swiss-post/README.md). Reading the relay would keep the
  parcel on a thinner copy whose `PST` codes never say delivered.
- Any other `Type` is refused rather than guessed, which could show someone
  else's parcel.

## Notes

- History is sorted by absolute instant, with provider order as tie-breaker —
  merged references interleave barcodes with different offsets, so array order
  would put an older scan on top.
- Only outcome codes are mapped (`DEL`, `DLV`, `POD`, `SIG` → delivered, `NTF` →
  pending); everything else stays in transit. Events carry no stage and the sync
  classifies their wording. A wrong "delivered" is worse than a missing nuance.
- The estimate is `DriveAndArrive.PlannedDeliveryDate`, falling back to
  `EstimatedArrival`.
- Timestamps are kept as sent; the host applies `Europe/Zurich` when there is no offset.
- Recipient and signature blocks are never read; the fixture exercises this.

## Limitations

- The endpoint is undocumented and can change without notice.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/postlogistics` checks
that an unissued barcode returns a clean 404. Set
`POSTLOGISTICS_LIVE_TRACKING_NUMBER` outside the repository to check a shipment,
or `SWISS_POST_TRACKING_NUMBER` to check that a relayed Swiss Post parcel returns
404 so routing can select Swiss Post.
