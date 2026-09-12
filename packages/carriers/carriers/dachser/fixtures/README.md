# Dachser fixtures

| File | Scenario | Provenance |
| --- | --- | --- |
| `in-transit.json` | Shipment in transit with a delivery commitment date and four Spanish event rows, alongside the sender, recipient, contact, signature and internal-note fields the projection must drop. | Constructed in the shape of the Customer Iberia detail endpoint; the shipment number and every name are made up. |
| `null-result-500.json` | The stable JSON HTTP 500 the public endpoint returns for an unknown shipment/access tuple, which the adapter recognizes as a clean not-found. | Scrubbed capture of the public error body, 2026-09-10. |
