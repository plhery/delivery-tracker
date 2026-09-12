# GLS Switzerland fixtures

| File | Scenario | Provenance |
| --- | --- | --- |
| `overview-delivered.json` | The anonymous `rstt029` overview for a delivered parcel: a full progress bar, no history, and the arrival time in the portal's own `19-Jun-2026 at 10:59 o`clock` wording. | Constructed in the shape of the public overview endpoint; the parcel number is the synthetic sample from `numbers.json`. |
| `detail-delivered.json` | The postcode-gated `rstt028` detail for the same parcel: two dated scans, plus the signature, recipient name, street, postcode, order reference and phone number the projection must drop. | Constructed in the shape of the public detail endpoint; every personal value is made up. |
| `detail-parcelshop.json` | A parcel waiting in a ParcelShop (`DELIVEREDPS`): exercises the pickup-point name, the parcel weight and the estimate that survives because the parcel is not delivered yet. | Constructed in the same shape; the shop name is made up. |
