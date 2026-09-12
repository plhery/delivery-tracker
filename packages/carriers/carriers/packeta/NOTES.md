# Packeta notes

## Decisions

- 2026-09-11: use the keyless consumer endpoint that backs the tracking page.
  One POST, no session, about 0.2 s.
- 2026-09-11: pin the request locale to English. The event text is the only
  per-event signal there is, and a fixed locale turns it into a stable
  vocabulary that substring matching can classify.
- 2026-09-11: treat both unknown signals — HTTP 404 and a 200 carrying `error`
  instead of `item` — as the same clean not-found.
- 2026-09-11: keep two independent maps. `packetStatusId` is a closed numeric
  vocabulary for the parcel; the event sentences are separate and neither is
  derived from the other.
- 2026-09-11: read the naive times as `Europe/Prague` rather than inventing UTC.
  The backend stamps Prague time; ordering within a parcel is what matters and
  it is preserved.
- 2026-09-11: link to the canonical `/en/{code}` path form after verifying that
  the legacy `?id=` form 301-redirects to it.
- 2026-09-11: keep `sender` and `branchAddress`. They are a merchant name and a
  pickup-point name — no recipient data, and the only pickup signal Packeta
  gives.
- 2026-09-12: `normalizePacketaTrackingNumber` keeps throwing `TypeError`; it
  validates an argument, not a provider response.

## Rejected alternatives

- Deriving the overall stage from the newest event sentence: `packetStatusId` is
  authoritative and the sentences are advisory, so an unmapped id must report
  `unknown` rather than borrow a stage from prose.
- Guessing a stage for an unmapped `packetStatusId`: only "3" is live-confirmed,
  so an unknown id is more likely schema drift than a new state.
- Stamping UTC on the naive times: it would shift every event by one or two
  hours and look authoritative while doing it.

## Open items

- Romanian depot scans (EET) can be one hour off, because the backend stamps
  Prague time and the payload carries no per-event locality.
- The other `packetStatusId` values are reconstructions; re-observing them on
  real parcels would let `statuses.json` move them from `prior-art` to `live`.
- The moved test no longer asserts how the host's sync classifies an
  unrecognized sentence; that path is covered by
  `src/server/trackingSync.test.ts`.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-10: unknown-code 404 and the `?id=` → `/en/{code}` redirect confirmed
  live.
- 2026-08-19: canned English event sentences confirmed live against real
  delivered parcels by the prior-art client.
- 2026-09-11: sender and pickup-point retention added.
- 2026-09-12: moved to `packages/carriers/carriers/packeta/`; behavior unchanged
  apart from the error class names.
