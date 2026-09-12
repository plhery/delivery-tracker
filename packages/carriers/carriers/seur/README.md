# SEUR

## Identity and scope

SEUR is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://www.seur.com/miseur/mis-envios`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `01475194188635` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/empresas/seur/500000075)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No SEUR history — 9 events but DPD Germany (corpus attribution unverified) |
| ParcelsApp | ❌ No SEUR history — DPD history; `046999610972820260807` asks for SEUR postcode/phone/email |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

Also tried `046999610972820260807` on Ship24: 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `01475194188635`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
