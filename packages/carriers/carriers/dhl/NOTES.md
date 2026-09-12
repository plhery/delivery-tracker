# DHL notes

## Decisions

- 2026-09-07: use the public recipient flow (`/int-verfolgen/data/config` then
  `/search`) with DHL's own `verfolgen-CSRF-token` and `verfolgen-wg` headers,
  rather than the business API, which needs credentials we do not have.
- 2026-09-07: a rejected or expired session, and an interrupted read, get one
  fresh HTTP session before a browser is used; a fresh session that is
  rejected outright goes straight to the browser. Rate limits and server
  errors stay errors — a browser would only hide a provider problem.
- 2026-09-10: the destination operator's link in the arrival event is trusted
  only for the exact hosts `post.ch`, `www.post.ch` and `service.post.ch`; a
  lookalike host (`www.post.ch.evil.example`, a `@`-userinfo URL, a `next=`
  parameter) must not produce a Swiss Post handoff.
- Timestamps are kept verbatim: DHL sends its own offset, and the delivery
  window is a calendar day. `core/time` only validates them in
  `Europe/Berlin`, so the strings the user sees are the strings DHL published.
- A forecast ("will be delivered", "wird … zugestellt") keeps the structured
  progress fallback. Mapping it to `delivered` would announce a delivery that
  has not happened; mapping it to `registered` would undo real progress.
- 2026-09-12 (move): the session renewal stays inside the `direct` step
  instead of becoming its own step id. A separate id would have shown every
  routine session renewal as a fallback in the Sentry dashboard, while
  `docs/scraper-monitoring.md` documents DHL as recording `direct` and
  `trawl`.
- 2026-09-12 (move): `DHLSessionError` now extends `ChallengeError`, so
  routing and telemetry classify it through `carrierErrorKind` instead of the
  class name. It keeps its name and message.

## Rejected alternatives

- Deutsche Post's business tracking API: needs contractual credentials for a
  flow the recipient page already exposes publicly.
- Reusing a browser session for every lookup: the HTTP session is cheap and
  survives; the browser service is only worth its cost when DHL refuses the
  plain session.
- Treating an empty or unmatched `sendungen` array as "no data yet": DHL
  answers with explicit `sendungNichtGefunden` flags, so anything else is a
  payload problem and is reported as one.
- Deriving the stage from `fortschritt` alone: the progress index moves for
  reasons the wording explains better; it is only used as the fallback for an
  unmapped summary (`fortschritt <= 1` means the parcel is still announced).

## Verification log

- 2026-09-07: public session flow and the one-renewal recovery path
  automated.
- 2026-09-10: Swiss Post handoff links observed in arrival events; host
  allowlist confirmed against lookalike URLs in the offline tests.
- 2026-09-12: moved to `packages/carriers/carriers/dhl`. The browser call now
  goes through `core/transport`'s `TrawlClient.scrape`, which additionally
  requires the solved page body, so a malformed browser answer raises
  `TrawlError` instead of `DHLSessionError`.
