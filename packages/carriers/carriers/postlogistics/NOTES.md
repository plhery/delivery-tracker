# PostLogistics notes

## Decisions

- **The response type decides how the answer is read.** `Type: 1` is a barcode
  lookup and the echoed identifier must match, because the service can return
  neighbouring shipments. `Type: 2` is a customer reference: the requested
  string is not a barcode, so every shipment it resolved to belongs to this
  lookup and all of them are merged.
- **An unsupported type is an error.** Guessing which reading applies to a
  third type would eventually show somebody else's parcel.
- **A `Type: 2` answer with no resolved barcode is refused.** Without an
  identifier there is nothing tying the history to the reference that was
  looked up.
- **History is ordered by absolute instant.** Merged references interleave
  scans from several barcodes whose timestamps carry different offsets; the
  provider's order is kept only as a tie-breaker so equal instants stay stable.
- **Only the outcome codes are mapped.** `DEL`, `DLV`, `POD`, `SIG` and `NTF`
  decide the shipment; every other code leaves it in transit and lets the sync
  classify the description. Mapping too little is the documented preference.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('PostLogistics')` (same
  message, same 404) and the payload-shape `TypeError`/`RangeError`s became
  `SchemaError` with their messages unchanged.

## Rejected alternatives

- **Stamping an event stage from the three-letter code.** Only the delivery and
  announcement codes have an unambiguous meaning; the rest describe internal
  handling steps whose stage is better derived from the description.
- **Retrying the POST.** The endpoint is a single keyless call with no session
  to rebuild; a transient failure is visible as a sync error and the next
  scheduled check retries it anyway.
- **Sorting by the provider's array order alone.** For `Type: 2` answers that
  interleaves barcodes and puts an older scan on top.

## Verification log

- 2026-09-12: five status codes recorded in `statuses.json`, each covered by a
  fixture-driven test.
- 2026-09-12: capability guard added — `history`, `location` and `eta` are each
  proved by `fixtures/delivered.json`, which also carries a recipient block and
  a signature to prove they are dropped.
