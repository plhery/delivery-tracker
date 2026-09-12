# DHL eCommerce fixtures

| File | Scenario | Provenance |
|---|---|---|
| `in-transit.json` | A parcel en route: the shipment alias DHL echoes instead of the queried number, a webshop sender, a delivery estimate, and two scans whose local timestamps come from a country code and from a US hub. | Constructed from the documented `utapi` shape. The recipient address and customer reference are placeholders (`PRIVATE …`) the privacy assertion checks never reach a result. |
| `delivered.json` | The same parcel delivered and signed for, used for `delivered_at` and for the rule that a delivered event's description is replaced. | Constructed; the signature name is a `PRIVATE …` placeholder. |
