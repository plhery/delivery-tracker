# ParcelsApp fixtures

- `announced.json`: a synthetic `/api/v2/parcels` reply for an announced-only shipment
  whose newest row is a delivery-preference notice, not a scan, plus sender and
  destination values the parser must drop. Identifiers are made up.
- `undated-leg.json`: a synthetic reply for a cross-border shipment whose last listed
  state, from another carrier, has no `date` key. Dates and places are made up.
