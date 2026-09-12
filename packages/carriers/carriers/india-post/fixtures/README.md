# India Post fixtures

| File | Scenario | Provenance |
|---|---|---|
| `delivered.json` | The `tracking-request` payload of a completed lookup: booking, dispatch and delivery rows with their offices and pincodes, plus the recipient remark, address and contact-number fields that must never survive normalization. | Constructed after the MySpeedPost Livewire payload shape inspected 2026-09-01. Every identifier, office, pincode and timestamp is made up; the recipient fields are placeholders, not real data. |
