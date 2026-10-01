# Ukrposhta

Tracks domestic barcodes and international postal references through the official
consumer tracker, including the destination post's scans when it supplies them.

## How it works

A fresh anonymous browser submits the same reference twice through the native
batch form. That response supplies an exact barcode, the current scan and a history
count. A single-reference query then supplies full history. The adapter requires
the count and current scan to agree across both replies before accepting history.
The browser completes the portal's automatic verification; interactive challenges
remain failures. No account, saved browser profile or recipient details are used.

## Notes

The batch clock includes seconds, while full history has minute precision. Matching
uses that shared precision. All offsetless scan clocks remain local, including
foreign scans, and retain native order. See [ROUTING.md](../../../../docs/ROUTING.md)
for unresolved history handling. A return decision starts a separate leg; later
transport remains active until a delivery scan completes that leg.

## Limitations

Retrieval needs `TRACKING_CHROMIUM_PATH`. Multiple-piece shipments, count changes
between requests and conflicting current scans are inconclusive. The portal's
not-found reply omits the barcode, so it cannot establish parcel absence. Delivery
and estimate dates are not inferred from local scan clocks or the query time.
The portal can refuse the browser's automatic verification. The lookup then fails
as a challenge and routing falls back to the universal providers.

## Testing

Run `npm run test:carriers:live -- packages/carriers/carriers/ukrposhta` with
`TRACKING_CHROMIUM_PATH` and `UKRPOSHTA_TRACKING_NUMBER` supplied outside the repository.
