# Dachser

## Identity and scope

Dachser is a German road-freight and logistics group. What this folder tracks is
specifically its **Customer Iberia** portal: the Spanish and Portuguese
operation's public shipment detail page, which is what a consignee in Spain or
Portugal is normally sent a link to. Shipments reach this adapter only when the
user pastes that complete link; no detection rule claims the Dachser number
format, and the number alone is not enough to look anything up.

## Portals

| Portal | URL | Role |
| --- | --- | --- |
| Public shipment detail | `https://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?…` | The capability link the user pastes; also the page we link back to. |
| Canary | `https://customeriberia.dachser.com/customerarea/` | Credential-free reachability probe. |

The page's data comes from the same origin at
`/api/utilidades/seguimiento-publico/detalle`, with the identical query string.
The adapter rewrites only the path, so the access parameters are never altered.

## What we retrieve

Retained: shipment status, the event history (timestamp and a neutral English
description derived from the Spanish wording) and the delivery estimate while
the shipment is undelivered.

Discarded: sender name, recipient name, address and contact details, the
delivery signature, and the internal per-event notes that arrive alongside the
customer-facing wording.

Unavailable: the endpoint attaches no scan location to event rows, so events
carry an empty location.

## Tracking numbers

The `numeroUnico` shipment number is a 13-digit value in the observed samples,
but the adapter only compares it — after stripping spaces, dots and dashes and
upper-casing — with the `numeroUnico` in the pasted URL and with the `numUnico`
the endpoint echoes. There is no detection rule and no checksum, so the sample in
`numbers.json` resolves to `unknown`.

## How the adapter works

One step, `direct`, and it cannot start without the capability URL: the factory
throws `InputRequiredError` when the parcel has none.

`validateDachserTrackingUrl()` runs first and is strict by design, because the
URL is a credential: HTTPS only, exact host, exact path, no userinfo, no
non-standard port, no fragment, every query parameter on an allowlist, no
duplicates, no control characters, each value at most 256 characters. It then
requires the URL's shipment number to equal the parcel's, and requires real
access parameters — either a `hash`, or a `clave` together with an 8-digit
`fecha`. The same function is what the host calls when a parcel is created, so
a bad link is rejected at entry rather than at sync time.

The request accepts HTTP errors so it can classify them. 404 is a clean
not-found. HTTP 500 is only a not-found when it matches the endpoint's exact
null-result signature — `code: ERR_APP_500`, the detail API's own `path`, and a
message naming `resultadoDetExp` and `null`. Every other 500 stays an upstream
error, so a database outage is never reported to the user as "no such shipment".

Timestamps are read as ISO-8601 with their own offset, else as
`dd/MM/yyyy [HH:mm[:ss]]` or `yyyy-MM-dd [HH:mm[:ss]]` in `Europe/Madrid`.
Events are deduplicated on (time, stage, description) and sorted newest first.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | "registrado", "creado", "announced", "registered", "information received" | fixture |
| accepted | "recogido", "aceptado", "picked up", "accepted" | fixture |
| in_transit | "salida"/"departed"/"outbound", "llegada"/"arrived"/"inbound", "fecha de entrega"/"cita"/"appointment", and any unmatched wording | fixture |
| out_for_delivery | "reparto", "proceso de entrega", "out for delivery", "in Zustellung" | prior-art |
| ready_for_pickup | "recogida", "ready for pickup", "ready for collection", "abholbereit" | prior-art |
| delivered | "entregado", "entregada", "delivered", "zugestellt", "consegnato" | fixture |
| customs | "aduana", "customs", "clearance", "Zoll" | prior-art |
| failed_attempt | "no entregado", "entrega fallida", "failed delivery", "unsuccessful" | fixture |
| returned | "devolución", "retorno", "return", "retour" | prior-art |
| pending | reached at shipment level only ("registrado"); never an event stage | fixture |

Full entries, with dates, are in `statuses.json`.

## Limitations and privacy

There is no status code to key on: every classification is a substring rule over
free text, so a wording Dachser has not used before is reported as a neutral
"Dachser tracking update" in transit rather than being guessed at. The raw
Spanish wording is deliberately not retained.

The tracking URL is part of the tracking credential. It is stored with the
parcel, used only for that parcel's lookup, and never written to logs, issues,
metrics, fixtures or this documentation — the URLs in the tests use a made-up
number and an all-`A` hash.

## Verification log

- 2026-09-10: the public endpoint alternates between an explicit null-result
  JSON 500 and a generic HTTP 500 for the same invalid shipment/access tuple;
  the adapter recognizes the first as not-found and leaves the second an
  upstream error. The opt-in canary accepts either.
- 2026-09-12: adapter moved into this folder; the wording rules moved to
  `status.ts` and the payloads to `fixtures/`. `DachserTrackingError` became
  `NotFoundError('Dachser')` — same message, same 404 status.
  `validateDachserTrackingUrl` stays exported for the host's input validation.
