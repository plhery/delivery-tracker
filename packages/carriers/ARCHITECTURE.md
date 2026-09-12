# Carrier package architecture

`packages/carriers` holds everything the app knows about parcel carriers: the
catalog, tracking-number detection, the scrapers ("adapters"), status
normalization, sample data and per-carrier documentation. It is written so it
can become its own repository later: nothing inside it imports Next.js,
Supabase, Sentry or application code. The host provides HTTP, sessions and a
telemetry sink through interfaces.

Goals, in the order they win when they conflict:

1. **Human-readable.** Everything about one carrier lives in one folder. A
   stranger can read that folder and understand what we retrieve, from where,
   why, and how sure we are.
2. **Updatable.** Adding a carrier, a number format or a newly observed status
   wording is a data change with a checklist, not archaeology across the repo.
3. **Monitorable.** Every lookup records which step served it, how long each
   step took, and whether the status mapping was explicit, inferred or missing.
4. **Maintainable.** One implementation of each cross-cutting concern.
5. **Extractable.** The package boundary is enforced by lint.

## Layout

```
packages/carriers/
  ARCHITECTURE.md        this file: design and decisions
  README.md              overview table (generated) and the add-a-carrier checklist
  PRIVACY.md             the projection policy, stated once and enforced in core
  core/
    catalog/             carrier.json schema, loader, typed access to the merged catalog
    brand/               palette derivation, truck geometry, the data both clients render
    detection/           number detection engine, checksums, input parsing, link rules
    status/              Stage vocabulary, status maps, wording classifier, observation hooks
    result/              CarrierResult / CarrierEvent and their normalization
    errors/              the single error taxonomy used by adapters, routing and telemetry
    transport/           bounded fetch, cookie sessions, TRAWL client, browser session, single flight
    time/                timestamp parsing with an explicit timezone policy
    runner/              runSteps(): tiered execution with per-step telemetry and budgets
    telemetry/           StepRecorder interface, metric names and label sets
    testing/             corpus loader, detection sweep, fixture harness, live-test helpers
  carriers/<id>/         one folder per carrier (see "Carrier folder")
  providers/<id>/        universal providers (Ship24, ParcelsApp, 17TRACK, Postal Ninja), same skeleton
  generated/             registry and merged catalog, produced by scripts; never edited by hand
  scripts/               generators and checks
```

## Carrier folder

```
carriers/<id>/
  carrier.json           identity, brand, timezone, portal facts, links, detection rules, inputs, capabilities
  numbers.json           evidence-tagged sample numbers used by the detection sweep
  statuses.json          observed status vocabulary: raw wording or code, stage, first seen, how confirmed
  README.md              human documentation with a fixed table of contents
  NOTES.md               dated decisions, rejected alternatives, verification log
  adapter.ts             dedicated carriers only: implements CarrierAdapter, exports a pure parse()
  status.ts              dedicated carriers only: code or wording → Stage map with provenance comments
  adapter.test.ts        offline tests over fixtures
  adapter.live.test.ts   opt-in tests against the real endpoint, gated by environment variables
  fixtures/              scrubbed payloads, one JSON per scenario, provenance header inside each
  brand/                 optional logo.svg; palette and decal are carrier.json keys
```

Carriers without a dedicated adapter (tracked through the universal providers)
have the data files and README only. Adding an adapter later adds files; it
never moves anything.

`carrier.json` is the single source of truth per carrier. The generator merges
every `carriers/*/carrier.json` into `contracts/openapi.json` under
`x-carriers`, so the TypeScript contract, the Swift contract, the iPhone's
offline catalog and `/api/carriers` are all produced from the folders.
`npm run test:contract` fails when any generated artifact is stale.

## Detection

One engine in `core/detection`, imported by the web client, the server and the
tests. Rules are data in `carrier.json` (`detection[]`, each with an `id`, a
`pattern`, a `confidence`, an optional `checksum` and a `source`). Exactly one
high-confidence match selects a carrier; zero or several high matches keep the
number as a low-confidence suggestion with candidates. The Swift port stays in
sync through a golden file produced by the corpus sweep and replayed by the
native tests.

Intended collisions between rules are declared in
`core/detection/collisions.json` with a reason each. The sweep fails on any
collision that is not declared.

## Number corpus

`numbers.json` records every sample number with its evidence family:

- `public_shipment_report`: a real number found on a public page, with the URL.
- `official_documentation_example`, `open_source_example`,
  `merchant_published_example`: published examples that are not real shipments.
- `synthetic`: made by us, shaped after a real number we saw (`derivedFrom`
  says how: `donated_real`, `observed_request`, `official_shape`, `invented`).

Real numbers given to us privately are never committed. They get a synthetic
sibling with the same shape and a valid checksum; the real value may live in a
git-ignored `private.numbers.json` next to it for live tests.

