# SpeedX

## Identity and scope

SpeedX is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://tracking.speedx.io/{trackingNumber}`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `SPXMIA056745759994` (shipment, `public_shipment_report`, [source](https://es.trustpilot.com/review/speedx.io)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (SpeedX recognized) |
| 17TRACK | ❌ No usable history — captured replies without history (2026-09-13) |

Also tried the other 3 public numbers on Ship24: all 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `SPXMIA056745759994`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `SPXMIA056745759994` via prod TRAWL: no usable history (history_missing).
