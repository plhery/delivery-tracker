# Ciblex fixtures

- `delivered-timeline.json` — scan rows rendered into the portal's table: `rows` is a delivered
  parcel with an address failure row, `pickupRows` covers return, pickup-ready, collected and
  unmapped wording. Depots are invented; the failure row's `PRIVATE STREET` place must never be
  forwarded.
- `full-barcode.html` preserves the native full-barcode banner annotations and
  event-table shape with synthetic identities, references and private places.
