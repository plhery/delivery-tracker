# YunExpress

## Identity and scope

YunExpress is tracked through the universal providers: this folder carries no
dedicated adapter. The public portal is `https://track.yunexpress.com/`.
Catalog facts live in
`carrier.json`; sample numbers with their evidence and source live in
`numbers.json` (see `../../CORPUS.md`).

## Tracking numbers

Samples live in `numbers.json`. Detection expectations for those samples are
recorded there; the detection sweep replays them on every test run.

## Universal provider compatibility

Probed 2026-09-12 with the corpus number `YT2621200705470145` (shipment, `public_shipment_report`, [source](https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/)).

| Provider | Result |
| --- | --- |
| Ship24 | ✅ Compatible — 33 events via Yun Express + GOFO |
| ParcelsApp | ✅ Compatible — delivered via Yun Express / GOFO |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

## Verification log

- 2026-09-12: universal-provider probe with corpus number `YT2621200705470145`: Ship24: compatible; ParcelsApp: compatible; 17TRACK: not verified in this pass.
