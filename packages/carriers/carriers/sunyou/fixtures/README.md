# SunYou fixtures

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | The unwrapped `queryTrack` payload for a delivered cross-border parcel: two origin scans stamped `+08:00`, two destination scans stamped `+02:00`, and the recipient and signature fields such a record can carry. | Constructed after the per-leg timezone behaviour documented in the public prior-art fixtures at https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py. `SYAE100000001` is the open-source example number already in `numbers.json`; the names, the address, the signature URL and every timestamp are made up. |
