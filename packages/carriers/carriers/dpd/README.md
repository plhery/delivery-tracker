# DPD

DPD Switzerland (myDPD), Swiss last-mile parcels only. DPD France is
[dpd-fr](../dpd-fr/README.md); other DPDgroup countries are not covered.

## How it works

1. `direct`: the myDPD Android app's guest JSON API under
   `www.dpdgroup.com/concept/webservice`. A Firebase installation identifies the
   app, Remote Config returns the guest Basic credential, that credential buys a
   client-credentials token, and the token reads `/v10/parcels/details/<number>`.
   Tokens are cached per instance. Concurrent lookups share one refresh, and a
   failed login answers new lookups for 30 seconds, so a burst of lookups during
   a login outage costs one attempt. A 400/401 on the token call drops the Basic
   credential and retries once.
2. `page`: the rendered consignee page (`/ch/mydpd/my-parcels/track`), when the
   guest API is inconclusive, fails in transport or returns a mismatched payload.
   It sits behind Cloudflare, so it goes through the browser service when
   `FLARESOLVERR_URL` is set; otherwise a challenge fails with an error naming it.

A 404 on the details call is a clean not-found and ends the lookup. A 404 earlier
in the token chain is an ordinary guest-API failure and falls through to `page`; a
test guards this distinction.

**Postcode.** Optional (`"optional": true` in `carrier.json`). With it, DPD returns
verified scans with places and the delivery window. A postcode DPD rejects (HTTP
400) is retried once with `continueWithoutVerification=true`, and the result
carries `dpd_postcode_verified: false` instead of failing. It is sent only to DPD
and never logged.

**Add-time check.** `recognizes(number)` asks the guest API alone whether DPD knows
a 14-digit number: a matching reply is true, a 404 or a details-call 400 is false,
anything else (a login failure included) is a failure. The detect route (`app/api/carriers/detect/route.ts`) uses it, within
six seconds and with a warm token, to promote a bare 14-digit number to `dpd` in
the Add sheet unless a preferred rule points elsewhere. A failure answers 502 and
the sheet falls back to "unknown".

## Numbers

14 digits: the 4-digit depot that printed the label, then 10 digits, with no check
digit inside (a separate check character may be printed after them). Detection
lists DPD first for Swiss depots 0606–0619 but still asks, because five other
carriers share the shape. The guest API is DPDgroup-wide, so an answer proves a
DPD parcel, not a Swiss one.

## Two payload shapes

- **With a verified postcode**, `parcelEvents` lists each scan with wording, place,
  scan code and a bare Swiss wall clock, and `parcelHistory` lists the same
  movements with an enumeration and DPD's offset. **Without it**, only
  `parcelHistory` comes back, with no places.
- A scan takes the offset of its `parcelHistory` twin at the same wall clock, so
  the repeated autumn hour keeps its instant; without a twin it is read in
  `Europe/Zurich`. It pairs only when it is the sole scan and the sole entry at
  that wall clock; otherwise it takes an offset only if every entry there agrees.
- A scan's stage comes from its code, then the code as an enumeration value, then
  its twin's enumeration. Unknown codes carry no stage, so the sync classifies the
  wording.
- The two shapes word the same scan differently, so they are stored as separate
  events, except at an exact shared instant, where DPD's scan takes over the stored
  row in place (see [ROUTING.md](../../../../docs/ROUTING.md) and
  [`eventIdentity.ts`](../../../../src/server/eventIdentity.ts)).

## Notes

- The guest API is primary because it returns codes, the delivery window, the
  sender and the pickup point; the page has translated prose only.
- `DEYY` (proof of delivery, filed minutes after `DEY`, no place) is dropped when a
  delivery scan exists, so the summary, `last_update` and `delivered_at` come from
  `DEY`. Alone, it counts as delivered only when the enumeration says `DELIVERED`.
- `ORI`, `PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` set `in_transit` but
  no stage: they say the parcel moved, not which milestone. On imports `ORI` follows
  customs, so an `accepted` stage would step back.
- Scans are sorted newest first; the API has returned them oldest first.
- `country: "UNDEFINED"` (and `UNKNOWN`, `NULL`, `NONE`, `N/A`, `-`) reads as empty.
  `depotCountry` is used only when a scan has no country at all.
- The sender is `sender.companyName`, then `sender.name`. While a parcel is
  `ready_for_pickup`, `receiverName` is the last fallback for the pickup-point name
  (DPD puts the parcelshop there); a real `pickupPoint` or `parcelShop` wins.
- The delivery window goes into `expected_delivery` (`YYYY-MM-DD 09:00–12:00`), so
  `eta_window` is not declared. The estimate is dropped once delivered or in
  exception.
- A local `clean()` is kept because the API mixes strings and numbers.
- The Firebase project, app id, package, certificate hash and API key are public,
  app-restricted values from the myDPD build, so they live in code.
  `DPD_FIREBASE_API_KEY` overrides the key without a release.
- Every guest-API failure, including 429, is a `DPDAPIError` (`IndeterminateError`),
  so the page tier can still answer.

## Rejected approaches

- Page as the only tier: no codes, window, sender or pickup point, and Cloudflare.
- Requiring the postcode: most parcels resolve without it.

## Limitations

- Without the postcode, DPD withholds places, verified scans and the delivery window.
- Never read: the `receiver` block, the sender's id and address,
  `customerReference1/2`, `gttsZipCode`, `podUrl` (it embeds the number) and
  `product`. A test asserts it.
- The in-place takeover matches the instant only, not the stage or carrier: a
  universal row from an earlier leg at the same second is taken over too, and its
  push receipt means that DPD scan is not announced again.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/dpd` (no env vars) expects
a clean not-found for a synthetic number, or the page challenge error. Fixtures are
synthetic, in the live response shapes ([fixtures/README.md](fixtures/README.md)).
