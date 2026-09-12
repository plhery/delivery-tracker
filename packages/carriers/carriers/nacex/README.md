# NACEX

## Identity and scope

NACEX is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://www.nacex.es/irSeguimiento.do`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `2850/11247170` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/reclamaci-C3-B3n-por-da-C3-B1o-a-mercanc/7bf1f90f3a5fe7d8cb)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (Nacex recognized) |
| 17TRACK | ❌ Provider rejects the slash composite format (Invalid tracking number); the dedicated adapter serves it (2026-09-13) |

Also tried `2103/11207088` on Ship24: 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `2850/11247170`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `2850/11247170` via prod TRAWL: format rejected by provider guard.
