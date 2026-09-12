# India Post

## Identity and scope

`india-post` — the Department of Posts, India's universal postal operator
(Speed Post for express). Last mile in `IN`. Tracked automatically; no postcode
or capability URL is needed.

## Portals

- Tracking page used: `https://myspeedpost.com/track?n={trackingNumber}&sync=true`.
  MySpeedPost is a third-party tracker, not India Post's own site; it exposes the
  tracking form as a Livewire component and completes the lookup asynchronously
  through `/livewire/update`.
- Canary: `https://myspeedpost.com/track`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | classified from `event_type`, `event` and `remarks` together |
| history | yes | newest first, at most 100 events |
| location | yes | `office` plus a six-digit `pincode` when present |
| provider_code | yes | `event_type`, for example `ItemDelivered` |
| timezone | yes | always `Asia/Kolkata` |
| eta | no | the page exposes none |
| recipient name / address / contact | no | present on the rows, never retained |

Declared capabilities: `history`, `location`, `provider_code`. The offline test
asserts each of them against the fixture.

## Tracking numbers

One high-confidence rule: `^[A-Z]{2}\d{9}IN$` with a valid S10 check digit.
`numbers.json` holds one open-source example and three synthetic numbers; no
real consignment number is committed.

## How the adapter works

Single step, `direct` — the Livewire submit-and-poll cycle is one stateful
conversation with one host, not a fallback tier:

1. `GET /track?n={number}&sync=true` through a per-lookup cookie jar, because
   the session cookie issued with the page must travel with every later call.
2. Read the `wire:snapshot` of the `track-consignment` component. If its status
   is already `Completed`, the page's `tracking-request` attribute holds the
   history and no further call is made.
3. Otherwise `POST /livewire/update` with the CSRF token from the page: either
   `__dispatch(set_consignment_number)` + `submit` for a `New` component, or
   `fetchStatus` for one already `Processing`.
4. Poll `fetchStatus` until the component reports `Completed`, then parse the
   HTML fragment it returns.

Identity binds twice: the Livewire snapshot must echo the requested
`consignment_number`, and the rendered fragment's `#consignment_search` input
must too.

Outcomes:

- A `consignment_not_found` dispatch → `NotFoundError('India Post')`.
- A Cloudflare interstitial (status 401/403/419/429, a `cf-mitigated: challenge`
  header, or a challenge marker in the body) → `IndiaPostChallengeError`, a
  `ChallengeError`. It must stay retryable and must never read as not-found.
- Still `Processing` after the poll budget → `IndeterminateError`: the backend
  answered but proved nothing about the shipment.
- Anything malformed → `SchemaError`.

Timestamps are ISO; a value carrying its own offset keeps it, an offset-less one
is read as `Asia/Kolkata`.

## Status reference

| Stage | Code / wording (raw) | Confirmed by |
|---|---|---|
| registered | Shipment Information Received, Label Created, Article Created, Consignment Created | prior-art |
| accepted | `ItemBooked`, Article Booked, Booking Confirmed | fixture |
| in_transit | `ItemDispatched`, Item Bagged, Item Received, Received At, Departed, Arrived, Forwarded, In Transit, Handed Over | fixture / prior-art |
| customs | Customs, Custom Clearance | prior-art |
| out_for_delivery | `OutForDelivery`, Item Out For Delivery, Sent For Delivery | prior-art |
| ready_for_pickup | Ready For Pickup, Ready For Collection, Awaiting Collection | prior-art |
| delivered | `ItemDelivered`, Delivered To Recipient | fixture |
| failed_attempt | `DeliveryAttempted`, Delivery Failed, Not Delivered, Undelivered, Insufficient Address, Addressee Cannot Be Located, Damaged, Refused, Lost | prior-art |
| returned | `ReturnToSender`, Returned To Customer, Returned To Booking Office, Return Item | prior-art |
| pending | — | not observed; reported as unmapped |

