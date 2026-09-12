# Hermes Einrichtungs-Service notes

## Decisions

- 2026-08-30: read `auftragstatusdaten` and ignore `statusdaten`. Both streams
  describe the same order, but `statusdaten` is the internal operational one:
  duplicate scans, different identifiers, and wording never shown to the
  customer. The carrier's own UI renders `auftragstatusdaten`.
- 2026-08-30: treat the all-null placeholder order as not found. The API answers
  HTTP 200 for a valid but unknown consignment number with a synthetic order, so
  accepting it would create a parcel stuck at "pending" forever.
- 2026-08-30: require the echoed Lieferschein number. Without that check a
  neighbouring order could be shown under the wrong parcel.
- 2026-08-30: the numeric `sendungsstatusId` is the authority and German wording
  is only a fallback for ids the map does not know. Map too little rather than
  wrongly.
- 2026-09-12: `HermesTrackingError` became `NotFoundError('Hermes')` — identical
  message and 404 status, so the host's unannounced-parcel path is unchanged.
  The remaining `TypeError`s became `SchemaError` with their original messages.

## Rejected alternatives

- Calling the appointment/address endpoints on myhes.de: they return the
  recipient's address and the drop-off permission, none of which this app keeps.
  The order lookup alone answers "where is it".
- Synthesising a location from the depot block: `depotdaten` names the handling
  depot, not where the item was scanned, so events keep an empty location rather
  than an invented one.
- Deriving the status from the newest row of both streams merged: the internal
  stream runs ahead of the customer timeline and would announce delivery before
  the customer is told.

## Open

- The adapter reports `timezone: 'Europe/Zurich'` while the service is German
  and its timestamps are offset-less local times. `Europe/Berlin` is almost
  certainly right, but the backend zone has not been measured, so the value was
  carried over unchanged by the 2026-09-12 move rather than corrected blind.

## Verification log

- 2026-08-30: anonymous `GET /api/request/auftragsdaten?parcelNumber=…`
  confirmed to need no cookie, token or referer.
- 2026-09-08: opt-in live suite confirmed the carrier's published delivered
  sample still resolves and that `12345678` still returns the placeholder.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed result matches the one asserted before the move.
