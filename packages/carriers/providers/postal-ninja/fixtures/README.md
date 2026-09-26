# Postal Ninja fixtures

- `found.json`: a synthetic full `/track/get` reply, events oldest first, local wall times
  with one explicit offset, and recipient address and access-code values the parser must
  drop. Identifiers are made up.
- Compact `firstEv`/`lastEv` replies are built in `adapter.test.ts` from synthetic scans.
