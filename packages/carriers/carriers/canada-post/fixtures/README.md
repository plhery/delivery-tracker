# Canada Post fixtures

`delivered.json` (status `8`, actual delivery day, scans with `cd` and `datetime`) and `in-transit.json` (status `5`, estimated day) are replies built from the app bundle's model; scan description and location keys are assumed. `0073938000999999` and `0073938000888888` are synthetic, and the signatory and service blocks are `PRIVATE …` placeholders the offline test asserts never reach a result.
