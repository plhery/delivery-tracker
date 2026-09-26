# Evri fixtures

Synthetic HTML preserving the detail-card and history-table structure observed
on the official international tracker, [GlobalEco](https://globaleco.app/track/),
on 2026-09-26. The official [Evri tracking page](https://www.evri.com/track-a-parcel)
links this portal for international parcels.

`international.html` replaces all references, people, destinations and dates;
its duplicate scan tests deduplication. Its `tracking_number` form field contains
the partner alias, as observed; the shipment heading and System Tracking field
carry the Evri identity. `not-found.html` preserves the explicit empty-result
signature with the cleared input observed on the portal. Neither fixture
contains a live parcel.
