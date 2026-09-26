# DHL

DHL Paket and German tracked mail, through the public recipient endpoint behind
`www.dhl.de`. DHL eCommerce is [dhl-ecommerce](../dhl-ecommerce/README.md);
numbers of other DHL divisions are rejected by this endpoint and reported as
such.

## How it works

1. `direct`: `GET /int-verfolgen/data/config` opens a cookie and CSRF session,
   then `GET /int-verfolgen/data/search?piececode=…` is sent with the
   `verfolgen-CSRF-token` and `verfolgen-wg` headers DHL's own page sends. The
   token rotates through a response header. The session is kept in memory and
   replaced after 100 minutes. A rejected session (redirect, 401/403/419, or a
   non-JSON body) or an interrupted read gets one fresh session inside this
   step; a fresh session rejected outright goes straight to `trawl`.
2. `trawl`: only when a browser service is configured, and only after a
   rejected session or a network failure. The service solves the tracking page
   (`skipHttp`, up to tier 3); its cookies and user agent seed a new HTTP
   session, which is kept for later lookups.

Lookups are serialised per instance, so two parcels never renew the session at
once.

## Notes

- Sessions are replaced at 100 minutes because DHL's edge stops answering a
  session about two hours old instead of rejecting it. Without the cap, the
  lookup that crosses that age waits out the 15-second timeout before renewing.
- Renewal stays inside `direct` rather than being its own step, so routine
  renewals don't show up as fallbacks in monitoring.
- Rate limits, server errors and payloads that don't match the requested number
  end the lookup. A browser would only hide a provider problem.
- DHL answers unknown numbers with explicit `sendungNichtGefunden` flags. An
  empty or unmatched `sendungen` array is a schema error, not "no data yet".
- The endpoint has no status codes: stages come from English or German wording,
  and the `istZugestellt` / `ruecksendung` flags outrank it.
- A forecast ("will be delivered tomorrow", "wird … zugestellt") keeps the
  progress fallback. Mapping it to `delivered` would announce a delivery that
  hasn't happened; mapping it to `registered` would undo real progress.
- `fortschritt` is only the fallback for unmapped wording (`<= 1` means the
  parcel is still announced); the wording explains progress better.
- Timestamps carry DHL's own offset and are kept verbatim; `core/time` only
  validates them. The delivery window is a calendar day.
- A single unambiguous link to a known carrier portal in an arrival event (such
  as Swiss Post) becomes `delivery_carrier`; the host confirms the shipment
  through that carrier before switching. Lookalike hosts and userinfo URLs are
  ignored.
- Not used: Deutsche Post's business tracking API — needs contractual
  credentials for data the recipient page exposes publicly.

## Limitations

- Shipments that need a postcode or shipping date on DHL's site, and numbers
  belonging to another DHL service, are explicit errors, not "not yet
  announced".
- No weight, dimensions, sender or pickup-point data is read.
- Recipient name, address, signature and service details are never read; a test
  asserts it.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/dhl` (no env vars)
checks that a synthetic number gets a clean no-data answer or a rejected session.
