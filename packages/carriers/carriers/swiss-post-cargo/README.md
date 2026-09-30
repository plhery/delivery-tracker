# Swiss Post Cargo

Swiss Post's domestic freight and pallet network (also trading as Hugger). It
tracks freight barcodes and customer references, not parcels (those go to
[swiss-post](../swiss-post/README.md)). The 6–40 character alphanumeric format
is too generic to detect, so numbers arrive only by manual carrier choice or a
pasted tracking link.

## How it works

`direct`: anonymous `POST https://eosapi.swisspost-cargo.com/api/trackandtrace/public`
with `{"Identifier": "…"}` — no token, cookie or session. 15 s timeout, 2 MB cap.
This is the endpoint the single-page tracker itself calls (protocol read from
its published source map).

- `Data: null` is the not-found answer. The endpoint returns HTTP 200 for
  unknown identifiers, so the status code cannot tell them apart; any other
  unexpected shape is a `SchemaError`.
- `Type: 1` is a barcode lookup: rows must echo the requested barcode and other
  rows are dropped.
- `Type: 2` is a customer reference, and references are not unique: the
  carrier's tracking form pairs its example `12345678` with a Betriebsnummer,
  and alone eos answers it with delivered shipments years apart. The official
  tracker lists each barcode behind a filter; a parcel needs one consignment,
  taken as the barcodes first scanned within a day of the newest one. It is read
  only while it has a scan from the last 60 days (carrier recognition's window)
  and no other barcode does ([reference.ts](reference.ts), shared with
  PostLogistics). Any other answer names no single current shipment: a 404,
  which routing treats like an unknown number rather than an outage.
- `Type: 3`, which the source map does not name, is a Swiss Post parcel barcode
  the eos system does not hold. The endpoint relays Swiss Post's own scans, each
  coded `PST`, with no place. Once the echo matches the barcode, it is a 404 and
  routing moves the parcel to [swiss-post](../swiss-post/README.md), which returns
  the same scans with their codes and places. Any other `Type` is a schema error.
- A consignment can span several barcodes; their histories are merged,
  deduplicated on (time, location, description, code), sorted newest first and
  capped at 100.
- Rows with no usable event are a schema error, not an empty success, so a
  broken shape never looks like a parcel with no news yet.

## Notes

- Negative wording (return, incident, failure) is checked before delivery words
  and codes — "Not delivered" contains "delivered", and a false delivery ends
  tracking.
- Only `DLV` is confirmed from a capture; `POD`, `P40`, `IMG` and `SIG` are
  carried over from the original map as delivery codes.
- Times arrive as Swiss wall-clock without an offset. They are read in
  `Europe/Zurich` (`isoTime`), never in the server's zone, and so are the
  `dd.MM.yyyy HH:mm[:ss]` and `dd/MM/yyyy HH:mm:ss` fallbacks. An explicit offset
  or `Z` is kept as sent.
- Not used: scraping the page HTML — it renders client-side, so it would need a
  browser for data the endpoint returns directly.
- The consignee block and `FullDescription` (internal operational detail) are
  never read. No proof-of-delivery or document endpoint is called.

## Limitations

- No delivery estimate: `expected_delivery` is always `null`.
- A reference whose one current consignment belongs to someone else still
  resolves to it; nothing in the answer tells them apart.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/swiss-post-cargo` checks
the clean 404 for an unknown number. Set `SWISS_POST_CARGO_TRACKING_NUMBER`
outside the repository to a current barcode or reference to check a shipment, or
`SWISS_POST_TRACKING_NUMBER` to a current Swiss Post parcel barcode to check the
`Type: 3` relay's 404.
