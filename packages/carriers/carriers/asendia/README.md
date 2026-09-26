# Asendia

Cross-border mail and e-commerce carrier that hands parcels to a destination operator for the
last mile. It runs two public trackers:

- **A1** (Asendia USA), `a1.asendiausa.com/tracking/` (also `a1.asendia.com`). Its page reads a
  JSON API with no challenge. [adapter.ts](adapter.ts) tracks through it.
- **Global portal** `track.asendia.com`, which serves the European subsidiaries. Every search
  needs a Cloudflare Turnstile token, so it is not a sync path. [probe.ts](probe.ts) keeps its
  protocol and parser for the Turnstile canary.

A number A1 does not know is not-found for this adapter only; routing then tries the universal
providers in the same check (see [routing](../../../../docs/ROUTING.md)).

## How it works

1. `direct`:
   1. `GET a1.asendiausa.com/tracking/js/main.js`: the page's public client config (API base
      URL, a shared Basic authorization value, `X-AsendiaOne-ApiKey`, default branded tracking
      key). Same for every visitor, read at run time, cached six hours, never pinned. The API
      host must be an Asendia domain over HTTPS.
   2. `GET <api>/api/A1/TrackingBranded/Customer?trackingKey=`: the page's brand request, used
      to prove the key. A rejected key answers 204 "no customers configured": schema drift,
      not not-found.
   3. `GET <api>/api/A1/TrackingBranded/Tracking?trackingKey=&trackingNumber=`. A warm lookup
      is this single request.
   - The outcome is `responseStatus.responseStatusCode` inside an HTTP 200: 200 with data, or
     204 "no package data found".
   - A JSON 401/403 from a cached config re-reads the page once.
   - A plain browser-like `User-Agent` is required; Cloudflare answers 403 "error code: 1010"
     to library defaults. No cookie or session.
   - 25-second budget per lookup, 10 seconds per request.

## Notes

- A bad key also yields 204 "no package data", so a 204 is reported as not-found only if the
  key was proven in the last 15 minutes. Otherwise the key is checked first; if it moved, the
  page is re-read and the lookup repeated once. Without this, a rotated key would bench every
  Asendia parcel as not-found.
- The reply echoes nothing about the query. It is bound to the request through the three
  references its summary reports (carrier original, customer, vendor).
- Scan codes mean different things per `eventSource` (USPS reuses `10` and `B1`, Broadreach
  uses `B8`), so codes are read only for Asendia's own sources:
  - `A1 … Data` sources: A1 codes (`1` registered, `2` accepted, `2.1`/`2.2` in transit).
  - `FullTrack API`: Asendia's harmonized codes from a published list (linked in
    [status.ts](status.ts)). Consumer-return `RET*` and inquiry `CLAIM*` codes are unmapped.
  - Partners (`USPS TrackV2 API`, `BROADREACH API`, …): exact wording, else the shared rules.
- The declared final-mile link becomes `delivery_carrier` only through catalog link rules; the
  vendor reference becomes `delivery_tracking_number`, so the host can propose one
  confirmation lookup with that operator.
- Weight is converted from pounds; `destination_country` comes from the summary.
- A scan without an explicit offset is dropped.
- `AS` + 9 digits + `US` needs no S10 checksum: a real A1 number fails it. The generic postal
  rule excludes this shape.
- A1 also accepts customer references, eBay `EEUS…` numbers, merchant references and last-mile
  numbers. They are not specific to Asendia, so there is no detection rule for them. S10
  numbers issued by a partner post stay with that post.
- Events keep time, wording, code and city/province/country only. Address lines, postal codes,
  service name and order reference are never read.

## Rejected approaches

- Solving or skipping Turnstile on `track.asendia.com`: out of scope and against the portal's
  intent. Its frontend requests a token whenever `ENABLE_CAPTCHA` is set.
- The documented A1 Tracking v2.0 API (`a1api.asendiausa.com`): 401 without account
  credentials. The branded endpoint is what the public page uses.

## Limitations

- Only shipments on Asendia USA's platform. European Asendia numbers usually get not-found from
  A1 and depend on the universal providers.
- No delivery estimate.
- USPS scans relayed by A1 carry `+00:00` but may be local wall time labelled UTC (unconfirmed);
  the offset is kept as sent. USPS pre-shipment scans are date-only and arrive as midnight UTC.
- A structural change to `main.js` fails as schema drift.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/asendia`. `adapter.live.test.ts`
checks a history and an unknown number; set `ASENDIA_LIVE_NUMBER` to replace the published
default if A1 archives it. `probe.live.test.ts` checks that the portal still rejects an invalid
Turnstile token. The probe reads a real token from `ASENDIA_TURNSTILE_TOKEN` for manual runs.
