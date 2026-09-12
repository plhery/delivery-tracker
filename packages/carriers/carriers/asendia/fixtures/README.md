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
