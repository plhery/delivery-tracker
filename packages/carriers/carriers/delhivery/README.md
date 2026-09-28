# Delhivery

Reads domestic parcel status and scans from the public consumer tracking feed.

## How it works

One GET with the website's Origin and Referer headers returns an identity-bound shipment.
It needs no merchant API token or account. An explicit invalid-or-old waybill response is
not-found; other empty replies remain schema failures.

## Notes

Future progress labels are excluded. The dated current status is a separate snapshot;
its timestamp is never assigned to an undated historical scan.
Scan remarks, recipient information, coordinates, references and phone fields are excluded.

## Limitations

The public feed often omits historical scan dates. Displayed delivery periods are prose,
so the adapter does not convert them into an exact delivery estimate. Freight LR numbers
use a separate service and are outside this adapter's scope.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/delhivery`. Set
`DELHIVERY_TRACKING_NUMBER` to check an authorized real parcel.
