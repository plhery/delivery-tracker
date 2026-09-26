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

The guest API returns history, places, the estimate, the sender, the pickup
point, the weight, the delivery time (`delivered_at`) and a per-scan
`provider_code`.

## Two payload shapes

- With a verified postcode, `parcelEvents` lists each scan with translated
  wording, a place, a scan code and a bare Swiss wall clock. `parcelHistory`
  lists the same movements with the enumeration and DPD's offset for each scan.
  Without the postcode only `parcelHistory` comes back, with no places.
- A scan takes the offset of the `parcelHistory` entry at the same wall clock,
  so the repeated autumn hour keeps its instant. Without a twin it is read in
  `Europe/Zurich`. Zone ids `+02:00`, `+0200`, `UTC+2`, `Z`/`UTC`/`GMT` and IANA
  names are read; anything else means Swiss time.
- A scan is paired with its twin only when it is the only scan at that wall
  clock and the twin the only entry there. Otherwise nothing says which entry
  belongs to which scan: the scans take an offset only when every entry at
  that wall clock names the same zone, and borrow no stage.
- The sync keys stored events on the exact time, place and wording strings.
  When a scan's instant is the one read before twin offsets existed, the
  earlier spelling is kept, so stored scans are not duplicated. The wording
  and place fallbacks are unchanged too: an empty translation still reads
  "Tracking update", and a scan with no country at all still takes
  `depotCountry`.

| Scan code | `parcelHistory` twin | Stage |
|---|---|---|
| `CCO` Customs - Out | none | `in_transit` |
| `ORI` Origin depot - In | `PARCEL_HANDED` | none (wording) |
| `DLI` Destination depot - Inbound | `AT_DELIVERY_CENTER` | `in_transit` |
| `DLO` Destination depot - Out for delivery | `PARCEL_OUT_FOR_DELIVERY` | `out_for_delivery` |
| `DEY` Delivery - Delivered | `DELIVERED` | `delivered` |
| `DEYY` Delivery - Proof of delivery | none | dropped, unless it is the only delivery evidence of a `DELIVERED` parcel |

A scan's stage comes from its code, then the code as an enumeration value, then
its paired twin's enumeration value. Unknown codes carry no stage, so the sync
classifies their wording.

## Notes

- The guest API is primary because it returns codes, a delivery window, the
  sender and the pickup point. The page returns translated prose only.
- The delivery postcode is an optional second input. With it, DPD unlocks
  verified scans and the delivery window. A postcode DPD rejects (HTTP 400) is
  retried once with `continueWithoutVerification=true`, and the result carries
  `dpd_postcode_verified: false` instead of failing. The postcode is sent only
  to DPD and never logged.
- `carrier.json` marks the requirement `"optional": true`, so the web and iPhone
  forms, the API and the database accept a DPD parcel without it and still
  validate one that is typed.
- The Firebase project, app id, package, certificate hash and API key are
  public, app-restricted values from the myDPD Android build, so they live in
  code. `DPD_FIREBASE_API_KEY` overrides the key without a release.
- Every guest-API failure, including HTTP 429, is a `DPDAPIError`
  (`IndeterminateError`), so the page tier can still answer.
- Scans are sorted newest first before the summary is taken: the API has
  returned them oldest first.
- `DEYY` is DPD filing the proof of delivery minutes after `DEY`, with no
  place. As the newest event it became the summary and, classified by wording,
  showed delivered parcels as in transit. It is dropped when a delivery scan is
  listed, so the summary, `last_update` and `delivered_at` come from `DEY`.
  Alone it is kept and staged `delivered` only when the enumeration says
  `DELIVERED`; on a return it would otherwise hide the returned stage.
- `PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` set the status to
  `in_transit` but carry no stage: they say the parcel moved, not which
  milestone it reached, so the sync classifies the wording instead. `ORI`
  stays unmapped like its `PARCEL_HANDED` twin. The result stage then comes
  from the same wording as the scan ("arrived at our depot", in transit), so
  the sync adds no observed row. On imports `ORI` follows `CCO`, and an
  `accepted` stage there would step back after customs.
