# PostLogistics

Swiss Post's logistics arm, tracked through the keyless endpoint behind
`tracking.postlogistics.ch`. It accepts barcodes and customer references. No
detection rule claims its identifiers, so parcels arrive here only when the
carrier is picked. Ordinary Swiss Post parcels go to
[swiss-post](../swiss-post/README.md).

## How it works

`direct`: one `POST https://eosapi.postlogistics.ch/api/trackandtrace/public?culture=fr-FR`
with `{"Identifier": "…"}`. No session, cookie or token; 15 s timeout, no retry
(nothing to rebuild, and the next scheduled check retries anyway). Same protocol
as [swiss-post-cargo](../swiss-post-cargo/README.md).

- `Data: null` is the explicit unknown-identifier answer and becomes a 404.
- `Type: 1` is a barcode lookup: only the shipment whose `Identifier` equals the
  requested barcode is read, because the answer can include neighbouring shipments.
- `Type: 2` is a customer reference: every returned shipment belongs to the
  lookup and their histories are merged. A `Type: 2` answer with no resolved
  barcode is refused — nothing ties the history to the reference.
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

`npm run test:carriers:live -- packages/carriers/carriers/postlogistics` (no env
vars; checks that an unissued barcode returns a clean 404).
