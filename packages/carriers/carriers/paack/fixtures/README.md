# Paack fixtures

- `delivered-order.json`: `routes/tracking.order` loader payload for a delivered order with
  an earlier incorrect-address attempt and a delivery window. Built around the order number
  from Paack's public API examples; every retailer, recipient, contact, address and
  `variables` field is a `PRIVATE …` placeholder so the test can assert none leaks.
