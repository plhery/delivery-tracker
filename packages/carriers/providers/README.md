# Universal providers

A universal provider is a public tracking aggregator, not a carrier. It has no
last mile, it is never selectable for a parcel, and it exists so that a parcel
whose carrier has no dedicated adapter — or whose carrier is unknown — still
shows real progress. Each provider has its own folder here, built like a carrier
folder: `adapter.ts` with a pure `parse…()` and an `adapter` factory,
`adapter.test.ts`, `fixtures/` and `README.md`. Providers are not
part of the generated carrier registry; the chain in `universal.ts` calls them.

| Folder | Provider name (persisted) | Transport | Steps |
| --- | --- | --- | --- |
| `ship24/` | `Ship24` | signed anonymous JSON POST, then a local browser session | `direct`, `browser` |
| `parcelsapp/` | `ParcelsApp` | browser service capture of the page's own API | `trawl` |
| `seventeentrack/` | `17TRACK` | browser service capture of the page's own API | `trawl` |
| `postal-ninja/` | `Postal Ninja` | local browser session submitting the official widget | `browser` |

The provider names are stored in each parcel's routing state and drive the
tracking link shown in the app, so they must not change.

## The chain

`universalSources()` returns **Ship24 → ParcelsApp → 17TRACK**. Ship24 leads
because its direct JSON lookups were verified sub-second in production
(2026-09-10); that is an operational preference from those samples, not a
reliability benchmark. Postal Ninja is excluded by default while unattended
verification is unresolved: `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it
before 17TRACK, which always stays last.

`UniversalTracker.fetch()` asks each enabled provider once, in that order, and
returns the first usable history; if all of them fail it throws one
`UniversalTrackingError` carrying every provider failure, with a summary that
names the providers but not their responses. The per-parcel router
(`docs/tracking-routing.md`) owns everything above that: it remembers which
provider answered and starts there next time, applies per-provider cooldowns and
the shared provider-health leases, and reserves 35 seconds per enabled provider
(30 s of lookup plus transport allowance) so a slow provider cannot starve the
others.

Unknown carriers (`unknown`, `intl-post`) and every carrier whose catalog entry
says `tracking.adapter: universal` are served by this chain. No authenticated
commercial API key is used by any provider, and a tracking URL saved on a parcel
is never fetched by the chain.

## What a provider may return

Only history bound to the requested shipment. Demo numbers, initial polling
replies, carrier-selection prompts, postcode forms, challenges and empty
responses cannot manufacture progress: each provider verifies identity in the
payload (or, for ParcelsApp, in the rendered result table) before any event is
projected.

Reported carrier names are hints. One unambiguous name becomes
`discovered_carrier`, which lets routing try that carrier's dedicated adapter;
only that adapter confirming the shipment adopts the carrier.

Events carry a time, a description and a stage.
Recipient names and addresses, signatures, access and door codes, courier
contact details and provider payloads are not retained, and a delivery
description that contains such details is replaced by `Delivered`.

## Shared modules

- `shared/result.ts` — the tracking-number guard (`numberOf`), the text and
  notice filters, the event builders with their timezone policy (`event` needs
  an explicit offset; `localEvent` keeps wall time), and `result()`, which
  deduplicates, orders, caps and summarizes a history. It also holds the
  provider wording → stage vocabulary the four providers share.
- `shared/hints.ts` — reported carrier names → catalog ids.
- `shared/capture.ts` — the browser-service call the two TRAWL providers share,
  the lazy iteration over captured bodies, and `TrackingCaptureError`.

## Steps, telemetry and errors

Every provider runs its tiers through `runSteps` from `../core/runner`, which
records one step per attempt and one lookup per call through the host's
`StepRecorder`. The step ids (`direct`, `trawl`, `browser`) and the provider
names used as the telemetry carrier label are the ones the Sentry scraper
dashboard already queries, and the lookup record is what used to be reported as
the `total` phase.

Errors are the shared taxonomy in `../core/errors`. Three provider error classes
carry extra fields the host's observability reads by name:
`TrackingCaptureError` (`reason`, indeterminate), `SeventeenTrackLookupError`
(`reason`, `providerCode`, transport) and `SeventeenTrackVerificationError`
(`reason`, `providerCode`, challenge).

## Adding or changing a provider

1. Create the folder with `adapter.ts`, `adapter.test.ts`, `fixtures/`,
   `README.md`; export an `adapter` factory.
2. Register it in `universal.ts` (`FACTORIES` and, if it belongs in the default
   order, `UNIVERSAL_SOURCES`). A new name becomes persisted state: adding one
   is a data migration for parcels that already prefer another provider.
3. Verify live before changing the order, and record the date and what was
   observed in `README.md`.
