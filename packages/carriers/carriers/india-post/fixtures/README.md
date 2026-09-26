# Fixtures

- `delivered.json`: a completed `tracking-request` payload (booking, dispatch and delivery rows) plus recipient remark, address and contact fields that must not survive normalization.
- `export-customs.json`: code-only rows (`ITEM_BOOK` to `TRANSFER_OOE`) through export customs to the office of exchange, with a cached `synced_at`.

All identifiers, offices, pincodes, times and recipient fields are made up.
