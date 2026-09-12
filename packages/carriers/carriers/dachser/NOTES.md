# Dachser notes

## Decisions

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

## Open

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

- 2026-09-10: wrong shipment/access tuple probed live; both the null-result
  JSON 500 and the generic 500 were observed for the same input.
- 2026-09-12: offline tests re-run from the carrier folder after the move; the
  URL validator's behaviour is unchanged and the parsed result now has an
  explicit success-path fixture, which the previous tests lacked.
