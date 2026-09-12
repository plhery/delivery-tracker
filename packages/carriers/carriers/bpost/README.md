# bpost

## Identity and scope

bpost is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://track.bpost.cloud/`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `323211216300000593107030` (shipment, `public_shipment_report`, [source](https://www.test-achats.be/plainte/plaintes-publiques/facteur-qui-a-renvoyer-un-coli/d5dc57a15ab2b157c6)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — recipient-postcode notice (Bpost) |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

Also tried `323245067847491492` and `CE500137339BE` on Ship24: both 404.

## Verification log

- 2026-09-12: universal-provider probe with corpus number `323211216300000593107030`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
