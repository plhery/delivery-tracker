# Scraper package

The app uses an exact release of [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper)
as an in-process npm dependency. The scraper owns carrier data, detection, adapters,
provider ordering, input validation, status classification, handoff suggestions and places.
The app owns accounts, polling, routing state, leases, persistence, notifications and clients.
See [architecture](ARCHITECTURE.md), [routing](ROUTING.md) and [observability](OBSERVABILITY.md).

## Public imports

- `universal-parcel-scraper`: browser-safe catalog, detection and result helpers.
- `universal-parcel-scraper/app`: browser-safe helpers shaped for this app, such as its
  parcel view, the clocks its sync uses and carrier scan-identity policies. The scraper
  changes them with the app, outside its semver contract.
- `universal-parcel-scraper/node`: registry, tracking, transport and telemetry interfaces.
- `universal-parcel-scraper/places`: server-side place resolution.
- `universal-parcel-scraper/data/*`: published data used by generators.

ESLint refuses any other path into the package.

The app supplies its browser service and telemetry recorder through `AdapterEnvironment`
([`adapterRegistry.ts`](../src/server/adapterRegistry.ts)). `CarrierTrackingAdapter`
delegates to `trackCarrier`; the app's router chooses providers and saves their outcomes.
Commercial universal providers are explicitly enabled by the app.

The scraper calls a carrier's postcode input `postcode`. The app's API, database and
clients call it `dpdPostcode`, so the app renames it wherever the scraper hands it over:
the requirements and checked inputs ([`lib/carriers.ts`](../src/lib/carriers.ts),
[`server/carriers.ts`](../src/server/carriers.ts)), the input a recognised carrier still
needs ([`trackingRouting.ts`](../src/server/trackingRouting.ts)) and the contract generator.

A national carrier's postcode requirement states its own example. One that takes any
country's postcode leaves it out, and the forms show the reader's country
([`postcodeExample.ts`](../src/lib/postcodeExample.ts), `CarrierCatalog.postcodeExample`
on iPhone): the device's time zone or language region on the web, its region setting on
iPhone, the carrier's own country otherwise. The examples live in
[`shared/postcode-examples.json`](../shared/postcode-examples.json).

The scraper validates its own catalog. The app contract generator projects the catalog
onto the client API, excluding what only retrieval uses: refresh pacing, clocks and the
page the scraper's canary probes. The scraper's stage vocabulary must agree with the
contract. Brand palettes, decals and truck geometry live in `src/brand`;
`scripts/generate-brand.mjs` feeds both web and native resources.

## Tests

Parser, detection and live-provider tests belong to the scraper. App tests replay synthetic
`CarrierResult` fixtures to exercise routing, event identities and persistence, and use
the public registry to check dispatch and the host recorder.
Fallback input and persistence scenarios supply provider plans explicitly so they can
exercise each provider independently of coverage ordering.

## Updating the dependency

`.github/workflows/adopt-scraper.yml` moves the app to a scraper release. The scraper
repository starts it after each npm publish, stable or prerelease, when it has the
`SCRAPER_ADOPTION_TOKEN` secret. It is also started by hand:

```bash
gh workflow run adopt-scraper.yml                    # the newer of npm's latest and next
gh workflow run adopt-scraper.yml -f version=1.2.3   # one exact release
```

It never downgrades. It waits until npm serves the release, pins it, checks the database
gate and optional peers, and regenerates the contract and iPhone resources. A second job,
which runs nothing of the release, pushes the result to `main` as one commit. CI validates
that final commit before deployment ([deployment](DEPLOYMENT.md)); adoption does not
repeat the test suites or production build. A commit that reached `main` in the meantime
is kept when it leaves the adoption's files alone; otherwise the run fails and its summary
gives the command that starts it again.

`playwright-core`, `sharp` and `onnxruntime-web` are the scraper's optional peers. npm does
not check them here, so [a test](../src/server/scraperDependency.test.ts) does. When a
release asks for other versions than the app pins, the run fails and names them: move
those pins and the scraper in one commit by hand, with `npm run contract:generate`,
`npm run ios:resources` and the app's validation. A new `playwright-core` also moves
`@playwright/test` and the browser journeys' Playwright image in `.github/workflows/ci.yml`.

`SCRAPER_ADOPTION_TOKEN` is a fine-grained token with read and write access to this
repository's contents, stored as a secret in both repositories. The scraper starts the
workflow with it. Here it is required to push the commit and start CI. Without it, adoption
stops without pushing: the workflow's own token would suppress the validation workflows.

The scraper's release workflow also publishes versioned HTTP and TRAWL images. TRAWL is
optional and has its own AGPL licence and matching source archives. Browser-service
configuration is documented in the scraper repository.

### Database gate

The database keeps its own copy of parts of the catalog, and a migration is applied
before the server that needs it. So the workflow stops, before pushing anything, when a
release changes one of these:

- the carrier ids;
- the inputs a carrier asks for (postcode, tracking URL): for which carrier, required or
  optional, and their shape;
- a tracking number that is more than letters and digits;
- the number shape that marks a Quickpac parcel;
- the stages;
- the names of the universal providers.

The run's summary lists each change with the constraints and functions that enforce it.
Write the migration, apply it to production, then continue with that release:

```bash
gh workflow run adopt-scraper.yml -f version=1.2.3 -f database_ready=true
```

`database_ready` vouches for one release, so it is refused without a version.

The gate compares catalog data. Rules written as scraper code, such as URL shapes and the
Mondial Relay barcode checksum, are outside it. So is the rule for a number with no digit:
the scraper's `validTrackingNumber` takes six to ten letters that a detection rule claims
and the database six or more, so a wider rule there needs a migration first. A changed
stage also needs the `Stage` enum in `contracts/openapi.json` edited by hand.

A checksum a detection rule names must also exist in `ios/PeekDeliveryTracker/CarrierCatalog.swift`.
The iPhone app keeps a rule whose checksum it does not know only as a low-confidence candidate
that is never preferred, so its replay of the scraper's detection answers fails after the
adoption. Add the checksum there before the release that names it. The same file holds the
iPhone's copy of the shape a number may have and of the labels that introduce one in a message;
change them with the scraper's. The iPhone tests also replay the scraper's checksum vectors, so a
Swift checksum that answers differently from the scraper's fails.
