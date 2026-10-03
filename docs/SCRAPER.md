# Scraper package

The app uses an exact release of [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper)
as an in-process npm dependency. The scraper owns carrier data, detection, adapters,
provider ordering, input validation, status classification, handoff suggestions and places.
The app owns accounts, polling, routing state, leases, persistence, notifications and clients.
See [architecture](ARCHITECTURE.md), [routing](ROUTING.md) and [observability](OBSERVABILITY.md).

## Public imports

- `universal-parcel-scraper`: browser-safe catalog, detection and result helpers.
- `universal-parcel-scraper/node`: registry, tracking, transport and telemetry interfaces.
- `universal-parcel-scraper/places`: server-side place resolution.
- `universal-parcel-scraper/data/*`: published data used by generators.

ESLint refuses any other path into the package.

The app supplies its browser service and telemetry recorder through `AdapterEnvironment`
([`adapterRegistry.ts`](../src/server/adapterRegistry.ts)). `CarrierTrackingAdapter`
delegates to `trackCarrier`; the app's router chooses providers and saves their outcomes.
Commercial universal providers are explicitly enabled by the app.

The scraper validates its own catalog. The app contract generator projects the catalog
onto the client API, excluding retrieval-only refresh and clock metadata. The scraper's
stage vocabulary must agree with the contract. Brand palettes, decals and truck geometry
live in `src/brand`; `scripts/generate-brand.mjs` feeds both web and native resources.

## Tests

Parser, detection and live-provider tests belong to the scraper. App tests replay synthetic
`CarrierResult` fixtures to exercise routing, event identities and persistence, and use
the public registry to check dispatch and the host recorder.

## Updating the dependency

1. Publish a scraper release.
2. Set the exact version in `package.json` and update the lockfile. `playwright-core`,
   `sharp` and `onnxruntime-web` are the scraper's optional peers: keep them on the
   versions it asks for.
3. Run `npm run contract:generate` and `npm run ios:resources`, then the app's validation.

A new carrier ID also needs a migration that adds it to the database's carrier list,
applied before the server that offers it. See [deployment](DEPLOYMENT.md).

The scraper's release workflow also publishes versioned HTTP and TRAWL images. TRAWL is
optional and has its own AGPL licence and matching source archives. Browser-service
configuration is documented in the scraper repository.
