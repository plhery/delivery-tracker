# FedEx fixtures

`999999999999` and `999999999998` are synthetic 12-digit numbers in FedEx's
published format. No real shipment, recipient, signatory or session value
appears in this folder: every private field carries a `PRIVATE …`
placeholder the offline test asserts never reaches a result.

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | A delivered international parcel: four scans with per-scan `date`/`time`/`gmtOffset`, the `DL` package code, the signatory and shipper/recipient blocks the reply carries. | Constructed against the page bundle's package model (`trackingNbr`, `keyStatusCD`, `scanEventList` with `date`/`time`/`gmtOffset`/`scanLocation`/`status`/`statusCD`/`scanDetails`), inspected 2026-09-20. |
| `in-transit.json` | The same shape out for delivery: the `OD` package code, an estimated delivery timestamp and four scans. | Constructed against the same model. |
