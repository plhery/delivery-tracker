# Quickpac

## Identity and scope

Quickpac is a Swiss parcel service delivering to private addresses. Its
eighteen-digit `44…` identifiers now use the same tracking API and the same
public tracking page as ordinary Planzer deliveries, so this folder has no
adapter of its own: `carrier.json` points `tracking.adapter` at `planzer` and
the generated registry serves both ids from
[`carriers/planzer/adapter.ts`](../planzer/adapter.ts).

The separate Quickpac carrier id is retained for number detection and display
only; it no longer selects a legacy Quickpac adapter (docs/CARRIERS.md,
"Planzer shared links"). Existing Quickpac parcels keep their carrier label.

## Portals

| Portal | URL | What it is |
|---|---|---|
| Tracking app | `https://tracking.app.planzer.ch/delivery/info?deliveryNumber={trackingNumber}` | The public page a Quickpac number opens; the canary probes its root. |
| Quickpac links | `quickpac.ch` with a `parcel` parameter | Recognized when pasted, so an older link still resolves. |

The page is backed by `api.tracking.app.planzer.ch/api/v1/shipments/{shipment}/Pak`,
the keyless JSON API described in the Planzer folder.

## What we retrieve

Identical to Planzer: the shipment status and stage, the newest status text,
every milestone with its timestamp and its own stage, and the delivery day as
the estimate. The consignee block, the signature and transport positions
belonging to a different shipment are dropped. Scan locations are not published
by the API, so events carry an empty location.

## Tracking numbers

| Rule | Shape | Note |
|---|---|---|
| `quickpac-1` | `44` + 16 digits | Eighteen digits in total; printed as `44.00.123456.12345678`. |

`numbers.json` holds one synthetic sample built to that shape. Shared
`999.90.########` shipments are Planzer's, not Quickpac's, and live in the
Planzer folder.

## How the adapter works

See [`carriers/planzer/README.md`](../planzer/README.md#how-the-adapter-works).
One bounded request with a 10-second timeout, a single `direct` step, and one
replay after a transport failure or an HTTP 502, 503 or 504. Only the transport
position whose number equals the requested shipment is read, and an unfamiliar
milestone label is an error rather than an unmapped event.

## Status reference

The vocabulary is Planzer's; `statuses.json` repeats it here so this folder can
be read on its own.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| `registered` | `Recorded` | live 2026-09-06 |
| `in_transit` | `Transferred`, `Shipment on the way` | live 2026-09-06 / fixture |
| `out_for_delivery` | `In delivery`, `Shipment out for delivery` | live 2026-09-06 / fixture |
| `delivered` | `Shipped`, `Delivered`, `Shipment delivered` | live 2026-09-06 / fixture |
| `failed_attempt` | `Not delivered` | fixture |
| `accepted` | `Abholung` (shared route step only) | fixture |
| `pending`, `customs`, `ready_for_pickup`, `returned` | — | not observed; reported as unmapped |

`Shipped` means *delivered*, not *dispatched*.

## Limitations and privacy

- The endpoint is undocumented and keyless; it can change without notice.
- Milestone timestamps carry no offset; the catalog timezone (`Europe/Zurich`)
  is applied by the host.
- No consignee name, address or signature is retained.

## Verification log

- 2026-09-06: a real Quickpac delivery returned the four milestones `Recorded`,
  `Transferred`, `In delivery` and `Shipped` through the Planzer API.
- 2026-09-12: documented as a Planzer-served carrier when the adapter moved
  into `carriers/planzer/`; no behaviour change.
