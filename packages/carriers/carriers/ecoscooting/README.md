# Ecoscooting

## Identity and scope

Ecoscooting is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://ecoscooting.com/tracking/{trackingNumber}`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `380030000066362966` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/las-entregas-no-llegan-/a9ac02ca080289f896)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt |
| 17TRACK | ❌ No usable history — lookup still polling at budget end (code 100; 2026-09-13) |

Also tried the other 4 public numbers on Ship24: all 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `380030000066362966`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `380030000066362966` via prod TRAWL: no usable history (lookup still polling).
