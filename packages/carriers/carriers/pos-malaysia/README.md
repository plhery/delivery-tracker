# Pos Malaysia

Pos Malaysia items, including Pos Laju, tracked through the keyless API behind the official
[tracking app](https://tracking.pos.com.my/).

## How it works

1. `direct`: one `POST https://ttu-svc.pos.com.my/api/trackandtrace/v1/request` with
   `{ connote_ids: [number], culture: "en" }` and a client-generated `P-Request-ID` header. No
   cookies, account, signature or browser. 15 s timeout.

## Notes

- HTTP is always 200 and the envelope always `S0000`, so only the item can say "unknown": an empty
  `process_status` with `tracking_data: null` is not-found. Unknown and expired numbers look the
  same. A non-delivered item with no events is also not-found.
- The endpoint accepts several connotes, so the item is found by its echoed `connote_id`, never by
  position.
- `process_status: "DELIVERED"` is authoritative and wins over the event rows, even when there are
  none. Otherwise the status comes from the latest event's `process_summary`.
- An unmapped `process_summary` keeps an `in_transit` stage rather than none: every row is a physical
  scan, and no terminal stage is invented.
- Times like `22 Aug 2023, 05:34:58 PM` have no offset and are read as `Asia/Kuala_Lumpur`, which is
  unambiguous (one zone, no DST).
- Portal links must use the path form `/tracking/{number}`; `?id=` and `#trackingIds=` do not
  prefill the lookup.
- The 2020-era REST endpoint in community notes is gone; this flow comes from the tracking app's
  bundle.

## Limitations

- No ETA: `eta_data` exists but has always been empty.
- Only the delivered-path wording (`Collected` to `Delivery completed`) is known, from the demo parcel
  in the app bundle. Failure, return and pickup summaries are unknown and land on `in_transit`.
- Sender and recipient blocks and the `epod` proof-of-delivery link are never read; the offline test
  asserts it. `office` is kept as a coarse facility name. At most 20 events are kept.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/pos-malaysia` checks a synthetic not-found.
Set `POS_MALAYSIA_DELIVERED_TRACKING_NUMBER` to also check a real delivered parcel.
