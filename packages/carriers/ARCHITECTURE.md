# Carrier package architecture

The package holds the catalog, detection, adapters, universal providers and result
normalization. It never imports the app, Supabase or Sentry. The host passes configuration
and telemetry through [`AdapterEnvironment`](core/adapter/index.ts).

## Sources of truth

| Concern | Lives in |
| --- | --- |
| Identity, links, inputs, capabilities, declared steps | `carriers/<id>/carrier.json` |
| Sample numbers and provenance | `carriers/<id>/numbers.json` ([CORPUS.md](CORPUS.md)) |
| Observed status wording and evidence | `carriers/<id>/statuses.json` |
| Actual status mapping | the carrier's `status.ts`, or [provider result helpers](providers/shared/result.ts) |
| Runtime interface and result validation | [core/adapter](core/adapter/index.ts), [core/result](core/result/index.ts) |
| Protocol, gotchas, limitations | one README per carrier or provider |
| Catalog, registry, brand assets | `generated/`, rebuilt by `npm run contract:generate` |

READMEs explain what the code and JSON can't. They don't copy contracts or status lists.

## Registration

The [registry generator](scripts/generate-registry.mjs) maps each carrier to its adapter:

- link-only carriers → `null`;
- folders with `adapter.ts` → their own factory;
- `tracking.adapter: "universal"` → the universal providers;
- `tracking.adapter: "<folder>"` → another carrier's adapter (Chronopost uses `la-poste`).

`--check --strict` fails on stale output or an automatic carrier without an adapter. The
host builds the registry in [`adapterRegistry.ts`](../../src/server/adapterRegistry.ts).
Modules are imported statically; only instances are created lazily and cached.

## Execution

An adapter factory returns `{ id, steps, track(input, context?) }`. `input` carries the
number plus an optional capability URL and postcode. `context` carries cancellation and a
time budget, and adapters must pass both down to their real I/O.

[`runSteps`](core/runner/index.ts) tries the enabled steps in order (`direct`, `retry`,
`refresh`, `page`, `trawl`, `browser`), passing the remaining budget and recording each step
for telemetry. By default it moves on after challenge, transport, indeterminate and
unclassified errors; adapters can supply their own recovery rules. `singleFlight()`
serializes work on one instance, for example to avoid two session renewals at once.

Errors use the taxonomy in [core/errors](core/errors/index.ts). The host's
[`routingFailure`](../../src/server/trackingRouting.ts) turns them into routing decisions.
Ordering between carriers and providers, affinity, cooldowns and shared leases belong to
[routing](../../docs/ROUTING.md), never to an adapter.

## Status model

Each event's stage is decided in this order:

1. **Carrier map**: the adapter sets `stage` from a code or wording in its `status.ts`.
2. **Provider stage**: a universal provider's declared stage or sub-status.
3. **Wording classifier** ([core/status](core/status/wording.ts)): multilingual rules,
   then broad keyword rules. The host applies it to events without a `stage`.
4. **Fallback** when nothing matches.

An event with no `stage` means "no explicit mapping", not "unknown". The host records which
of these decided each event (`raw_data.stage_source`), and unmapped wording is collected for
review ([OBSERVABILITY.md](../../docs/OBSERVABILITY.md)).

`normalizeCarrierResult()` validates known fields and keeps extra ones. It is not a field
allowlist: each parser decides what it returns. Time helpers live in `core/time`, but each
parser owns how it reads its provider's offsets and wall-clock times.

## Telemetry

The host's [`StepRecorder`](../../src/server/stepRecorder.ts) turns step records into Sentry
metrics, logs and Prometheus series. The database audit of each refresh is separate. Privacy
and logging policy lives in [OBSERVABILITY.md](../../docs/OBSERVABILITY.md), and the package
doesn't add its own.
