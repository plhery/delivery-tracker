# DPD

## Identity and scope

DPD Switzerland — DPD (Schweiz) AG, the Swiss member of the DPDgroup network,
whose consignee portal is branded myDPD. This folder covers Swiss last-mile
parcels only (`region.countries: ["CH"]`). DPD France has its own folder
(`dpd-fr`) with a different protocol, and other DPDgroup countries are not
served by this adapter.

## Portals

- Consignee portal: `https://www.dpdgroup.com/ch/mydpd/my-parcels/incoming?parcelNumber={trackingNumber}`
  — the page a recipient opens, and the link the app shows.
- Rendered timeline used by the page fallback:
  `https://www.dpdgroup.com/ch/mydpd/my-parcels/track`.
- The portal shows status, scan history, operational locations, a delivery date
  and a delivery window, the sender, and the pickup point. It also shows
  recipient identity once the postcode has been entered; that is dropped.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`, `sender_name`,
`pickup_point`.

Status and current stage, the scan history with its operational city and
country, the delivery date (with the delivery window folded into the same
`expected_delivery` string), the webshop sender name, and the pickup-point name
while the parcel is waiting for collection. The guest API's own delivery-date
fields and the "was the postcode accepted" flag travel with the result so the
app can explain a partial lookup.

## Tracking numbers

14 digits, no letters. The format is shared with several other carriers, so
`carrier.json` declares it low confidence: a bare 14-digit number stays a
suggestion and the user confirms the carrier. `numbers.json` holds one publicly
reported sample whose attribution was not independently verified, plus a
quarantined record no rule claims.

The delivery postcode is an optional second input (four digits). It is part of
the tracking credential: stored with the parcel, sent only to DPD, never
logged.

## How the adapter works

Two tiers, declared as `tracking.steps: ["direct", "page"]`.

1. `direct` — the myDPD guest JSON protocol. A Firebase installation identifies
   the application, Remote Config returns the guest Basic credential, that
   credential buys a client-credentials access token, and the token reads
   `/v10/parcels/details/<number>`. Tokens are cached in the adapter instance
   and refreshed one at a time. A postcode DPD rejects (HTTP 400) is retried
   once without verification and the result says the postcode was not verified.
2. `page` — the rendered consignee page, used when the guest protocol answers
   inconclusively. Cloudflare normally challenges anonymous requests, so the
   page goes through the private browser service's legacy command API when one
   is configured (`FLARESOLVERR_URL`) and directly otherwise.

A positive "unknown parcel" (HTTP 404 on the details call) ends the lookup; it
never falls through to the page.

## Status reference

The guest API's `status.description` / `eventType` enumeration is the key; the
rendered page has no codes and is classified by wording in the four portal
languages.

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `registered` | `ORDER_CREATED` | live |
| `out_for_delivery` | `PARCEL_OUT_FOR_DELIVERY` | live |
| `ready_for_pickup` | `AVAILABLE_FOR_COLLECTION` | fixture |
| `failed_attempt` | `UNSUCCESSFUL_DELIVERY_ATTEMPT` | live |
| `returned` | `RETURN_TO_SENDER` | live |
| `delivered` | `DELIVERED` | live |
| — | `PARCEL_HANDED`, `IN_TRANSIT`, `AT_DELIVERY_CENTER`, `OTHER` | fixture / live |
| `pending` | not observed; reported as unmapped | — |
| `accepted` | not observed; reported as unmapped | — |
| `in_transit` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

`PARCEL_HANDED`, `IN_TRANSIT` and `AT_DELIVERY_CENTER` move the result status
to `in_transit` but deliberately carry no stage, so the sync classifies the
wording and records it for review. Individual events from this adapter never
carry a stage: only the parcel's current stage is mapped.

## Limitations and privacy

- Recipient names, addresses, phone numbers and signatures are present in the
  guest payload and are never projected. One exception is deliberate: while a
  parcel is `ready_for_pickup`, `receiverName` is the last fallback for the
  pickup-point name, because DPD puts the parcelshop there. When the payload
  carries a real `pickupPoint` or `parcelShop`, that wins.
- The delivery window is part of `expected_delivery` ("2026-07-16 09:00–12:00")
  rather than the `expected_delivery_from` field, which is why the `eta_window`
  capability is not declared.
- Without the postcode the lookup still works but DPD withholds verified scans
  and the delivery window.
- The page fallback without a browser service will normally be challenged by
  Cloudflare; the resulting error names `FLARESOLVERR_URL`.

## Implementation decisions

- **The guest JSON protocol is the primary tier, not the page.** It returns
  codes, a delivery window, the sender and the pickup point; the rendered page
  returns prose only. Everything the app shows beyond a status line comes from
  the API tier.
- **Firebase values are shipped in the application, so they live in the code.**
  The project number, application id, package name, signing certificate hash and
  API key are public, app-restricted identifiers taken from the myDPD Android
  build. `DPD_FIREBASE_API_KEY` can override the key without a release.
- **The postcode is optional, and a rejection is not a failure.** DPD answers
  HTTP 400 when the supplied postcode does not match. The lookup retries once
  with `continueWithoutVerification=true` and reports
  `dpd_postcode_verified: false` instead of failing, so a parcel with a wrong
  postcode still shows progress.
- **A 404 on the details call is a positive not-found.** It ends the lookup and
  never falls through to the page; 404s raised earlier in the token chain are
  ordinary guest-API failures and do fall through. That distinction is what the
  "does not misclassify an authentication-stage 404" test protects.
- **Step ids are `direct` and `page`.** Before the move the recovery phase was
  reported as `trawl` when `FLARESOLVERR_URL` was set and `page` when it was
  not, for the same tier doing the same work. It is now always `page`; the
  Sentry "Scraper Health" dashboard sees one label for one tier.
- **`DPDAPIError` is an `IndeterminateError`, including its HTTP subclass.**
  Every guest-API failure — unreachable, malformed JSON, an unexpected status —
  is inconclusive about the parcel, and the page tier is allowed to recover from
  it. This deliberately keeps a guest-API HTTP 429 inconclusive rather than
  rate-limited, because the page tier answered those before the move and still
  should.
- **The token refresh uses `singleFlight()`** instead of the hand-rolled
  promise handle, so two concurrent lookups through one adapter instance cannot
  both refresh the guest credential.
- **Local `clean()` is kept.** The guest API mixes strings and numbers in the
  fields we project, so `core/transport`'s string-only `clean` would silently
  turn a numeric city or code into an empty string.

## Rejected alternatives

- **Making the rendered page the only tier.** It has no codes, no delivery
  window, no sender and no pickup point, and it is behind Cloudflare, so it
  would cost more and return less.
- **Requiring the postcode.** Most parcels resolve without it; making it
  mandatory would block lookups for a marginal gain in detail.
- **Mapping `IN_TRANSIT` and friends to an `in_transit` stage.** They say the
  parcel moved, not which milestone it reached. Leaving them unmapped lets the
  sync's classifier record the wording for review rather than inventing a
  milestone (ARCHITECTURE.md, "map too little rather than wrongly").
- **Dropping `receiverName` from the pickup-point fallback.** It is the
  parcelshop name in the collection case, and it is only read while the stage is
  `ready_for_pickup`, after two operational fields. Removing it would lose the
  pickup point for payloads that only fill that field.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `06086216767970` (shipment, `public_shipment_report`, [source](https://www.paketda.de/fragen-antworten.php)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — empty result page |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

## Verification log

- 2026-09-10: the tracking-link audit confirmed the consignee page and that a
  synthetic number returns a guest "not assigned" result (docs/CARRIERS.md).
- 2026-09-12: moved into this folder; the guest protocol, the status map and
  the page fallback are unchanged. The recovery tier is now labelled `page` in
  telemetry whether or not a browser service is configured.
- 2026-09-12: universal-provider probe with corpus number `06086216767970`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
