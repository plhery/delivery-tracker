# SunYou

SunYou (SYPost) carries small parcels from China to Europe and usually hands them to a local post
for the last mile. This folder covers the journey up to that handoff.

## How it works

1. `direct`: one keyless GET to `https://sypost.net/queryTrack?queryTime=…&toLanguage=en_US&trackNumber={number}`,
   the endpoint behind the public search page. `queryTime` is a cache-buster. The reply is JSONP
   (`callbackName({…})`) and is unwrapped before parsing. No retry: there is no session to rebuild.

## Notes

- A body that doesn't unwrap (an HTML outage or bot challenge) is a `SchemaError`, never not-found:
  a not-found would stop syncing a parcel that still exists.
- Not-found is `displayStatus: "0"` or `has !== true`. Only the record whose `orderNo` matches the
  requested number is read.
- Each shipment has two legs, `result.origin` and `result.destination`, each stamping its own
  `timeZone` (`+08:00`, then a European offset). Each scan gets its leg's offset and events are
  sorted by instant; sorting the wall-clock strings made Chinese scans look newer than later
  European ones.
- A scan without a usable offset keeps the provider's raw text. No zone is guessed (not even
  Asia/Shanghai). `core/time`'s `explicitOffsetTime` is not used because it drops values it can't
  resolve.
- `displayStatus` is shipment-level, so only the newest scan gets its stage.
- Scan descriptions are free text in several languages and are classified by the sync's shared
  wording rules, not here.

## Limitations

- No scan locations or ETA: the endpoint has neither. At most 20 scans are kept.
- The recipient block and signature image are never read.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/sunyou` needs no env vars; it checks that a
synthetic number returns not-found.
