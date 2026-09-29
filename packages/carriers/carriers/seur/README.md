# SEUR

Tracks single-piece shipments through SEUR's public simplified lookup.
Other references and multi-piece shipments use universal providers.

## How it works

One JSON request uses the same simplified lookup as the consumer portal's
tracking links. It needs neither an anonymous session nor recipient details.
The returned search identifier must exactly match and have nonempty history.

## Notes

Current status follows the first native scan. Only observed code, group and
wording combinations are mapped, so planned delivery or unfamiliar codes do
not inherit an older terminal state. Supplied timestamp offsets are preserved;
unresolved clocks remain local time or provider text. A delivery instant needs
the current delivered scan's own valid timestamp.

Scan comments, names, contact details, QR codes, delivery PINs and driver
coordinates are excluded. Shipment weight uses the portal's kilogram label.

The no-history error also covers recent or out-of-range identifiers and remains
inconclusive. Empty replies, redirects and generic HTTP errors do too.

## Testing

Set `SEUR_TRACKING_NUMBER` to an authorized reference and optionally
`SEUR_UNKNOWN_NUMBER` to a valid-looking unresolved identifier, then run
`npm run test:carriers:live -- packages/carriers/carriers/seur`.
