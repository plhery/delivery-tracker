# TNT

Direct tracking covers 9-digit international consignments through the JSON read
behind tnt.com's public tracking page, and TNT France's 16-digit national
consignments through its public HTML tracking page.

## How it works

`direct` makes one GET, chosen by the number's shape. No session, browser,
postcode or account is required.

- 9 digits: `https://www.tnt.com/api/v3/shipment?con={number}&searchType=CON&locale=en_GB&channel=OPENTRACK`.
  A `notFound` entry for the number is a clean not-found, which recognition uses.
- 16 digits: the national consignment detail page on tnt.fr. tnt.com rejects these
  numbers, so they are never sent there.

## Notes

- tnt.com lists every consignment that carried the number, since numbers are reused.
  Only consignments whose own number matches are read, and the one with the most recent
  scan is the parcel. References, signatories and addresses are not kept.
- tnt.com scan times carry offsets. Scan codes (`legacyCode`) set the stage, because the
  wording is prose: "partially delivered" is not a delivery. The estimate is kept as a
  calendar day until delivery.
- On tnt.fr, the returned detail header and item identity must match. History comes only
  from the shipment's event rows; the progress rail includes future delivery labels.
  The selected milestone determines current status. National scan times are read in the
  French civil timezone, and the page's Latin-1 encoding is respected.

## Limitations

The link opens tnt.com, which cannot show TNT France consignments. Public histories can
expire.

## Testing

Set `TNT_TRACKING_NUMBER` (9 digits) or `TNT_FRANCE_TRACKING_NUMBER` (16 digits) outside
the repository, then run `npm run test:carriers:live -- packages/carriers/carriers/tnt`.
The wrong-number check runs without either.
