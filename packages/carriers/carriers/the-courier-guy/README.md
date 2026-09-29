# The Courier Guy

Tracks shipment and supported product references through the official anonymous
consumer API, including the shipment timeline for multiple pieces. Individual-piece
references and arbitrary customer-defined aliases are outside this adapter's scope.

## How it works

One bounded GET uses the provider identity resolved by the
[official portal](https://portal.thecourierguy.co.za/track). The response must name
The Courier Guy and the exact shipment reference, or explicitly bind the printed
product reference to one canonical shipment. The product separator is required by
the native API and restored after generic input normalization. Only the endpoint's
explicit, reference-bound absence reply proves a missing shipment.

## Notes

The consumer page uses shipment-level scans and hides internal operational events.
The adapter follows that rule; one delivered piece cannot complete a shipment.
Status comes from the latest public scan and must agree with the public summary.
An internal summary requires a dated, unambiguous public timeline. Contradictory
scan order is rejected instead of promoting an older delivery to current status.
Free-text messages, recipient details and proof images are excluded.

Cancelled collection bookings can omit their piece count. They are accepted only
with one piece reference and a history containing creation, collection assignment,
failed collection attempts and cancellation. Movement or completion still requires
a complete shipment count.

Explicit scan offsets establish instants. Offsetless or incomplete clocks remain
local evidence. Estimates are omitted because delivered responses retain old
promises and their active-shipment provenance is unverified.

## Live test

Set `COURIER_GUY_TRACKING_NUMBER` outside the repository and run
`npm run test:carriers:live -- packages/carriers/carriers/the-courier-guy/adapter.live.test.ts`.
Optionally set `COURIER_GUY_UNKNOWN_NUMBER` to check explicit absence.
