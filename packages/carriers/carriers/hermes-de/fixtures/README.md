# Hermes Germany fixtures

- `delivered-neighbour.json`: delivered to a neighbour, with an out-of-order history, one exact duplicate row, a row with its own `historyText` and a recipient block the projection must drop.
- `out-for-delivery.json`: the same parcel out for delivery, with an `eta` and the ignored `EDL_BOOKED_DROPOFF` booking.

Both are constructed in the recipient service's shape; barcodes are synthetic.
