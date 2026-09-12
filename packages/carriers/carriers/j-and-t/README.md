# J&T Express

## Identity and scope

J&T Express is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://www.jtexpress.ph/track-and-trace?flag=1&waybillNo={trackingNumber}`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `888 058 657 515` (shipment, `public_shipment_report`, [source](https://news.detik.com/suara-pembaca/d-3988487/paket-dinyatakan-hilang-j-t-menolak-mengganti-penuh)).

| Provider | Result |
| --- | --- |
| Ship24 | ⏳ Indeterminate — Ship24 lookup timed out twice at 8–10 s, not proven incompatible |
| ParcelsApp | ❌ No usable history — recipient-postcode notice (GLS) |
| 17TRACK | ❌ No usable history — provider reports lookup unavailable, code 400 (2026-09-13) |

## Verification log

- 2026-09-12: universal-provider probe with corpus number `888 058 657 515`: Ship24: indeterminate; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `888 058 657 515` via prod TRAWL: no usable history (lookup_unavailable).
