# Canada Post

## Identity and scope

`canada-post` — the Canadian postal operator. Tracked automatically
through the tracking application's own JSON endpoint; no postcode or
capability URL is needed.

## Portals

- Public tracker: `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={trackingNumber}`
- The lookup form reads `GET {origin}/track-reperage/rs/track/json/package?refNbrs={trackingNumber}`
  with an empty Basic credential and a JSON Accept, which is what the
  adapter reads directly.
- Canary: `https://www.canadapost-postescanada.ca/track-reperage/en/home`,
  the lookup front door.
- The portal shows status, history with locations, the delivery estimate,
  the service type and delivery options.

## What we retrieve

| Field | Source |
|---|---|
| `status`, `current_stage` | numeric package `status` first, then scan wording |
| `last_status_text` | package summary, or the newest scan, with "Delivered" once delivered |
| `last_update` | newest scan's `datetime`, as UTC when naive |
| `expected_delivery` | `expectedDlvryDateTime` revised or planned day, dropped once delivered |
| `delivered_at` | actual or attempted delivery day, once delivered |
| `events[].time`, `.location`, `.description`, `.stage`, `.provider_code` | `events[]`: `datetime`, location, display text, wording stage, scan `cd` |

Declared capabilities: `history`, `location`, `eta`, `delivered_at`. The
service type, the delivery options and any recipient details present in
the payload are never read into a result; the offline test asserts it.

## Tracking numbers

- `^\d{16}$`, low confidence — the printed 16-digit PIN, shared with other
  carriers, so it stays a suggestion and never selects Canada Post alone.
- Longer digit runs and UPU S10 `*CA` labels are accepted by the same
  endpoint.

The adapter re-checks a 13-to-24-digit or S10 shape itself and refuses
anything else before any request.

## How the adapter works

One step, `direct`: a single JSON GET with the same empty Basic
credential and Accept headers the application sends. No session, captcha
or browser is needed — verified 2026-09-20, when the endpoint answered
plain server-side HTTP with a `004` "No PIN History" envelope for an
expired number.

Identity is bound to the echoed `pin`/`refNbr1`: an error-only envelope
reads as the unlocated unknown result, an unmatched single item and a
multi-match as schema failures.

Naive scan timestamps are read as UTC. That is the documented assumption,
not an observed zone: the reply carries no offset, and a live parcel may
show the backend renders facility-local time instead. Revisit once a live
capture shows real scans.

Errors: `SchemaError` for invalid envelopes and identity mismatches; HTTP
and network failures propagate through the shared taxonomy so routing
keeps its backoff semantics.

## Status reference

| Stage | Code or wording (raw) | Confirmed by |
|---|---|---|
| accepted | `0`, `1`; Accepted | bundle, prior-art |
| in_transit | `2`, `5`, `6`; In transit | bundle, prior-art |
| out_for_delivery | Out for delivery | prior-art |
| ready_for_pickup | `7` | bundle |
| delivered | `8`; Delivered | bundle, prior-art |
| failed_attempt | Notice left, Delivery attempted | prior-art |
| exception | `3`, `4`; Alert, Exception | bundle, prior-art |
| returned | Return to Sender | prior-art |
| registered | not observed; reported as unmapped | — |
| customs | not observed; reported as unmapped | — |

`failed_attempt` and `returned` both surface as the result status
`exception`. A delivered scan's description is replaced by "Delivered"
because the original line may name who signed. `statuses.json` holds the
full list.

## Limitations and privacy

- Scan display-text and location keys follow the bundle's observed model
  names; a live parcel has not confirmed them yet.
- Naive timestamps are read as UTC by assumption (see above); an
  unparseable scan keeps the provider's own text.
- Event order follows the reply order, assumed newest-first like the
  application's own rendering.

## Implementation decisions

- Read the application's own list endpoint directly instead of driving the
  Angular form through a browser: the call needs no session state.
- Keep the empty `Authorization: Basic Og==` header the application sends;
  without it the endpoint answers 406.
- Bind strictly to the echoed PIN: reference lookups can alias, and an
  alias must never resolve to another parcel's history.

## Rejected alternatives

- Loading the lookup page in a browser: unnecessary — the JSON endpoint
  answers plain HTTP, and the details route performs no lookup on direct
  navigation anyway.
- The reference-number POST (`ref/filter`): needs a destination postcode
  and a captcha response the anonymous flow does not have.

## Verification log

- 2026-09-20: traced the home-form lookup to the list endpoint in headless
  Chrome; verified the same call server-side with the empty Basic
  credential, including the `004` envelope for an expired number.
- 2026-09-20: adapter added with offline tests and an env-gated live test.
  Live verification with a real shipment is still open (supply
  `CANADA_POST_LIVE_TRACKING_NUMBER` outside the repository).
