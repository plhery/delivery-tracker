# Planzer

## Identity and scope

Planzer is a Swiss transport and logistics group. Two kinds of shipment reach
this folder:

- **Ordinary deliveries**, tracked by their shipment number. Twenty-digit
  delivery IDs carry the `91346097` prefix; other bare twenty-digit numbers are
  deliberately kept out of Planzer routing.
- **Shared shipments** (`999.90.########`), which are not in the tracking API
  at all and need the complete shared link with its `accessKey`.

The same adapter also serves the `quickpac` carrier id: Quickpac's eighteen-digit
`44…` identifiers use this API and this public page (docs/CARRIERS.md). Quickpac
keeps its own carrier id for detection and display only.

## Portals

| Portal | URL | What it is |
|---|---|---|
| Tracking app | `https://tracking.app.planzer.ch/delivery/info?deliveryNumber={trackingNumber}` | The public page for an ordinary shipment; the canary probes its root. |
| Shared link | `https://trackandtrace.planzergroup.com/shared/sendungen/{number}?accessKey=…` | A capability URL for one shared shipment. |

The tracking app is backed by `api.tracking.app.planzer.ch/api/v1/shipments/
{shipment}/Pak`, a keyless JSON API. The shared link has no API behind it: the
route page itself is read.

## What we retrieve

Retained: the shipment status and stage, the newest status text, every
milestone with its timestamp and its own stage, and the delivery day as the
estimate. The shared route adds our own neutral description per reached step.

Discarded: everything else the payload can carry, including the consignee block
and the signature (exercised by `fixtures/delivered.json`), and the transport
positions that belong to a different shipment in the same delivery.

Unavailable: scan locations. Neither route publishes them, so events carry an
empty location rather than an invented one.

## Tracking numbers

| Rule | Shape | Note |
|---|---|---|
| `planzer-1` | `999.90.########` | Shared shipments; the tracking URL is required for these. |
| `planzer-2` | `91346097` + 12 digits | Twenty-digit delivery IDs. |

A number containing a dot is treated as `reference.shipment`: only the shipment
half is looked up, without its leading zeros. Samples and what the engine
answers for them are in `numbers.json`.

## How the adapter works

One bounded request per lookup with a 10-second timeout, declared as a single
`direct` step. The factory picks the route: a parcel with a tracking URL goes
to the shared-link tracker, everything else to the API.

The API call replays once after a transport failure or an HTTP 502, 503 or 504,
and after an HTTP 429 only when it supplies a short, valid `Retry-After`
(docs/CARRIERS.md). Invalid data and other HTTP errors are never retried.

A response may contain transport positions of other shipments, so only the
position whose `positionNumber` equals the requested shipment number is read.
An unfamiliar milestone label is an error, not an unmapped event: Planzer's
label vocabulary is small and stable, and silently accepting new wording risks
turning an unknown state into a delivery.

The shared route page carries no status code. Its five steps are read from the
markup: the tooltip label names the stage, `text-primary` marks the steps
already reached, and the `<time datetime>` next to each carries its timestamp.

## Status reference

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| `registered` | `Recorded` | live 2026-09-06 |
| `in_transit` | `Transferred` | live 2026-09-06 |
| `out_for_delivery` | `In delivery` | live 2026-09-06 |
| `delivered` | `Shipped` | live 2026-09-06 |
| `in_transit` | `Shipment on the way` | fixture |
| `out_for_delivery` | `Shipment out for delivery` | fixture |
| `delivered` | `Delivered`, `Shipment delivered` | fixture |
| `failed_attempt` | `Not delivered` | fixture |
| `registered` / `in_transit` / `out_for_delivery` / `delivered` | German, French and Italian aliases | fixture (generated) |
| `accepted` | `Abholung` (shared route step only) | fixture |
| `pending`, `customs`, `ready_for_pickup`, `returned` | — | not observed; reported as unmapped |

`Shipped` is Planzer's English label for *delivered* (Zugestellt / Livré), not
for *dispatched*. The full list with provenance is in `statuses.json`.

## Limitations and privacy

- The shared link's `accessKey` is part of the tracking credential. It is
  validated, used for one lookup, and never written to logs, issues, metrics,
  fixtures or documentation.
- Both endpoints are undocumented and keyless; they can change without notice.
- Milestone timestamps carry no offset; the catalog timezone (`Europe/Zurich`)
  is applied by the host.
- No consignee name, address or signature is retained.

## Verification log

- 2026-09-06: a real Quickpac delivery returned the four milestones `Recorded`,
  `Transferred`, `In delivery` and `Shipped`, with sub-second timestamps and no
  offset.
- 2026-09-12: adapter and shared-link tracker moved into this folder;
  behaviour unchanged apart from the error taxonomy (`NotFoundError` /
  `SchemaError` replace `PlanzerTrackingError` and the ad-hoc `TypeError`s).
