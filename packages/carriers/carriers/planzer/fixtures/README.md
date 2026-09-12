# Planzer fixtures

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | `/shipments/{shipment}/Pak` payload for a delivered Quickpac parcel: the four milestone labels in the order the API returns them, a delivery day, a transport position belonging to another shipment, and the recipient and signature blocks such a payload can carry. | Constructed after the response shape confirmed live on 2026-09-06. The four English labels and their sub-second timestamps keep the observed wording and format; the shipment number `440000000000000001`, the second position, the names and the signature URL are made up. |
