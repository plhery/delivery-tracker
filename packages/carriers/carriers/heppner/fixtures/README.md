# Heppner fixtures

- `returned-shipment.json` — detail response for a shipment that reached
  `MARCHANDISE_RETOURNEE`, covering the returned, awaiting-instructions,
  out-for-delivery, collected and in-transit milestones in one timeline.
  Constructed: provider-shaped, with every party, reference, merchandise,
  appointment and address field filled with `PRIVATE …` placeholders so the
  offline test can assert none of them reaches the result.
