# Blue Dart

Tracks domestic waybills through the official server-rendered third-party tracking page.

## How it works

One anonymous GET returns the shipment summary and scan table. The returned waybill must
match the requested number. The main tracking form uses a CAPTCHA; this read-only result
page needs no session or challenge token.

## Notes

Only scan-table rows become events, in the portal's newest-first order. Domestic scans use
India time; unresolved date labels stay separate from timestamps. Unknown wording keeps
its text without inheriting the shipment's current status. Recipient and reference-number
rows, feedback forms and page scripts are excluded.

The no-information panel exists hidden in successful pages too. Only its server-provided
activation marker makes a missing summary a confirmed negative.

## Limitations

Reference-number searches and international partner histories are outside this adapter's scope.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/blue-dart`. Set
`BLUE_DART_TRACKING_NUMBER` to check an authorized real shipment.
