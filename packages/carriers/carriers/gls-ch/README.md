# GLS Switzerland

GLS parcels in Switzerland and Liechtenstein, tracked through the GROUP
recipient service behind `gls-group.eu`. This folder holds the shared GROUP
implementation (parser, status map, URL builders); [gls-de](../gls-de/README.md)
imports it unchanged. [gls-fr](../gls-fr/README.md) uses a separate French
endpoint. `gls-group.eu` links are routed by country path (see each `carrier.json`).

## How it works

`direct`, up to two GETs under `https://gls-group.eu/app/service/open/rest/GROUP/en`
(15 s timeout, 1 MB cap), with the frontend's `caller=witt002` and `millis` params.

1. `rstt029?match={number}`: anonymous overview. Progress bar, status and
   delivery owner, no history. It also translates an 8-character Track ID into
   the numeric parcel number the detail call needs. Without a stored postcode,
   this is the whole result.
2. `rstt028/{parcelNumber}?postalCode=…&tuOwnerCode=…`: detailed history, gated
   by the recipient postcode. `tuOwnerCode` is the overview's `REQUEST` owner.

HTTP 400, 403 and 404 all mean "no such parcel" and raise
`GLSSwitzerlandTrackingError` (a `NotFoundError`; gls-de narrows on it with
`instanceof`, so keep the class). Other non-OK statuses stay upstream errors.

## Notes

- Identity: the parcel must echo the number on `tuNo`, `trackId`, `trackingId`
  or a track/parcel reference. A 12-digit printed number may come back as its
  first 11 digits (documented in GLS ShipIT), so that alias is accepted by exact
  prefix only. A Track ID is not echoed, so a single result is accepted. Two
  matches are ambiguous; none is a different shipment.
- Swiss Post last mile: when the overview names owner `DELIVERY`/`CH01`, the
  result carries `delivery_carrier: 'swiss-post'`. The detail response omits
  the owner, so the overview's reference is merged back in.
- Status comes from the progress-bar code, then the newest classified event.
  The displayed text is the newest event's wording, because the heading text
  goes stale (a locker drop reads "Delivered" while the parcel still waits).
  `DELIVEREDPS` is `ready_for_pickup`. `retourFlag` forces a return.
- Codes beat wording: codes are stable across languages. Rows without a code use
  wording rules ordered negatives first, then `core/status`'s multilingual
  classifier.
- "The parcel has not been handed over to GLS." is deliberately unmapped: a
  "handed over to GLS" rule would read it as acceptance.
- Scan date and time arrive as separate offset-less fields and are read in
  `Europe/Zurich` (gls-de relabels the timezone only).
- The estimate is dropped once the parcel is delivered or in exception.
- The postcode is a tracking credential: sent only to `rstt028`, never to the
  overview, never logged. Scan locations keep ParcelShop name, country and
  city; the street and postcode in the same `address` object are dropped, as
  are recipient, phone, signature and references.

## Rejected approaches

- Scraping the tracking page — the frontend's own JSON endpoints are simpler.
- Asking for the postcode before the overview — the overview must run first to
  resolve a Track ID and read the Swiss Post handoff.
- Sending the postcode to the overview — it has no use for it.

## Limitations

- No history without the postcode, which is why the carrier declares it as a
  required input.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/gls-ch` (no env vars;
checks that a retired published example and a wrong number both return a clean
404). Fixtures are constructed in the endpoint shapes with synthetic values.
