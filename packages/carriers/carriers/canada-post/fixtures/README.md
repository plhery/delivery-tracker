# Canada Post fixtures

`0073938000999999` and `0073938000888888` are synthetic 16-digit numbers in
Canada Post's published format. No real shipment, recipient or signatory
appears in this folder: the delivered line carries a `PRIVATE RECIPIENT`
placeholder and the service blocks `PRIVATE …` placeholders the offline
test asserts never reach a result.

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | A delivered parcel: the `8` package status, an actual-delivery day, three scans with `cd` codes and `datetime` pairs, and the service blocks the reply carries. | Constructed against the application's bundle model (`pin`, `status`, `events` with `cd`/`datetime`, `actualDlvryDate`, `expectedDlvryDateTime`), inspected 2026-09-20. Event display-text and location keys are the documented assumption until a live parcel confirms them. |
| `in-transit.json` | The same shape en route: the `5` package status, an estimated-delivery day and two scans. | Same provenance. |
