# SF Express

SF Express waybills (12 digits, or `SF` + 13 digits), tracked through the anonymous route query
behind the official [Taiwan tracking page](https://htm.sf-express.com/tw/en/dynamic_function/waybill/),
driven by the TRAWL browser service.

## How it works

1. `trawl`: TRAWL opens the Taiwan page for the number (tiers 2–3, no plain HTTP) and captures the
   page's own call to
   `GET https://htm.sf-express.com/sf-service-core-web/service/bills/{number}/routes?lang=en&region=tw&translate=&app=bill`.
   - The page opens a GeeTest v4 slider in bind mode with no start button, which TRAWL's generic
     solver can't drive. The scoped helper [`sf-express-session.mjs`](../../../../ops/trawl/sf-express-session.mjs)
     solves it; see [`ops/trawl/README.md`](../../../../ops/trawl/README.md).
   - The page adds its own short-lived verification headers. Each lookup uses a fresh isolated
     context; no cookies, tokens or phone suffix are stored.
   - Only a capture whose URL matches that number and query exactly counts. A hidden widget is not
     success.

Budget: 45 s by default (max 60 s), including a 15 s TRAWL transport allowance.

## Notes

- There is no reliable not-found. `code: 60000` (`运单路由查询被管控`, query restricted) and captcha
  failures (`code: 1` "captcha verification failure", `70000`) are challenges; synthetic numbers get
  `60000` too. `500` is indeterminate, and an empty success envelope proves nothing.
- On the capture: 401/403 is a challenge, 404/410 means the endpoint is gone, 429 is rate limited
  (honours `Retry-After`).
- Exactly one `result` entry must have `id` equal to the number. Sibling references and
  shipment-wide personal detail objects are ignored.
- Each scan is classified by its own `opCode`. Code `202` (已出库) sits in the frontend's warehouse
  "delivered" group but means warehouse dispatch, not delivery. Code `8000` depends on its
  `stayWhyCode`; unknown combinations stay unclassified.
- Summary `expressState` `99` is broad transit, so a mapped latest scan wins over it. Other summary
  states win over the scan.
- `scanDateTime` has no offset. Events get `local_time` and the result `last_update_local`; there is
  no UTC `time`, `delivered_at` or ETA. The Taiwan frontend just prints the string, and SF
  International's timezone fields belong to a different API. Events sort by wall-clock string, like
  the portal. The host keeps this history and still asks universal providers for real instants.
- "AWB Info & POD" rows are proof-access links, not scans, and are dropped. Phone controls are
  stripped from remarks, and delivered scans read `Delivered`.
- Not used: [SF International](https://www.sf-international.com/us/en/support/querySupport/waybill)
  (Tencent verification) and the Mainland China portal (GeeTest plus phone verification).

## Limitations

- Anonymous access may not cover every shipment class; restricted numbers get `60000`.
- Weights, facility IDs, estimates and personal detail blocks are not read. At most 100 of 500 scans
  are kept.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/sf-express` with `FLARESOLVERR_URL` and
`SF_EXPRESS_TRACKING_NUMBER`. Optional: `SF_EXPRESS_EXPECTED_EVENTS` (exact event count) and
`SF_EXPRESS_CHECK_RESTRICTION=1` (checks that a synthetic number gets the restriction).
