# Fixtures

- `delivered.json`: a delivered `detail.json` module (four scans up to `GTMS_SIGNED`, an ETA window, a partner handoff number, and a recipient block the adapter must ignore).
- `in-transit.json`: the same module mid-journey, line-haul scans only, with an open ETA window.

Both are constructed from the live response shape; every identifier, name, address and time is synthetic. Scans keep the live `timeZone` and Beijing-based epoch `time`.
