# Correos de Chile

Tracks Chilean postal references through the anonymous tracking page. The
publicly documented developer API requires customer credentials and is not used.

## How it works

A fresh page request establishes a Liferay session and CSRF token. The adapter
then calls the page's tracking resource with the complete number and checks the
returned shipment's reference and identifier before projecting scans. The resource
includes a large branch directory, so each response has a strict byte limit;
only the shipment detail is retained.

## Notes

The portal supplies scan wall clocks without offsets. They remain local-time
evidence rather than invented instants. Future progress-rail markers, customer
details, delivery names, identity numbers, notices and the branch directory are
excluded. Free-form status text is replaced with a neutral update. A missing
shipment response may also mean its history expired, so it remains inconclusive.

The page can return a browser challenge instead of an anonymous session.

## Testing

Set `CORREOS_CHILE_TRACKING_NUMBER` to an authorized real reference and
optionally `CORREOS_CHILE_UNKNOWN_NUMBER` to a valid-looking unknown reference,
then run `npm run test:carriers:live -- packages/carriers/carriers/correos-chile`.
