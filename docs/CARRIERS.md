# Carrier support

Carrier integrations live in [`packages/carriers`](../packages/carriers/README.md):
one folder per carrier with its catalog entry, sample numbers, status
vocabulary, adapter, fixtures, tests and documentation. Start there:

- [Overview table and the add-a-carrier checklist](../packages/carriers/README.md)
- [Architecture and decisions](../packages/carriers/ARCHITECTURE.md)
- [The tracking-number corpus](../packages/carriers/CORPUS.md)
- [Universal providers: Ship24 → ParcelsApp → 17TRACK, Postal Ninja opt-in](../packages/carriers/providers/README.md)
- [Routing policy between direct adapters and providers](tracking-routing.md)
- [Scraper monitoring and metrics](scraper-monitoring.md)

Each carrier's README documents its portals, what is retrieved, its number
formats, how the adapter works, the observed status vocabulary, limitations,
implementation decisions, and a dated verification log in one place.

## Catalog

Carrier names, brand colours, timezones, portal links, required inputs,
capabilities and detection rules are defined once per carrier in
`packages/carriers/carriers/<id>/carrier.json`. `npm run contract:generate`
merges the folders into `contracts/openapi.json` (`x-carriers`), the generated
TypeScript and Swift contracts, the package catalog and registry, and the
iPhone's offline catalog; `/api/carriers` publishes the same data for native
refreshes. Editing `x-carriers` by hand is undone by the next run.

Broad numeric formats are suggestions the user confirms; distinctive families
and checksum-valid UPU S10 identifiers select a carrier automatically. Every
rule is backed by sample numbers with their evidence and source, and the
detection sweep fails on undeclared overlaps between carriers. The native app
replays the same golden file so the Swift port cannot drift.

## Tests

The regular suites use scrubbed fixtures and never reach a carrier:

```bash
npx vitest run --config vitest.server.config.ts packages/carriers
```

Opt-in live probes send validly shaped, deliberately wrong numbers through
every adapter and expect each provider's clean not-found answer (or its
documented challenge). Real parcel numbers come from environment variables and
are never committed:

```bash
npm run test:carriers:live
```

The rendered tracking pages linked from the UI are checked separately, with
synthetic numbers, by `npm run test:tracking-links`. Each case in
`src/server/trackingLinkCases.ts` pins the final route and wording read from
the live page and requires the page to look up, display or prefill the number,
or give the carrier's specific not-found answer. A unit test requires every
carrier with its own adapter, or without automatic tracking, to have a case for
its link or a recorded reason in `uncheckedTrackingLinks`.

The daily carrier-canary workflow runs the wrong-number probes that need no
private input (`npm run test:carriers:canary`, with Chromium so the Ship24 form
scraper runs too), the rendered-link checks, and a reachability probe of each
distinct `canaryUrl` of the automatic carriers, where a 404, 410 or 5xx fails.
Each job's summary lists every failed check and every inconclusive one (a
challenge or bot block, which is not a pass). A failing run on `main` opens or
updates a single "Daily carrier canary failures" issue, commenting only when the
set of failing checks changes, and a clean run closes it.

`src/server/fixtures/auditedTrackingHistory.json` holds 129 reviewed
provider-description cases (no numbers, timestamps or locations) replayed
through the sync's stage classification, plus generated translations in four
languages; `npm test` runs them. Unmapped wording seen in production is
collected for review in `tracking_status_observations` (see
[OBSERVABILITY.md](OBSERVABILITY.md)).

## Public sample checks

Dated checks against public examples, kept here because several carrier READMEs
cite them:

| Date | Provider | Public source and sample | Observed result |
| --- | --- | --- | --- |
| 2026-09-08 | Hermes Germany | Paketda Hermes forum, `39181147009513` | Five dated events, delivered to a neighbour July 7. |
| 2026-09-08 | GLS Germany | Paketda GLS forum, `28286849236` | Explicit retired/not-found response (`E000`, HTTP 404). |
| 2026-09-08 | Delivengo | Philaseiten public postal example, `LD156008025FR` | Old May 2023 example; access error, not usable history. |
| 2026-09-08 | Unknown → ParcelsApp | Reddit AirReps discussion, `YT2621200705470145` | 32 events through the real dispatcher; delivered August 17. |
| 2026-09-08 | Universal ambiguity | Reddit tracking discussion, `7321315927723857` | 17TRACK reported delivery August 31; ParcelsApp varied. |
| 2026-09-10 | Ship24 | Two public examples from the production container | 32 and 6 normalized events in 409 and 121 ms, one request each. |
| 2026-09-10 | Tracking links | All 11 stored carriers plus GLS, Cainiao and ParcelsApp | Seven routes passed headless checks; seven unverified by bot protection; interactive checks confirmed the rest. |
