# GEODIS fixtures

- `out-for-delivery.json` — the `contenu` block of a shipment out for delivery:
  an active timeline step, two days of scans with their agency names, a planned
  delivery date, and the sender, recipient, per-scan complementary-information
  and delivery-document blocks the endpoint returns alongside them. Constructed
  to the endpoint's shape; the shipment number is the synthetic one from
  `numbers.json` and every personal value is a placeholder the privacy assertion
  looks for.
