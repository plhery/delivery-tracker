# UPS fixtures

| File | Scenario | Provenance |
|---|---|---|
| `out-for-delivery.json` | `Track/GetStatus` reply for a parcel out for delivery: three scans with both the UTC and the local/offset pair, a `progressBarType`, a scheduled delivery day, and the recipient, address, signature and photo fields the reply carries. | Constructed against the documented response shape; every value is made up. `1Z999AA10123456784` is a synthetic number in UPS's published format, and the `PRIVATE …` placeholders stand in for the recipient block the offline test asserts is never retained. |
