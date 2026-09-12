# UPS notes

## Decisions

- Read the page's own `GetStatus` endpoint rather than the rendered HTML: it
  returns the whole scan history as JSON, where the page carries only the
  current status.
- Keep the cookie jar in memory and reuse it across lookups. Establishing a UPS
  session is the expensive part; the structured call afterwards is cheap.
- One refresh, then drop. A rejected cached session is given exactly one page
  fetch to recover; a second rejection means the session is dead, not slow.
- Serialize lookups through the adapter instance. The jar and the XSRF token are
  shared state, and two lookups refreshing them at once produce a session that
  belongs to neither.
- 2026-09-12: `UPSSessionRejected` stays a distinct class because the adapter
  itself reacts to it — refresh once, then drop the session — and it now extends
  `ChallengeError`, so routing treats a rejected session as a verification
  problem rather than a schema problem.
- 2026-09-12: the "configure FLARESOLVERR_URL" failure became a `ChallengeError`
  with the same message. It is what it always was: UPS asking for a browser we
  do not have.
- 2026-09-12: the two tiers became `runSteps` with the ids `direct` and `trawl`,
  the ids the existing dashboards already use. The cached session, its one
  refresh and a fresh session are all inside `direct`: they are the same plain
  HTTP transport, not separate tiers.
- 2026-09-12: the rendered-page parse stays inside the `trawl` step, as before,
  plus the no-browser-service case where the direct page is all there is.

## Rejected alternatives

- Calling `GetStatus` without first loading the tracking page: it answers 401
  without the cookies the page sets.
- Treating an HTTP 404 from the page or the API as a not-found: neither proves
  the shipment is absent, and it would put a day-long cooldown on a lookup that
  a browser can still answer. They stay indeterminate.
- Parsing the rendered page as the primary path: it has no history, so every
  sync would see one event and never a timeline.
- Pinning a browser user agent: the browser step seeds the session with the user
  agent the service actually used, because the cookies were issued to it.

## Verification log

- 2026-09-10: public tracking page checked interactively; direct anonymous
  access is subject to an Akamai challenge.
- 2026-09-10: the live wrong-number canary accepts only a privacy-safe
  no-result or the exact recognized browser-challenge error.
- 2026-09-12: moved to `packages/carriers/carriers/ups/`. Behavior is unchanged
  apart from the error classes above, and one consequence worth naming: the
  host's current `routingFailure()` looks for `TypeError` / `RangeError`, so a
  `SchemaError` is classified as `transport` (15-minute cooldown) instead of
  `schema` (one hour). It disappears once routing classifies with
  `carrierErrorKind()`.
- 2026-09-12: `src/server/browserProtectedCarriers.live.test.ts` still expects
  `name: 'RangeError'` for the missing-browser-service case. That file is owned
  by the grouped live suite; its expectation now needs to be `ChallengeError`.
