# DHL

## Identity and scope

DHL's German parcel and tracked-mail service (Deutsche Post DHL, brand names
"DHL Paket" and, for letters, "DHL Sendungsverfolgung"), tracked through the
recipient endpoint behind `www.dhl.de`. Last mile: Germany. Other DHL
divisions have their own portals and their own folders: DHL eCommerce is
`dhl-ecommerce`, and a shipment this endpoint rejects as "not a DHL parcel
shipment" is reported as such rather than treated as an unannounced parcel.

## Portals

- Public tracking: `https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode={trackingNumber}`
- Entry points for parcels and letters are documented in DHL's own
  [tracking help](https://www.dhl.de/en/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html).
- The portal shows status, history with locations, the delivery window and,
  for the people entitled to see them, recipient name, recipient address and
  signature. DHL's business API credentials are not needed for this public
  flow.

## What we retrieve

| Field | Source |
|---|---|
| `status`, `current_stage` | `sendungsverlauf.status`, or `sendungsdetails.istZugestellt` / `ruecksendung` when DHL marks completion |
| `last_status_text` | the current status line, otherwise the newest event |
| `last_update` | `sendungsverlauf.datumAktuellerStatus`, otherwise the newest event date |
| `expected_delivery` | `zustellung.zustellzeitfensterVon` or `…Bis`, as a calendar day, dropped once delivered or returned |
| `events[].time`, `.location`, `.description`, `.stage` | `sendungsverlauf.events[].datum`, `.ort`, `.status` |
| `delivery_carrier` | set to `swiss-post` when an arrival event links to an exact `post.ch` host |

Declared capabilities: `history`, `location`, `eta`. Recipient name, recipient
address, signature and service details present in the payload are never read
into a result; the offline test asserts it.

## Tracking numbers

German S10 parcel and tracked-mail numbers (`C…DE`, `L…DE` including `LF…DE`)
with a valid check digit, `JJD…` / `JVGL…` / `JD` + 18 digits, and
`00340434…` label numbers. Ten-digit numbers are a low-confidence suggestion:
other carriers use the same shape. Samples and their expectations live in
`numbers.json`; links on `dhl.com`, `dhl.de` and `deutschepost.de` carrying a
`piececode`, `tracking-id` or `trackingId` parameter resolve here.

## How the adapter works

Two steps, in this order:

1. `direct` — `GET /int-verfolgen/data/config` establishes the cookie and CSRF
   session, then `GET /int-verfolgen/data/search` is read with the
   `verfolgen-CSRF-token` and `verfolgen-wg` headers DHL's own recipient page
   sends. The token rotates through a response header. Cookies stay in memory
   for the process. A rejected session (redirect, 401/403/419, or a non-JSON
   body) and an interrupted read are retried once with a fresh session inside
   this same step; a fresh session that is rejected outright is not retried.
2. `trawl` — only when a browser service is configured, and only after a
   rejected session or a network failure. The service solves the tracking page
   (`skipHttp`, up to tier 3); its cookies and user agent seed a new HTTP
   session, which is kept for the next lookups when it succeeds.

Rate limits, server errors, and payloads that do not match the requested
shipment end the lookup: they are never routed through a browser. One lookup
at a time per instance, so two parcels never renew the session at once.

## Status reference

DHL publishes no status code for this endpoint, so stages come from the
wording (English or German), with `sendungsdetails` flags outranking it.

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `registered` | "The instruction data for this shipment have been provided by the sender to DHL electronically" | fixture |
| `accepted` | "The shipment was handed over to DHL." | fixture |
| `in_transit` | "Die Sendung wurde im Briefzentrum bearbeitet."; "…has arrived in the destination country/destination area." | fixture |
| `customs` | "The shipment is being processed by customs" | fixture |
| `out_for_delivery` | "…has been loaded into the delivery vehicle"; "Die Sendung wurde in das Zustellfahrzeug geladen." | fixture |
| `ready_for_pickup` | "The shipment is ready for collection"; "Die Sendung liegt zur Abholung bereit." | fixture |
| `delivered` | "The shipment has been delivered"; `istZugestellt=true` | fixture |
| `failed_attempt` | "The shipment could not be delivered"; "Die Sendung wurde nicht erfolgreich zugestellt." | fixture |
| `returned` | "The shipment is returning to sender"; `istZugestellt=true,ruecksendung=true` | fixture |
| `pending` | not observed; reported as unmapped | — |

A forecast ("The shipment will be delivered tomorrow") is deliberately left
unmapped: it keeps the structured progress fallback instead of announcing a
delivery. `statuses.json` holds the full list.

## Limitations and privacy

- A shipment needing a postcode or shipping date on DHL's website, and a
  number belonging to another DHL service, are explicit errors; neither is
  reported as a parcel that has not been announced yet.
- Only the destination operator link found in an arrival event is followed,
  and only for the exact hosts `post.ch`, `www.post.ch` and `service.post.ch`.
- No weight, dimensions, sender or pickup-point data is read from this
  endpoint today, so those capabilities are not declared.
- The package privacy policy applies unchanged (`PRIVACY.md`).

## Verification log

- 2026-09-07: public config plus search session automated, with a browser
  fallback for rejected sessions.
- 2026-09-07: interrupted reads (config, search and body) were confirmed to
  recover with one fresh HTTP session instead of a browser attempt.
- 2026-09-10: arrival events were observed to carry the destination
  operator's link; Swiss Post handoffs are followed from exact hosts only.
- 2026-09-12: moved into this folder; errors now use the package taxonomy
  (`ChallengeError`, `SchemaError`, `RateLimitedError`) and the two steps are
  run and reported by `core/runner`.
