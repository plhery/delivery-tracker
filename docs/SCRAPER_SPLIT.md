# Scraper split plan

Temporary. This is the plan for moving the carrier scrapers into their own repository. It
describes work that hasn't happened yet. The commit that finishes the split deletes this file.

## Goal

Two public repositories:

| Repository | Holds | Ships |
| --- | --- | --- |
| `plhery/universal-delivery-scraper` (new) | Carrier catalog, detection, adapters, universal providers, status vocabulary, TRAWL build, canaries | npm package `universal-delivery-scraper` (library, CLI, HTTP server), images `ghcr.io/plhery/universal-delivery-scraper` and `ghcr.io/plhery/universal-delivery-scraper-trawl` |
| `plhery/delivery-tracker`, renamed `plhery/universal-delivery-tracker` | Web app and PWA, API, sync worker, Supabase, iPhone app | The app container, deployed as today |

It's "scraper" with one p: a "scrapper" is a fighter. The npm name `universal-delivery-scraper`
is free.

## Decisions

### 1. A library, used in-process by the app

The app installs `universal-delivery-scraper` at an exact version and calls it in its own Node
process, as it calls `packages/carriers` today. A service between the two would cost more than
it gives:

- [`trackingRouting.ts`](../src/server/trackingRouting.ts) asks one source at a time with its
  own budget and abort signal, asks carriers to recognize numbers, and receives every step's
  telemetry through a `StepRecorder`. An HTTP boundary would have to expose all of that, and
  add a network hop, a second deploy to keep in step and a new way to fail.
- Nothing needs to scale separately. The expensive part, the browser, already runs in its own
  container (TRAWL).
- An exact version in `package-lock.json` makes each scraper update an ordinary commit: tested
  by the app's CI, deployed like any change, rolled back with a revert.

### 2. The same package also ships a CLI and an HTTP server

For everyone who can't import a Node library: Home Assistant (Python), other languages, shell
scripts, a one-off tracking page.

- `npx universal-delivery-scraper track <number>` prints the result as JSON.
- `universal-delivery-scraper serve` starts a small stateless HTTP API. The image
  `ghcr.io/plhery/universal-delivery-scraper` is that command plus Chromium, for amd64 and
  arm64 (Raspberry Pi Home Assistant hosts).
- One package, one version, one release. The app doesn't use the server.

### 3. The boundary

The scraper answers "what does this parcel look like right now?" and keeps no state. The app
decides which parcels to check, when, for whom, and what changed.

