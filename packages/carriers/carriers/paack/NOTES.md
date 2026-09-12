# Paack notes

## Decisions

- **Read the embedded loader payload, not a second API.** The recipient page is
  a Remix app and ships its `routes/tracking.order` loader response inside
  `window.__remixContext`. One bounded GET therefore returns everything the page
  itself renders, with no undocumented API call and no extra round trip.
- **`redirect: 'manual'`.** A wrong number or postcode is answered with a 3xx
  back to the form. Following it would return a generic page; treating the 3xx
  itself as the answer makes the wrong-number path explicit and cheap.
- **Map identifiers, not labels.** `label` is a translation key and the page is
  localized per viewer, so both `id` and `label` are reduced to letters and
  digits and matched by substring. That keeps suffixed variants
  (`scannedAtOriginHeader`, `pudoAssignedHeader`) on the same stage.
- **Failure rules before delivery rules.** `notDelivered` contains `delivered`;
  testing the failure list first is what stops a failed parcel from being shown
  as delivered.
- **Scheduled returns are not `returned`.** `returnToSenderScheduled`,
  `returnAbsent` and `returnOther` describe a return that has been *planned*.
  They map to `failed_attempt` so the parcel stays active, and only
  `returnedToSender` / `returnedToRetailer` reach the terminal stage.
- **`activeEvent` wins when it is mapped.** The banner can be ahead of the
  timeline; when its identifier maps to a known stage it decides the result's
  status, while the timeline keeps its own per-event stages.
- **The postcode is a credential.** Half of the lookup key, treated like a
  tracking secret; `InputRequiredError` when it is missing.

## Rejected alternatives

- **Adding a detection rule.** Paack numbers are retailer order numbers with no
  stable shape; every publicly reported example in `numbers.json` either matches
  nothing or matches another carrier's rule. A rule here would cost precision
  everywhere else, so the carrier is chosen manually or through its link.
- **Keeping per-event `variables`.** They exist to interpolate the recipient's
  name, address and phone into localized sentences — exactly the fields
  PRIVACY.md forbids retaining.
- **Publishing the delivery window's start as `expected_delivery_from`.** The
  start and end describe one day's slot; only the end date is retained, and the
  window capability is not declared.
- **Using `core/time` for event stamps.** The loader mixes epoch seconds, epoch
  milliseconds and offset-bearing ISO strings in the same field, and the result
  keeps millisecond precision, which the core helpers deliberately suppress. The
  local helper stays, with a comment saying why.

## Verification log

- 2026-09-12: moved from `src/server/paack.ts` into this folder with its tests;
  Remix extraction, identifier verification and the status map unchanged.
- 2026-09-12: `PaackTrackingError` → `NotFoundError('Paack')`; payload and
  mismatch errors → `SchemaError`; the empty-body case → `IndeterminateError`.
  Order-number and postcode format errors stay `TypeError`: they reject user
  input, not a provider response.
- 2026-09-12: constructor takes an options object (`timeoutMs`, `fetcher`).
