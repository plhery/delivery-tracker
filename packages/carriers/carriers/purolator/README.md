# Purolator

Tracks individual Purolator PINs through the anonymous JSON endpoint used by the official portal.

## How it works

One POST requests descending package scans using the widget's public client key and browser
user agent. The search result's indexes must select exactly one matching package.
Ambiguous matches remain inconclusive. AWS WAF can require an image challenge; that failure
is reported for routing fallback.

## Notes

Scans retain the provider's newest-first order. Cross-country scan clocks without offsets
remain local wall times in the host's direct history archive. They provide no verified instant
for freshness checks or the dated timeline. Each scan uses its own event code; unrecognized
codes keep their wording without inheriting an older milestone. Pickup availability is
distinct from parcel delivery. Shipment-level weight is retained only for a single-piece
shipment. Recipient information, delivery instructions, references and proof data are excluded.

## Testing

Set `PUROLATOR_TRACKING_NUMBER` to an authorized real PIN and run
`npm run test:carriers:live -- packages/carriers/carriers/purolator`.
