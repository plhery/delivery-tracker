# Canada Post

Tracks parcel PINs and Canadian postal numbers through the public tracking application's anonymous JSON service. Delivery-notice and numeric reference lookups resolve one parcel PIN before retrieving its history.

## How retrieval works

A PIN lookup reads the detail response directly. An alias lookup first requires one exact returned reference and its PIN, then checks the detail response against that PIN. The public application's empty Basic credential is sufficient; no session or browser is required. Both requests share one bounded deadline.

## Decisions and limitations

Scan clocks use their supplied offsets. Missing offsets retain local clocks, while malformed clocks retain their original labels. Unresolved rows preserve source order and cannot lend an older timestamp to the current status.

Return flags establish a return journey rather than completed sender delivery. Conditional collection notices keep their pickup meaning. Movement remains movement throughout a return journey, and outbound delivery estimates are suppressed.

Delivery time comes from the matching delivery scan. Attempt dates and signature availability cannot substitute for it. A delivered summary without a matching current delivery scan is retained as an undated snapshot.

Empty history, expired history and ambiguous references remain inconclusive. Reference results requiring a postcode or containing several parcels are not selected automatically. Output excludes addresses, signatories, signatures, images and service options.

## Live test

Run `npm run test:carriers:live -- packages/carriers/carriers/canada-post` with `CANADA_POST_LIVE_TRACKING_NUMBER` supplied outside the repository. `CANADA_POST_LIVE_NOTICE_NUMBER` optionally exercises delivery-notice resolution.
