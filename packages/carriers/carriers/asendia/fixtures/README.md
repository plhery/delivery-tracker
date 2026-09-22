# Asendia fixtures

- `delivered-parcel.json` — a `branded-parcel-search` response for a delivered
  France → Switzerland parcel with three harmonized scans. Constructed around
  `LF092919653FR`, an identifier shape published in Asendia's own tracking
  documentation; the order reference and the recipient's name, address and
  e-mail hold `Private …` placeholders so the offline test can assert none of
  them reaches the result.
- `tenant-config.json` — the `get-config-data` response for the public
  `track.asendia.com` tenant, which the probe turns into the subsidiary and
  brand fields of the search body. Constructed: no account-specific values.

A1 (`adapter.ts`) replies, all shaped after live `TrackingBranded/Tracking`
answers from 2026-09-22 with their field layout, code sources and timestamp
formats kept. Only published numbers are real; every other reference, the
delivery city and the address placeholders are synthetic, and the address
lines and postal codes exist to prove they are dropped.

- `a1-delivered.json` — `AS010501721US`, Asendia's own `1`–`2.2` scans followed
  by a Canadian partner's (Broadreach) scans, including two scans with the same
  second and six-digit fractional seconds.
- `a1-harmonized.json` — `EEUS027988469JP0`, Asendia's harmonized
  `FullTrack API` codes to Japan with a failed attempt, a duplicated customs
  scan and a trailing-space city.
- `a1-usps-leg.json` — `AHOY1X39DP45`, USPS scans before and after Asendia's,
  a Canada Post final-mile link and a date-only pre-shipment scan.

