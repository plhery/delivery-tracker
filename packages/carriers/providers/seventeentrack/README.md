# 17TRACK

Browser-only universal provider. It splits multi-operator journeys into per-leg
histories, often including the destination postal operator, and reports carrier names.
It runs after Ship24 and ParcelsApp, except for checksum-valid China Post `C…CN` and
`L…CN` numbers, which start with it (reason in [COMPARISON.md](../COMPARISON.md)).
Persisted provider name: `17TRACK`. The folder is `seventeentrack` because an import
path cannot start with a digit. Link shown to users:
`https://t.17track.net/en#nums={number}` (it follows the app language).

## How it works

One step, `trawl`, with a 30 s budget:

1. TRAWL (`FLARESOLVERR_URL`) loads the tracking page (`skipHttp`, up to tier 3) and
   captures `https://t.17track.net/track/restapi` replies with a 15 s settle window.
2. Bodies are parsed newest first. Shipment code 100 means 17TRACK is still polling, so
   the loop continues and remembers the last typed failure.
3. A completed, identity-matched `NotFound` with no rows becomes `NotFoundError`.
4. If nothing parses, the last typed lookup failure is thrown, so a verification wall
   is never reported as an empty capture. Without one, the error says what happened:
   `capture_missing` (nothing captured), `capture_unreadable` (unreadable body) or
   `history_missing` (replies without history). These are indeterminate and say nothing
   about the shipment.

This needs the pinned TRAWL compatibility build ([ops/trawl](../../../../ops/trawl/README.md)).
TRAWL 1.3.1 ignores capture requests. Stock 1.5.0 refuses compressed bodies and can
finish before polling completes. The compatibility build captures the browser-decoded
JSON and waits through code 100.

A cached page can come back as HTTP 304 and still carry a fresh API reply.
[shared/capture.ts](../shared/capture.ts) accepts 304 for capture flows and validates the
captured bodies instead.

## Provider codes

| Code | Meaning | Error |
| --- | --- | --- |
| -11, -13, -14 | interactive verification required | `SeventeenTrackVerificationError` (challenge) |
| 100 (shipment) | still polling | `SeventeenTrackLookupError`, reason `lookup_pending` |
| 400 with one matching shipment and `shipment: null` | no history for this reference | `SeventeenTrackNoHistoryError`, reason `no_history` (indeterminate) |
| any other non-200, including envelope-level 400 | lookup unavailable | `SeventeenTrackLookupError`, reason `lookup_unavailable` |

Routing needs these distinctions for its cooldowns. Sentry keeps `reason`,
`providerCode` and `meta.message` (truncated to 120 characters), because code 400 is
intermittent. A no-history reply proves neither an invalid number nor an unsupported
carrier.

## Parsing

- Exactly one shipment must match the requested number. Demo numbers and ambiguous
  replies are rejected.
- Stages come from the exact `sub_status` map in [events.ts](events.ts) first. It works
  when `stage` is null or the description is Chinese. Then come the declared stage and
  the shared wording rules. `Exception_Returning` is not a completed return.
  Shipment-level `Expired` is never a scan and never means lost.
- Times: `time_utc`, else `time_iso`, and both must carry an offset. Rows with neither are
  dropped and counted in `undated_event_count`. A malformed non-empty timestamp is a
  schema error. Retrieval time is never used as a scan time.
- 17TRACK sometimes adds the offset itself (`time_raw.timezone` is null), and it can be
  wrong: for one parcel, the China Post leg put `+08:00` on the same wall clock that
  USPS reported at `-07:00`. Each event keeps `provider_time_iso`, `time_provenance`
  (`provider_inferred`, `carrier_reported` or `unspecified`) and the reporting carrier's
  name and key. The timeline still uses 17TRACK's UTC, and mirrored scans from two
  operators are not deduplicated. That is why a scoped China Post success skips
  timestamp-based shadow comparisons.
- Original scan text is kept. The English interface does not translate descriptions.
- At most 20 carrier legs and 1000 events. `shipping_info` and per-event `address` are
  never read.

## Rejected approaches

- Unsigned direct POST: returns HTTP 200 with rejection code `-14` (current endpoint) or
  `-10` (legacy endpoint). Embed-style widget requests get `-14` too.
- The 2019 anonymous endpoint (`kamushadenes/tracker17`): superseded.
- Account-based clients (`mderazon/seventeen-track-js`): need sign-in.
- API-key integrations (official API, `TA2k/ioBroker.parcel`): need a provisioned key.
- A separate widget integration: ChinaPostalTracking's tracker is 17TRACK's public widget
  on the same `track/restapi` endpoint. The normal page route already works.
- Making 17TRACK first for everything: a browser lookup costs seconds, while Ship24's
  direct HTTP usually answers in under a second.

## Testing

No dedicated live test. `npm run test:carriers:live -- src/server/expandedCarriers.live.test.ts`
with `FLARESOLVERR_URL` set runs the whole chain, which can end at 17TRACK. Unit tests use
synthetic [fixtures](fixtures/README.md).
