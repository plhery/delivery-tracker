# Asendia notes

## Decisions

- **No `adapter.ts` in this folder.** `packages/carriers/scripts/generate-registry.mjs`
  resolves a carrier to its own folder as soon as `adapter.ts` exists, before it
  looks at `tracking.adapter`. Creating one here would silently move Asendia off
  the universal tier and onto a path that cannot run unattended. The module is
  called `probe.ts` for that reason, and `probe.test.ts` asserts
  `tracking.adapter === 'universal'` so the arrangement cannot drift.
- **Link plus universal.** Asendia parcels are saved with a link to
  `track.asendia.com` and synced through the universal providers. The portal is
  gated by Cloudflare Turnstile, which needs a human, so it is not a sync path.
- **The probe exists for the canary.** It reproduces the portal's public
  protocol far enough to prove the gate still behaves as recorded: a rejected
  token must come back as a challenge, not as "shipment not found". That
  distinction is the whole point — a Turnstile rejection reported as a 404 would
  make the routing layer back off for a day on a live parcel.
- **Fail before the network when no token is available.** `challengeToken()`
  validates the injected token's shape first, so a missing or malformed token
  never turns into three requests against the portal.
- **The checksum key is public, not a secret.** `NEXT_PUBLIC_BRANDED_HIT_KEY` is
  served to every browser by `__env.js` and rotates with a frontend deployment.
  It is read at lookup time rather than pinned, and the value in the test exists
  only to make the SHA-256 token deterministic.
- **Map harmonized wording, not the harmonized code.** The same numeric code has
  appeared with different harmonized wording across subsidiaries, so the code is
  retained as `provider_code` for review but never decides a stage.
- **`isoTime` then `zonedTime`.** Scan stamps arrive as ISO strings with or
  without an offset, or in one of the portal's display formats. `isoTime` keeps
  a supplied offset and reads offset-less values in Europe/Zurich; the display
  formats fall through to `zonedTime` in the same zone. Nothing is guessed as
  UTC.

## Rejected alternatives

- **Solving Turnstile automatically.** Out of scope and against the portal's
  terms; the token must come from an approved interactive flow.
- **Treating the Turnstile rejection as a not-found.** It is a challenge, and
  reporting it as anything else corrupts both the canary and the routing
  backoff.
- **Claiming the S10 numbers Asendia moves.** They are issued by the partner
  post and the detection engine answers with that post. `numbers.json` records
  both cases with the source that attributes them to Asendia, so the
  disagreement stays visible instead of being papered over.
- **`textFromHtml` for the harmonized wording.** The portal embeds
  entity-encoded strings that Cheerio decodes fully and the regex helper does
  not, so the local `plainText()` keeps using Cheerio.

## Verification log

- 2026-08-30: public protocol inspected on `track.asendia.com`; tenant config,
  published checksum key and the Turnstile-gated search endpoint recorded.
- 2026-09-12: moved from `src/server/asendia.ts` to `probe.ts` in this folder;
  `src/server/asendia.ts` stays as a re-export stub pointing at the probe, with
  a comment explaining why the path is not `adapter.ts`.
- 2026-09-12: `AsendiaTrackingError` → `NotFoundError('Asendia')`;
  `AsendiaChallengeError` → `ChallengeError('Asendia', …)`, which changes the
  reported status from 503 to 403. Routing already classified both as a
  verification failure, once by status and once by the error name.
- 2026-09-12: payload errors (`__env.js`, tenant config, parcel selection) →
  `SchemaError`. Tracking-number and hit-token argument validation stay
  `TypeError`: they reject caller input, not a provider response.
