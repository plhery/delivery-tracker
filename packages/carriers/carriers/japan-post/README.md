# Japan Post

Japan Post items, tracked through the anonymous [English tracking portal](https://trackings.post.japanpost.jp/services/srv/search?locale=en).
Accepts checksum-valid S10 references and 11–13 digit domestic numbers.

## How it works

1. `direct`: one GET to `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1={number}&locale=en`.
   No cookies, browser or key. 15 s default deadline (or the router's budget), 1 MB cap, caller
   cancellation.

## Notes

- `U`-prefixed customs labels are rejected:
  [Japan Post says they are not tracking barcodes](https://www.post.japanpost.jp/service/send/oversea/information/ems_search_en.html).
- Identity comes from the `Item number` cell of the details table (`配達状況詳細`), not the echoed
  form field. Exactly one details table and one history table (`履歴情報`) must exist. Changed headers
  or malformed rows fail the parse instead of silently dropping a newer scan.
- Not-found is the result table (`照会結果`) holding the number and `** Your item was not found…`.
  HTTP 404/410 means the endpoint is gone (transport error), not the parcel.
- History rows come in pairs: the event row, then a postal-code row that is not an event. Postal
  codes, the free-form details column and office contacts are discarded.
- The history header labels overseas scans as local time. Every event keeps its wall clock in
  `local_time`. A UTC `time` is added only when the row's own Prefecture/Country cell is in a small
  confirmed map (`OSAKA`, `KANAGAWA`, `JAPAN` → `Asia/Tokyo`; `MALTA` → `Europe/Malta`) and the
  timestamp is full and unambiguous (not date-only, not in a DST gap or fold). Another scan's zone or
  the destination never fills the gap: a guessed zone produces wrong instants that look authoritative.
- `last_update` is set only when the latest row itself resolved; otherwise it is null and
  `last_update_local` carries the wall clock. Routing then also tries universal providers for a dated
  timeline, keeps the direct history as fallback, and never lets an unresolved result overwrite a
  richer saved summary.
- Rows arrive oldest first and are reversed, not sorted, so mixed resolved and unresolved rows keep
  the carrier's order. Exact duplicates are dropped; the latest 100 are kept.
- "Item returned from import Customs" is still in transit. Unknown wording stays unknown.
- Prior art: [BINM7MD/jp-post-api](https://github.com/BINM7MD/jp-post-api) (MIT) uses the same
  endpoint and row pairing.

## Limitations

- No ETA.
- Domestic numbers are covered only by a synthetic fixture, not a live check.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/japan-post` with `JAPAN_POST_TRACKING_NUMBER`.
