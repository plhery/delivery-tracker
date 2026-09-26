# Amazon Shipping fixtures

`progressTracker`, `eventHistory` and `addresses` are escaped JSON strings, as on the wire. `delivered.json` is a constructed French shipment (with a duplicate event and the private fields the projection must drop; every identifier and name is made up). `not-found.json` (`TRACKING_ID_NOT_FOUND`) and `history-expired.json` (MCF, past supported age) are scrubbed captures.
