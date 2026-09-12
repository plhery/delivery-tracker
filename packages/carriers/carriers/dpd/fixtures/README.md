# DPD Switzerland fixtures

| File | Scenario | Provenance |
|---|---|---|
| `ready-for-collection.json` | myDPD guest-API `parcels/details` payload for a parcel waiting at a Pickup parcelshop: a mapped `AVAILABLE_FOR_COLLECTION` status, a three-scan history, a delivery window, a webshop sender, and the recipient identity block the payload carries. | Constructed after the guest API's response shape. Every identifier, name, address and timestamp is made up; `06080000000001` is a synthetic 14-digit number that was never issued. |
