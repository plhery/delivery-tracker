# GLS Germany

## Identity and scope

GLS Germany is the German arm of the GLS (General Logistics Systems) network.
It is served by the same GROUP recipient service as GLS Switzerland, so this
folder is a thin shell: the response parser, the status map, the wording rules
and the URL builders all live in `../gls-ch/` and are imported unchanged. What
is specific here is the postcode shape, the reported timezone, the error class
the host's live suite asserts, and the `recognizes()` probe.

`gls-group.eu` links are routed by country path: `/DE/` comes here, `/FR/` goes
to `gls-fr`, and `/CH/` or `/EU/` to `gls-ch`.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public tracking | `https://gls-group.eu/DE/de/paketverfolgung?match={trackingNumber}` | The page we link to. |
| Canary | `https://gls-group.eu/EU/en/parcel-tracking` | Credential-free reachability probe, shared with the Swiss folder. |

## What we retrieve

Identical to `../gls-ch/`: status and stage, the event history with coarse scan
locations and GLS event numbers, the ParcelShop or locker name, the parcel
weight, the estimate, the delivery time and the canonical parcel number. The
result's timezone is relabelled `Europe/Berlin`; both services run on CET/CEST,
so only the label differs.

Discarded, also identically: recipient name, street, postcode and city, phone
number, signature and customer references.

## Tracking numbers

Same two shapes as the Swiss folder — an 8-character alphanumeric Track ID or an
11-to-14-digit parcel number — and both stay low confidence, because several
German carriers print the same lengths. The delivery postcode may be four or
five digits here (Swiss or German), where `gls-ch` accepts four.

Because the numeric shape is ambiguous, the app does not guess: the carrier
detection route promotes a bare 11- or 12-digit number to `gls-de` only after
`recognizes()` confirms GLS itself knows it, and a provider failure there is
reported as a failure rather than as "not GLS". Samples, including two publicly
reported numbers, live in `numbers.json`.

## How the adapter works

One step, `direct`, and always two requests, because the postcode is required
here: the anonymous `rstt029` overview first, then `rstt028` with the parcel
number, the postcode and the requesting owner's code.

The overview is parsed and its identity validated *before* the postcode is sent,
so a wrong or expired number never causes the user's postcode to be transmitted.
A not-found from the shared parser is re-raised as `GLSGermanyTrackingError`, so
the German carrier reports its own error name.

`recognizes(number)` runs the overview against the `/DE/en/` variant of the
service and reports whether GLS returns a shipment with a known status. It
returns false for a clean not-found, and re-throws everything else — a challenge
or an outage must not be reported to the user as "this is not a GLS number".

HTTP 404 is only a not-found when the body carries GLS's own `lastError: E000`;
otherwise it stays an upstream error, so a challenge, an invalid postcode, a
rate limit or an outage cannot be mistaken for an expired parcel.

## Status reference

The map is the shared one in `../gls-ch/status.ts`; the table below is the same
as that folder's, and `statuses.json` here mirrors it.

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

## Limitations and privacy

**The delivery postcode is part of the tracking credential.** It is stored with
the parcel, sent only to the detail endpoint after the overview has confirmed
the parcel's identity, and never written to logs, issues, metrics, fixtures or
this documentation.

Public history expires: a number whose parcel was delivered long ago answers
with `lastError: E000` and is shown as not found.

## Verification log

- 2026-09-08: a publicly reported GLS Germany number from the Paketda forum
  returned the explicit retired/not-found response (`E000`, HTTP 404), with no
  postcode-protected detail request made. Successful detail parsing is covered
  by synthetic fixtures instead.
- 2026-09-12: adapter moved into this folder; it now imports the shared
  implementation from `../gls-ch/adapter`. `GLSGermanyTrackingError` extends
  `NotFoundError` and keeps its name and 404 status, because the host's grouped
  `expandedCarriers.live.test.ts` asserts them. The constructor still accepts a
  positional timeout, because `app/api/carriers/detect/route.ts` constructs it
  as `new GLSGermanyTracker(5_000)`.
