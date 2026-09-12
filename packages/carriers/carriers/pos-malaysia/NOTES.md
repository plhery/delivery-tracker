# Pos Malaysia notes

## Decisions

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
- Retaining `epod`: it is a proof-of-delivery link, which `PRIVACY.md` forbids.
- Deriving the overall status from the newest event even when `process_status`
  says DELIVERED: the overall value is authoritative and survives a missing
  final scan.

## Open items

- Failure, return and pickup summaries have never been observed — the demo
  parcel is a clean delivery. Their wordings are unknown, so those stages are
  currently unreachable and would arrive through the `in_transit` default until
  someone sees them.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-10: SPA bundle inspected, consumer flow recovered, unknown-code shape
  and deep-link behavior confirmed live.
- 2026-09-12: moved to `packages/carriers/carriers/pos-malaysia/`; behavior
  unchanged apart from the error class names (the "different shipment" case was
  a `RangeError` and is now a `SchemaError`).
