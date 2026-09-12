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
| exception | "incidencia", "avería", "dañado", "rechazado", "dirección incorrecta" | prior-art |
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

## Implementation decisions

- 2026-09-10: require the complete capability URL rather than accepting a bare
  shipment number. The public endpoint only answers with the access parameters,
  so a number-only lookup is impossible, and pretending otherwise would mean
  storing a number that can never be tracked.
- 2026-09-10: validate the URL with an allowlist, not a denylist. Host, path,
  scheme, port, userinfo, fragment and every query key are checked, and values
  are length- and control-character-bounded. The link is a credential and is
  replayed server-side, so an unvalidated one is an SSRF and a data-leak risk.
- 2026-09-10: reuse the pasted URL's query string verbatim for the API call and
  rewrite only the path. Rebuilding the query would risk dropping or reordering
  an access parameter.
- 2026-09-10: recognize the null-result HTTP 500 narrowly — `ERR_APP_500`, the
  detail API's own path, and a message naming both `resultadoDetExp` and `null`.
  A broader match would turn every Dachser outage into "shipment not found",
  which stops the parcel from being retried.
- 2026-09-10: classify a rescheduled delivery appointment ("fecha de entrega",
  "cita") as in transit, before the delivery rule. The wording contains
  "entrega" and would otherwise end the parcel's tracking on a future date.
- 2026-09-12: `DachserTrackingError` became `NotFoundError('Dachser')`; the
  message and the 404 status are unchanged, so the host's unannounced-parcel
  handling and the canary's expectations still hold. The URL validator keeps
  throwing `TypeError`, because it is called by the host's input validation
  rather than by a lookup, and the API boundary turns a `TypeError` into a 400.

## Open questions

- The wording needles are masculine singular ("registrado", "aceptado"), so a
  feminine form such as "expedición registrada" falls through to the neutral
  "Dachser tracking update" in transit, and "expedición recogida" matches the
  `ready_for_pickup` rule's "recogida" before the `accepted` rule's "recogido".
  Both are pre-existing and were left unchanged by the 2026-09-12 move: fixing
  them needs a real capture to say which forms Dachser actually sends, and
  guessing would be exactly the wrong-mapping risk the rules exist to avoid.
  The committed fixture therefore uses the masculine forms.

## Rejected alternatives

- Scraping the HTML detail page: the page calls the same JSON endpoint with the
  same query string, so parsing markup would add a dependency for nothing.
- Translating the raw Spanish wording into the event description: the endpoint
  mixes languages per customer, so the adapter maps to a fixed English
  vocabulary and does not retain the original text.
- Treating any HTTP 500 as not-found: see above; it conflates an outage with a
  definite answer and suppresses retries.


## Verification log

- 2026-09-10: the public endpoint alternates between an explicit null-result
  JSON 500 and a generic HTTP 500 for the same invalid shipment/access tuple;
  the adapter recognizes the first as not-found and leaves the second an
  upstream error. The opt-in canary accepts either.
- 2026-09-12: adapter moved into this folder; the wording rules moved to
  `status.ts` and the payloads to `fixtures/`. `DachserTrackingError` became
  `NotFoundError('Dachser')` — same message, same 404 status.
  `validateDachserTrackingUrl` stays exported for the host's input validation.
