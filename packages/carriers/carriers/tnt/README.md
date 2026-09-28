# TNT

Direct tracking covers TNT France's 16-digit national consignments through its
public HTML tracking page. Other TNT services use universal providers.

## How it works

`direct` makes one GET to the national consignment detail page. No session,
browser, postcode or account is required.

## Notes

The returned detail header and item identity must match. History comes only from
the shipment's event rows; the progress rail includes future delivery labels.
The selected milestone determines current status. National scan times are read
in the French civil timezone, and the page's Latin-1 encoding is respected.

## Limitations

Nine-digit international consignments use universal providers. Public histories can expire.

## Testing

Set `TNT_FRANCE_TRACKING_NUMBER` outside the repository, then run
`npm run test:carriers:live -- packages/carriers/carriers/tnt`.
