# Carrier package architecture

The package contains the catalog, number detection, adapters, universal
providers and result normalization. It does not import the web application,
Supabase or Sentry. The host supplies configuration and telemetry through
[AdapterEnvironment](core/adapter/index.ts).

## Sources of truth

| Concern | Maintained source |
| --- | --- |
| Identity, links, inputs, capabilities and declared steps | `carriers/<id>/carrier.json` |
| Number examples and their provenance | `carriers/<id>/numbers.json`; [corpus rules](CORPUS.md) |
| Status observations and evidence | `carriers/<id>/statuses.json` |
| Actual status mapping | Carrier `status.ts`, or [provider result helpers](providers/shared/result.ts) |
| Runtime interface and result validation | [core/adapter](core/adapter/index.ts), [core/result](core/result/index.ts) |
| Protocol choices, limitations and verification | One README per carrier/provider; provenance beside fixtures |
| Generated catalog, registry and brand assets | `generated/`; regenerate through `npm run contract:generate` |

READMEs explain non-obvious behavior; they should not duplicate changing
contracts or become a second status database. General reverse-engineering
methods belong in the reusable scraper skill, not a repo-specific casebook.

## Registration and execution

The [registry generator](scripts/generate-registry.mjs) resolves link-only
carriers to `null`, folders with `adapter.ts` to their own factory, universal
carriers to `universal`, and shared adapters to the referenced folder. This
also handles legacy catalog adapter names when a dedicated file exists.
`--check --strict` verifies the output and rejects unresolved automatic carriers.

An adapter exports an `AdapterFactory`. Its instance exposes `id`, `steps`
and `track(input, context?)`; input carries the stored number, optional
capability URL and postcode. The context can provide cancellation and a budget.
[AdapterRegistry](core/adapter/index.ts) creates and caches instances by adapter
id. Modules are statically imported; only instance creation is lazy.

[runSteps](core/runner/index.ts) attempts enabled steps in order, supplies the
remaining budget and signal, and records completed steps and lookup outcomes.
Adapters must pass these controls into their actual I/O. Default recovery
allows challenge, transport, indeterminate and unclassified errors; adapters
can supply explicit recovery predicates. `singleFlight()` serializes operations
on an instance. The error taxonomy is in [core/errors](core/errors/index.ts);
the host's [routingFailure](../../src/server/trackingRouting.ts) consumes it
before applying compatibility handling for other errors.

The host constructs the registry in [adapterRegistry.ts](../../src/server/adapterRegistry.ts).
Cross-provider ordering, affinity, cooldowns and shared leases belong to
[tracking routing](../../docs/tracking-routing.md), not individual scrapers.

## Results and telemetry

`normalizeCarrierResult()` validates known fields but preserves extra result
and event properties. Each parser selects the fields it returns; normalization
is not a field allowlist. The host sync classifies events without an explicit
stage and records the classification source. Time helpers live in `core/time`;
provider-specific offset or wall-time interpretation remains with each parser.

The host [StepRecorder](../../src/server/stepRecorder.ts) emits Sentry metrics
and logs; registered sinks add Prometheus. The sync's database attempt ledger
is separate from these per-adapter step records. Operational diagnostic policy
is maintained in [Observability](../../docs/OBSERVABILITY.md), with phase timing
and emission behavior in [scraper monitoring](../../docs/scraper-monitoring.md).
Do not add a second package-level privacy or logging policy.

## Checks

See the [package README](README.md#running-the-checks) for commands. Offline
fixtures exercise parsing and recovery; opt-in live tests check current
transport compatibility. A generated catalog or passing fixture does not
establish live coverage. Preserve dated evidence and unresolved limitations
in the affected integration's README.
