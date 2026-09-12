# Paack fixtures

- `delivered-order.json` — the `routes/tracking.order` loader payload for a
  delivered order whose timeline still contains an earlier incorrect-address
  attempt, plus the delivery window the page shows. Constructed around the
  order number Paack publishes in its own API examples
  (https://www.postman.com/paacklogistics/paack-apis/folder/1uuw6iw/orders-api);
  every retailer, recipient, contact, address and per-event `variables` field
  holds a `PRIVATE …` placeholder so the offline test can assert none of them
  reaches the result.
