# FedEx fixtures

`delivered.json` (international parcel, `DL`, signatory and shipper/recipient blocks) and `in-transit.json` (`OD`, estimated delivery) are `track/v2/shipments` replies built from the page bundle's package model. `999999999999` and `999999999998` are synthetic; every private field is a `PRIVATE …` placeholder the offline test asserts never reaches a result.
