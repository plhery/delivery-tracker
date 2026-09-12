# PostLogistics

## Identity and scope

PostLogistics is Swiss Post's logistics arm; this folder covers its own
track-and-trace service, the one behind `tracking.postlogistics.ch`. It is
separate from the `swiss-post` carrier, which tracks ordinary Swiss Post parcels
and letters. Parcels reach this folder because the sender picked PostLogistics:
the catalog has no exclusive detection rule for its identifiers.

## Portals

| Portal | URL | What it is |
|---|---|---|
| Swiss Post tracking | `https://www.swisspost.ch/swisspost-tracking?formattedParcelCodes={trackingNumber}` | Where a tracking link points. |
| PostLogistics tracker | `https://tracking.postlogistics.ch/` | The track-and-trace page the endpoint belongs to. |
| Canary | `https://service.post.ch/` | Probed daily for availability. |

The tracker posts the identifier to
`eosapi.postlogistics.ch/api/trackandtrace/public`, a keyless JSON endpoint.
That endpoint is what the adapter reads.

## What we retrieve

Retained: the shipment status, the newest status text, every history entry with
its timestamp, its description and its operational city, and the planned
delivery date (or the estimated arrival) as the estimate.

Discarded: everything else a shipment can carry, including the recipient block
and the signature (exercised by `fixtures/delivered.json`).

Unavailable: an explicit per-event stage. The endpoint gives one three-letter
code per scan but no stage vocabulary, so events are returned without a stage
and the sync classifies their wording.

## Tracking numbers

No exclusive detection rule. The service accepts two kinds of input and says
which it got:

- a barcode, answered as `Type: 1`;
- a customer reference, answered as `Type: 2` with the barcodes it resolved to.

`numbers.json` holds one invented placeholder, recorded as a negative: it
resolves to no carrier, which is what the engine should answer for it.

## How the adapter works

One bounded POST with a 15-second timeout, declared as a single `direct` step.
No session, cookie or token is involved and nothing is retried.

`Type: 1` answers may contain several shipments, so only the one whose
`Identifier` equals the requested barcode is read. `Type: 2` answers are
merged: the requested string is not a barcode, so every shipment returned
belongs to this lookup. Any other type is refused rather than guessed at, and a
`Type: 2` answer with no resolved barcode is refused too.

Merged references interleave several barcodes, so history is ordered by
absolute instant, with the provider's own order kept for entries that share
one.

A `Data: null` answer is the service's explicit "unknown identifier" and
becomes a clean 404.

## Status reference

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| `delivered` | `DEL`, `DLV`, `POD`, `SIG` | fixture |
| `registered` | `NTF` (shipment announced) | fixture |
| everything else | any other code | not mapped; the shipment stays in transit and the wording is classified by the sync |
| `accepted`, `in_transit`, `out_for_delivery`, `customs`, `failed_attempt`, `ready_for_pickup`, `returned`, `pending` | — | not observed; reported as unmapped |

The map is deliberately small: a wrong "delivered" is worse than a missing
nuance. `statuses.json` carries the full list with provenance.

## Limitations and privacy

- The endpoint is undocumented and keyless; it can change without notice.
- History timestamps carry their own offset when the service supplies one; the
  catalog timezone (`Europe/Zurich`) is applied by the host otherwise.
- No recipient name, address or signature is retained, and none is written to
  logs, fixtures or documentation.

## Verification log

- 2026-09-12: adapter moved into this folder from
  `src/server/upstreamAdapters.ts`; behaviour unchanged apart from the error
  taxonomy (`NotFoundError` / `SchemaError` replace the previous ad-hoc
  classes).
