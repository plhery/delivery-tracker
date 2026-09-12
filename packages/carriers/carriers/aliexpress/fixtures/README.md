# AliExpress / Cainiao fixtures

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | `detail.json` module for a delivered parcel: four scans from warehouse acceptance to `GTMS_SIGNED`, an ETA window, a partner handoff number, and the recipient identity block such a module can carry. | Constructed after the documented response shape. Every identifier, name, address and timestamp is made up; `LP00000000000001` and `RA123456785CH` are synthetic. |
| `in-transit.json` | The same module mid-journey: line-haul scans only, an unresolved ETA window (`deliveryMinTime` before `deliveryMaxTime`), no delivery. | Constructed. `LP00000000000002` is synthetic. |
