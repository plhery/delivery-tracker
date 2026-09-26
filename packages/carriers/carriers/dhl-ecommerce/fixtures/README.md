# DHL eCommerce fixtures

- `in-transit.json`: `utapi` response for a parcel en route, with the alias DHL echoes instead of the queried number, a webshop sender, an estimate and scans timed from a country code and a US hub.
- `delivered.json`: the same parcel delivered and signed for (`delivered_at`, replaced description).

Both are constructed; recipient, reference and signature values are placeholders the privacy test checks never reach a result.
