# Paack

## Identity and scope

Paack (Paack Logistics) is a last-mile carrier for online retailers, strongest
in Spain and Portugal and also delivering in France and the United Kingdom.
Automatic tracking is enabled through its public recipient page; the carrier is
selectable in the manual picker on the web and in both iPhone interfaces.

## Portals

| Purpose | URL |
|---|---|
| Recipient page | https://mydeliveries.paack.app/tracking?tracking_number={trackingNumber} |
| Endpoint the adapter reads | https://mydeliveries.paack.app/tracking/order?tracking_number=…&postal_code=… |

Recognized tracking links: any `mydeliveries.paack.app` URL carrying a
`tracking_number` parameter.

The page shows the status, the timeline, the delivery window, the retailer and
the recipient's name, address, e-mail and phone. Only the status, the timeline
and the delivery window are retained.

## What we retrieve

| Field | Retained | Note |
|---|---|---|
| `status`, `current_stage` | yes | from `activeEvent` when it is mapped, otherwise the newest mapped timeline entry |
| `events[].time` | yes | millisecond-precision UTC |
| `events[].stage` | yes | from `status.ts` |
| `events[].description` | yes | our own English wording, not the provider's |
| `expected_delivery` | yes | end of the delivery window, dropped once the parcel is delivered or in exception |
| `events[].location` | no | the loader exposes no operational location |
| retailer, recipient name, e-mail, phone, address, per-event `variables` | no | never read |

Declared capabilities: `history`, `eta`.

## Tracking numbers

Four to forty ASCII letters and digits with at least one digit — in practice the
retailer's order number (`EXCHANGE000001D`). The lookup also needs the delivery
postcode, 3 to 10 alphanumeric characters, which covers Spanish, Portuguese,
French and UK formats. No shape is distinctive enough for a detection rule, so
`carrier.json` declares none and Paack is chosen manually or through a link.
`numbers.json` records five publicly reported numbers; the engine claims none of
them for Paack, which is the honest answer for a carrier with no rule.

## How the adapter works

One step, `direct`, one bounded GET with `redirect: 'manual'`. The page is a
Remix application, so the loader response for `routes/tracking.order` is already
embedded in `window.__remixContext`; reading it avoids a second undocumented API
call and gives exactly what the page renders.

- A 3xx redirect back to the form, or an HTTP 404, is the wrong-number answer
  and becomes a clean `NotFoundError`.
- "Order not found" / "Incorrect order number or postal code" (and its French
  and Spanish translations) in the HTML or in the loader payload is the same
  answer in another shape.
- `orderTrackData.external_id` must equal the number requested.
- Entries flagged `timeline: false` are skipped; the rest are de-duplicated,
  sorted newest first and capped at 100.

## Status reference

Timeline entries carry a stable `id` and a translation `label`; the map keys on
those, never on the localized text.

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| `returned` | `returnedToSender`, `returnedToRetailer` | fixture |
| `failed_attempt` | `incorrectAddress`, `absent`, `notDelivered`, `integrationError`, `returnToSenderScheduled`, `returnAbsent`, `returnOther` | fixture |
| `delivered` | `delivered` | fixture |
| `out_for_delivery` | `driverAssigned`, `inProgress` | fixture |
| `ready_for_pickup` | `readyForPickup`, `atPickupPoint` | prior-art |
| `registered` | `orderReactivated`, `appointmentRescheduled`, `appointmentBroughtForward`, `manifested`, `created` | fixture |
| `accepted` | `scannedAtOrigin` | fixture |
| `in_transit` | `receivedAtHub`, `pudoAssigned`, `sorted`, `warehouse` | fixture |
| `pending` | reached through `registered` identifiers only | fixture |
| `customs` | not observed; reported as unmapped | — |

Return states that are only *scheduled* deliberately stay `failed_attempt`, not
`returned`, so a parcel that can still be delivered is not shown as final.
Unrecognized identifiers keep the neutral description "Shipment update".

## Limitations and privacy

- The postcode is half of the lookup key and part of the tracking credential:
  never logged, never committed, never in an issue. The factory raises
  `InputRequiredError` when the parcel has none.
- An empty HTTP 200 proves nothing and is reported as `IndeterminateError`.
- The delivery window's start is not retained separately; only the end date is
  published as `expected_delivery`, and it is dropped once the parcel is
  delivered or in exception.

## Verification log

- 2026-09-12: moved into this folder; the Remix-context extraction, the
  identifier check and the status map are unchanged.
- 2026-09-12: `PaackTrackingError` → `NotFoundError` (same 404 and message);
  payload rejections → `SchemaError`; the empty body → `IndeterminateError`.
