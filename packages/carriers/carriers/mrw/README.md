# MRW

## Identity and scope

MRW is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://www.mrw.es/seguimiento`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `02680I390427` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/mi-paquete-lleva-en-22transito-22/3ca104c95fcd6886da)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (MRW recognized) |
| 17TRACK | ✅ Compatible — 1 event, in_transit (2026-09-13) |

Also tried the other 4 public numbers on Ship24: all 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `02680I390427`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `02680I390427` via prod TRAWL: compatible (1 event, in_transit).
