# DHL fixtures

| File | Scenario | Provenance |
|---|---|---|
| `in-transit.json` | One parcel sorted at a mail centre: an electronic pre-advice and a processing scan, a delivery window, and the recipient, signature and address fields the portal returns. | Constructed from the documented `/int-verfolgen/data/search` shape. The tracking number is the committed synthetic `LF123456785DE`; every personal-looking value is a placeholder (`Private …`) that the privacy assertion checks never reaches a result. |
