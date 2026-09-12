# DHL eCommerce

## Identity and scope

DHL's eCommerce division (formerly DHL Global Mail, "DHL eCommerce
Solutions"), the high-volume webshop parcel service, tracked through the
recipient endpoint the global DHL tracking page calls. Last mile: Germany,
the Netherlands and the United States. Shipments of other DHL divisions are
rejected rather than parsed here: the German parcel service is `dhl`.

## Portals

- Public tracking: `https://www.dhl.com/ch-en/home/tracking.html?tracking-id={trackingNumber}&submit=1`
- The page calls `https://www.dhl.com/utapi` with the queried number; that
  response is what we read.
- Portal links on `ecommerceportal.dhl.com` and `webtrack.dhlglobalmail.com`
  also resolve to this carrier.
- The portal shows status, history with locations, the delivery estimate, the
  sender's webshop name, the recipient address and customer references.

## What we retrieve

| Field | Source |
|---|---|
| `status`, `current_stage` | `shipments[0].status`, with `returnFlag` turning a delivered return into `returned` |
| `last_status_text` | `status.description`, replaced by "Delivered" once delivered |
| `last_update`, `delivered_at` | `status.timestamp`, converted to UTC |
| `expected_delivery` | `estimatedTimeOfDelivery`, as a calendar day, dropped once delivered or returned |
| `sender_name` | `sender.name` or `senderName` when the webshop is named |
| `events[].time`, `.location`, `.description`, `.stage` | `events[].timestamp`, `.location.address` (locality and country code), `.description` |

Declared capabilities: `history`, `location`, `eta`, `sender_name`,
`delivered_at`. The recipient address and the customer references present in
the payload are never read into a result; the offline test asserts it.

## Tracking numbers

`GM` followed by 16–18 digits is recognized with high confidence; bare 16–17
digit numbers are a suggestion only, because several carriers use that shape.
DHL documents these identifiers in its
[Americas reference](https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas).
Samples and their expectations live in `numbers.json`.

## How the adapter works

One step, `browser`: a local Chromium loads the public tracking page, the site
solves its own challenge and calls `utapi` in that session, and the response
to the exact requested API URL is parsed. There is no direct HTTP step — the
endpoint answers every direct server request with an Akamai crypto
proof-of-work challenge (HTTP 428), and browser clearance cannot be copied
back to Node. One lookup at a time per instance, and the browser helper keeps
its own concurrency limit, so a batch never spawns a Chromium per parcel.

DHL may answer with a customer-confirmation id instead of the queried alias,
so exactly one `ecommerce` shipment from that exact request URL is accepted,
and the id itself is never retained.

## Status reference

UTAPI sends a coarse `statusCode` and a free-text `description`. The wording
decides first; the code is the fallback, except `delivered`, which is
terminal and outranks an intuitive translation.

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `pending` | any unknown `statusCode` with unmapped wording | fixture |
| `registered` | `pre-transit`; "LABEL CREATED"; "MANIFEST DATA RECEIVED"; "EN ROUTE TO DHL ECOMMERCE OR AWAITING PROCESSING" | fixture |
| `accepted` | "PACKAGE RECEIVED AT DHL ECOMMERCE DISTRIBUTION CENTER"; "Picked up at parcelshop" | fixture, prior-art |
| `in_transit` | `transit`; "CLOSE BAG"; "CUSTOMS CLEARED" | fixture, prior-art |
| `customs` | "CUSTOMS CLEARANCE" | fixture |
| `out_for_delivery` | "OUT FOR DELIVERY" | fixture |
| `ready_for_pickup` | "READY FOR COLLECTION" | fixture |
| `delivered` | `delivered`; "DELIVERED - Signed by …" | fixture |
| `failed_attempt` | `failure`; "DELIVERY ATTEMPT FAILED" | fixture |
| `returned` | "RETURNED TO SENDER"; `returnFlag` with the `delivered` code | fixture |

`statuses.json` holds the full list.

## Limitations and privacy

- Scans whose timezone cannot be resolved from the event's country code or a
  known hub are omitted rather than stamped with a fabricated UTC time, so a
  history can be shorter than the portal's.
- A delivered event's description is replaced by "Delivered": the original
  line names the signatory.
- Rate limits and server errors from the page go to routing; a challenge
  status becomes a named `DHLEcommerceSessionError` carrying the upstream
  status, which the host records.

## Implementation decisions

- 2026-09-10: accept exactly one `ecommerce` shipment, and only from the
  response to the exact requested `utapi` URL. DHL can answer with a
  customer-confirmation id that matches none of the queried aliases, so an
  identity check on the echoed id would reject good data and a looser check
  would accept somebody else's parcel.
- 2026-09-11: no direct HTTP step at all. The endpoint answers every direct
  server request with an Akamai crypto proof-of-work challenge (HTTP 428);
  cookie replay and visiting the page first were both verified to still
  return 428 on 2026-09-10, and browser clearance is not transferable back to
  Node. A direct attempt would only add latency before the browser.
- Event timestamps are local wall-clock strings, sometimes without a country
  code. The zone comes from the event's country code, a locality that is
  itself a country code, or a known hub; anything else is omitted. A
  fabricated UTC timestamp would reorder a history and mislead a notification.
  This stays a local policy instead of `core/time` because every event is
  normalized to UTC, which is what the result declares.
- 2026-09-11: sender-side drop-off wording ("picked up at parcelshop",
  "dropped off at") maps to `accepted`, not `ready_for_pickup` (prior art:
  ha-dhl-nl#15). The parcel is entering the network, not waiting for its
  recipient.
- A `delivered` status code outranks the intuitive translation of the wording,
  and a delivered event's description is replaced by "Delivered" because the
  original line names the signatory.
- 2026-09-12 (move): `DHLEcommerceSessionError` was reinstated as a subclass
  of `ChallengeError` carrying `status`. The class had been deleted with the
  direct path on 2026-09-11, but `src/server/observability.ts` still reports
  the upstream status for errors with that name; it is now thrown when the
  tracking page itself answers 401, 403, 419 or 428.

## Rejected alternatives

- Solving the Akamai challenge in Node (cookie replay, page visit first):
  verified not to work on 2026-09-10.
- Sending the browser through the shared TRAWL service like `dhl`: the site
  has to call its own API inside the session that solved the challenge, which
  is what the local Chromium helper captures.
- Trusting `estimatedTimeOfDelivery` after completion: the estimate survives
  delivery in the payload, so it is dropped once the parcel is delivered or
  returned.


## Verification log

- 2026-09-10: carrier and detection added; the API answers with a customer
  confirmation id that differs from the queried alias, so the response is
  accepted only from its exact request URL.
- 2026-09-10: cookie replay and visiting the page before the API call were
  both verified to still return HTTP 428.
- 2026-09-11: the direct HTTP path was dropped; the lookup goes straight to
  local Chromium.
- 2026-09-11: sender name and delivered-at retained, and the ha-parcel status
  maps adopted for drop-off wording.
- 2026-09-12: moved into this folder; errors now use the package taxonomy and
  the single step is run and reported by `core/runner`.
