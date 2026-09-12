# BRT

## Identity and scope

BRT is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://services.brt.it/en/tracking`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `08454077486990` (shipment, `public_shipment_report`, [source](https://www.altroconsumo.it/reclamare/bacheca-dei-reclami/brt-non-mi-consegna-il-pacco-n/c869ef987b19acc348)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (BRT Bartolini recognized) |
| 17TRACK | ❌ No usable history — provider reports lookup unavailable, code 400 (2026-09-13) |

Also tried `25003180070704` on Ship24: 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `08454077486990`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `08454077486990` via prod TRAWL: no usable history (lookup_unavailable; API 500 on first try).
