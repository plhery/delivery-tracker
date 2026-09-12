# An Post

## Identity and scope

An Post is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://track.anpost.ie/`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `CP476340265IE` (shipment, `public_shipment_report`, [source](https://www.trustpilot.com/review/www.anpost.com)).

| Provider | Result |
| --- | --- |
| Ship24 | ✅ Compatible — 13 events via An Post |
| ParcelsApp | ❌ No usable history — empty result page |
| 17TRACK | ✅ Compatible — 13 events, ready_for_pickup via An Post; discovered `an-post` (2026-09-13) |

## Verification log

- 2026-09-12: universal-provider probe with corpus number `CP476340265IE`: Ship24: compatible; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `CP476340265IE` via prod TRAWL: compatible (13 events).
