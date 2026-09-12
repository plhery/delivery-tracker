# Swiss Post Cargo notes

## Decisions

- 2026-08-30: call the anonymous JSON endpoint the official tracker itself
  calls, rather than scraping the single-page app. The endpoint takes no token
  or cookie, so there is no session to keep alive and no challenge to solve.
- 2026-08-30: treat `Data: null` as not found and anything else unexpected as a
  schema error. The endpoint answers HTTP 200 for unknown identifiers, so the
  status code alone cannot tell the two apart.
- 2026-08-30: require the echoed identifier for `Type: 1` responses and accept
  every returned row for `Type: 2`. A reference lookup legitimately returns
  shipments whose identifier differs from the query; an identifier lookup does
  not.
- 2026-08-30: classify negative wording (return, incident, failure) before the
  delivery words. Rows such as "Not delivered" contain "delivered" as a
  substring, and mislabelling one as a delivery ends the parcel's tracking.
- 2026-09-12: the status map moved to `status.ts` unchanged, and the inline
  delivered payload moved to `fixtures/delivered.json`. `SwissPostCargoTrackingError`
  became `NotFoundError('Swiss Post Cargo')`; the message and HTTP-like status
  404 are identical, so the host's unannounced-parcel handling is unaffected.

## Rejected alternatives

- Reading the public page's HTML: the page renders client-side, so this would
  mean running a browser for data the endpoint returns directly.
- `core/time`'s `isoTime()` for event timestamps: it stamps offset-less ISO
  values with a zone. Keeping luxon's `setZone` reading means an unexpected
  offset-less value is never silently relabelled as Swiss local time. The
  `dd.MM.yyyy` fallbacks are read in `Europe/Zurich`, which is stated in the
  helper's comment.
- Reporting an empty shipment as a pending parcel: a response with rows but no
  usable event proves nothing about the shipment, so it stays a schema error.

## Verification log

- 2026-08-30: `https://apv.swisspost-cargo.com/static/js/907.9a0b939a.chunk.js.map`
  confirmed the request shape and the null-data contract.
- 2026-08-30: the official tracking form at `portal-de1.swisspost-cargo.com/Track`
  labels `12345678` as its own example ("z.B."); the live test uses it.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed result is byte-for-byte the one asserted before the move.
