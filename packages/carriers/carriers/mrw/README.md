# MRW

Tracks national MRW shipments through the anonymous form and its history page.

## How it works

A page request establishes an ASP session. The adapter submits the complete
reference, checks the returned summary's own reference, then follows that
shipment's history link and checks the history subtitle. Requests are paced to
respect the portal's rate limit and share one time budget.

## Notes

The portal sometimes returns a bound current summary with no history. That
result is marked `summary_only` and contains no invented scans. A page that
echoes an unknown number without a shipment table is inconclusive.

Scan clocks are shown without offsets, so they remain local wall times. Only
visible office labels are retained from history rows; PointCorner map addresses
and coordinates are excluded.

## Testing

Set `MRW_TRACKING_NUMBER` to an authorized reference with history. Optionally
set `MRW_SUMMARY_ONLY_NUMBER` and `MRW_UNKNOWN_NUMBER` for the other observed
response shapes, then run `npm run test:carriers:live -- packages/carriers/carriers/mrw`.