India Post has no stable status code: `event_type`, `event` and `remarks` are
all English prose worded differently per office. The classifier normalizes the
three into one alphanumeric key and matches substrings, most specific first.
An unrecognized row keeps the `in_transit` stage with an `unknown` status, so a
scan is never lost and no terminal stage is ever invented; at parcel level that
`unknown` becomes plain `in_transit`.

## Limitations and privacy

- No delivery estimate.
- The vocabulary is prose, so the classifier is a substring matcher rather than
  a code map. A newly worded event lands on `in_transit` until its wording is
  added.
- Rows can carry a recipient remark, a `recipient_address` and a
  `pincode_info.contact_number`. None of them is retained: events are built from
  an explicit allowlist, and the offline test feeds a fixture carrying all three
  and asserts the result JSON contains none of their values.
- `office` plus `pincode` is an operational location; the pincode is only kept
  when it is exactly six digits.

## Implementation decisions

- 2026-09-01: track through MySpeedPost's Livewire flow. It is the surface that
  answers without an account, and its `tracking-request` attribute carries the
  whole history as JSON once the lookup completes.
- 2026-09-01: use a per-lookup cookie jar (`fetch-cookie` + `tough-cookie`).
  Livewire is stateful: the session cookie issued with the page must travel with
  every `/livewire/update` call, and one jar per lookup keeps concurrent
  lookups from sharing a component snapshot.
- 2026-09-01: short-circuit when the page already reports `Completed`. A cached
  consignment then costs exactly one request.
- 2026-09-01: bind identity twice — the Livewire snapshot's
  `consignment_number` and the rendered fragment's `#consignment_search` value
  must both echo the requested number.
- 2026-09-01: classify from `event_type`, `event` and `remarks` joined into one
  normalized key, most specific rule first. There is no stable code, and offices
  word the same event differently.
- 2026-09-01: keep Cloudflare interstitials as a distinct challenge outcome so
  they stay retryable and never turn into a day-long not-found cooldown.
- 2026-09-12: an exhausted poll budget became `IndeterminateError` instead of a
  bare `Error`. The backend answered, it simply never finished, which proves
  nothing about the shipment.
- 2026-09-12: the classifier moved to `status.ts` and now uses `cleanScalar`
  from `core/transport` in place of the module's own number-tolerant `clean`.
  India Post sends pincodes and ids as numbers as often as strings, so the
  number-tolerant helper is required; the only difference from the old local
  copy is that `cleanScalar` does not truncate a numeric value to `maxLength`.
- 2026-09-12: `normalizeIndiaPostTrackingNumber` keeps throwing `TypeError`; it
  validates an argument, not a provider response.

## Rejected alternatives

- Polling India Post's own tracking site: it is interactive and rate-limited,
  and it does not answer anonymous programmatic requests reliably.
- Treating a still-`Processing` component as not-found: it would put a working
  consignment into a not-found cooldown for a day.
- Dropping rows whose wording is unrecognized: every row is a physical scan, so
  losing it would make the history look emptier than the portal's.

## Open questions

- The live test's real-consignment case is now gated on
  `INDIA_POST_TRACKING_NUMBER`. It previously used `JN067614884IN`, which
  `numbers.json` records as a synthetic number built to the published shape — so
  as written it could only ever have 404ed. A real number must not be committed;
  the operator supplies one through the environment variable.
- Only the booking, dispatch and delivery wordings are fixture-confirmed. The
  failure, return, customs and pickup keys come from prior art and have not been
  re-observed.


## Verification log

- 2026-09-01: the MySpeedPost tracker inspected. It is a Livewire component at
  `/track` that completes the lookup through `/livewire/update`; the flow needs
  a cookie jar, the page's CSRF token and the component snapshot.
- 2026-09-01: Cloudflare interstitials confirmed to be distinguishable from a
  genuine miss by status, `cf-mitigated` header and body markers.
- 2026-09-12: adapter moved into this folder; the classifier moved to
  `status.ts` and the error classes moved onto the shared taxonomy. The live
  test's real-consignment case became env-gated
  (`INDIA_POST_TRACKING_NUMBER`), because the number it used is recorded in
  `numbers.json` as synthetic.