| Scraper | App |
| --- | --- |
| Carrier catalog (`carrier.json`), sample numbers, status evidence | Accounts, parcels, Supabase, RLS, quotas |
| Detection from numbers, links and email text; recognition | Add sheet, carrier pickers, the Swift port of detection (it replays the scraper's golden file) |
| Adapters, universal providers, transport, TRAWL client, step runner, error taxonomy | Sync queue, worker, scheduler, per-parcel routing state |
| Stage vocabulary, status maps, wording classifier, result normalization, event time resolution | Event persistence and identity, UPU archive, notifications, Live Activities |
| Handoff proposals, input validation, universal provider order from coverage results | Which handoff to adopt, affinity, shadow checks |
| `StepRecorder` interface and metric names | Sentry, Prometheus, logs, audit tables, health incidents, dashboards |
| Places gazetteer (scan text to map place) | Map, stamps, passport, friends, app copy and translations, brand palettes and truck decals |
| TRAWL build, daily canaries, coverage probe | Deploying the app and the production TRAWL |

Rule of thumb for new code: if it needs a database row, a user or the history of past checks, it
belongs to the app.

### 4. Retries: within one lookup in the scraper, across lookups in the app

Knowing how to talk to a carrier travels with its adapter. Deciding when to talk to it again
depends on persistence, scale and users, so each consumer owns it: the app, and later Home
Assistant. They meet through data, not behaviour: typed error kinds, `retryAfterMs`, and the
limits a carrier declares in its catalog entry.

| Rule | Owner |
| --- | --- |
| Steps (`direct`, `retry`, `refresh`, `page`, `trawl`, `browser`), one budget per lookup, abort signals | Scraper |
| One transient retry honouring a `Retry-After` of up to a minute; serialized session renewal (`singleFlight`) | Scraper |
| Universal provider order from coverage results, per-provider budgets, China Post `C…CN`/`L…CN` through 17TRACK first, UPU last | Scraper (evidence about providers) |
| Turning an error into a failure kind and a retry delay (today in `routingFailure`) | Scraper, exported as `failureHint(error)` |
| Backoff per failure kind (15 min to 6 h, 1 h to 6 h, 24 h), the 429 freshness window | App |
| Refresh cadence (Europe/Zurich daytime, out for delivery every 2 min, quiet parcels hourly) | App |
| Affinity, discovery cursor, shadow checks, recognition retry schedule | App |
| Provider leases and cooldowns shared between workers (`tracking_provider_health`) | App |
| Carrier limits: GLS at most hourly and 4 h after a failure, PostNL every 30 min | Declared in `carrier.json` (`tracking.refresh`), applied by the app |

### 5. The contract

Semver covers the exported API, the `CarrierResult` shape, error kinds, the stage vocabulary,
carrier ids, universal source names (`Ship24`, `ParcelsApp`, `17TRACK`, `Postal Ninja` and
`UPU` are stored in the app's database), and the `carrier.json` and published catalog schemas.

- Patch: fixes, status mappings, sample numbers.
- Minor: a new carrier, provider, result field or export.
- Major: renaming or removing any of the above. Stages and ids are never renamed in place, and a
  new stage is major because the app's database constrains stages.
- Installed iPhone apps read the published catalog from `/api/carriers`, so its shape only
  grows, and a new detection feature (a checksum type, a rule field) must be safe to ignore for
  an engine that doesn't know it.

Publish `0.x` while phases 1 to 4 settle the API, and `1.0.0` when the README is announced.

### 6. Every scraper release redeploys the app

```text
scraper main --CI--> release.yml --> npm (provenance), GHCR images, git tag
                                 \-> repository_dispatch "scraper-released" {version}
app scraper-update.yml --> install the version, regenerate contract and iOS resources
                       --> the server checks --> (TRAWL redeploy if its image changed)
                       --> push to main --> Coolify deploys; the full CI runs on that commit
                       \-> on failure: open or update one "Scraper update failed" issue
```

Patch and minor releases land by themselves. A major release opens the issue for a person,
because it can need app code or a migration. Details in phase 3.

### 7. The database accepts any catalog carrier without a migration

Today every new carrier needs a migration: `packages_carrier_check` and the owner functions
`create_owned_package` and `change_owned_package_carrier` list every carrier id and hard-code
per-carrier postcode and URL rules (see
[the latest version](../supabase/migrations/20260926170000_optional_dpd_postcode.sql)). After the
split, that would stop every release that adds a carrier. Phase 0 replaces the lists with a
table the server fills from the installed catalog.

### 8. Aggregators are opt-in outside the app

ParcelsApp, Ship24, 17TRACK and Postal Ninja are commercial services whose websites the
providers read like a browser. The app enables them explicitly. The library, CLI and server leave
them off unless configured (`providers: ['ParcelsApp', …]`, `UDS_PROVIDERS`). UPU, an official
public API, can stay on. A public package that reads paid services' free trackers by default
invites blocking and takedown requests that would hit the app too. Without them, coverage drops
(see the measured numbers below). This is the owner's call; settle it before phase 4.

## Couplings to cut first

All found in the current code.

| Coupling | Where | Fix in phase 0 |
| --- | --- | --- |
| The package's catalog and `STAGES` are written by the app's contract generator | [`generate-api-contract.mjs`](../scripts/generate-api-contract.mjs) writes `packages/carriers/generated/catalog.ts`, taking `STAGES` from `contracts/openapi.json` | The package generates its catalog and owns the stage list; the app's generator reads them from the package |
| Region towns are generated from the app's gazetteer | [`generate-region-towns.mjs`](../packages/carriers/scripts/generate-region-towns.mjs) reads `src/server/places/places.tsv.br` | Move [`src/server/places`](../src/server/places/README.md) and `scripts/generate-places.mjs` into the package |
| `import 'server-only'`, which fails outside Next.js | 50 package files | Remove it. Entry points keep browser-safe code apart from Node code, and the app keeps its own guard in `src/server` |
| Adapters read `process.env` | `FLARESOLVERR_URL` in 8 adapters, `DPD_FIREBASE_API_KEY`, `ASENDIA_TURNSTILE_TOKEN`, `TRACKING_CHROMIUM_PATH` in `core/transport/browser.ts`, fallbacks in `providers/universal.ts` | Read only [`AdapterEnvironment`](../packages/carriers/core/adapter/index.ts) (`env`, `trawl`, `browserExecutablePath`) |
| A worker path relative to the app's working directory | [`correios-br/ocr.ts`](../packages/carriers/carriers/correios-br/ocr.ts) | `new URL('./ocr-worker.mjs', import.meta.url)` |
| Heavy dependencies load with the registry | Static imports of `playwright-core` (`core/transport/browser.ts`, `ukrposhta`, `yunexpress`) and `sharp` (`yunda/challenge.ts`) | Dynamic `import()` in the step that needs them; optional peer dependencies |
| The app imports carrier folders | `amazon-shipping/adapter` (errors, eligibility), `dachser/adapter` and `planzer/shared` (URL validators), parsers in `src/test/replayTrackingHistory.ts` | Public API for input validation and a documented error `reason`; the tests move to the scraper |
| Scraper logic in the app | [`eventTime.ts`](../src/server/eventTime.ts); `resultStage`, `resultHasUpdate`, `stageSource` and `classifyStage` in [`trackingSync.ts`](../src/server/trackingSync.ts); [`carrierRecognition.ts`](../src/server/carrierRecognition.ts); [`carrierHandoff.ts`](../src/server/carrierHandoff.ts); `normalizeCarrierInputs` in [`carriers.ts`](../src/server/carriers.ts); the classification in `routingFailure`; the adapter dispatch in `CarrierTrackingAdapter` | Move into the package with their tests |
| Carrier facts hard-coded in the app | `SLOW_POLL_CARRIERS` and PostNL's 30 min in `trackingSync.ts`; the 41 local-clock carriers in [`directLocalHistory.ts`](../src/server/directLocalHistory.ts) | `carrier.json` fields `tracking.refresh` and `tracking.localClocks` |
| App design in the package | `core/brand` (palettes, truck, decals); `brand.palette`, `brand.decal` and `brand.family` in `carrier.json` | Move to the app; the catalog keeps `brand.color` |
| Carrier and provider lists in SQL | `packages_carrier_check`, the owner functions, the `tracking_provider_health` provider check | A `public.carriers` table synced at startup (decision 7) |
| Deep imports through the `@carriers/*` alias | `tsconfig.json`, three vitest configs, about 60 module paths | Named entry points and a lint rule against deep imports |

## The scraper repository

```text
universal-delivery-scraper/
  core/        detection, catalog, status, result, time, errors, transport, runner, telemetry, recognition
  carriers/    one folder per carrier, unchanged
  providers/   universal providers, coverage.json
  places/      gazetteer and placesForEvents
  facade/      createTracker(), the stateless one-call policy       (phase 4)
  server/      the HTTP API behind `serve`, openapi.json            (phase 4)
  cli/         detect, track, recognize, carriers, serve            (phase 4)
  trawl/       TRAWL browser build (today ops/trawl)
  data/        generated JSON: catalog.json, stages.json, detection-golden.json, carrier.schema.json
  generated/   generated TypeScript, never edited by hand
  scripts/     new-carrier, generators, coverage probe, canary
  examples/    Node usage, Home Assistant REST sensor, one-off page
```

The package's current layout becomes the root, so history and links stay readable.

### Entry points

| Import | Runs in | Contents |
| --- | --- | --- |
| `universal-delivery-scraper` | Browser and Node, no I/O | Catalog, detection, recognition candidates, stages and wording classifier, result types, `normalizeCarrierResult`, `resolveResult`, time helpers, error kinds and `failureHint`, handoff proposals, input validation, `universalPlan` |
| `universal-delivery-scraper/node` | Node | `AdapterRegistry` with the generated registry, universal providers, TRAWL client, local browser, `runSteps`, `StepRecorder`, `createTracker` |
| `universal-delivery-scraper/places` | Node | The gazetteer, loaded on first use |
| `universal-delivery-scraper/data/*` | Anywhere | The JSON files above |

The app's browser code imports only the first. Nothing outside the package imports
`carriers/<id>/…`. `universalPlan` and the coverage tiers move out of `providers/universal.ts`
into a module that imports no provider.

Build with `tsc` into `dist/`, without a bundler, so the `import.meta.url` paths to the OCR worker,
its model and the gazetteer keep working; copy those files next to the output. Publish
JavaScript, since Node won't strip types inside `node_modules`. Test on Node 24 (LTS) and 26.

Dependencies: `luxon`, `cheerio`, `tough-cookie`, `fetch-cookie`. Optional peers:
`playwright-core`, `sharp`, `onnxruntime-web`. A step whose optional dependency is missing fails
with a `transport` error that names it, and the lookup moves on.

### Facade

For consumers without a router of their own:

```ts
const tracker = createTracker({ trawlUrl, chromiumPath, providers: ['ParcelsApp', 'Ship24'], recorder });
tracker.detect(text);            // { number, carrier?, candidates, confidence }
await tracker.recognize(number); // { carrier?, choices, asked, unanswered }
await tracker.track({ number, carrier, postcode, trackingUrl }, { signal, budgetMs });
// -> { carrier, source, result, attempts, handoff? }, result with resolved stages and instants
// throws TrackingError { attempts, hint: { kind, retryAfterMs } } when no source answered
```

One call tries the carrier's adapter, then recognition for an ambiguous number, then the
enabled universal providers in the carrier's coverage order, and confirms a proposed handoff
once. Nothing is stored. It is built from the primitives the app's router uses (`universalPlan`,
`recognizeAll` and `settleRecognition`, `deliveryHandoff`), which stay public. A change to the
order or to recognition goes into those primitives, so the two callers can't drift apart.

### HTTP server

- `GET /v1/carriers`, `POST /v1/detect`, `POST /v1/recognize`, `POST /v1/track`, `GET /health`,
  optional `GET /metrics`, described in `server/openapi.json`.
- Stateless. It caches each answer for the carrier's minimum refresh interval (default 10 min)
  and spaces calls per provider in memory, so several clients sharing it don't hammer carriers.
- Optional bearer token (`UDS_TOKEN`), a per-client rate limit, `FLARESOLVERR_URL` for TRAWL,
  `UDS_PROVIDERS` for aggregators.
- Postcodes and tracking URLs go through the catalog's validators, so the server never fetches
  a URL outside a carrier's declared hosts.
- Logs never contain tracking numbers, unlike the app's.
- Plain `node:http`: five routes don't need a framework.

## Phases

Each step lands on `main` with its docs, CI green and the app deployable. Phases 0 and 5
happen in this repository, 1 and 4 in the new one, 2 and 3 in both.

### Phase 0: decouple inside this repository

1. **Name and manifest.** Add `packages/carriers/package.json` (name `universal-delivery-scraper`,
   `type: module`, the dependencies above). Rename the alias `@carriers/*` to
   `universal-delivery-scraper/*` in every import, `tsconfig.json` and the three vitest configs.
   No behaviour change.
2. **Package hygiene.** Remove `server-only`, the `process.env` reads, the working-directory path
   and the static heavy imports listed above.
3. **Catalog and stages.** Move the projection that builds the published catalog (`x-carriers`)
   and the stage list into a package generator writing `generated/catalog.ts`,
   `data/catalog.json` and `data/stages.json`. The app's `generate-api-contract.mjs` reads them to
   write `x-carriers`, `CarrierId` and `Stage` into `contracts/openapi.json`, and
   [`generate-ios-resources.mjs`](../scripts/generate-ios-resources.mjs) reads
   `data/catalog.json` and `data/detection-golden.json`. The golden file moves there from
   `contracts/fixtures/`.
   Done when `npm run test:contract` and `npm run ios:resources -- --check` pass with no change to
   `contracts/openapi.json` or the iOS resources.
4. **Places.** Move `src/server/places/` and `scripts/generate-places.mjs` to
   `packages/carriers/places/`. `eventPlaces.ts` imports from there. Update the gazetteer's
   `outputFileTracingIncludes` entry in the same commit: without the file, parcels are served
   without places and nothing fails.
5. **Scraper logic out of `src/server`.** Move, with their tests: `eventTime.ts` to `core/time`;
   the stage helpers to `core/status`, plus a `resolveResult()` that fills each event's stage,
   stage source and instant; `carrierRecognition.ts` to `core/recognition`; `carrierHandoff.ts`
   to `core/catalog`; `normalizeCarrierInputs` to `core/catalog/inputs`, with coded errors the app
   turns into its messages; the classification half of `routingFailure` to `failureHint()`;
   `CarrierTrackingAdapter.fetch` to a `trackCarrier()` in the package. The backoff table and
   everything that reads routing state stay.
6. **Carrier facts into the catalog.** Add `tracking.refresh` (`minMinutes`,
   `afterFailureMinutes`) and `tracking.localClocks` to `carrier.schema.json` and the carriers
   concerned. The app reads them instead of `SLOW_POLL_CARRIERS`, the PostNL special case and
   `directLocalHistory`'s list.
7. **Brand out of the package.** Move `core/brand`, `generate-brand.mjs` and the decal sources to
   `src/brand/`, with an app file of palettes, decals and families keyed by carrier id. The schema
   keeps `brand.color`, and colour sources stay with the scraper.
8. **Carrier-specific errors.** Give Amazon Shipping's history-expired and not-found answers a
   documented `reason` on the standard error kinds, and expose its eligibility check through the
   public API, so `trackingSync.ts` and `amazonShippingEligibility.ts` stop importing the carrier
   folder.
9. **Tests and checks.** Move into the package: the adapter tests (`carrierAdapters`,
   `expandedCarrierAdapters`, `topCarrierAdapters`, `universalScrapers`, the parsers behind
   `src/test/replayTrackingHistory.ts`), every `*.live.test.ts`, `trackingLinkCases.ts`,
   `trackingLinkProbe.ts`, `carrierCanary.ts`, `scripts/canary-report.mjs`,
   `vitest.carriers-live.config.ts` and the commands of
   [`carrier-canary.yml`](../.github/workflows/carrier-canary.yml). The canary reads the package
   catalog, not `contracts/openapi.json`. Split mixed tests such as `trackingSync.test.ts` and
   `trackingRouting.test.ts`: the app's side uses recorded `CarrierResult` fixtures, never carrier
   parsers.
10. **Build and entry points.** Make the root an npm workspace. Build the package to `dist/`,
    publish the entry points above in `exports`, and drop the alias so the app consumes the build
    through the workspace link. Build the package before `dev` (in watch mode), `build`, `test` and
    `typecheck`. In [`next.config.ts`](../next.config.ts), add the package to
    `serverExternalPackages` and point `outputFileTracingIncludes` at its files in
    `node_modules`. Add a `no-restricted-imports` rule allowing only the entry points.
    Done when CI is green, `.next/standalone` contains the OCR model, its worker and the
    gazetteer, and `grep -r "universal-delivery-scraper/carriers/" app src` finds nothing.
11. **Database.** Independent of the rest; it can go first. A migration adds `public.carriers`
    (id, retired, and per-carrier postcode and tracking-URL patterns taken from the `carrier.json`
    inputs), points `packages.carrier` at it, and makes the owner functions check the table instead
    of their lists. The server upserts the rows from the installed catalog at startup, before the
    worker starts. Ids are retired, never deleted. Do the same for the provider names in
    `tracking_provider_health`. The functions must still re-validate everything: clients can call
    them directly through PostgREST. Put the rollout order in the commit message.
    Done when a test adds a carrier to the catalog on a disposable database and creates a parcel
    for it without a migration.

### Phase 1: extract with history

1. Clone with full history. Cloud sessions clone shallow, so run `git fetch --unshallow`, and
   install `git-filter-repo`.
2. List the paths to keep: `packages/carriers/`, `ops/trawl/`, and every earlier path of their
   files (`git log --follow --name-only --format=`), since many adapters began in `src/server/`.
3. `git filter-repo --paths-from-file paths.txt --path-rename packages/carriers/: --path-rename ops/trawl/:trawl/`
4. Create the public repository `plhery/universal-delivery-scraper` and push.
5. Rewrite [`.gitleaksignore`](../.gitleaksignore): its fingerprints name commit SHAs and paths,
   which filter-repo changed (`.git/filter-repo/commit-map` maps old SHAs to new). Run gitleaks on
   the whole history.
6. Add `LICENSE` (Apache-2.0), `NOTICE` (GeoNames CC BY 4.0, the Correios model's MIT licence,
   Natural Earth), `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
   `AGENTS.md`, an ESLint config, `.nvmrc`, a `.gitignore` with `private.numbers.json` and
   `.private/`, issue templates ("A carrier stopped working", "Add a carrier") and workflows.
   `AGENTS.md` carries over this repository's privacy, push-to-main and documentation rules, plus
   the semver rules above and "never import from an app".
7. Workflows: CI (lint, typecheck, tests, generator checks, the detection sweep, the TRAWL script
   tests, and `npm pack` installed into a scratch project that imports every entry point), secret
   scanning, and the daily canary, whose issue now lives in the new repository.
8. Links into the app (`docs/ROUTING.md`, `docs/OBSERVABILITY.md`, `src/server/…`) become absolute
   links to the app repository, or go. The provider order's rationale already lives with the
   providers ([COMPARISON.md](../packages/carriers/providers/COMPARISON.md)); the app's
   [ROUTING.md](ROUTING.md) keeps only the app's policy and links to it.

### Phase 2: publish and switch the app

1. Publish `0.1.0` with npm trusted publishing from `release.yml` (the first publish may have to be
   manual), and push both images.
2. In the app: depend on the exact version and delete `packages/carriers/`, `ops/trawl/`, the
   moved files, the workspace, the `carrier:new`, `canary`, `test:carriers:*` and
   `test:tracking-links` scripts, `vitest.carriers-live.config.ts` and the canary workflow.
3. Check the full CI, `npm run test:e2e` and the iOS job, and that `contracts/openapi.json`, the
   `/api/carriers` response and the iOS resources are identical before and after.
4. Point `README.md` (Carriers), `docs/ARCHITECTURE.md`, `docs/ROUTING.md`,
   `docs/OBSERVABILITY.md`, `docs/LOCALIZATION.md`, `CONTRIBUTING.md`, `AGENTS.md` and
   `.env.example` at the scraper repository.
5. Deploy, and watch the Sentry routing events and `carrier_lookup_total` for a day.

### Phase 3: release and deploy automation

In the scraper, `release.yml` runs on every push to `main` except when only Markdown, tests or
fixtures changed:

- `version` in `package.json` is the release line. If npm doesn't have it, publish it; otherwise
  publish the next patch. The workflow never commits, so bumping minor or major is an edit to
  `package.json` in the change that needs it.
- `npm publish --provenance`, a `vX.Y.Z` tag, a GitHub release listing the commit subjects,
  `ghcr.io/plhery/universal-delivery-scraper:X.Y.Z`, and a TRAWL image when `trawl/` changed. The
  package exports `TRAWL_IMAGE`, the image it needs.
- A `repository_dispatch` to the app with `{ version }`, using a GitHub App or a fine-grained
  token limited to the app repository (contents: write). The scraper repository holds no
  production secret.

In the app, `scraper-update.yml` runs on that dispatch, daily as a safety net, and by hand with a
version (which is also how to roll back). It works like a person following `AGENTS.md`: validate,
then push to `main`.

1. `concurrency` with `cancel-in-progress`, so a burst of releases lands only the newest.
2. A major version stops here and opens the issue.
3. Install the version, run `npm run contract:generate` and `npm run ios:resources`.
4. Run the checks the server depends on: lint, typecheck, `test:contract`, `test:coverage`,
   `test:coverage:server`, `build`, `test:deployment`.
5. If `TRAWL_IMAGE` changed, redeploy the production TRAWL through Coolify's API and wait until it
   is healthy. TRAWL changes must keep working with the previous scraper version, since TRAWL goes
   first.
6. Commit "Update the scraper to X.Y.Z" and push to `main` with the GitHub App token, so the
   usual CI (including the iOS job, whose golden replay catches detection changes) runs on it. If
   `main` moved, rebase once; the commit only touches `package.json`, the lockfile and generated
   files.
7. Coolify deploys the push. Confirm first that it deploys on push to `main`; if it doesn't, call
   its deploy API here too. Coolify's token lives only in this repository.
8. Any failure opens or updates one "Scraper update failed" issue naming the step, like the canary
   issue.

Rollback: run the workflow with the previous version. Deprecate a bad release with
`npm deprecate`, never unpublish it.

### Phase 4: the open-source surface

1. `createTracker()`, the CLI and the server, with tests and `examples/`: Node usage, a Home
   Assistant `rest` sensor calling `/v1/track` (useful before a real integration exists), and a
   minimal one-off tracking page the server serves at `/` when `UDS_DEMO_PAGE=true` (detection runs
   in the browser from the main entry point, tracking through `/v1/track`).
2. A README for people who have never seen the app: what it does, install, library, CLI, Docker,
   Home Assistant, which third parties receive which data, adding a carrier, and the comparison
   below.
3. Publish `1.0.0`.

### Phase 5: rename and clean up

Rename `plhery/delivery-tracker` to `plhery/universal-delivery-tracker` (GitHub redirects the old
URLs). Update the Coolify source, the badges, `package.json` (`name`, `repository`, `bugs`,
`homepage`) and links. Keep the iOS bundle ids and the domain. Delete this file.

## README comparison

Generated like the carrier overview: `scripts/generate-readme.mjs` renders two tables from data
files, so the numbers change only when the data does.

**Measured on the same public references.** From
[`coverage.json`](../packages/carriers/providers/coverage.json): for the carriers compared, how many
each source returned history for, and how often it had the fullest history. The scraper's row is
its adapters plus its fallbacks, with a second row for its adapters alone. A rough first count over
the 100 carriers in [COVERAGE.md](../packages/carriers/providers/COVERAGE.md): ParcelsApp 53,
17TRACK 43, Postal Ninja 42, Ship24 41, UPU 12, the dedicated adapters about 51, the scraper as a
whole about 72. Recompute exactly with the script; an expired reference explains many "no
history" results. Later, record each lookup's duration in the coverage probe to compare speed.

**The landscape.** From a `comparison.json` in which every figure has a source URL and the month
it was checked (the README prints no dates). Vendor figures are claims, not measurements;
re-check them whenever the table is regenerated. Starting points:

| Project | Kind | Licence | Key or account | Carriers | Price |
| --- | --- | --- | --- | --- | --- |
| This scraper | Library, CLI, HTTP server | Apache-2.0 | None | 105 in the catalog, 84 dedicated adapters, 58 countries | Free, self-hosted |
| [17TRACK](https://www.17track.net/en/api) | Hosted API | Proprietary | Yes | 3,200+ claimed | 100 free lookups a month, then prepaid plans |
| [Ship24](https://www.ship24.com/pricing) | Hosted API | Proprietary | Yes | 2,500+ claimed | 10 free shipments a month, then from $39/month |
| [AfterShip](https://www.aftership.com/docs/tracking/others/supported-couriers) | Hosted API | Proprietary | Yes | 1,100+ claimed | Tracking API on paid plans |
| [TrackingMore](https://www.trackingmore.com/pricing) | Hosted API | Proprietary | Yes | 1,691 claimed | Free plan, then from $11/month |
| [ParcelsApp](https://parcelsapp.com/developers) | Hosted API | Proprietary | Yes | 1,540+ claimed | From $19/month |
| [shlee322/delivery-tracker](https://github.com/shlee322/delivery-tracker) | Scraper with a GraphQL server | Public; check the licence | None | About 30, mostly Korean | Free, self-hosted |
| [sauladam/shipment-tracker](https://github.com/sauladam/shipment-tracker) | PHP scraper | Public; check the licence | None | 8 | Free |
| [Karrio](https://github.com/karrioapi/karrio) | Shipping platform | LGPL-3.0 and Apache-2.0 | Your carrier API credentials | Carriers with official APIs | Free, self-hosted |

Say plainly that "carriers" means different things: the hosted APIs count every courier they can
route to, the scraper counts carriers it reads first-hand or through its fallbacks. What users
notice is history for real parcels, how complete, how fresh, which is what the measured table
shows. For Home Assistant users, note that the built-in 17TRACK and AfterShip integrations need an
account or an API key.

## Later, in their own repositories

- A Home Assistant add-on running `ghcr.io/plhery/universal-delivery-scraper`, and a custom
  integration (HACS expects one per repository) calling its API: a config flow for the server URL,
  one device per parcel, sensors for stage, last scan and estimate, add and remove services. Its
  `DataUpdateCoordinator` respects `retryAfterMs` and `tracking.refresh`: like the app, it owns its
  cadence.
- A Swift package for detection in the scraper repository, replacing the app's port and its golden
  replay.

## Risks

- **Terms of service and bot protection.** Adapters read public tracking pages, and the TRAWL
  build gets past challenges (SF Express's slider, Royal Mail's invisible hCaptcha, Postal Ninja's
  Turnstile). A reusable package makes large-scale use easy. Mitigations: decision 8, per-provider
  spacing and caching by default, a plain description of what the package does, and TRAWL only as
  an optional image. Check TRAWL's own licence before publishing a derived image; if it doesn't
  allow it, publish the Dockerfile and patches only.
- **A public one-off page.** Anonymous lookups from one address can get that address blocked by
  carriers. Host it apart from the app and its TRAWL, behind a challenge and per-address limits.
- **Deploy frequency.** Carrier fixes land several times a day, and each one redeploys the app.
  Deploys are safe ([DEPLOYMENT.md](DEPLOYMENT.md)), and the concurrency setting collapses bursts.
- **Package size.** The Correios model (4.6 MB) and the gazetteer (2.8 MB) make about 8 MB
  unpacked. Acceptable; otherwise the model can become an optional package.
- **Private data.** Real tracking numbers stay in environment variables or git-ignored files in
  both repositories.

## Done when

- The scraper repository is public, with CI, the daily canary, `release.yml`, an npm release with
  provenance and both images.
- The app has no `packages/carriers`, depends on an exact version, and its CI, deploy,
  `/api/carriers` output and iOS resources are unchanged.
- A patch release of the scraper reaches production without a human step, and a failing one opens
  the issue instead.
- A new carrier ships without a migration.
- This file is deleted.
