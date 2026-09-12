# Blue Dart

## Identity and scope

Blue Dart is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo={trackingNumber}`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `90617363115` (shipment, `public_shipment_report`, [source](https://www.consumercomplaints.in/blue-dart-express-b100070)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — recipient-postcode notice (GLS) |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

## Verification log

- 2026-09-12: universal-provider probe with corpus number `90617363115`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
