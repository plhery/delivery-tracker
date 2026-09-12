# Pos Malaysia

## Identity and scope

`pos-malaysia` — Pos Malaysia Berhad, the Malaysian universal postal operator
(Pos Laju for express). Last mile in `MY`. Tracked automatically; no postcode or
capability URL is needed.

## Portals

- Public tracker: `https://tracking.pos.com.my/tracking/{trackingNumber}`. The
  path form is the one that prefills: the SPA route `tracking/:ids` picks the
  code up as a chip and runs the lookup automatically. `?id=` and
  `#trackingIds=` do not.
- The adapter reads the consumer track-and-trace API the SPA calls,
  `POST https://ttu-svc.pos.com.my/api/trackandtrace/v1/request`.
- Canary: `https://tracking.pos.com.my/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | `process_status` "DELIVERED" wins; otherwise the latest event's `process_summary` |
| history | yes | newest first, at most 20 events |
| location | yes | `office`: Pos Malaysia facility names (hubs, kiosks), kept coarse |
| provider_code | yes | `event_type`, for example `EM053` |
| timezone | yes | always `Asia/Kuala_Lumpur` |
| eta | no | `eta_data` exists but was empty on every parcel observed |
| sender / recipient / proof of delivery | no | present on the item, never retained |

Declared capabilities: `history`, `location`, `provider_code`. The offline test
asserts each of them against the fixture.

## Tracking numbers

Two high-confidence rules: `^MYPM\d{11}$`, and `^[A-Z]{2}\d{9}MY$` with a valid
S10 check digit.

## How the adapter works

Single step, `direct`. One `POST` with `{ connote_ids: [code], culture: "en" }`
and a client-generated `P-Request-ID` header. No cookies, account, signature or
browser state. The 2020-era REST endpoint from community notes is gone; this
flow was recovered from the official tracking SPA bundle.

- The transport status is always 200 and the envelope always says `S0000`.
  Identity binds through the echoed `connote_id`, which is why the response is
  searched for the requested code rather than read positionally.
- An unknown or expired code comes back with an empty `process_status` and
  `tracking_data: null` → `NotFoundError('Pos Malaysia')`. A non-delivered item
  with an empty history is the same outcome.
- `process_status` "DELIVERED" is authoritative and stands even with no event
  rows.

Timestamps look like `22 Aug 2023, 05:34:58 PM` — English abbreviations, a
12-hour clock, no offset. Malaysia is a single UTC+8 zone with no DST, so
reading them as `Asia/Kuala_Lumpur` is unambiguous.

Errors: `NotFoundError('Pos Malaysia')`, `SchemaError` for an unsuccessful
envelope or a payload that does not bind to the requested shipment,
`UpstreamHttpError` for a non-200.

## Status reference

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| accepted | `Collected` | fixture |
| in_transit | `On the way`, `Sorting completed`, `Preparing for delivery` | fixture |
| out_for_delivery | `Out for delivery` | fixture |
| delivered | `Delivery completed`; parcel-level `process_status` = `DELIVERED` | fixture / live |
| pending | — | not observed; reported as unmapped |
| registered | — | not observed; reported as unmapped |
| customs | — | not observed; reported as unmapped |
| failed_attempt | — | not observed; reported as unmapped |
| ready_for_pickup | — | not observed; reported as unmapped |
| returned | — | not observed; reported as unmapped |

Unlike the open vocabularies elsewhere in this package, an unmapped
`process_summary` keeps the `in_transit` event default rather than no stage:
every row here is a physical scan, so "something moved" is the safe reading, and
no terminal stage is ever invented.

## Limitations and privacy

- No delivery estimate: the `eta_data` block exists in the response but was
  empty on every parcel observed, so nothing is projected from it.
- Sender and recipient blocks (postcode, state, city, country, phone) travel
  alongside the item and are never retained, and the `epod` proof-of-delivery
  link and image fields are dropped. The offline test feeds a fixture carrying
  all of them, including a populated `epod` URL, and asserts the result JSON
  contains none of their values.
- `office` is an operational facility name and is never refined into an address.

## Implementation decisions

- 2026-09-11: the 2020-era REST endpoint circulating in community notes is gone.
  The current consumer flow was recovered from the official tracking SPA bundle
  and is keyless: one POST, a client-generated `P-Request-ID`, nothing else.
- 2026-09-11: search `data[]` for the echoed `connote_id` instead of reading
  `data[0]`. The endpoint accepts several connotes per request, so position
  proves nothing about identity.
- 2026-09-11: treat an empty `process_status` with `tracking_data: null` as a
  clean not-found. The transport status is always 200 and the envelope always
  says `S0000`, so the item is the only thing that can say "unknown".
- 2026-09-11: let `process_status` "DELIVERED" win over the event rows, and let
  it stand even when there are none.
- 2026-09-11: read the naive times as `Asia/Kuala_Lumpur`. Malaysia is a single
  UTC+8 zone with no DST, so unlike the multi-country lanes in this package the
  zone assignment is unambiguous.
- 2026-09-11: keep the `office` facility name as an event location; it is
  operational, never an address.
- 2026-09-12: an unmapped `process_summary` keeps the `in_transit` event default
  instead of dropping the stage, which is the opposite of the open-vocabulary
  carriers here. Every row in `tracking_data` is a physical scan, so the default
  states only that something moved, and no terminal stage is ever invented.
- 2026-09-12: `normalizePosMalaysiaTrackingNumber` keeps throwing `TypeError`;
  it validates an argument, not a provider response.

## Rejected alternatives

- Reading `data[0]` positionally: identity would stop being proven.
- Projecting `eta_data`: it was empty on every parcel observed, so it would be a
  field that is always null.
- Retaining `epod`: the adapter omits this proof-of-delivery link.
- Deriving the overall status from the newest event even when `process_status`
  says DELIVERED: the overall value is authoritative and survives a missing
  final scan.

## Open questions

- Failure, return and pickup summaries have never been observed — the demo
  parcel is a clean delivery. Their wordings are unknown, so those stages are
  currently unreachable and would arrive through the `in_transit` default until
  someone sees them.


## Verification log

- 2026-09-10: the tracking SPA bundle inspected; the current consumer flow
  (`POST /api/trackandtrace/v1/request` with `connote_ids` and a
  `P-Request-ID` header) recovered from it.
- 2026-09-10: live check. Unknown codes return HTTP 200 `{code:"S0000"}` with a
  per-connote entry carrying an empty `process_status` and `tracking_data: null`.
- 2026-09-10: the `tracking/:ids` deep link confirmed to prefill and run the
  lookup; `?id=` and `#trackingIds=` do not.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
