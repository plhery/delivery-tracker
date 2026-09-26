# DPD Switzerland fixtures

Every identifier, name, address, reference and timestamp is synthetic;
`06080000000001` is a 14-digit number that was never issued.

- `delivered-verified.json`: guest-API `parcels/details` payload for a delivered
  parcel looked up with its postcode. `sender` and `receiver` objects,
  `parcelEvents` with scan codes (`CCO`, `ORI`, `DLI`, `DLO`, `DEY`, and `DEYY`
  with a `podUrl`), the `UNDEFINED` country placeholder, `parcelHistory` twins
  with `+02:00` offsets, a weight, and the product, references and
  `gttsZipCode` the projection has to drop. The shape mirrors a live response
  from 2026-09-26.
- `delivered-unverified.json`: the same parcel looked up without the postcode:
  `parcelHistory` only, no places, no sender, an empty receiver block. Same
  provenance.
- `ready-for-collection.json`: a parcel waiting at a parcelshop, with a delivery
  window, a webshop sender and recipient fields. Constructed, not captured: its
  string `senderName`/`receiverName` and enumeration values in
  `parcelEvents[].eventType` predate the live shapes above. It is kept for the
  pickup-point and delivery-window paths, which no live payload has shown yet.
