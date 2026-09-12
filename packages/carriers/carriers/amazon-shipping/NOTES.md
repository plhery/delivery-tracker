# Amazon Shipping notes

## Decisions

- 2026-09-10: require positive evidence before treating a number as Amazon
  Shipping. Only a structured `SWA` or `MCF` response promotes a parcel from
  `amazon-logistics`; a generic page, an empty body or a status string alone is
  a not-found. The formats are shared, so an optimistic guess would show an
  account-only Logistics parcel as publicly trackable and then never update.
- 2026-09-10: keep the eligibility probe in the host
  (`src/server/amazonShippingEligibility.ts`). It reports through the host's
  observability and raises host `HttpError`s, neither of which belongs in this
  package; it reaches this adapter through `src/server/amazonShipping.ts`.
- 2026-09-10: treat `SHIPMENT_OLDER_THAN_SUPPORTED_AGE` as its own outcome
  rather than a not-found or an empty success. The shipment exists, the history
  is gone, and the placeholder `IN_TRANSIT` summary that comes with it must not
  become a scan.
- 2026-09-10: drop offset-free event times for `TBA` numbers. A US number
  identifies no country, so there is no zone to read them in, and stamping UTC
  would move every event by hours.
- 2026-09-10: read only city, region and country out of the event `location`
  object; the same object carries the street and the postcode.
- 2026-09-12: `AmazonShippingNotFoundError` now extends `NotFoundError` and
  keeps its name and 404 status. `AmazonShippingHistoryExpiredError` now extends
  `IndeterminateError` and keeps its name and message; the host narrows on both
  with `instanceof`, in `amazonShippingEligibility.ts` and in `trackingSync.ts`.

## Rejected alternatives

- Mapping `AmazonShippingHistoryExpiredError` to `NotFoundError`: it would give
  the error a 404 status, and the host's `isUnannouncedTrackingError()` treats
  any 404 as "not announced yet", which is the opposite of what this means. The
  `indeterminate` kind keeps it out of that bucket; note that it does now carry
  a 502 status it did not have before, which is metadata only.
- Falling back to a universal provider when Amazon says not found: Amazon is the
  only source for these numbers, so a fallback would only add latency and noise.
- Keeping the Amazon number pattern in this folder: it lives in
  `amazon-logistics`'s detection rule and is read from the generated catalog by
  `core/detection/amazon`, so the two folders cannot disagree.
- Using a `core/time` helper for event times: the tracker mixes ISO-8601,
  RFC 2822 and US long-form dates ("Aug 11, 2026, 4:31:56 PM"), and the nullable
  zone has to reject rather than stamp. The local helper documents that.

## Verification log

- 2026-09-10: unknown id returns HTTP 200 with `TRACKING_ID_NOT_FOUND`;
  retention limit returns `SHIPMENT_OLDER_THAN_SUPPORTED_AGE` with a placeholder
  `IN_TRANSIT` summary.
- 2026-09-10: regional portal mapping confirmed for `IT`, `ES`, `UK`/`GB`, `TBA`
  and the French fallback.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  parsed result is the one asserted before the move, field for field.
