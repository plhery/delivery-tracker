# Postal Ninja fixtures

- `found.json` — constructed after the shape of one `/track/get` reply captured
  from the official embedded widget (verified 2026-09-10): events oldest first,
  local wall times with one explicit offset, and recipient address and access
  code values that the projection must drop. Identifiers are made up.
- Compact `firstEv`/`lastEv` replies are constructed in `adapter.test.ts` from
  synthetic scans. That shape was verified in the widget on 2026-09-21; full
  `/track/get` mode instead supplies the `events` array shown in `found.json`.
