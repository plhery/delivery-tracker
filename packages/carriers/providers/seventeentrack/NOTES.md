# 17TRACK notes

## Decisions

- **Keep the captured browser lookup (2026-09-10).** Unsigned direct POST probes
  returned HTTP 200 with rejection codes `-14` on the current endpoint and `-10`
  on the legacy one, not history. The maintained multi-carrier integration found
  in the same review uses an API key, and the newer JavaScript client requires a
  login, so the browser capture stays.
- **Pinned compatibility build required.** TRAWL 1.3.1 ignores capture requests;
  stock 1.5.0 refuses compressed bodies and can finish before polling completes.
  The compatibility build captures the browser-decoded JSON and waits through
  code 100 for a final matching reply (`ops/trawl`).
- **Rejection codes are typed, not generic failures.** `-11`, `-13` and `-14`
  mean an interactive verification is required (a challenge), a shipment code of
  100 means the lookup is still polling, and anything else means the lookup is
  unavailable. Routing needs that distinction for its cooldowns, and Sentry
  keeps `reason` and `providerCode` for triage.
- **A structured failure survives the capture loop.** The newest readable body
  wins; when none parses, the last typed lookup failure is thrown instead of a
  generic "no history", so a verification wall is never reported as an empty
  capture.
- **Capture failures are distinguished.** `capture_missing`,
  `capture_unreadable` and `history_missing` say whether the browser service can
  capture at all, could not read what it captured, or captured replies without
  history. They prove nothing about the shipment and are classified as
  indeterminate.

## Rejected alternatives

- **The 2019 anonymous endpoint** (`kamushadenes/tracker17`, revision
  `6d87ce4`): historical, superseded by the current rejection codes.
- **The account-based client** (`mderazon/seventeen-track-js`, revision
  `b8000c9`): requires sign-in and the buyer API.
- **An API key integration** (`TA2k/ioBroker.parcel`, revision `3c4fb0e`): a
  useful reference, but its 17TRACK route needs a provisioned key.
- **Making this provider first in the chain.** It stays last; Ship24's verified
  sub-second direct lookups lead the order.

## Verification log

- 2026-09-10: direct probes and prior implementations reviewed; browser capture
  retained. Live verification returned seven events for a public example.
- 2026-09-10: a provider code 400 with no history observed as an explicit lookup
  failure, not an empty shipment.
- 2026-09-12: moved into `packages/carriers/providers/seventeentrack`; the
  capture now goes through the shared `TrawlClient`, reports a `trawl` step, and
  its browser transport allowance is the client's standard 15 s instead of the
  previous hand-written 5 s.
