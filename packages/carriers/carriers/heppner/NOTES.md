# Heppner notes

## Decisions

- **Two hops, not one.** The detail endpoint only accepts the capability the
  search endpoint issues, so the search call cannot be skipped. The capability
  is decoded and compared with the credential we sent before it is used; a
  capability for another shipment is a `SchemaError`, never a result.
- **The postcode is a credential.** It is half of the lookup key, so it is
  treated like a tracking secret: never logged, never in a fixture, never in an
  issue. The factory raises `InputRequiredError('Heppner', 'the delivery
  postcode')` when the parcel has none, instead of sending an empty one.
- **No location at all.** The only location-shaped field in the payload is the
  delivery address, so `events[].location` is always empty rather than
  selectively filtered. This is why `capabilities` omits `location`.
- **Our own English descriptions.** The endpoint carries no human wording, only
  identifiers, so `status.ts` supplies both the stage and the display text.
- **Milestone first, code prefix second.** Mapping reads `step`, then the code
  prefix. A new code inside a known milestone therefore still lands on the right
  stage instead of falling through to the unmapped default.
- **UTC timestamps, kept local.** The portal always stamps an offset, and this
  adapter normalizes to UTC. `explicitOffsetTime` from `core/time` preserves the
  source offset instead, so the local helper stays, with a comment saying why.

## Rejected alternatives

- **Reusing a capability across lookups.** It encodes one shipment plus its
  postcode and buys nothing on the next lookup; each lookup re-derives it.
- **Keeping `agency_location` as the event location.** On the shipments seen it
  repeats the delivery address, which PRIVACY.md forbids retaining.
- **Raising the detection rule above low confidence.** `^\d{8}$` collides with
  several carriers (the corpus sample resolves to `unknown` with Mondial Relay
  and Heppner as candidates), so the user confirms the carrier.

## Verification log

- 2026-09-12: moved from `src/server/heppner.ts` into this folder with its
  tests; behavior preserved apart from the error classes below.
- 2026-09-12: `HeppnerTrackingError` → `NotFoundError('Heppner')`, same status
  and message. `TypeError` / `RangeError` on payloads and capabilities →
  `SchemaError`. Tracking-number and postcode format errors stay `TypeError`:
  they reject user input, not a provider response.
- 2026-09-12: constructor takes an options object (`timeoutMs`, `fetcher`) so
  the registry can inject the environment's fetcher.
