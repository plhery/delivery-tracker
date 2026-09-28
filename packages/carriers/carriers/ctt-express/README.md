# CTT Express

Tracks single-piece Spanish shipment references through the anonymous JSON route
used by the official public tracking app.

## How it works

One GET requests shipment history. The returned shipment must match exactly and
its package code must identify the sole package according to the carrier's
[label specification](https://transfer.cttexpress.com/IT/export/integra/Shipment_Number_Calculation_and_Package_Codes_of_CttExpress.pdf).
Multi-piece shipments remain inconclusive because the public response contains
only one package's scans. Portuguese postal references use the universal providers.

## Notes

The feed provides ascending scans with explicit offsets. Histories are projected
newest first; unresolved newest clocks retain their place and local digits or
provider text. Pickup availability and returns in progress do not complete a
delivery. An explicit return start establishes the sender-bound leg across later
movement scans; completed delivery on that leg means returned. The outbound
estimate stays suppressed throughout the return. The portal's presentation rail
can fill in future milestones, so only actual scan rows are retained. Empty
histories, token errors and unbound error
replies remain inconclusive. Calendar estimates retain their date-only precision
for active deliveries when they are no older than the latest dated scan. Pickup,
delivery, incidents and document holds suppress estimates. Unlabelled
measurements, contact information and free-form delivery comments are excluded.

## Testing

Set `CTT_EXPRESS_TRACKING_NUMBER` to an authorized real Spanish reference and run
`npm run test:carriers:live -- packages/carriers/carriers/ctt-express`.
