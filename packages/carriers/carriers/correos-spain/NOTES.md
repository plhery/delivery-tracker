# Correos notes

## Decisions

- 2026-09-11: use the keyless `localizador.correos.es` traceability service that
  backs the public tracker. One GET, no session.
- 2026-09-11: let the `codError` envelope decide the outcome, not the HTTP
  status. The service answers 200 for unknown numbers.
- 2026-09-11: accept any Correos-issued code shape in the adapter (S10 ES, `PQ`,
  `PR`) and let the envelope decide. Detection stays narrow (`PR` + 15 digits +
  `C`), so only the shapes we can attribute reach this adapter automatically.
- 2026-09-11: tolerate a bare object as well as the single-element array, since
  some error bodies come back unwrapped.
- 2026-09-11: map `codEvento`, never `desTextoResumen` — the code is stable, the
  Spanish text is display prose.
- 2026-09-11: expose the office (`nom_codired`) as `pickup_point` only when the
  parcel is actually awaiting collection. On a delivered parcel the same field
  is where it *was* held, which would read as a false pickup instruction.
- 2026-09-11: keep weight and dimensions. They are operational parcel data, not
  personal data, and they are what users check against a merchant's listing.
- 2026-09-12: `normalizeCorreosSpainTrackingNumber` keeps throwing `TypeError`;
  it validates an argument, not a provider response.

## Rejected alternatives

- Scraping `correos.es/.../detalle`: a JavaScript app, so the HTML carries no
  history.
- Deriving unknown from the HTTP status: it is always 200.
- Stamping `Atlantic/Canary` on Canary Islands scans: events carry no locality,
  so there is nothing to key the decision on. The one-hour caveat is documented
  instead.
- Dropping the community-reconstructed codes (`L010000V`, `I010000V`,
  `X120000V`, `EOL.9001`): they cost nothing and an unmapped code is still
  reported as `unknown`, so a wrong reconstruction shows up as a mismatch rather
  than as silence.

## Open items

- **`nombre_cliente` dropped (2026-09-12).** Until the move the adapter
  projected it as `receiver_name` and the sync persisted it into
  `carrier_data`. It is the contract customer, which for a private recipient is
  that person's name, and nothing in the app displays it, so it now stays out
  per `PRIVACY.md`.
- The moved test no longer asserts how the host's sync classifies an unmapped
  wording; that path is covered by `src/server/trackingSync.test.ts`.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-10: unknown-code envelope (`codError` "3", `eventos: null`, HTTP 200)
  confirmed live.
- 2026-08-24: full success sequence confirmed against a real ES parcel by the
  prior-art client.
- 2026-09-11: sender, pickup, weight and dimension retention added.
- 2026-09-12: moved to `packages/carriers/carriers/correos-spain/`; behavior
  unchanged apart from the error class names.