The sweep asserts every expectation, flags any second carrier claiming high
confidence, reports detection rules with no example, and writes the Swift golden
file.

## Status model

Adapters emit the product `Stage` vocabulary at both result and event level.
An event may carry no `stage`, meaning "no explicit mapping": the sync then
runs the wording classifier (`core/status/wording.ts`) and records where the
final stage came from in `raw_data.stage_source`: `carrier_map` when the
adapter or provider supplied a valid stage, `wording:<rule-id>` when a
classifier rule decided, `none` when the fallback was used. Events whose
source is not `carrier_map` are also recorded in the service-only
`tracking_status_observations` table so new wording can be reviewed and
mapped later (see docs/OBSERVABILITY.md).

Mapping precedence: explicit carrier map → provider-declared stage → wording
classifier → fallback (previous stage or `in_transit`), flagged. Wording rules
never produce a terminal stage unless the rule is marked terminal and has a
fixture. Map too little rather than wrongly.

## Adapters, steps, errors

Each dedicated adapter implements:

```ts
interface CarrierAdapter {
  readonly id: CarrierId;
  readonly steps: readonly StepId[];
  normalizeNumber(raw: string): string;
  track(input: TrackingInput, ctx: TrackingContext): Promise<CarrierResult>;
}
```

and exports a pure `parse(payload, number)` that the offline tests target.
`runSteps()` in `core/runner` executes declared tiers (for example `direct`
then `trawl`), enforces the budget, and records per-step outcome, duration and
fallback reason through the `StepRecorder`.

One error taxonomy in `core/errors`: `NotFound`, `Indeterminate`, `Challenge`,
`RateLimited`, `Maintenance`, `SchemaError`, `InputRequired`, `Transport`.
Routing, sync and observability classify with `instanceof`.

## Telemetry

The host wires the `StepRecorder` to three sinks: Sentry metrics and structured
logs (existing names), the Postgres sync ledger (one row per step), and
Prometheus counters and histograms. `carrier_lookup_total{final_step}` answers
whether a fallback tier is worth keeping.

## Documentation

Per-carrier READMEs follow a fixed table of contents: identity and scope,
portals, what we retrieve, tracking numbers, how the adapter works, status
reference, limitations and privacy, verification log. Tables are generated from
the JSON files; prose sections are hand-written. The package README carries the
generated overview table and the add-a-carrier checklist.

## Decisions and alternatives

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Layout | one folder per carrier, generated registry | flat files and an if/else dispatch chain | more than a hundred carriers |
| Catalog | `carrier.json` per folder, merged into `openapi.json` | editing `openapi.json` by hand | readability; downstream consumers unchanged |
| Shared code | one `core/` | vendored copies per carrier | vendoring drifts |
| Separate repository | later, once the boundary lint passes | now | the split is mechanical once nothing imports the app |
| Sample numbers | data files and generated tests | literals in tests | provenance, uniqueness sweep, Swift golden |
| Private numbers | never in git | committing them | privacy; they expire anyway |
| Status vocabulary | keep the product stages, nullable event stage | a second adapter-level status enum | one vocabulary, less mapping code |
| Mapping | explicit map → declared → wording → flagged fallback, with `stage_source` | maps only, or wording only | day-one coverage with a guard rail, and the source becomes a metric |
| Unmapped wording | observation table plus a review script | an issue per wording | volume and review workflow |
| Metrics | `prom-client` behind a `StepRecorder` interface | Sentry metrics only | retention and per-label queries; the interface keeps alternatives open |
| Errors | one taxonomy, `instanceof` | per-adapter classes and name sniffing | routing correctness |
| Docs | generated tables plus hand-written sections per carrier | one large markdown file | drift and mixed audiences |
| Brand assets | one palette derivation and one truck geometry, as data | a palette and a truck re-typed per platform | the SVG and the SwiftUI canvas drifted; a parity test on each side now replays the same file |

## Migration status

Phase 0 to 2 are in place: the corpus and detection core, per-carrier
`carrier.json` as the source of truth, the error taxonomy, transport, runner
and telemetry in `core/`, adapters and providers in their folders served
through the generated registry, Prometheus plus Sentry sinks, and the brand
assets generated from one truck geometry and one palette derivation
(`core/brand`, see its README). Still open: a generated status reference in each
README, the lookup canary that replays a synthetic number through every
registered adapter, and the optional `exception` stage.

## Prior art

The structure borrows from the ha-parcel-integrations organisation on GitHub
(MIT): one folder per carrier from a tested template, README status tables that
show raw wording next to each stage, capabilities declared as data and guarded
by tests, status maps with dated provenance, and "map too little over mapping
wrongly". Their vendored core was not copied: this is one TypeScript workspace.
