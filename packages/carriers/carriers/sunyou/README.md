# SunYou

## Identity and scope

SunYou (SYPost) is a Chinese cross-border logistics provider. It carries small
parcels from China to Europe and hands most of them to a local postal operator
for the last mile, so this folder covers the international journey up to that
handoff.

## Portals

| Portal | URL | What it is |
|---|---|---|
| Public search | `https://sypost.net/search?trackNumber={trackingNumber}` | The page a tracking link opens. |
| Canary | `https://sypost.net/` | Probed daily for availability. |

The search page reads `sypost.net/queryTrack`, a keyless endpoint that answers
JSONP (`callbackName({…})`) rather than JSON and expects a cache-busting
`queryTime` parameter. That endpoint is what the adapter reads.

## What we retrieve

Retained: the shipment status and stage, the newest status text, and up to
twenty scans with their timestamps and descriptions, merged from both legs.

Discarded: everything else a record can carry, including the recipient block
and the signature image (exercised by `fixtures/delivered.json`).

Unavailable: scan locations and a delivery estimate. The endpoint publishes
neither, so events carry an empty location and `expected_delivery` is null.

## Tracking numbers

| Rule | Shape | Note |
|---|---|---|
| `sunyou-1` | `SY` + 11 digits | |
| `sunyou-2` | `SYAE` + 9 digits | The shape of the publicly reported samples. |

`numbers.json` holds three samples: one synthetic, one publicly reported and
one open-source example.

## How the adapter works

One bounded GET, declared as a single `direct` step. Nothing is retried: there
is no session to rebuild and a transient failure stays visible as a sync error.

The body is a JSONP envelope, so it is unwrapped before it is parsed; an HTML
outage or challenge page fails to unwrap and is reported as an invalid
response rather than as a not-found.

A shipment is returned in two legs, `result.origin` and `result.destination`,
each stamping its own timezone. Events are merged and ordered by absolute
instant. When a scan carries a usable `timeZone` offset, that offset is applied
to its wall-clock string; when it does not, the provider's text passes through
unchanged rather than being stamped with a guessed zone.

`displayStatus: "0"` and a record whose `has` is not `true` are SunYou's
explicit "no such shipment" and become a clean 404.

## Status reference

| Stage | Code (raw `displayStatus`) | Confirmed by |
|---|---|---|
| `in_transit` | `1` | fixture |
| `ready_for_pickup` | `2` | fixture |
| `failed_attempt` | `3`, `5`, `6` | fixture |
| `delivered` | `4` | fixture |
| — | `0` | fixture; explicit not-found, never classified |
| `pending`, `registered`, `accepted`, `customs`, `out_for_delivery`, `returned` | — | not observed; reported as unmapped |

The status is shipment-level: only the newest scan inherits it, because the
code says nothing about where the parcel was three days ago. `statuses.json`
carries the full list with provenance.

## Limitations and privacy

- The endpoint is undocumented and keyless; it can change without notice.
- Scan descriptions are the provider's own text and are classified by the
  sync's wording rules, not here.
- No recipient name, address or signature is retained, and none is written to
  logs, fixtures or documentation.

## Verification log

- 2026-09-12: per-leg offsets replayed from the public prior-art payloads at
  `ha-sunyou`; ordering by instant confirmed to differ from ordering by
  wall-clock string.
- 2026-09-12: adapter moved into this folder from
  `src/server/upstreamAdapters.ts`; behaviour unchanged apart from the error
  taxonomy (`NotFoundError` / `SchemaError` replace the previous ad-hoc
  classes).
