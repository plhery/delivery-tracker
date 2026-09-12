# InPost notes

## Decisions

- 2026-09-11: implement the `inposteasy.com` per-country hub, not ShipX. The hub
  is keyless, answers in about 0.2 s, and its success shape is documented by the
  prior-art client; ShipX's success shape was never confirmed.
- 2026-09-11: map the parcel-level `status` code to the overall stage and each
  event's own code to that event's stage. The two are independent in the payload.
- 2026-09-11: require explicit offsets on event timestamps. The PL, IT, PT and
  GB hubs share this API, so stamping one zone would be wrong somewhere.
- 2026-09-11: keep `JJD`/`JD` and bare 24-digit numerics at low confidence.
  `JJD` collides with DHL, so it needs a domain hint or an explicit pick.
- 2026-09-11: fall back to the raw code as an event description when
  `statusTitle` is empty, so a sparse row still carries something readable.
- 2026-09-12: `normalizeInpostTrackingNumber` keeps throwing `TypeError`; it
  validates an argument, not a provider response.

## Rejected alternatives

- Guessing a stage for an unmapped `<PHASE>.<NNNN>` code from its phase prefix:
  the vocabulary is open and the phase alone does not decide the stage
  (`LMD.1002` is transit, `LMD.1004` is ready for pickup, `LMD.9002` is a failed
  attempt).
- Stamping `Europe/Warsaw` on offset-less timestamps: the same endpoint serves
  four countries.
- Retaining the origin/destination country codes: they feed no product field.

## Open items

- ShipX (`api-shipx-pl.easypack24.net`) remains an unexplored second surface; it
  might carry locker names and an estimate, which this hub does not.
- The moved test no longer asserts how the host's sync classifies an unmapped
  wording; that path is covered by `src/server/trackingSync.test.ts`.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-10: unknown-number 404 with a structured `NOT_FOUND` body confirmed
  live; expired corpus numbers answer identically.
- 2026-08-31: vocabulary confirmed on IT/PT/GB consignments by the prior-art
  client.
- 2026-09-12: moved to `packages/carriers/carriers/inpost/`; behavior unchanged
  apart from the error class names.
