# DPD

DPD Switzerland (myDPD), Swiss last-mile parcels only. DPD France is
[dpd-fr](../dpd-fr/README.md); other DPDgroup countries are not covered.

## How it works

1. `direct`: the myDPD Android app's guest JSON API under
   `www.dpdgroup.com/concept/webservice`. A Firebase installation identifies the
   app, Remote Config returns the guest Basic credential, that credential buys a
   client-credentials token, and the token reads `/v10/parcels/details/<number>`.
   Tokens are cached per instance and refreshed through `singleFlight()`, so
   concurrent lookups never refresh twice. A 400/401 on the token call drops the
   Basic credential and retries once.
2. `page`: the rendered consignee page (`/ch/mydpd/my-parcels/track`), when the
   guest API is inconclusive, fails in transport or returns a mismatched
   payload. It sits behind Cloudflare, so it goes through the browser service's
   legacy command API when one is configured (`FLARESOLVERR_URL`) and directly
   otherwise; a challenge then fails with an error naming `FLARESOLVERR_URL`.

A 404 on the details call is a positive not-found and ends the lookup. A 404
earlier in the token chain is an ordinary guest-API failure and falls through
to `page`; a test guards this distinction.

## Notes

- The guest API is primary because it returns codes, a delivery window, the
  sender and the pickup point. The page returns translated prose only.
- The delivery postcode is an optional second input. With it, DPD unlocks
  verified scans and the delivery window. A postcode DPD rejects (HTTP 400) is
  retried once with `continueWithoutVerification=true`, and the result carries
  `dpd_postcode_verified: false` instead of failing. The postcode is sent only
  to DPD and never logged.
- The Firebase project, app id, package, certificate hash and API key are
  public, app-restricted values from the myDPD Android build, so they live in
  code. `DPD_FIREBASE_API_KEY` overrides the key without a release.
- Every guest-API failure, including HTTP 429, is a `DPDAPIError`
  (`IndeterminateError`), so the page tier can still answer.
- Scans are sorted newest first before the summary is taken: the API has
  returned them oldest first.
- `PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` set the status to
  `in_transit` but carry no stage: they say the parcel moved, not which
  milestone it reached, so the sync classifies the wording instead. Events never
  carry a stage; only the current stage is mapped.
- While a parcel is `ready_for_pickup`, `receiverName` is the last fallback for
  the pickup-point name, because DPD puts the parcelshop there. A real
  `pickupPoint` or `parcelShop` wins.
- The delivery window is folded into `expected_delivery`
  (`YYYY-MM-DD 09:00–12:00`), not `expected_delivery_from`, so `eta_window` is
  not declared as a capability.
- A local `clean()` is kept: the API mixes strings and numbers, and the shared
  string-only `clean` would blank a numeric city or code.

## Rejected approaches

- Page as the only tier: no codes, window, sender or pickup point, and it is
  behind Cloudflare.
- Requiring the postcode: most parcels resolve without it.

## Limitations

- Without the postcode, DPD withholds verified scans and the delivery window.
- Recipient names, addresses, phone numbers and signatures are never read
  (except the pickup-point fallback above).

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/dpd` (no env vars)
expects a clean not-found for a synthetic number, or the page challenge error.
