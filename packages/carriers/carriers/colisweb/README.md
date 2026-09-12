# Colisweb

## Identity and scope

Colisweb schedules appointed last-mile deliveries in France for retailers:
furniture, appliances, anything delivered in a booked time slot rather than
dropped at a door. A shipment is therefore a *delivery*, with a slot and three
milestones, not a parcel travelling through a sorting network. This folder
covers its public recipient search (`region.countries: ["FR"]`).

Timezone: `Europe/Paris`. Brand colour `#ff8a00`.

## Portals

| What | Where |
|---|---|
| Recipient portal | `https://www.colisweb.com/suivi-livraison?value={trackingNumber}` |
| Endpoint used | `POST https://www.colisweb.com/api/search` |
| Canary | `https://www.colisweb.com/suivi-livraison` |

Links pasted from `colisweb.com` with a `value` or `trackingNumber` parameter
resolve to this carrier.

## What we retrieve

Declared capabilities: `history`, `eta`.

| Portal shows | We retain | We drop |
|---|---|---|
| current step | status, current stage | — |
| confirmation, pickup and delivery times | history | — |
| booked delivery slot | the slot's starting day, as the estimate | the slot's end time |
| retailer name | — | retailer name |
| recipient name and address | — | recipient name and address |

There is no scan history: the result's events are the three milestone
timestamps the endpoint returns (`deliveryConfirmationDate`, `pickedUpDate`,
`deliveredDate`), newest first, plus one entry for the current step when no
milestone already carries its stage. The estimate is the calendar day of
`startsAt` and is dropped once the delivery is finished or failed. Timestamps
carry their own offset and are kept verbatim.

## Tracking numbers

Digits only, 8 to 32 of them, spaces removed. `carrier.json` declares no
detection rule: the shape is shared with too many carriers to claim, so
Colisweb is reached by pasting a `colisweb.com` link or by choosing the carrier
in the picker. `numbers.json` keeps one invented sample as a shape check and
records that other carriers' rules answer for it.

## How the adapter works

One step, `direct`: a bounded `POST` of `{"value":"…"}` with a 15 s timeout, a
500 kB cap and `redirect: 'error'`. Then:

1. HTTP 400, 404 or 422 is a not-found.
2. An empty HTTP 500 is **indeterminate**, not a not-found — see below.
3. Any other non-2xx whose body says "not found", "introuvable" or "inconnu" is a
   not-found; anything else is an `UpstreamHttpError`.
4. `parse()` requires `searchValue` to echo the requested number and rejects
   anything else as a schema error.

## Status reference

Machine steps, no wording. Steps are compared with case and separators removed,
so `pickedUp`, `picked_up` and `PICKED_UP` are the same entry.

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| delivered | delivered | fixture |
| delivered | delivery_pb_ok | official-doc |
| returned | delivery_returned | fixture |
| returned | package_returned, package_return_failed, delivery_return_failed, canceled, delivery_canceled | official-doc |
| failed_attempt | non_deliverable | fixture |
| failed_attempt | pickup_failed, package_withdrawal_failed, delivery_failed | official-doc |
| out_for_delivery | out_for_delivery, delivery_in_progress | official-doc |
| in_transit | picked_up | fixture |
| in_transit | package_withdrawn, package_withdrawal_pb_ok | official-doc |
| registered | confirmed | fixture |
| registered | idle, course_accepted | official-doc |
| pending | not observed; reported as unmapped |  |
| accepted | not observed; reported as unmapped |  |
| customs | not observed; reported as unmapped |  |
| ready_for_pickup | not observed; reported as unmapped |  |

An unlisted step produces a result with no `current_stage` and one event with no
stage; the sync classifies it and records it for review.

## Limitations and privacy

- **An empty HTTP 500 is not a not-found.** A validly shaped unknown number
  currently answers HTTP 500 with no body. The official UI renders its
  "not found" card from it, but the response proves nothing about the shipment,
  so the adapter reports `IndeterminateError` (status 502) and the parcel is
  retried instead of being marked unknown.
- No scan locations, weight or dimensions are exposed, so those capabilities are
  not declared.
- The booked slot's end time is deliberately dropped: only the starting day is
  kept as the delivery estimate.
- The retailer name and the recipient block are never retained (`PRIVACY.md`).

## Verification log

- 2026-09-12: adapter, tests and the step map moved into this folder. The
  provider-specific error classes were replaced by `NotFoundError` and
  `IndeterminateError` from `core/errors`, keeping the same messages and HTTP
  statuses; the `upstreamStatus: 500` field on the old class is gone.
- 2026-09-12: an unknown number (`99999999`) answers with an empty HTTP 500; the
  opt-in live test asserts the indeterminate result rather than a clean 404.
