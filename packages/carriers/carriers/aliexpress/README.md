# AliExpress / Cainiao

## Identity and scope

Cainiao is Alibaba's logistics network and carries most AliExpress orders on
their international leg. It is rarely the last mile: the parcel is handed to a
local postal operator or courier, and Cainiao publishes that partner number
when it has one. Parcels reach this folder because the sender picked AliExpress
or pasted a `global.cainiao.com` link — the catalog has no exclusive detection
rule for Cainiao numbers (see `numbers.json`).

Swiss inbound letter post is a special case: a checksum-valid `L…CH` S10
identifier is checked against Swiss Post before every sync, and Cainiao
supplies the history only until Swiss Post announces the shipment
(docs/CARRIERS.md, "AliExpress handoff to Swiss Post").

## Portals

| Portal | URL | What it is |
|---|---|---|
| Consumer detail page | `https://global.cainiao.com/detail.htm?mailNoList={trackingNumber}` | The page the tracking link opens. |
| Canary | `https://global.cainiao.com/` | Probed daily for availability. |

The page is backed by `global.cainiao.com/global/detail.json`, a keyless JSON
endpoint that takes one or more `mailNos` and answers with one module each.
That endpoint is what the adapter reads; no session, cookie or token is
involved.

## What we retrieve

Retained: the shipment status and stage, the newest status text, up to twenty
scans (timestamp and description), the estimated delivery window, the
delivered-at time, and the partner number the parcel was handed over with.

Discarded: everything else a module can carry, including the recipient
identity block and proof-of-delivery links (exercised by `fixtures/`).

Unavailable: scan locations. The endpoint returns none, so every event carries
an empty location rather than an invented one.

## Tracking numbers

Cainiao numbers have no exclusive shape: `LP` + 14 digits collides with several
other networks, and published samples resolve elsewhere or nowhere at all.
`numbers.json` records two samples and what the engine actually answers for
them; neither is a positive oracle for this carrier.

## How the adapter works

One bounded GET with a 10-second timeout, declared as a single `direct` step.
There is no second tier: the endpoint is either reachable or it is not.

The response may describe several shipments, so the module whose `mailNo`
equals the requested number is the only one read; anything else is a schema
error rather than a stranger's parcel.

Status precedence: the newest `latestTrace.actionCode` decides. Only when no
action code is present does the coarse parcel-level token decide, and only when
neither exists does the shipment fall back to pending (no history) or unknown.

A module with no status, no history and no latest trace is a positive
not-found only when `mailNoSource` is `EXTERNAL`; otherwise the seller has
simply not handed the parcel over yet and the shipment stays pending.

## Status reference

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| `registered` | `GWMS_ACCEPT`, `GWMS_PACKAGE`, `PRE_READY_TO_SHIP`, `CONSIGN`, `WAIT_SELLER_SEND_GOODS`, `SELLER_SEND_GOODS` | fixture / prior art |
| `in_transit` | 26 line-haul, customs and hub codes (`LH_*`, `CC_*`, `SC_*`, `TD_*`, `CW_*`, `GTMS_ACCEPT`, `COMMON_INTRANSIT`, …) | fixture / prior art |
| `out_for_delivery` | `GTMS_DO_DEPART` | fixture |
| `ready_for_pickup` | `GSTA_INFORM_BUYER`, `GTMS_WAIT_SELF_PICK`, `GTMS_STA_SIGNED` | fixture / prior art |
| `delivered` | `GTMS_SIGNED`, `SIGN` | fixture / prior art |
| `exception` | `CC_IM_FAILURE`, `CC_IM_EXCEPTION`, `GTMS_STA_SIGN_FAILURE`, `EXCEPTION`, `FAILED`, `RETURNED` | prior art |
| `pending`, `accepted`, `customs`, `returned` | — | not observed; reported as unmapped |

The full list with provenance is in `statuses.json`. An action code that is not
in the map leaves the event without a stage, and the sync classifies its
wording and records it for review.

## Limitations and privacy

- The endpoint is undocumented and keyless; it can change without notice, and
  failures stay visible as sync errors rather than being retried away.
- `GTMS_STA_SIGNED` means a pickup station signed, not the recipient. It must
  never read as delivered, and it does not.
- No recipient name, address, contact or proof-of-delivery link is retained,
  and none is written to logs, fixtures or documentation.

## Implementation decisions

- **The action code wins over the parcel token.** Real parcels carry
  parcel-level `status` values from an unestablished vocabulary
  (`DELIVERED`, `CLEAR_CUSTOMS`, `transport`, `pickup`, `delivered`), while
  `latestTrace.actionCode` is a documented per-leg scan code. The token is kept
  only as a fallback for modules that have no trace yet.
- **A station signature is not a delivery.** `GTMS_STA_SIGNED` maps to
  `ready_for_pickup`, not `delivered`: the parcel is at a pickup station and
  the recipient has not collected it.
- **The pickup distinction is derived once per lookup.** Whether
  `out_for_delivery` means "on the van" or "waiting at a pickup point" depends
  on the newest action code, and the same table is then applied to the whole
  history. This is the pre-move behaviour and is preserved deliberately;
  changing it would rewrite the stage of historical events on re-sync.
- **Empty external modules are the only positive not-found.** An empty module
  whose `mailNoSource` is not `EXTERNAL` means the seller has not shipped yet.
  Turning that into a 404 would make the sync give up on a parcel that is
  simply early.
- **The handoff number is read from `copyRealMailNo` first.** `realMailNo` is
  display prose; the identifier is extracted from it only when the
  machine-readable field is missing or malformed.
- 2026-09-12: moved out of `src/server/upstreamAdapters.ts` into this folder.
  `UpstreamTrackingError` became `NotFoundError('Cainiao')` (same message, same
  404) and the payload-shape `TypeError`/`RangeError`s became `SchemaError`
  with their messages unchanged.

## Rejected alternatives

- **Mapping the parcel-level token as the primary signal.** Its vocabulary is
  not established across regions; two parcels in the same state have been seen
  carrying different tokens.
- **Stamping a timezone on the scan strings.** Cainiao returns wall-clock text
  with no offset and no zone. The provider text is passed through unchanged and
  the carrier's catalog timezone is applied by the host, rather than guessing
  UTC here.
- **Inventing scan locations from the description.** The endpoint exposes none;
  an empty location is honest, a parsed one would not be.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `CNG00798678939847` (shipment, `public_shipment_report`, [source](https://www.paketda.de/fragen-antworten.php)).

| Provider | Result |
| --- | --- |
| Ship24 | ✅ Compatible — 25 events via Cainiao |
| ParcelsApp | ❌ No usable history — empty result page, and the direct tier times out (2026-09-13) |
| 17TRACK | ✅ Compatible — 25 events, delivered via Cainiao; discovered `aliexpress` (2026-09-13) |

## Verification log

- 2026-09-12: adapter moved into this folder from `src/server/upstreamAdapters.ts`;
  behaviour unchanged apart from the error taxonomy (`NotFoundError` /
  `SchemaError` replace the previous ad-hoc classes).
- 2026-09-12: universal-provider probe with corpus number `CNG00798678939847`: Ship24: compatible; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `CNG00798678939847` via prod TRAWL: compatible (25 events, delivered).
- 2026-09-13: ParcelsApp direct-tier re-probe: no usable history (request times out, as on the page).
