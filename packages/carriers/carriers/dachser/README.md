# Dachser

Covers Dachser's **Customer Iberia** portal only: the public shipment detail page that Spanish
and Portuguese consignees receive a link to. The user must paste that complete link — its
query parameters are the access key, and the number alone can't be looked up. No detection
rule.

## How it works

1. `direct`: `GET https://customeriberia.dachser.com/api/utilidades/seguimiento-publico/detalle`
   with the pasted URL's query string reused verbatim — only the path is rewritten, so no
   access parameter is dropped or reordered. The HTML page calls this same JSON endpoint.
   - Without a URL the factory raises `InputRequiredError`.
   - 404 is not-found.
   - HTTP 500 is not-found only on the exact null-result signature: `code: ERR_APP_500`, the
     detail API's `path`, and a message naming `resultadoDetExp` and `null`. The endpoint
     alternates this with a generic 500 for the same bad tuple; every other 500 stays
     `UpstreamHttpError` so an outage never reads as "no such shipment" and stops retries.
   - The echoed `numUnico` must match the parcel's number.

## Notes

- The URL is a credential and is replayed server-side, so `validateDachserTrackingUrl()` is an
  allowlist (SSRF and leak risk): HTTPS, exact host and path, no userinfo, non-default port or fragment,
  every query key allowlisted, no duplicates, no control characters, values ≤256 characters.
  `numeroUnico` must match the parcel's number (after stripping spaces, dots, dashes), and it
  needs a `hash` or a `clave` plus 8-digit `fecha`.
- The host's `carriers.ts` calls the validator when a parcel is created or edited, so a bad
  link is rejected at entry. It throws `TypeError`, which the API boundary turns into a 400.
- Never write the URL to logs, issues, metrics, fixtures or docs. Tests use a made-up number
  and an all-`A` hash.
- No status codes: `descripcionIncidencia` (per event) and `estadoExpedicion` (shipment) are
  free text, mostly Spanish, sometimes EN/FR/DE/IT. Both are matched as accent-folded
  substrings in priority order: negatives ("no entregado") before the delivery words they
  contain, and a rescheduled appointment ("fecha de entrega", "cita") is `in_transit`, never
  delivered.
- Unmatched event wording is `in_transit` with "Dachser tracking update". Descriptions are a
  fixed English vocabulary; the raw wording is not retained because the endpoint mixes
  languages per customer.
- Times: ISO-8601 keeps its offset; `dd/MM/yyyy` and `yyyy-MM-dd` forms (optional clock) are
  read in `Europe/Madrid`.
- The estimate is the first of `fechaEntregaAplazada`, `fCompromiso`, `fechaPrimeraEntrega`,
  dropped once delivered.
- Sender, recipient, contact, signature and internal per-event notes are never read.

## Limitations

- No scan locations on event rows.
- Needles are masculine singular ("registrado", "aceptado"): "expedición registrada" falls to
  the neutral update, and "expedición recogida" hits `ready_for_pickup` before `accepted`.
  Fixing it needs a real capture showing which forms Dachser sends.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/dachser` (no env vars). It sends a
made-up number and hash and accepts either the null-result not-found or the generic 500.
