# Scraper package boundary

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

The app supplies its browser service and telemetry recorder through `AdapterEnvironment`.
`CarrierTrackingAdapter` delegates to `trackCarrier`; the app's router chooses providers
and saves their outcomes. Commercial universal providers are explicitly enabled by the app.

The scraper validates its own catalog. The app contract generator projects the catalog
onto the client API, excluding retrieval-only refresh and clock metadata. The scraper's
stage vocabulary must agree with the contract. Brand palettes, decals and truck geometry
live in `src/brand`; `scripts/generate-brand.mjs` feeds both web and native resources.

Parser and live-provider tests belong to the scraper. App tests replay synthetic
`CarrierResult` fixtures to exercise routing, event identities and persistence. App tests
also use the public registry to check dispatch and the host recorder.

## Updating the dependency

Publish a scraper release, update the exact dependency and lockfile, then run the app's
validation and generated-resource checks. Carrier IDs must also be supported by the
Supabase catalog before users can save parcels with those IDs. See [deployment](DEPLOYMENT.md).

The release workflow in the scraper repository publishes versioned HTTP and TRAWL images.
TRAWL is optional and has its own AGPL licence and matching source archives. Browser-service
configuration is documented in the scraper repository.

## Remaining split work

The application rename to Peek and automated scraper-release adoption are separate changes.
Automation must synchronize new carrier IDs with Supabase, regenerate the client contracts,
and pass application validation before adopting a release.
