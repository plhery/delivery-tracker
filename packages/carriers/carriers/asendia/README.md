# Asendia

## Identity and scope

Asendia is a cross-border mail and e-commerce carrier (a Swiss Post / La Poste
joint venture) that hands parcels to a destination operator for the last mile.
It runs two public tracking systems:

- **A1**, Asendia USA's platform, behind `a1.asendiausa.com/tracking/` (also
  served as `a1.asendia.com/tracking/`). Its public page reads a JSON API
  without any challenge. `adapter.ts` tracks through it.
- **The global portal** `track.asendia.com`, which also serves the European
  subsidiaries. Every search needs a Cloudflare Turnstile token, so it is not a
  sync path. `probe.ts` keeps its protocol and parser for the Turnstile canary
  test.

A number A1 does not know is a not-found for the adapter only: routing then
tries the universal providers in the same check (see
[tracking routing](../../../../docs/tracking-routing.md)).

## Portals

| Purpose | URL |
|---|---|
| Link saved with the parcel (global portal) | https://track.asendia.com/track/{trackingNumber} |
| Link returned by an A1 lookup | https://a1.asendiausa.com/tracking/?trackingnumber={trackingNumber} |
| Canary target | https://a1.asendiausa.com/tracking/ |

Recognized tracking links: `track.asendia.com/track/<number>` and
`a1.asendiausa.com/tracking/?trackingnumber=<number>` (or `a1.asendia.com`).

## What we retrieve

| Field | Retained | Note |
|---|---|---|
| `status`, `current_stage` | yes | from the newest scan: explicit map, else the shared wording rules |
| `events[].time` | yes | A1 always sends an explicit offset; a scan without one is dropped |
| `events[].description` | yes | the scan wording as A1 relays it |
| `events[].location` | yes | city, province and country only |
| `events[].provider_code` | yes | the scan code, read per source (see below) |
| `weight_kg` | yes | from the summary, converted from pounds |
| `destination_country` | yes | ISO code from the summary |
| `delivery_carrier`, `delivery_tracking_number` | yes | the declared last-mile link resolved through the catalog, and the vendor reference |
| address lines, postal codes, service name, order reference | no | never read |

Declared capabilities: `history`, `location`, `provider_code`, `weight`. A1
publishes no delivery estimate.

## Tracking numbers

| Rule | Shape | Evidence |
|---|---|---|
| `asendia-1` | `ASE` + 8–37 letters or digits | Asendia's SendNow tracking page example |
| `asendia-2` | `AS` + 9 digits + `US` | Asendia USA numbers published by Ship24 and ParcelPanel; two answered live in A1 on 2026-09-22, one with an invalid S10 check digit, so no checksum is required. The generic postal rule excludes this shape. |
| `asendia-3` | `AHOY` + 8 letters or digits | Pirate Ship's export numbers, which its support pages describe as the Asendia USA door-to-door number; one answered live |

A1 also accepts any reference it reports for a shipment: the customer
reference, eBay International Shipping `EEUS…` numbers, 20- or 22-character
merchant references and the last-mile number. Those shapes are not specific
enough for detection. S10 numbers issued by a partner post stay with that post.
`numbers.json` records all of these with their sources.

## How the adapter works

1. `GET a1.asendiausa.com/tracking/js/main.js`: the page's public client
   configuration (API base URL, a shared Basic authorization value, an
   `X-AsendiaOne-ApiKey` and the default branded tracking key). It is the same
   for every visitor, read at run time and cached for six hours, never pinned in
   the repository. The API host must be an Asendia domain over HTTPS.
2. `GET <api>/api/A1/TrackingBranded/Customer?trackingKey=`: the page's own
   brand request. A key A1 no longer accepts answers 204 "no customers
   configured"; that is schema drift, not a not-found.
3. `GET <api>/api/A1/TrackingBranded/Tracking?trackingKey=&trackingNumber=`.
   A warm lookup is this single request.

`responseStatus.responseStatusCode` carries the outcome inside an HTTP 200:
200 with data, or 204 "no package data found". A 204 without a valid key looks
the same, so a not-found is only reported when the key was accepted in the last
15 minutes; otherwise the key is checked first, and if it moved, the page is
read again and the lookup repeated once. A JSON 401 or 403 from a cached
configuration also re-reads the page once. Cloudflare answers 403 "error code:
1010" to a library's default User-Agent; the adapter sends an ordinary one. The
whole lookup shares a 25-second budget, with at most 10 seconds per request.

