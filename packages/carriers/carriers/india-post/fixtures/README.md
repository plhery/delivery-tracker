# India Post fixtures

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | The `tracking-request` payload of a completed lookup: booking, dispatch and delivery rows with their offices and pincodes, plus the recipient remark, address and contact-number fields that must never survive normalization. | Constructed after the MySpeedPost Livewire payload shape inspected 2026-09-01. Every identifier, office, pincode and timestamp is made up; the recipient fields are placeholders, not real data. |
| `export-customs.json` | A completed lookup in the code-only shape India Post returns since 2026-09 (`ITEM_BOOK`, `BAG_DISPATCH`, `CUSTOM_RECEIVE`, `CUSTOM_RETURN`, `TRANSFER_OOE`), through export customs to the office of exchange, with the `synced_at` of MySpeedPost's cached sync. | Constructed after a live refreshed reply inspected 2026-09-22. Offices, pincodes and timestamps are made up. |
