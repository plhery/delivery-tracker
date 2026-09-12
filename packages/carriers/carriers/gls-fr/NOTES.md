# GLS France notes

## Decisions

- The public consignee endpoint is used rather than scraping
  `moncolis.gls-france.com`: it is the same data the page renders, as JSON, with
  no session or token to keep alive. One `direct` step is enough.
- `DEL` is read the way the official frontend reads it: a rescheduled delay by
  default (`in_transit`), and a failed attempt (`failed_attempt`) only when the
  same event's `typeEvenement` is `LIV`. The parcel-level `statutColis` gets the
  same treatment against the newest event.
- Response identity is checked against three fields (`trackid`,
  `numeroalphaColis`, `numeroGp`) because the endpoint echoes the number in
  whichever one matches the shape that was asked for; a mismatch is a schema
  error, never a result.
- Timestamp parsing stays local instead of using a `core/time` policy: the same
  fields carry ISO values with or without an offset, SQL-style wall clocks and
  bare calendar days, and no single policy covers all three. Offsets are
  honoured; everything else is Europe/Paris.
- The location is kept as the GLS facility code (`FR0012`), not resolved to a
  city. It is operational, short and carries no address.
- 2026-09-12: unmapped codes no longer default to `in_transit`. The event is
  still returned, with its code and no stage, so the sync's classifier decides
  and the wording is recorded for review. This is the one intentional behaviour
  change of the move.

## Rejected alternatives

- Copying the response's `adresse` and signature blocks into the result: they
  are recipient data, and `PRIVACY.md` forbids retaining them. The projection is
  an allowlist for that reason.
- Treating the endpoint's HTTP 404 as an inconclusive answer: it is returned for
  a validly shaped unknown number with an explicit "no command found" body, so
  it is a definite not-found.
- Declaring a `sender_name` or `weight` capability: the consignee endpoint does
  not return either, and a declared capability with no fixture would fail the
  capability guard.

## Verification log

- 2026-09-12: moved from `src/server/glsFrance.ts` into this folder; error
  classes replaced by `SchemaError` from `core/errors` (the module had no
  provider-specific error class), factory added with `steps: ['direct']`.
- 2026-09-12: `00ZZ00Z0` (valid shape, unknown parcel) answers HTTP 404 from the
  consignee endpoint.
