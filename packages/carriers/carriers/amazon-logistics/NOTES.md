# Amazon Logistics notes

## Decisions

- 2026-09-10: keep this carrier link-only. Retail Amazon Logistics tracking is
  behind the customer's Amazon account; there is no anonymous endpoint to call,
  and asking users for Amazon credentials is not something this app does.
- 2026-09-10: resolve the shared number format here first, then let the Amazon
  Shipping check promote a parcel to `amazon-shipping`. Guessing the other way
  round would present an account-only parcel as publicly trackable.
- 2026-09-10: hold the Amazon number pattern in this folder's single detection
  rule and read it from the generated catalog, so `amazon-shipping`,
  `core/detection` and the native clients all use one pattern.
- 2026-09-12: folder given a README and these notes while the `amazon-shipping`
  adapter moved into its own folder. No behaviour changed here.

## Rejected alternatives

- Scraping Your Orders with a stored session: it would mean holding the user's
  Amazon credentials or cookies, which this app does not do.
- Routing these numbers through a universal provider: the aggregators need the
  same account access, so the lookup fails and only adds latency and noise.
  Sync marks the parcel unsupported instead.
- Giving the carrier its own number pattern: the format is genuinely shared with
  Amazon Shipping, and two copies would drift.

## Verification log

- 2026-09-10: confirmed that sync marks Amazon Logistics parcels unsupported
  without calling direct or universal trackers, including numbers that were
  previously misclassified.
- 2026-09-12: no code in this folder; carrier.json enriched with region and
  portal facts only.
