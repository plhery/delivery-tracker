# Mondial Relay fixtures

| File | Scenario | Provenance |
|---|---|---|
| `available-at-relay.json` | `/api/tracking` reply for a parcel waiting at its Point Relais: a headline, two events, two reached milestones, an estimate, and the relay-detail and recipient blocks the reply carries. | Constructed against the documented response schema; every value is made up. The `PRIVATE …` placeholders stand in for the relay address, contacts, coordinates and recipient fields, and the offline test asserts none of them reaches the result. |
