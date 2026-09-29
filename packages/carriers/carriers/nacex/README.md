# NACEX

Tracks composite agency/shipment references through the anonymous Spanish portal.
Other reference formats and international detail modes use universal providers.

## How it works

Each lookup opens a fresh anonymous session, submits the agency and shipment
fields, then follows one identity-checked redirect to the detailed scan table.
The returned shipment label and agency/shipment details must match. The legacy
external link shows a reduced view; it is used for public links, not retrieval.

## Notes

Public scans have calendar headings without a clock or zone. These remain
provider text, with no invented midnight or delivery instant. Scans retain
their source order, including repeated descriptions on the same day. Unknown
current wording cannot inherit an older delivery. A delivered summary must agree
with the newest mapped physical scan; contradictory responses are rejected.

Only status labels and depot localities of mapped movement scans are retained.
Delivery recipient text, signatures and free-form instructions are excluded.
A negative requires the portal's explicit no-shipment result after submission;
empty pages, generic HTTP errors and missing histories remain inconclusive.

## Testing

Set `NACEX_TRACKING_NUMBER` to an authorized real reference and optionally
`NACEX_UNKNOWN_NUMBER` to a valid-looking unknown reference, then run
`npm run test:carriers:live -- packages/carriers/carriers/nacex`.
