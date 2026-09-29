# Correos Express

Tracks 16-digit shipment references through the anonymous public tracking form.
Other reference formats use the universal providers.

## How it works

One form POST returns the shipment label and its scan table. Both the visible
label and hidden shipment field must match the requested reference. No session
bootstrap, postcode or browser is needed.

## Notes

Scans retain the carrier's newest-first order. Their clocks have no stated zone,
so valid digits remain local time and unresolved labels remain provider text.
Calendar estimates retain date-only precision while the delivery is active;
estimates older than the latest scan are omitted. A rescheduled round does not establish dispatch.
Only recognized status labels and the locality column are retained. Scans with
missing or unrecognized labels remain neutral tracking updates, so an older
delivery does not become current. Free-form explanations, contact fields and
proof of delivery are excluded.

The initial page contains every error message hidden in its markup. A negative
requires the server-selected no-history code and the matching request echo;
other form-only responses remain inconclusive.

## Testing

Set `CORREOS_EXPRESS_TRACKING_NUMBER` to an authorized real reference and optionally
`CORREOS_EXPRESS_UNKNOWN_NUMBER` to a valid-looking unknown reference, then run
`npm run test:carriers:live -- packages/carriers/carriers/correos-express`.
