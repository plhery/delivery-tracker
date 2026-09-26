# Asendia fixtures

Shaped after live replies. Only published numbers are real; every other reference, city, address line and postal code is synthetic.

- `a1-delivered.json`: A1 reply with Asendia `1`–`2.2` scans then Broadreach scans, two in the same second.
- `a1-harmonized.json`: A1 reply with `FullTrack API` harmonized codes, a failed attempt and a duplicated customs scan.
- `a1-usps-leg.json`: A1 reply with USPS scans, a Canada Post final-mile link and a date-only pre-shipment scan.
- `delivered-parcel.json`: global portal `branded-parcel-search` reply (probe) with `Private …` recipient placeholders.
- `tenant-config.json`: global portal `get-config-data` reply for the public tenant.
