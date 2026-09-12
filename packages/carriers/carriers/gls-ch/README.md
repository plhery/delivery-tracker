# GLS Switzerland

## Identity and scope

GLS (General Logistics Systems) is a pan-European parcel network. This folder
covers its Swiss operation, which also serves Liechtenstein, and it owns the
shared GLS implementation: the response parser, the status map and the URL
builders here are imported unchanged by `../gls-de/`, because both countries are
served by the same GROUP recipient service.

Swiss GLS parcels are frequently handed to Swiss Post for the last mile. When
the overview names Swiss Post as the delivery owner (`DELIVERY`/`CH01`), the
result carries `delivery_carrier: 'swiss-post'` so the app can offer the Swiss
Post view as well.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public tracking | `https://gls-group.eu/EU/en/parcel-tracking?match={trackingNumber}` | The page we link to. |
| Canary | `https://gls-group.eu/EU/en/parcel-tracking` | Credential-free reachability probe. |

Two endpoints behind it, both under
`https://gls-group.eu/app/service/open/rest/GROUP/en`: `rstt029` is the
anonymous overview, and `rstt028/{parcelNumber}` is the detailed history, which
requires the recipient's postcode.

## What we retrieve

Retained: shipment status and stage, the event history (timestamp, coarse scan
location and the GLS event number), the ParcelShop or locker name as the pickup
point, the parcel weight, the delivery estimate, the delivery time, the
canonical parcel number, and the Swiss Post handoff reference when GLS declares
one.

Discarded: recipient name, street, postcode and city from the delivery address,
the recipient's phone number, the signature, and customer/order references. The
scan `address` object contains a street and a postcode next to the city; only
the ParcelShop name, the country and the city are read out of it.

## Tracking numbers

Two forms: an 8-character alphanumeric Track ID containing at least one letter
and one digit, or an 11-to-14-digit parcel number. Both are low confidence in
detection — many carriers print the same shapes — so a number alone will not
select GLS; the user picks the carrier, or pastes a `gls-group.eu` link whose
country path (`CH`/`EU`) routes it here rather than to `gls-fr` or `gls-de`.

Samples live in `numbers.json`.

## How the adapter works

One step, `direct`, and up to two requests.

Without a postcode the adapter returns the overview alone: status, heading and
the handoff reference, but no event history — that is all the anonymous endpoint
gives.

With a postcode it first fetches the overview, which also translates an
8-character Track ID into the numeric parcel number the detail endpoint needs,
then fetches `rstt028` with the parcel number, the postcode and the requesting
owner's code. The detail result is returned, with the overview's verified Swiss
Post handoff merged back in — the detail response omits it.

Identity is checked on every response: the parcel must echo the requested
number on `tuNo`, `trackId`, `trackingId` or a track/parcel reference. GLS
accepts both the 11-digit parcel ID and its 12-digit printed form and can echo
only the first 11 digits, so that one alias is bound to an exact prefix match
and nothing else. Two matches are ambiguous, none is a different shipment.

HTTP 400, 403 and 404 are all the service's way of saying "no such parcel" and
become a clean not-found; every other non-OK status stays an upstream error.

Event stages come from the row's own status code when it has one, and from the
wording rules in `status.ts` otherwise — including the package's shared
multilingual classifier as the last resort. The newest event's wording is what
the app shows, because the progress-bar heading goes stale: a locker drop sticks
at "Delivered" upstream while the parcel is still waiting. A parcel flagged
`retourFlag` is an exception regardless of the heading.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| pending | `NORECORD` (reported as status `unknown`) | prior-art |
| registered | `PREADVICE`, `PLANNEDPICKUP`; "The parcel data was entered into the GLS IT system…" | fixture |
| accepted | `INPICKUP`; "The parcel was handed over to GLS." | fixture |
| in_transit | `INTRANSIT`, `INWAREHOUSE`; "reached/left the parcel center", "released by customs" | fixture |
| out_for_delivery | `INDELIVERY`; "The parcel is in delivery." | fixture |
| ready_for_pickup | `DELIVEREDPS`; "ready for collection", "ParcelShop", "locker" | fixture |
| delivered | `DELIVERED`; "The parcel has been delivered." | fixture |
| customs | "has not been released by customs", "Customs Consignment via Customs Portal" | fixture |
| failed_attempt | `NOTDELIVERED`; "delivery failed", "not delivered" | fixture |
| returned | `RETURNED`, `CANCELED`, `CANCELLED`, `FINAL`, `NOTPICKEDUP`; "returned to sender" | fixture |

"The parcel has not been handed over to GLS." is deliberately left unmapped.
Full entries are in `statuses.json`.

## Limitations and privacy

Without the postcode there is no event history at all — the anonymous overview
carries only the progress bar. That is why the postcode is a declared input
requirement for this carrier.

**The postcode is part of the tracking credential.** It is stored with the
parcel, sent only to the detail endpoint for that parcel, and never written to
logs, issues, metrics, fixtures or this documentation.

Scan timestamps arrive as a separate date and time with no offset and are read
as wall-clock times in `Europe/Zurich`.

## Verification log

- 2026-08-30: protocol read from the official frontend bundle
  `gls_group_witt002_js.js` at `gls-group.eu`; confirmed `rstt029` for the
  anonymous overview and `rstt028/{parcel}` with `postalCode` for the history.
- 2026-08-30: confirmed that HTTP 400, 403 and 404 all mean "no such parcel"
  here, and that the wrong-number body carries `lastError: E206`.
- 2026-09-12: adapter moved into this folder; the status map and wording rules
  moved to `status.ts` and the payloads to `fixtures/`.
  `GLSSwitzerlandTrackingError` now extends `NotFoundError` and keeps its name,
  because `../gls-de/adapter.ts` narrows on it with `instanceof`.
