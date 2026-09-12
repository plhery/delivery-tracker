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

## Implementation decisions

- 2026-08-30: use the two endpoints the official frontend uses — `rstt029` for
  the anonymous overview, `rstt028` with the recipient postcode for the history
  — rather than scraping the tracking page.
- 2026-08-30: keep this folder as the shared GLS implementation. `../gls-de/`
  imports the parser, the status map and the URL builders from here, because
  both countries are served by the same GROUP service and two copies would
  drift.
- 2026-08-30: return the overview alone when no postcode is stored, instead of
  failing. A status with no history is still worth showing, and it is all the
  anonymous endpoint has.
- 2026-08-30: let the newest history row outrank the progress-bar heading. The
  heading goes stale — a ParcelShop drop sticks at "Delivered" upstream — so
  `DELIVEREDPS` maps to `ready_for_pickup` with status `out_for_delivery`, and
  the newest event's own wording is what the app shows.
- 2026-08-30: bind the 12-digit printed number to an 11-digit echo by exact
  prefix only. GLS's own ShipIT documentation describes that truncation; without
  the exact-prefix rule, an unrelated numeric parcel in the same response could
  be accepted as a match.
- 2026-08-30: treat "The parcel has not been handed over to GLS." as unmapped.
  It is a negative statement about possession, and any wording rule that sees
  "handed over to GLS" would read it as an acceptance scan.
- 2026-08-30: keep coarse scan locations (ParcelShop name, country, city) and
  drop the street and postcode that sit in the same `address` object.
- 2026-09-12: `GLSSwitzerlandTrackingError` now extends `NotFoundError` and
  keeps its own name; `../gls-de/adapter.ts` narrows on it with `instanceof`.
  The remaining `TypeError`/`RangeError`s became `SchemaError` with their
  original messages. The wording fallback now imports `trackingLanguageStage`
  from `core/status` instead of the host's `src/server/trackingLanguage.ts`.

## Rejected alternatives

- Asking for the postcode before the overview: the overview is what translates a
  Track ID into the parcel number the detail call needs, and it is what carries
  the Swiss Post handoff, so it has to run first either way.
- Sending the postcode to the overview endpoint: it does not need one, and a
  credential should not be sent to an endpoint that has no use for it.
- Trusting the progress bar's `statusInfo` alone: see the locker case above.
- Classifying wording before codes: codes are stable across the service's
  languages; wording is not. Wording is only consulted for rows that carry no
  code.


## Verification log

- 2026-08-30: protocol read from the official frontend bundle
  `gls_group_witt002_js.js` at `gls-group.eu`; confirmed `rstt029` for the
  anonymous overview and `rstt028/{parcel}` with `postalCode` for the history.
- 2026-08-30: confirmed that HTTP 400, 403 and 404 all mean "no such parcel"
  here, and that the wrong-number body carries `lastError: E206`.
- 2026-09-08: Swiss Post's published GLS example `993990103198` no longer has
  retained history and answers with the clean not-found path; the live test
  asserts exactly that.
- 2026-09-12: adapter moved into this folder; the status map and wording rules
  moved to `status.ts` and the payloads to `fixtures/`.
  `GLSSwitzerlandTrackingError` now extends `NotFoundError` and keeps its name,
  because `../gls-de/adapter.ts` narrows on it with `instanceof`.
