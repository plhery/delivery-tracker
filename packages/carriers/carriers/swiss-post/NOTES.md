# Swiss Post notes

## Decisions

- Keep one cookie jar per lookup. The anonymous user, the CSRF token and the
  search hash are only valid together; sharing a jar across lookups would let
  one search's hash leak into another's result.
- Let the newest event code override the shipment summary. `globalStatus` lags:
  a MyPost24 locker deposit reads `DELIVERED` at shipment level while the parcel
  is still waiting for the recipient, so event code `2102` maps to
  `ready_for_pickup` and wins.
- 2026-09-10: give the `LETTER.*.90.*` import scans their own table. The same
  numeric codes mean different things for parcels and for inbound letter-post,
  and their English wording ("Completion of customs clearance process",
  "Arrival at the collection/delivery point") reads like a delivery or like
  active customs if classified by words.
- Treat the event call as optional. When `/events` fails, the shipment summary
  is still returned; an error there would throw away a usable status.
- Fetch the translation table lazily, once per process, and only when the
  shipment actually has events. It is large and static, and a lookup with no
  events has nothing to translate.
- Require an exact number match, on either the Swiss Post number or the echoed
  international barcode, and refuse two matches as ambiguous. The search
  endpoint is a *search*: it can return neighbouring shipments.
- 2026-09-12: `SwissPostTrackingError` became `NotFoundError('Swiss Post')` and
  the remaining `TypeError`/`RangeError`s became `SchemaError` with their
  original messages. No caller used `instanceof` on the old class.

## Rejected alternatives

- `core/transport`'s `clean()` for provider text: it collapses inner whitespace,
  and Swiss Post's translated wording is shown to the user as the carrier writes
  it. The local `text()` only trims and caps.
- `core/time` for event timestamps: the adapter deliberately does not normalize
  them. It keeps the carrier's own string and parses it only to sort, so nothing
  is rewritten on the way to the app.
- Classifying event wording instead of codes: the wording is whatever the
  translation table returns for the requested language, so it is not a stable
  key. Codes are.
- Dropping the scan postcode from locations: it is what separates two same-named
  Swiss towns in the history, and it is a facility/area postcode rather than a
  street address. Recorded here because it is the one field in this folder that
  is coarser than PRIVACY.md's "city, region, country" wording.

## Verification log

- 2026-09-10: the ten international import scan codes checked against their
  English wording and mapped in `LETTER_IMPORT_STAGE_BY_CODE`.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed results match those asserted before the move, and a new fixture-driven
  test covers the success path, the declared capabilities and the privacy
  projection, which the previous tests only covered indirectly.
