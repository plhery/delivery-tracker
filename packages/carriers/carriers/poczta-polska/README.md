# Poczta Polska

Tracks registered postal items and parcel barcodes through the official
eMonitoring widget's anonymous JSON service.

## How it works

The adapter reads public widget configuration from eMonitoring, then requests
one parcel's history. No account or browser is required. Both returned parcel
identifiers must match. A 19-digit reference receives the same check digit that
the official widget appends before lookup.

## Notes

Specific scan codes determine progress. An unsuccessful delivery can carry the
broader “in delivery” state, so that state does not override the scan. Weight is
provided in kilograms. Office names provide locations; office addresses,
opening hours and payment documents are excluded.

## Limitations

The service includes international partner scans without clock offsets. Local
digits and provider order are preserved; a timezone is never inferred from the
carrier's home country. See [ROUTING.md](../../../../docs/ROUTING.md) for
unresolved history handling. Empty history, invalidated scans and ambiguous
reused numbers are inconclusive. Pallet consignments and references with linked
components need parcel-level history and are not supported.

## Testing

Run `npm run test:carriers:live -- packages/carriers/carriers/poczta-polska`.
Set `POCZTA_POLSKA_TRACKING_NUMBER` outside the repository for a real parcel.
