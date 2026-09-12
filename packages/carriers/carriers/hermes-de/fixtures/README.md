# Hermes Germany fixtures

| File | Scenario | Provenance |
| --- | --- | --- |
| `delivered-neighbour.json` | Delivered to a neighbour: an out-of-order history, one exact duplicate row, a row carrying the carrier's own `historyText`, plus the recipient block the projection must drop. | Constructed in the shape observed on the public recipient service (2026-09-08); the barcode is synthetic. |
| `out-for-delivery.json` | Same parcel out for delivery, with an `eta` and the `EDL_BOOKED_DROPOFF` preference booking the adapter ignores. | Constructed in the same shape; the barcode is synthetic. |
