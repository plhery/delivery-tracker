# Hermes Germany

## Identity and scope

Hermes Germany (myHermes) is Germany's largest independent parcel network:
home delivery, ParcelShops and parcel boxes. It is a different company from
Hermes Einrichtungs-Service (the `hermes` folder, two-man furniture delivery)
and from Evri, the former Hermes UK — Evri's `H` + 15 alphanumerics is
deliberately kept distinct from the `H` + digits format here.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public tracking | `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#{trackingNumber}` | The page we link to. |
| Canary | `https://www.myhermes.de/empfangen/sendungsverfolgung/` | Credential-free reachability probe. |

The data comes from `https://api.my-deliveries.de/tnt/v2/shipments/search/{number}`,
the anonymous recipient service the public page calls. A second,
postcode-protected endpoint returns the delivery address; it is never called.

## What we retrieve

Retained: shipment status and stage, the event history (UTC timestamp, the
carrier's own display wording and the raw `parcelStatus` code), the sending
retailer's company name, the delivery estimate while the parcel is moving, and
the delivery time once it has arrived.

Discarded: the `address` block (recipient name and street) that arrives in the
same payload, and any delivery preference the shipment carries.

Unavailable: the recipient service attaches no scan location to history rows, so
events carry no location at all.

## Tracking numbers

Eight to twenty characters, letters and digits, at least one digit. Two shapes
are catalogued: `H` followed by 15–19 digits, which is unique enough to select
this carrier outright, and a bare 14-digit form that stays a low-confidence
suggestion because several German carriers print the same length. Samples,
including three publicly reported numbers, live in `numbers.json`.

## How the adapter works

One step, `direct`. `HermesGermanyTracker.fetch()` requests the recipient
service with `X-Language: de`, a 15 s timeout and a 750 KB cap, accepting HTTP
errors so it can classify them: 404 is the carrier's clean not-found answer,
anything else stays an upstream error rather than being turned into "no such
parcel".

`parseHermesGermanyResponse()` then requires exactly one parcel whose `barcode`
equals the requested number, rejects a history that is empty or longer than 500
rows, drops exact `(time, status)` duplicates and the `EDL_BOOKED_DROPOFF`
preference booking, and sorts newest first. Timestamps are read with their own
offset (falling back to `Europe/Berlin`) and normalized to UTC.

Delivery is decided by the newest mapped milestone **or** the payload's
`parcelAttributes.delivered` flag. When the newest row carries a code this
folder does not map and nothing says delivered, the result is reported as
`unknown` with the history intact — the sync then classifies the wording and
records the code for review, rather than the adapter inventing a stage.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | `ANNOUNCED`, `ORDER_INFO_RECEIVED`, `PREANNOUNCED`, `PARCELSHOP_DROP_OFF`, `ATG_OUT_OF_WAREHOUSE` | fixture, official-doc |
| accepted | `HANDED_OVER`, `HANDED_OVER_TO_HERMES`, `TAKEN_OVER_BY_HERMES`, `PICKED_UP`, `SHIPMENT_PICKED_UP`, `PARCELSHOP_COLLECTED_BY_DRIVER` | fixture, official-doc |
| in_transit | `IN_TRANSIT`, `SORTED`, `ARRIVED_AT_DEPOT`, `ARRIVED_AT_DELIVERY_DEPOT`, `ARRIVED_IN_DESTINATION_REGION(_V2)` | official-doc |
| out_for_delivery | `DELIVERY_TOUR_STARTED`, `OUT_FOR_DELIVERY`, `NEXT_STOP` | fixture |
| delivered | `DELIVERED`, `DELIVERED_HOMEDELIVERY`, `DELIVERED_NEIGHBOUR`, `DELIVERED_DROPOFF`, `DELIVERED_MAILBOX`, `DELIVERED_PARCELSHOP`, `DELIVERED_PARCELBOX`, `PICKED_UP_BY_RECIPIENT`, `COLLECTED` | live (`DELIVERED_NEIGHBOUR`) |
| ready_for_pickup | `READY_FOR_PICKUP`, `PARCELSHOP_ITEMS_FOR_COLLECTION`, `READY_FOR_COLLECTION` | fixture |
| failed_attempt | `DELIVERY_FAILED`, `NOT_DELIVERABLE`, `UNKNOWN_WHEREABOUTS` | fixture |
| returned | `RETURN`, `RETURN_TO_SENDER`, `RETURN_DELIVERED_TO_SENDER`, `RETOURE_DELIVERED` | fixture |
| pending | not observed as an event stage; announcements are reported as `registered` | — |
| customs | not observed; reported as unmapped | — |

Full entries, with dates, are in `statuses.json`. `EDL_BOOKED_DROPOFF` is listed
there as deliberately unmapped.

## Limitations and privacy

Public tracking history expires: a number that was delivered months ago answers
with a clean 404, which the app shows as "not found" rather than an error. The
opt-in live test accepts either outcome for that reason.

The lookup needs no credential and the number alone unlocks the history, so it
is treated as part of the tracking credential. The address endpoint that would
need a postcode is never called, so no postcode for this carrier is ever sent.

## Verification log

- 2026-09-08: recipient protocol read from the carrier's own published bundle
  `https://gcp-prd.my-deliveries.de/tnt/bundle/tnt-bundle-v2.js`; the
  `parcelStatus` enum in `status.ts` comes from it.
- 2026-09-08: a publicly reported number from the Paketda Hermes forum returned
  five dated events ending in delivery to a neighbour.
- 2026-09-12: adapter moved into this folder; the milestone map moved to
  `status.ts` and the payloads to `fixtures/`. Live coverage stays in the host's
  grouped `expandedCarriers.live.test.ts`, so `HermesGermanyTrackingError` keeps
  its name and 404 status.
