# Correos Express

## Identity and scope

Correos Express is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://s.correosexpress.com/`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `7983000739053141` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/incidencia-env-C3-ADo-imposible-h/0052eb4a8375da7128)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt |
| 17TRACK | ❌ No usable history — provider reports lookup unavailable, code 400 (2026-09-13) |

Also tried `3230002125829719` on Ship24: HTTP 201 without history.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `7983000739053141`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `7983000739053141` via prod TRAWL: no usable history (lookup_unavailable).
