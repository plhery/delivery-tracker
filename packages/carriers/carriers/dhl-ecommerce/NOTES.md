# DHL eCommerce notes

## Decisions

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

- 2026-09-10: carrier, detection and the alias behavior confirmed; HTTP 428
  reproduced for direct requests, including after a page visit.
- 2026-09-11: direct path removed; browser-only lookup shipped.
- 2026-09-11: sender name and delivered-at added to the projection.
- 2026-09-12: moved to `packages/carriers/carriers/dhl-ecommerce`; parse
  errors became `SchemaError`, and the browser step is reported through
  `core/runner`.
