# Aramex

Reads domestic and international shipment histories from the official tracking portal.

## How it works

An anonymous overview request returns a shipment card. Its matching number binds a signed
detail link, which is followed once on the same host. The detail page must independently
return the requested shipment number. No account, cookie bootstrap or browser is needed.
The portal may redirect that link once to a regional English tracking page; the signed
query must remain unchanged.

Requests use an application user agent because the edge rejects Node's default user
agent on server networks. The same header is sent on the overview, detail and regional
redirect requests.

## Notes

The parser reads actual history rows, excluding the progress rail and recipient details.
Cross-border dates have no offsets, so they remain local wall times. Invalid dates retain
their text, and incomplete scan rows fail the lookup. The app archives this
direct evidence and asks providers for a timestamped timeline before using it as a fallback.

## Limitations

The portal's local dates cannot establish freshness against another source. Signed links
are obtained anew for each lookup and are not stored in the result.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/aramex`. Set
`ARAMEX_TRACKING_NUMBER` to check an authorized real shipment.
