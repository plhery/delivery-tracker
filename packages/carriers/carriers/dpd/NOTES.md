# DPD notes

## Decisions

- **The guest JSON protocol is the primary tier, not the page.** It returns
  codes, a delivery window, the sender and the pickup point; the rendered page
  returns prose only. Everything the app shows beyond a status line comes from
  the API tier.
- **Firebase values are shipped in the application, so they live in the code.**
  The project number, application id, package name, signing certificate hash and
  API key are public, app-restricted identifiers taken from the myDPD Android
  build. `DPD_FIREBASE_API_KEY` can override the key without a release.
- **The postcode is optional, and a rejection is not a failure.** DPD answers
  HTTP 400 when the supplied postcode does not match. The lookup retries once
  with `continueWithoutVerification=true` and reports
  `dpd_postcode_verified: false` instead of failing, so a parcel with a wrong
  postcode still shows progress.
- **A 404 on the details call is a positive not-found.** It ends the lookup and
  never falls through to the page; 404s raised earlier in the token chain are
  ordinary guest-API failures and do fall through. That distinction is what the
  "does not misclassify an authentication-stage 404" test protects.
- **Step ids are `direct` and `page`.** Before the move the recovery phase was
  reported as `trawl` when `FLARESOLVERR_URL` was set and `page` when it was
  not, for the same tier doing the same work. It is now always `page`; the
  Sentry "Scraper Health" dashboard sees one label for one tier.
- **`DPDAPIError` is an `IndeterminateError`, including its HTTP subclass.**
  Every guest-API failure — unreachable, malformed JSON, an unexpected status —
  is inconclusive about the parcel, and the page tier is allowed to recover from
  it. This deliberately keeps a guest-API HTTP 429 inconclusive rather than
  rate-limited, because the page tier answered those before the move and still
  should.
- **The token refresh uses `singleFlight()`** instead of the hand-rolled
  promise handle, so two concurrent lookups through one adapter instance cannot
  both refresh the guest credential.
- **Local `clean()` is kept.** The guest API mixes strings and numbers in the
  fields we project, so `core/transport`'s string-only `clean` would silently
  turn a numeric city or code into an empty string.

## Rejected alternatives

- **Making the rendered page the only tier.** It has no codes, no delivery
  window, no sender and no pickup point, and it is behind Cloudflare, so it
  would cost more and return less.
- **Requiring the postcode.** Most parcels resolve without it; making it
  mandatory would block lookups for a marginal gain in detail.
- **Mapping `IN_TRANSIT` and friends to an `in_transit` stage.** They say the
  parcel moved, not which milestone it reached. Leaving them unmapped lets the
  sync's classifier record the wording for review rather than inventing a
  milestone (ARCHITECTURE.md, "map too little rather than wrongly").
- **Dropping `receiverName` from the pickup-point fallback.** It is the
  parcelshop name in the collection case, and it is only read while the stage is
  `ready_for_pickup`, after two operational fields. Removing it would lose the
  pickup point for payloads that only fill that field.

## Verification log

- 2026-09-10: tracking-link audit confirmed the consignee page and the guest
  "not assigned" response for a synthetic number (docs/CARRIERS.md).
- 2026-09-12: moved to `packages/carriers/carriers/dpd`. `RangeError` for a
  mismatched parcel became `SchemaError`, the plain `Error` for a non-OK page
  became `IndeterminateError`, and the "configure FLARESOLVERR_URL" `RangeError`
  became `DPDChallengeError` with the same message. `DPDTrackingError`,
  `DPDAPIError` and `DPDChallengeError` keep their names and now extend
  `NotFoundError`, `IndeterminateError` and `ChallengeError`.
- 2026-09-12: the browser-service call goes through `TrawlClient.solve()`, whose
  transport allowance is 15 s rather than the previous 10 s on top of the
  request timeout. The `maxTimeout` sent to the service is unchanged.
