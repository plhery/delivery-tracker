# USPS fixtures

`9400111899223397910421` and `9400111899223397910438` are synthetic
22-digit numbers in USPS's published format. No real shipment, recipient or
signatory appears in this folder: the delivered line carries a
`PRIVATE RECIPIENT` placeholder the offline test asserts never reaches a
result.

| File | Scenario | Provenance |
|---|---|---|
| `delivered.html` | A delivered parcel: the observed shell classes (`.track-bar-container`, `#trackingNum`, `.latest-update-banner-wrapper .banner-header`, `.current-tracking-status-wrapper`), a four-row history and a signatory line. | Shell classes from a live page render, inspected 2026-09-20; history rows follow the official Tracking API event vocabulary. Row markup is the adapter's documented assumption until a live success render confirms it. |
| `in-transit.html` | The same shell en route, with an expected-delivery line and three scans. | Same provenance. |
