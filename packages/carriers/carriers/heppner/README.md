# Heppner

French groupage and palletized-freight network. Covers recipient shipments in France and
Switzerland through the `myportal.heppner-group.com` recipient portal. A lookup needs the
8-digit receipt number plus the delivery postcode (4 digits = CH, 5 digits = FR).

## How it works

1. `direct`: two bounded requests on `myportal.heppner-group.com`.
   1. `GET /api/recipient/search/expedition?zipCode=…&receipt=…&countryCode=…` returns a
      base64 capability encoding `receipt&postcode&country`. The adapter decodes it and
      requires it to equal what it sent; a capability for another shipment is a
      `SchemaError`.
   2. `GET /api/recipient/search/detailexpedition?expedition=<capability>` (with
      `Referer: /tracking/<capability>`) returns an array of shipments; the one whose
      `receipt` matches is parsed.
   - HTTP 404 on either request, or an empty array, is not-found.

## Notes

- The postcode is half of the lookup key, so it is a credential: never log it, put it in a
  fixture or an issue. With no postcode the factory raises `InputRequiredError` instead of
  calling the portal.
- The search call can't be skipped: the detail endpoint only accepts the capability it issues.
  A capability is not reused across lookups — it encodes one shipment and buys nothing.
- Detection (`^\d{8}$`) is low-confidence: it collides with Mondial Relay and others, so the
  user confirms the carrier.
- The endpoint sends identifiers, no wording. `step` (milestone) is read first, then the event
  code prefix, so a new code inside a known milestone still lands on the right stage.
  `status.ts` supplies the English descriptions.
- `EN_ATTENTE_INSTRUCTIONS` (awaiting delivery instructions) and the shipment state
  `ANOMALIE` map to `exception`.
- Scan stamps always carry an offset and are normalized to UTC. The local time helper stays
  because `explicitOffsetTime` in `core/time` preserves the source offset instead.
- `events[].location` is always empty: the only location-shaped fields (including
  `agency_location`) repeat the delivery address, not a depot. Parties, references,
  merchandise, pickup codes and appointment tokens are never retained; a test asserts it.

## Limitations

- No delivery estimate and no operational location.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/heppner` (no env vars). It asserts a
synthetic, unassigned receipt number returns not-found.
