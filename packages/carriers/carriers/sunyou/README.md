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

## Implementation decisions

- **Order by absolute instant, never by wall-clock string.** Origin scans carry
  `+08:00` and destination scans a European offset; comparing the raw strings
  put a Chinese scan before a later European one. Applying each leg's own
  offset and sorting by instant fixes the order without touching the text of
  scans that have no offset.
- **A scan without a usable offset keeps the provider's text.** This is
  deliberately not `core/time`'s `explicitOffsetTime`, which rejects a value it
  cannot resolve: a naive string is still the only thing the carrier said about
  that scan, and dropping it would lose history while inventing a zone would be
  worse. The local helper carries that reasoning in a comment.
- **Only the newest scan inherits the shipment stage.** `displayStatus` is a
  shipment-level code; stamping it on every event would claim the parcel was
  delivered at each of its earlier scans.
- **`displayStatus: "0"` and `has !== true` are both a clean 404.** Those are
  the two ways the endpoint says it does not know the shipment.
- **The JSONP envelope is unwrapped before parsing.** An outage or challenge
  page does not unwrap, so it is reported as an invalid response and stays
  retryable instead of being mistaken for a not-found.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('SunYou')` (same message, same
  404) and the payload-shape `TypeError`/`RangeError`s became `SchemaError`
  with their messages unchanged.

## Rejected alternatives

- **Assuming Asia/Shanghai for offset-less origin scans.** Most scans do carry
  an offset; guessing a zone for the rest would produce timestamps that look
  authoritative and are not.
- **Treating an HTML response as "shipment unknown".** It is far more likely to
  be an outage or a bot challenge; classifying it as a not-found would make the
  sync stop checking a parcel that still exists.
- **Mapping the scan descriptions here.** They are free text in several
  languages; the sync's shared wording classifier already handles them and
  records what it could not map.


## Verification log

- 2026-09-12: per-leg offsets replayed from the public prior-art payloads at
  `ha-sunyou`; ordering by instant confirmed to differ from ordering by
  wall-clock string.
- 2026-09-12: adapter moved into this folder from
  `src/server/upstreamAdapters.ts`; behaviour unchanged apart from the error
  taxonomy (`NotFoundError` / `SchemaError` replace the previous ad-hoc
  classes).
