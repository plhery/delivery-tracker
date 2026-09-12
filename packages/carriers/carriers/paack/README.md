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
| `failed_attempt` | `absent`, `notDelivered`, `returnToSenderScheduled`, `returnAbsent`, `returnOther` | fixture |
| `exception` | `incorrectAddress`, `integrationError`, `notAccepted`, `rejected`, `damaged`, `lost`, `nonDeliverable`, `cancelled` | fixture |
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

## Implementation decisions

- **Read the embedded loader payload, not a second API.** The recipient page is
  a Remix app and ships its `routes/tracking.order` loader response inside
  `window.__remixContext`. One bounded GET therefore returns everything the page
  itself renders, with no undocumented API call and no extra round trip.
- **`redirect: 'manual'`.** A wrong number or postcode is answered with a 3xx
  back to the form. Following it would return a generic page; treating the 3xx
  itself as the answer makes the wrong-number path explicit and cheap.
- **Map identifiers, not labels.** `label` is a translation key and the page is
  localized per viewer, so both `id` and `label` are reduced to letters and
  digits and matched by substring. That keeps suffixed variants
  (`scannedAtOriginHeader`, `pudoAssignedHeader`) on the same stage.
- **Failure rules before delivery rules.** `notDelivered` contains `delivered`;
  testing the failure list first is what stops a failed parcel from being shown
  as delivered.
- **Scheduled returns are not `returned`.** `returnToSenderScheduled`,
  `returnAbsent` and `returnOther` describe a return that has been *planned*.
  They map to `failed_attempt` so the parcel stays active, and only
  `returnedToSender` / `returnedToRetailer` reach the terminal stage.
- **`activeEvent` wins when it is mapped.** The banner can be ahead of the
  timeline; when its identifier maps to a known stage it decides the result's
  status, while the timeline keeps its own per-event stages.
- **The postcode is a credential.** Half of the lookup key, treated like a
  tracking secret; `InputRequiredError` when it is missing.

## Rejected alternatives

- **Adding a detection rule.** Paack numbers are retailer order numbers with no
  stable shape; every publicly reported example in `numbers.json` either matches
  nothing or matches another carrier's rule. A rule here would cost precision
  everywhere else, so the carrier is chosen manually or through its link.
- **Keeping per-event `variables`.** They exist to interpolate the recipient's
  name, address and phone into localized sentences. The parser omits them.
- **Publishing the delivery window's start as `expected_delivery_from`.** The
  start and end describe one day's slot; only the end date is retained, and the
  window capability is not declared.
- **Using `core/time` for event stamps.** The loader mixes epoch seconds, epoch
  milliseconds and offset-bearing ISO strings in the same field, and the result
  keeps millisecond precision, which the core helpers deliberately suppress. The
  local helper stays, with a comment saying why.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `00100909086360120251130131718` (shipment, `public_shipment_report`, [source](https://www.ocu.org/reclamar/lista-reclamaciones-publicas/mucho-retraso-en-entrega/3e6c4a88d9208bdbc4)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (MRW, not Paack) |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

Also tried the other 4 public numbers on Ship24: all 404.

## Verification log

- 2026-09-12: moved into this folder; the Remix-context extraction, the
  identifier check and the status map are unchanged.
- 2026-09-12: `PaackTrackingError` → `NotFoundError` (same 404 and message);
  payload rejections → `SchemaError`; the empty body → `IndeterminateError`.
- 2026-09-12: universal-provider probe with corpus number `00100909086360120251130131718`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
