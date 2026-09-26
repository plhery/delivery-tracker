# Packeta

The Central European locker and pickup-point network (Zásilkovna in Czechia), last mile in
CZ, SK, HU, RO and PL. Tracked through the keyless endpoint behind the public tracking page.

## How it works

1. `direct`: one `POST https://tracking.packeta.com/api/getPacketById/{code}/en`. No cookies,
   headers, account or browser state.
   - The echoed `barcode` must match the request, otherwise `SchemaError`.
   - Unknown codes come back two ways, both `NotFoundError`: HTTP 404 `{"error":"notFound"}`,
     or HTTP 200 carrying `error` instead of `item`. Expired codes answer the same 404, so
     unknown and expired look identical.
   - Any other non-200 is `UpstreamHttpError`.

## Notes

- The locale is pinned to English. Event sentences are the only per-event signal, and a
  fixed locale turns them into a stable vocabulary that substring matching can classify.
- Two independent maps: `packetStatusId` sets the parcel's stage, the canned sentences set
  each event's stage. The overall stage never borrows from the sentences.
- Only `packetStatusId` `3` (delivered) is confirmed live; the other ids are reconstructed
  from prior art. An unmapped id is treated as schema drift: `unknown`, no guessed stage.
- Times are naive and read as `Europe/Prague`, the zone the backend stamps. The result
  carries `timezone: Europe/Prague` so clients render them correctly. Stamping UTC would
  shift every event by one or two hours.
- `sender` (merchant) and `branchAddress` (Z-BOX or partner shop) are kept as sender name
  and pickup point; neither holds recipient data. Recipient name, address, phone and
  signature are never read; a test asserts it.
- At most 20 events are returned, newest first.
- Links use the canonical `/en/{code}` path; the legacy `?id=` form 301-redirects to it and
  is still recognized.

## Limitations

- No delivery estimate and no event locations.
- Romanian (EET) depot scans can be one hour off: the backend stamps Prague time and events
  carry no locality to correct it.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/packeta`. The wrong-number check
needs no env vars; set `PACKETA_DELIVERED_TRACKING_NUMBER` to also check a real delivered
parcel.
