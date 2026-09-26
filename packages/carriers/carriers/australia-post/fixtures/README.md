# Australia Post fixtures

Synthetic equivalents of the anonymous official shipment-gateway response
observed on 2026-09-26. Identifiers, facilities, names, addresses, dates and
private metadata were replaced. `delivered.json` retains the twelve-event
structure, independent article/detail identity, explicit time offsets, epoch
milliseconds and the separate summary modification time. `not-found.json`
preserves the matched entry's `400 / errorCode: 21` signature inside HTTP 200.

The browser sends the exact requested `trackingIds` query after opening the
official detail page. These fixtures test parsing; they do not establish browser
compatibility by themselves. No raw live response is committed.
