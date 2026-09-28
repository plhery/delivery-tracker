# Pos Malaysia

Tracks Pos Malaysia and Pos Laju items through the anonymous API used by the official tracking app.

## How it works

One bounded JSON request supplies the number and a fresh request identifier. No browser, account or cookie is needed. The response must contain exactly one matching consignment.

## Notes

Null or empty history is inconclusive: unavailable history does not prove shipment absence. Error rows and malformed scans cannot silently expose an older scan as current.

The delivered summary is authoritative. If the latest scan does not establish delivery, an undated summary snapshot preserves that evidence without borrowing an older scan's time. Unknown scan summaries remain visible without an inferred stage.

Offsetless clocks receive Malaysian time only when both route countries explicitly identify a domestic Malaysian journey. International or unlocated clocks and invalid dates remain provider text with no instant. The source supplies current scans first; that order is preserved whenever any clock is unresolved.

## Limitations

The adapter retains a bounded history and coarse facility names. It excludes personal contact blocks, addresses and proof-of-delivery material. It returns no ETA. Undated scans are archived as direct evidence; displaying them in a dated timeline requires another source with resolved clocks.

## Testing

Run `npm run test:carriers:live -- packages/carriers/carriers/pos-malaysia`. Set `POS_MALAYSIA_TRACKING_NUMBER` for available history or `POS_MALAYSIA_DELIVERED_TRACKING_NUMBER` for a delivered item. Supply parcel inputs outside the repository.