The reply echoes nothing about the query. It is bound to the requested number
through the three references its summary reports (carrier original, customer,
vendor); any other answer is rejected as a different shipment.

## Status reference

Codes mean different things per `eventSource`, so they are only read for
Asendia's own sources. Everything else is matched on exact wording or left to
the shared rules and the unmapped-wording review.

| Source | Mapped by | Examples |
|---|---|---|
| `A1 … Data` (Imported, Labelled, Processed, Sorted, Manifested) | code | `1` registered, `2` accepted, `2.1`/`2.2` in transit |
| `FullTrack API` | Asendia's harmonized codes | `CHECKIN` accepted, `IMPCUSTIN` customs, `OUTDELIVCENTER` out for delivery, `DELFAILUNKN` failed attempt, `DELIVERY` delivered, `RETURN*` returned |
| partners (`USPS TrackV2 API`, `BROADREACH API`, …) | exact wording | "Delivered", "Out for delivery", "Customs released" |

The harmonized codes follow a published code list (linked from `status.ts`);
`statuses.json` marks which ones were seen live. Consumer-return (`RET*`) and
inquiry (`CLAIM*`) codes are unmapped. The global portal's harmonized wording
map used by the probe is kept in the same file.

## Limitations and privacy

- Only shipments on Asendia USA's platform. European Asendia numbers usually
  get a not-found from A1 and depend on the universal providers.
- USPS scans relayed by A1 carry `+00:00`, but one Montreal "Out for Delivery"
  at 09:30 suggests local wall time labelled UTC. This is unconfirmed; the
  offset is kept as sent.
- USPS pre-shipment scans are date-only and arrive as midnight UTC.
- The public configuration, the tracking key and the API host can change with a
  frontend deployment; the adapter re-reads them, but a structural change to
  the page script fails as schema drift.
- Addresses, postal codes and the merchant's references are never copied.

## Implementation decisions

- **A1 as the adapter, the global portal as a probe.** A1 answers anonymous
  requests exactly as its public page does. The global portal needs a human
  Turnstile token, so it cannot serve unattended sync.
- **Configuration read from the official script.** The values are public client
  configuration, not an issued credential, and they can change with a frontend
  deployment. Reading them keeps them out of the repository and follows any
  rotation.
- **The key is proven before a not-found is trusted.** Without it, a rotated key
  would bench every Asendia parcel for a day as not-found.
- **Codes per source.** USPS reuses `10` and `B1`, Broadreach uses `B8`; reading
  them as Asendia codes would invent stages.
- **Last-mile evidence, not a guess.** The declared final-mile link resolves a
  partner only through catalog link rules. The vendor reference lets the host
  propose one confirmation lookup with that operator.

## Rejected alternatives

- **Solving or skipping Turnstile on track.asendia.com.** Out of scope and
  against the portal's intent; its frontend requests a token whenever
  `ENABLE_CAPTCHA` is set.
- **The documented A1 Tracking v2.0 API** (`a1api.asendiausa.com`). It answers
  401 without an account's credentials; the branded endpoint is what the public
  page uses.
- **Detection for `EEUS…` and merchant references.** They are accepted by A1 but
  not specific to Asendia.

## Verification log

- 2026-08-30: global portal protocol inspected (`__env.js`, `get-config-data`,
  `branded-parcel-search`); the checksum key is public and a Turnstile token is
  a required body field.
- 2026-09-12: portal module moved to `probe.ts`.
- 2026-09-22: global portal rechecked. `fe-tracking-configuration` sets
  `ENABLE_CAPTCHA: true` and the bundle still posts `turnstile_token`. A manual
  search in a real browser completed the check and returned "Not found" for a
  privately supplied 14-digit reference, which also had no data in A1, Ship24,
  ParcelsApp, DPD and the Swiss Post adapters.
- 2026-09-22: A1 protocol inspected on `a1.asendiausa.com/tracking/` (page
  last modified 2026-08-06). Requests minimized: both header values and the
  tracking key are required; a non-library User-Agent is enough. Of 40
  published candidate numbers, A1 returned history for four plus
  `AS010501721US`; alias queries with the customer and vendor references
  returned the same shipment. Live test: delivered history and a clean
  not-found, both through the page configuration.
