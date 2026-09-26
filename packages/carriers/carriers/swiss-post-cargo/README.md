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
- `Type: 1` is an identifier lookup: rows must echo the requested identifier and
  other rows are dropped. `Type: 2` is a reference lookup: the echo is not
  guaranteed and every row belongs to the query. Any other `Type` is a schema error.
- Consignments can span several rows; histories are merged, deduplicated on
  (time, location, description, code), sorted newest first and capped at 100.
- Rows with no usable event are a schema error, not an empty success, so a
  broken shape never looks like a parcel with no news yet.

## Notes

- Negative wording (return, incident, failure) is checked before delivery words
  and codes — "Not delivered" contains "delivered", and a false delivery ends
  tracking.
- Only `DLV` is confirmed from a capture; `POD`, `P40`, `IMG` and `SIG` are
  carried over from the original map as delivery codes.
- Timestamps normally carry an explicit offset. `dd.MM.yyyy HH:mm[:ss]` and
  `dd/MM/yyyy HH:mm:ss` fallbacks are read in `Europe/Zurich`. `core/time`'s
  `isoTime()` is not used: it would stamp an offset-less ISO value as Swiss time.
- Not used: scraping the page HTML — it renders client-side, so it would need a
  browser for data the endpoint returns directly.
- The consignee block and `FullDescription` (internal operational detail) are
  never read. No proof-of-delivery or document endpoint is called.

## Limitations

- No delivery estimate: `expected_delivery` is always `null`.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/swiss-post-cargo` (no
env vars). It tracks the example number printed on the carrier's own
tracking form, and checks the clean 404 for an unknown number.
