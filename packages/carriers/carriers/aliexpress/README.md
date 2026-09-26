# AliExpress / Cainiao

Cainiao is Alibaba's logistics network and carries the international leg of most AliExpress
orders. It rarely does the last mile: it hands the parcel to a local post or courier and
publishes that partner's number when it has one. Cainiao numbers have no exclusive shape
(`LP` + 14 digits collides with other networks), so parcels land here only when the user
picks AliExpress or pastes a `global.cainiao.com` link.

## How it works

1. `direct`: one keyless GET to `https://global.cainiao.com/global/detail.json?mailNos={number}&lang=en-US`,
   the JSON behind the consumer page. No session, cookie or token. 10 s timeout, no fallback tier.

## Handoff

- The partner number comes from `copyRealMailNo`; only when that is missing or malformed is it
  extracted from the display prose in `realMailNo`. It is returned as `delivery_tracking_number`,
  with `destCountry` as `destination_country_name`.
- The host decides whether to hand off to the partner; see [`docs/ROUTING.md`](../../../../docs/ROUTING.md).
  Checksum-valid `L…CH` numbers keep a Swiss Post confirmation probe unless Cainiao names another
  destination. The destination label only restricts that probe; it never picks the operator.

## Notes

- The endpoint can return several modules. Only the one whose `mailNo` equals the requested
  number is read; anything else is a `SchemaError`, because showing a stranger's parcel is worse
  than an error.
- The newest `latestTrace.actionCode` decides the status. The parcel-level `status` token
  (`DELIVERED`, `CLEAR_CUSTOMS`, `transport`…) has no stable vocabulary, so it is only a fallback
  when no action code exists. The action-code map comes from the MIT client
  [ha-cainiao](https://github.com/ha-parcel-integrations/ha-cainiao).
- `GTMS_STA_SIGNED` means a pickup station signed, not the recipient: it maps to
  `ready_for_pickup`, never `delivered`.
- Whether `out_for_delivery` means "on the van" or "at a pickup point" is decided once from the
  newest action code and applied to the whole history. Changing that would rewrite the stages of
  stored events on re-sync.
- An empty module is not-found only when `mailNoSource` is `EXTERNAL`. Otherwise the seller has
  not shipped yet and the parcel stays pending; a 404 would make the sync give up on an early parcel.
- Scan time is `timeStr` (local wall clock) plus `timeZone` (`GMT+2`, `GMT+8`…). `timeStr` alone
  would be read as UTC, the catalog timezone. The epoch `time` field is ignored: it treats `timeStr`
  as Beijing time even for European scans. A scan without `timeZone` keeps its raw text.
- Unknown action codes leave the event without a stage; the sync classifies the wording and records
  it for review.

## Limitations

- Undocumented, keyless endpoint. Failures surface as sync errors; nothing retries them.
- No scan locations: the endpoint has none, and parsing them out of descriptions was rejected.
- At most 20 scans are kept. The recipient block and proof-of-delivery links are never read.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/aliexpress` needs no env vars. It checks
not-found with a synthetic number and handoff extraction on the public example in `numbers.json`.
