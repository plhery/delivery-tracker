- `overview-delivered.json`: anonymous `rstt029` overview for a delivered parcel (full progress bar, no history, arrival time in the portal's wording).
- `detail-delivered.json`: postcode-gated `rstt028` detail for the same parcel, plus signature, recipient, street, postcode, reference and phone fields the parser must drop.
- `detail-parcelshop.json`: a parcel waiting in a ParcelShop (`DELIVEREDPS`), with pickup-point name, weight and estimate.

All constructed in the public endpoint shapes; numbers and personal values are synthetic.
