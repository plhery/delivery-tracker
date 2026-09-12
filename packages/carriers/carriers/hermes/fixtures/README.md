# Hermes Einrichtungs-Service fixtures

| File | Scenario | Provenance |
| --- | --- | --- |
| `delivered.json` | Delivered consignment: the customer timeline (`auftragstatusdaten`) plus the internal operational stream (`statusdaten`) the adapter ignores, and a row whose wording is `null`. | Scrubbed capture of the shape returned by the public myhes.de order lookup; the consignment number is the carrier's own published sample. |
| `empty-order.json` | The synthetic placeholder order the API returns for a valid but unknown consignment number: every identifying and status field is `null`. | Scrubbed capture, 2026-08-30. |
