# Amazon Shipping

## Identity and scope

Amazon Shipping (SWA, "Shipping with Amazon") is Amazon's carrier service for
parcels that Amazon itself moves and publishes tracking for, including
Multi-Channel Fulfillment (MCF) shipments. It shares its number formats with
Amazon Logistics (the `amazon-logistics` folder), which is account-only: the
same string can be either. The catalog therefore resolves the format to
`amazon-logistics` first, and a parcel is only promoted to `amazon-shipping`
after the public tracker returns a structured `SWA` or `MCF` response for it.
That check is the host's (`src/server/amazonShippingEligibility.ts`), and it is
repeated independently when a parcel is created or its carrier is changed — a
client-supplied carrier name is never taken as evidence.

This carrier is not user-selectable (`selectable: false`); it is only ever
reached through that verification.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public tracker | `https://track.amazon.{fr,it,es,co.uk,com}/tracking/{trackingNumber}` | The page we link to. |
| Canary | `https://track.amazon.fr/` | Credential-free reachability probe. |

The portal is chosen from the number's prefix: `IT`, `ES` and `UK`/`GB` have
their own, `TBA` uses `.com`, and every other European prefix goes through the
French portal. The data comes from the same origin at
`/api/tracker/{trackingNumber}`.

## What we retrieve

Retained: shipment status and stage, the event history (timestamp, coarse
location as city/region/country, a neutral English description and the raw
`eventCode`), and the expected delivery date while the parcel is undelivered.

Discarded: the merchant name (`shipperName`), the `addresses` block, the
recipient name carried on delivery events, the recipient contact details, and
the proof-of-delivery image. The event `location` object also carries the street
and postcode; only city, region and country are read out of it.

## Tracking numbers

Two shapes: a recognized European country prefix followed by ten digits
(`FR1234567890`), or `TBA` followed by twelve digits. Spaces, dots and dashes
are stripped and the value is upper-cased. The pattern is the catalog's single
source of truth — `core/detection/amazon` reads it from `amazon-logistics`'s
detection rule, so the two folders cannot drift apart. Samples live in
`numbers.json`; all three resolve to `amazon-logistics`, which is the intended
behaviour described above.

## How the adapter works

One step, `direct`. `AmazonShippingTracker.fetch()` normalizes the number,
derives the regional portal, and requests `/api/tracker/{number}` with the
matching public page as `Referer`, a 15 s timeout and a 2 MB cap.

The response nests JSON *inside* JSON: `progressTracker`, `eventHistory` and
`addresses` arrive as strings. Each is parsed defensively — an unparseable one
is a schema error, never an empty success.

Three checks run before any history is read. A `TRACKING_ID_NOT_FOUND` or
`INVALID_TRACKING_ID` error is a clean not-found. A `trackerSource` that is not
`SWA` or `MCF` is also not-found, because a generic page proves nothing. And any
tracking id the payload does echo must equal the requested number.

`SHIPMENT_OLDER_THAN_SUPPORTED_AGE` is its own outcome: Amazon knows the
shipment but no longer serves its history. The accompanying `IN_TRANSIT` summary
is a placeholder, so the adapter raises `AmazonShippingHistoryExpiredError`
instead of inventing movement; the host stores a history-expired marker and
stops scheduling syncs for that parcel.

Events are deduplicated on (time, location, code, description), sorted newest
first, and capped at 100. The shipment status comes from the summary when it
classifies, otherwise from the newest event that does.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | `CREATION_CONFIRMED`, `LABEL_CREATED`, `SHIPMENT_CREATED`, `INFORMATION_RECEIVED`, `REGISTERED` | fixture |
| accepted | `PICKUP_DONE`, `PICKED_UP`, `RECEIVED_FROM_SELLER`/`_SHIPPER`, `ACCEPTED_BY_CARRIER` | prior-art |
| in_transit | `IN_TRANSIT`, `RECEIVED`, `DEPARTED`, `ARRIVED`, `SORT_CENTER`, `DELIVERY_CENTER`, `TRANSPORT`, and `DELAYED`/`LATE` | fixture |
| out_for_delivery | `OUT_FOR_DELIVERY`, `swa_rex_ofd` | prior-art |
| ready_for_pickup | `READY_FOR_PICKUP`, `READY_FOR_COLLECTION`, `HOLD_FOR_PICKUP`, `AWAITING_CUSTOMER_PICKUP` | prior-art |
| delivered | `DELIVERED` | fixture |
| customs | `CUSTOMS…`, `CLEARANCE…` | prior-art |
| failed_attempt | `DELIVERY_ATTEMPTED`, `UNABLE_TO_DELIVER`, `UNDELIVERABLE…`, `DAMAGED`, `DESTROYED`, `REJECTED`, `CANCELLED`, `LOST`, `ADDRESS_PROBLEM`, `INFORMATION_NEEDED` | prior-art |
| returned | `RETURNED_TO_SENDER` and the rest of the return family | prior-art |
| pending | reached at shipment level only (`CREATION_CONFIRMED`); the event stage is `registered` | fixture |

`TRACKING_ID_NOT_FOUND` and `SHIPMENT_OLDER_THAN_SUPPORTED_AGE` are listed in
`statuses.json` as error codes rather than stages.

## Limitations and privacy

A `TBA` number identifies no country, so no timezone can be established for it.
Offset-free event times on such a shipment are dropped rather than stamped with
a guess, and the result carries no `timezone` at all.

Amazon Shipping sync calls this adapter directly and never falls back to a
universal provider: a negative answer here is the answer.

The lookup needs no credential. The private fields the payload carries are
dropped at projection, and the committed fixtures contain only made-up
identifiers. The live suite always probes a deliberately wrong number; a real
shipment is only exercised when `AMAZON_SHIPPING_LIVE_TRACKING_NUMBER` is set in
the environment, so no real tracking credential is ever committed.

## Verification log

- 2026-09-10: confirmed the public tracker answers an unknown id with HTTP 200
  and a `TRACKING_ID_NOT_FOUND` error body rather than a 404, and that
  `SHIPMENT_OLDER_THAN_SUPPORTED_AGE` arrives with a placeholder `IN_TRANSIT`
  summary.
- 2026-09-10: confirmed the regional portal mapping — `IT`, `ES`, `UK`/`GB` and
  `TBA` have their own hosts and every other prefix resolves through
  `track.amazon.fr`.
- 2026-09-12: adapter moved into this folder; the classifier moved to
  `status.ts` and the payloads to `fixtures/`. `AmazonShippingNotFoundError` now
  extends `NotFoundError` and `AmazonShippingHistoryExpiredError` extends
  `IndeterminateError`; both keep their names, because the host narrows on them
  with `instanceof`.
