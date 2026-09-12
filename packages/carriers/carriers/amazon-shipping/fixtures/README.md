# Amazon Shipping fixtures

Each file mirrors the wire format: `progressTracker`, `eventHistory` and
`addresses` arrive as JSON *strings* inside the JSON response, which is why they
are escaped here rather than nested.

| File | Scenario | Provenance |
| --- | --- | --- |
| `delivered.json` | Delivered French shipment: four event rows including an exact duplicate and one carrying a scan location, alongside the merchant name, recipient name, street, postcode, e-mail and proof-of-delivery image the projection must drop. | Constructed in the shape of the public `track.amazon.fr` tracker; every identifier and name is made up. |
| `not-found.json` | The HTTP 200 body the tracker returns for an unknown tracking id (`TRACKING_ID_NOT_FOUND`, `trackerSource: UNKNOWN`). | Scrubbed capture, 2026-09-10. |
| `history-expired.json` | A recognized MCF shipment whose history is past the supported age; its `IN_TRANSIT` summary is a placeholder, not movement. | Scrubbed capture, 2026-09-10. |
