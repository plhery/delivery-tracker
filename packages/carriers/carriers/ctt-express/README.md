# CTT Express

## Identity and scope

CTT Express is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://shipping-tracking.production.cloud2.cttexpress.com/?sc={trackingNumber}`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `0082800082809771393048` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/empresas/ctt-express/3C8C0C39-1EAE90226)).

| Provider | Result |
| --- | --- |
| Ship24 | ✅ Compatible — 14 events via CTT Express Tracking |
| ParcelsApp | ✅ Compatible — CTT EXPRESS history |
| 17TRACK | ✅ Compatible — 4 events via CTT Express (2026-09-13) |

Also tried `0082800082809771598159` on Ship24: ✅ 11 events; `0082800011298638008391`: 201 without history.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `0082800082809771393048`: Ship24: compatible; ParcelsApp: compatible; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `0082800082809771393048` via prod TRAWL: compatible (4 events).
