# EMS

This selectable carrier uses the [EMS Cooperative tracking service](https://www.ems.post/en/global-network/tracking),
shared by national EMS operators. China EMS is part of China Post; EMS here
identifies the express service and tracking route, not a new national operator.

Catalog and links: [carrier.json](carrier.json). Synthetic number examples:
[numbers.json](numbers.json). Status evidence: [statuses.json](statuses.json).

## Retrieval

[adapter.ts](adapter.ts) makes one anonymous GET per lookup:

```text
https://items.ems.post/api/publicTracking/track?language=EN&itemId={number}
```

The ordinary browser User-Agent in the adapter is sufficient. No cookie jar,
bootstrap, credentials, browser service or CAPTCHA solution is required by the
observed flow. The request has a 15-second default deadline, a streaming 1 MB
limit and caller cancellation. There is no local retry; provider recovery and
universal fallback remain with the host router.

The pure `parse()` binds the requested number to its result-table container and
checks the three expected column headers. An echoed input alone cannot bind a
response. The exact empty-result table row means not found; malformed history,
unsupported services and HTTP failures remain distinct. HTTP 404/410 indicate
an unavailable endpoint, since a missing item is reported inside HTTP 200 HTML.

## Selection and coverage

Choose **EMS** in the carrier picker or paste a link from `items.ems.post`.
Bare-number detection continues selecting the national postal operator. This
avoids a second high-confidence rule competing with China Post, La Poste and
the other operators that share EMS S10 numbers.

Only checksum-valid `E`-prefixed S10 numbers are accepted. Ordinary postal items,
including `LZ…CN`, are outside this endpoint's service coverage. The adapter
does not replace China Post's general routing or solve its character CAPTCHA.
Existing parcels are not relabelled.

The table exposes status, event history and facilities. Each event uses its own
exact wording map. Unknown wording stays visible with unknown current status;
customs release and arrival at a post office are not delivery. No ETA or private
recipient fields are inferred. At most 100 scans are returned, with exact
duplicates removed.

## Time and completeness

EMS prints local date/time without a timezone. The parser validates these
calendar values and emits offset-less ISO strings, retaining the portal's
chronological row sequence (oldest first on the wire, newest first in results).
It does not compare local clocks across international legs or invent an offset.

The host currently stores offset-less times using the catalog timezone, which
is UTC for this global service. That is an application storage convention, not
evidence that EMS's displayed clocks are UTC. Raw wall times are preserved in
event data; precise absolute times and cross-provider freshness remain limited
until per-event timezone semantics can be established. Do not assign the origin
country's zone to an entire international journey.

The Cooperative history can omit domestic scans. Successful retrieval proves
only that reference's available history, not completeness for every operator.

## Verification

On 2026-09-21 fresh local HTTP calls returned six scans for a China-origin EMS
reference (90 ms) and nine for a France-origin reference (117 ms). The synthetic
`EB000000005CN` returned the explicit empty-result row (46 ms); ordinary
`LZ000000005CN` returned the EMS-service restriction (36 ms). These are individual
request measurements, not a production latency benchmark.

The local automated live suite passed for the positive and empty controls.
A call through the application's normal carrier dispatcher also returned all
six China-origin scans and built six history rows in 95 ms. The complete
migration suite passed against a disposable PostgreSQL 16 database, including
creation and carrier changes with the new EMS selection.

The positive references are public reports linked by the
[China Post investigation](../china-post/README.md) and
[UPU comparison](../../providers/upu/README.md). Their live identifiers stay
outside fixtures; [fixture provenance](fixtures/README.md) describes scrubbing.

Offline tests cover identity isolation, invalid/empty HTML, unsupported inputs,
unknown wording, dates, provider ordering, response bounds, cancellation,
registration and link selection. To run the opt-in live suite, supply an
authorized reference outside the repository:

```sh
EMS_TRACKING_NUMBER="${EMS_LIVE_NUMBER:?Set an authorized EMS number locally}" \
  npx vitest run --config vitest.carriers-live.config.ts \
  packages/carriers/carriers/ems/adapter.live.test.ts
```

Production-network availability and deployed retrieval have not been verified.
Apply `20260921160000_add_ems.sql` before deploying the selectable carrier; it
extends the package constraint and both ownership-enforcing package RPCs.
