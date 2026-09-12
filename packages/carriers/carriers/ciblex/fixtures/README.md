# Ciblex fixtures

- `delivered-timeline.json` — the scan rows the offline test renders into the
  portal's `date / heure / action / lieu` table. `rows` is a delivered parcel
  whose history still contains an address-complement failure row; `pickupRows`
  covers the return, pickup-ready, collected and unmapped wording. Constructed:
  provider-shaped French wording with an invented depot and a `PRIVATE STREET`
  placeholder in the failure row's place cell, so the test can assert the
  adapter never forwards a place taken from a failure row.
