# EMS

Express Mail Service items, tracked through the [EMS Cooperative](https://www.ems.post/en/global-network/tracking)
public tracker shared by national EMS operators. Only checksum-valid `E`-prefixed S10 numbers are
accepted. Ordinary postal items (e.g. `LZ…CN`) belong to the national operator, such as
[`china-post`](../china-post/README.md).

## How it works

1. `direct`: one anonymous GET to `https://items.ems.post/api/publicTracking/track?language=EN&itemId={number}`
   with an ordinary browser User-Agent. No cookies, bootstrap or CAPTCHA. 15 s deadline (or the
   router's budget), 1 MB cap, caller cancellation. No local retry; the host router handles fallback.

## Notes

- Selected only when the user picks EMS or pastes an `items.ems.post` link. There is no bare-number
  rule: EMS S10 numbers are shared with China Post, La Poste and other operators, and a second
  high-confidence rule would compete with them.
- The parser reads only the `.result-table` with id `table-{number}` and checks its three column
  headers. The echoed input field is not proof of identity.
- Not-found is the exact `There were no results found.` row inside HTTP 200. HTTP 404/410 means the
  endpoint is gone and raises a transport error, so routing never concludes the parcel is missing.
- `does not denote an EMS item.` raises `InputRequiredError`: the service is unsupported, not the
  parcel unknown.
- Times are local wall clocks with no zone and are emitted offset-less. The host stores them with the
  catalog timezone (UTC); that is a storage convention, not what EMS means. Don't apply the origin
  country's zone to the whole journey: legs are in different zones.
- Rows arrive oldest first and are reversed rather than sorted, since clocks from different legs
  can't be compared.
- Statuses are an exact-wording map. Customs release and "Arrived at post office" are not delivery.
  Unknown wording keeps the event with an unknown status.
- Exact duplicate rows are dropped; at most 100 events are returned.

## Limitations

- No ETA.
- The Cooperative history can omit the national operator's domestic scans.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/ems` with `EMS_TRACKING_NUMBER` set to a
real EMS number (kept out of the repo).
