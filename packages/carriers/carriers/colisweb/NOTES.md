# Colisweb notes

## Decisions

- The public search endpoint is called directly: it is the same request the
  tracking page makes, needs no session or token, and answers in one round trip.
  One `direct` step.
- **The empty HTTP 500 stays indeterminate.** For a validly shaped unknown
  number Colisweb answers HTTP 500 with a zero-byte body. Its own UI turns that
  into a "not found" card, but the response carries no evidence that the
  shipment is absent — a broken backend produces exactly the same bytes. Calling
  it a 404 would stop the parcel from ever being retried and would tell the user
  something we do not know, so it maps to `IndeterminateError` (status 502).
  Every other rejection shape (400, 404, 422, or a body that says "introuvable")
  is a real not-found.
- Events are built from the three milestone timestamps rather than invented from
  the step alone. When the current step has no matching milestone, one
  time-less entry is prepended so the current stage is still visible.
- Only the starting day of the booked slot becomes the estimate. `endsAt` is a
  scheduling detail about the recipient's day, and the offline test asserts it
  never appears in the result.
- Steps are compared with case and separators stripped because the same step
  appears as `pickedUp`, `picked_up` and `PACKAGE_WITHDRAWN` across the
  provider's surfaces. Matching the raw string would silently drop statuses.
- A failed return (`package_return_failed`) maps to `returned`, not
  `failed_attempt`: the parcel is on its way back either way, and the failure is
  about the return leg.
- 2026-09-12: an unknown step no longer defaults to `in_transit`. The result has
  no `current_stage` and its single event has no stage, so the sync classifies
  it and records it for review.

## Rejected alternatives

- Keeping `ColiswebTrackingError` and `ColiswebIndeterminateLookupError` as
  provider-specific classes: nothing outside this folder constructs them or uses
  `instanceof` on them, and the core taxonomy already carries the same status
  and kind. The `upstreamStatus: 500` field they exposed was only ever read by
  their own tests.
- Declaring a `location` capability: the endpoint returns no scan location at
  all, and a declared capability with no fixture fails the capability guard.
- Adding a detection rule for the 8-to-32-digit shape: it collides with several
  carriers. Colisweb is reached by link or by the carrier picker instead, and
  `numbers.json` records what the engine actually answers for the sample.

## Verification log

- 2026-09-12: moved from `src/server/colisweb.ts` into this folder. Parse
  failures now raise `SchemaError`; not-found raises `NotFoundError('Colisweb')`
  with the same message; the empty-500 case raises `IndeterminateError` with the
  same message and status.
- 2026-09-12: `99999999` (valid shape, unknown delivery) answers HTTP 500 with an
  empty body; the opt-in live test pins that observation.