- Places: DPD writes `country: "UNDEFINED"` on customs and paperwork scans.
  `UNDEFINED`, `UNKNOWN`, `NULL`, `NONE`, `N/A` and `-` are read as empty.
  `depotCountry` names the business unit's depot on every scan, so a scan's
  own `country`, placeholder or not, always wins over it. It is read only
  when a scan has no country at all.
- The verified `sender` is an object: its `companyName`, then its `name`, is the
  sender. Its id and address are never read.
- While a parcel is `ready_for_pickup`, `receiverName` is the last fallback for
  the pickup-point name, because DPD puts the parcelshop there. It is read only
  as text; the `receiver` object is never read. A real `pickupPoint` or
  `parcelShop` wins.
- The estimate is dropped once the parcel is delivered or in exception.
- The delivery window is folded into `expected_delivery`
  (`YYYY-MM-DD 09:00–12:00`), not `expected_delivery_from`, so `eta_window` is
  not declared as a capability.
- A local `clean()` is kept: the API mixes strings and numbers, and the shared
  string-only `clean` would blank a numeric city or code. Anything else is
  empty, so an object never becomes "[object Object]".

## Rejected approaches

- Page as the only tier: no codes, window, sender or pickup point, and it is
  behind Cloudflare.
- Requiring the postcode: most parcels resolve without it.

## Limitations

- Without the postcode, DPD withholds verified scans and the delivery window.
- Never projected: the `receiver` block (name, email, phone, address,
  `geoPosition`), the sender's id and address, `customerReference1/2`,
  `gttsZipCode`, `podUrl` (it embeds the parcel number) and `product` (the
  recipient's delivery preference). A test asserts it.
- The two shapes word and place the same scan differently ("Delivered" with no
  place, "Your parcel has been delivered successfully" at "Urdorf, CH"), so each
  has its own event identity. When a DPD reply brings a scan whose identity is
  not stored, the sync gives it the identity of the one stored DPD or universal
  (`unknown:`) row at the exact same instant
  ([`eventIdentity.ts`](../../../../src/server/eventIdentity.ts)). That row is
  updated in place and keeps its id, `created_at` and push receipts, so adding
  the postcode later, or DPD rejecting it, copies no scan and repeats no
  notification. A scan only the verified shape lists, such as customs (`CCO`),
  is a new row. Two stored rows or two new scans at one instant reuse nothing,
  and neither does a scan whose instant differs between the shapes.
- A universal reply is not matched this way. After DPD-only history, its copies
  are added beside DPD's scans, as for any fallback. Once DPD has taken over a
  universal row, the row keeps its `unknown:` identity: the next universal reply
  rewrites it in place and the next DPD reply takes it back, so its wording
  follows the source that answered last.
- The takeover checks only the instant and the identity prefix, not the stage
  or the carrier a universal row names. A universal row from another carrier
  (an earlier leg in the same feed) that is alone at a DPD scan's exact second
  is taken over too: it shows DPD's wording while DPD answers, and since it
  keeps its push receipts, that DPD scan is not announced. A row whose stage
  was never announced (`pending`, or a stage the owner turned off) has no
  receipt, so a DPD scan that takes it over with an announced stage is
  announced once, as a new row would have been.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/dpd` (no env vars)
expects a clean not-found for a synthetic number, or the page challenge error.
The fixtures are synthetic, in the live response shapes (see
[fixtures/README.md](fixtures/README.md)).

## Latest verification

- 2026-09-26: a delivered parcel looked up with and without its postcode
  returned both shapes above. Every twin shared its wall clock with its scan
  and carried `+02:00`; the parser keeps every earlier time, place and wording
  string except the dropped proof-of-delivery scan and the `UNDEFINED` places.
