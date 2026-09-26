# DHL eCommerce

DHL's webshop parcel division (formerly DHL Global Mail), tracked through the
`www.dhl.com/utapi` endpoint the global DHL tracking page calls. Shipments of
other DHL services are rejected; German DHL Paket is [dhl](../dhl/README.md).

## How it works

1. `browser`: a local Chromium loads the public tracking page, the site solves
   its own Akamai challenge and calls `utapi` in that session, and the response
   to the exact requested `utapi` URL is parsed. Lookups are serialised per
   instance, and the [browser helper](../../core/transport/browser.ts) runs one
   local browser per process.

There is no direct HTTP step: plain requests get an Akamai proof-of-work
challenge (HTTP 428), and browser clearance doesn't transfer back to Node.

## Notes

- Exactly one `ecommerce` shipment is accepted, and only from the exact request
  URL. DHL may echo a customer-confirmation id instead of the queried number,
  so checking the echoed id would reject good data; the id is never kept.
- Event timestamps are local wall-clock strings, sometimes without a country
  code. The zone comes from the event's country code, a locality that is a
  country code, or a known hub (`HUB_ZONES`); other scans are dropped rather
  than stamped as UTC, which would reorder the history. All times are converted
  to UTC because legs cross zones.
- Stage: wording first, `statusCode` as fallback, except `delivered`, which
  outranks the wording.
- Sender drop-off wording ("picked up at parcelshop", "dropped off at") maps to
  `accepted`, not `ready_for_pickup`: the parcel is entering the network.
- A delivered event's description becomes "Delivered", because the original
  line names the signatory.
- `estimatedTimeOfDelivery` survives delivery in the payload; it is dropped once
  delivered or returned.
- A 401/403/419/428 on the page itself becomes `DHLEcommerceSessionError`. The
  host's observability reports the upstream status for errors with that name,
  so keep it.

## Rejected approaches

- Direct HTTP with cookie replay, or visiting the page first: still HTTP 428.
- Reproducing the proof-of-work in Node: the challenge was solved but the data
  request stayed blocked.
- The shared TRAWL browser service (as in `dhl`): the site has to call its API
  inside the session that solved the challenge, which only the local Chromium
  helper captures.

## Limitations

- The browser helper only accepts 200/201 API responses and handles 429. An API
  404/5xx or a parser failure is ignored while waiting and ends as a generic
  timeout.
- Scans with an unresolvable timezone are omitted, so the history can be
  shorter than the portal's.
- Recipient address and customer references are never read; a test asserts it.

## Testing

No live test. Fixtures are constructed from the documented `utapi` shape.
