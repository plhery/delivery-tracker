# Ciblex notes

## Decisions

- **The empty 200 is indeterminate, the echoed empty table is a 404.** The
  portal's honest wrong-number answer still renders the banner with the number
  it searched and an empty scan table; that is a clean `NotFoundError`. A
  completely empty body has also been observed transiently and proves nothing,
  so it raises `IndeterminateError` and the parcel is retried instead of being
  marked as unknown to the carrier.
- **Verify the echoed number first.** Nothing is read from the page until the
  banner's 14 digits match the number requested, so a session or cache that
  answers for another parcel can never become this parcel's history.
- **Places must look like a depot.** The place cell is free text; on failure
  rows it carries the recipient's address. The adapter keeps it only when it
  matches `CITY 68 (68)` — the same department number before and inside the
  parentheses — and drops it outright on exception rows.
- **Our own English descriptions.** The provider's French label decides the
  stage but is not returned; each mapped phrase supplies the wording we show.
- **`zonedTime` over a local parser.** The three date formats the page uses are
  naive French wall-clock values, which is exactly `core/time`'s `zonedTime`
  policy, so the local parser was replaced by a loop over it.

## Rejected alternatives

- **Treating the empty body as a 404.** It would mark live parcels as unknown
  to the carrier during a transient portal outage, and the routing layer would
  then back off for a day.
- **Keeping the place cell verbatim.** It is the recipient's address on exactly
  the rows a user is most likely to look at.
- **Returning the French label as the description.** Ciblex labels mix case and
  accents inconsistently ("Colis Livré" / "COLIS LIVRE"); mapping to our own
  wording keeps the timeline readable and the classifier deterministic.

## Verification log

- 2026-09-12: moved from `src/server/ciblex.ts` into this folder with its tests;
  page parsing, the depot-shape rule and the status map unchanged.
- 2026-09-12: `CiblexTrackingError` → `NotFoundError('Ciblex')`;
  `TypeError('… empty tracking response')` → `IndeterminateError` (same
  message); identifier and mismatch errors → `SchemaError`. The live canary now
  branches on `NotFoundError` versus `IndeterminateError`.
- 2026-09-12: constructor takes an options object (`timeoutMs`, `fetcher`).
