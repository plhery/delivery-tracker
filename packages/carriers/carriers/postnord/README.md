# PostNord

Tracks individual parcels through the anonymous JSON service used by PostNord's official tracking widget.

## How it works

One GET returns the shipment and scans. The request carries the widget's bounded SHA-512
nonce proof and tracking-site origin. Both are required: an incomplete request can look
like a missing shipment. Only the service's structured not-found response is a clean negative.

## Notes

The requested identifier must match the shipment, selected item and returned identifier.
Shipment group references and aliases need an exact item reference. Offset timestamps
are ordered by instant; incomplete scans fail rather than allowing older progress to appear current.
Each event uses its own code and, where the code covers several milestones, exact portal wording.
Pickup availability remains distinct from parcel delivery. Confirmed notification and
recipient-choice notices are omitted from shipment history, so a delivered message cannot
become a parcel-delivery milestone. A notice-only response is inconclusive.
Summary status comes from the selected item's current status. Recipient addresses, sender
references, delivery instructions and proof data are excluded.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/postnord` checks a structured negative.
Set `POSTNORD_TRACKING_NUMBER` to check history for an authorized real parcel.
