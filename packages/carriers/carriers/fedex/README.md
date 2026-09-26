# FedEx

Global FedEx tracking from the site's own tracking API, captured through a browser. Akamai
often refuses even real browser sessions, so this adapter is unreliable and the router's
universal-provider fallback does a lot of the work.

## How it works

The adapter accepts 12- or 15-digit numbers (spaces, dots and dashes stripped) and rejects
anything else, including longer label barcodes, before any request. Without a browser
service it fails at once with `ChallengeError('FedEx challenged direct tracking; configure
FLARESOLVERR_URL for browser fallback')`.

1. `trawl`: loads `https://www.fedex.com/fedextrack/?trknbr=…` (a shell) with
   `captureResponses` on `POST https://api.fedex.com/track/v2/shipments` and parses the
   captured replies newest first. The browser service has a dedicated FedEx route (see
   [`ops/trawl/README.md`](../../../../ops/trawl/README.md)):
   - it opens the blank tracker and submits its normal form, every time, because the
     result-page form can ignore a submission or keep the previous route;
   - it keeps the page and context only after a reply that matches the requested number
     (request and response) and has a status or scans;
   - the context stays on its pooled browser and closes after 30 min idle, 2 h total, any
     failed validation, or a browser restart.

## Notes

- The newest captured reply decides. A captured 401/403 is a `ChallengeError`, so routing
  applies cooldown and fallback; it is not hidden behind an older 200 from the same page.
- Other captured errors: 429 is `RateLimitedError` with its `Retry-After`; 5xx is
  `UpstreamHttpError`; any other 4xx, including 404, is a `TransportError`, never
  not-found.
- A 403 is Akamai's HTML `Access Denied` page; an accepted reply is JSON from the API
  gateway. Both datacenter and residential IPs get a mix of the two, so it is not a fixed IP
  ban.
- The rendered page is read only to spot a challenge. Its "can't find that tracking number"
  notice appears both for unknown numbers and for refused API calls, so it never means
  not-found.
- An empty `packages` array returns an unlocated `unknown`, not not-found: the real not-found
  envelope has never been observed.
- A recipient-gated shipment (`TRACKING.AUTHORIZATION.ERROR`) raises `InputRequiredError`
  instead of retrying a verification the adapter cannot supply.
- Results bind strictly to `trackingNbr`. Several matches (same digits, different
  qualifiers) are refused: the qualifier is opaque and picking one risks another
  recipient's parcel.
- Status uses `keyStatusCD` / scan `statusCD` first, then substring matches on the prose. A
  `DL` code is terminal and outranks the wording.
- Delivered scans are rewritten to "Delivered" because FedEx's line names the signatory.
- Scan times come from `date` + `time` + `gmtOffset`. A scan without a usable triple keeps no
  time rather than a guessed zone.

## Rejected approaches

- Plain HTTP to the tracking API, with or without the page's cookies, headers and OAuth
  token: 403. The token endpoint is open; the data endpoint is bot-gated.
- Legacy `trackingCal/track`: 403 for non-browser clients; its `api.ecom.fedex.com` route
  answers 404.
- Official developer API (`apis.fedex.com`): needs per-deployment credentials, so it cannot
  serve anonymous lookups. Reconsider if the browser path stays unreliable.
- Copying cookies into a fresh browser context did not reproduce acceptance in the recorded
  comparison, while the original context still worked. The test did not isolate omitted storage,
  initialization, browser characteristics or timing, so it does not prove intrinsic context binding.
- Blind retries after a 403: replies carry no `Retry-After`, and retries on the deployed path
  did not recover.

## Prior art checked

- [`infecting/akamai` at `9390e7d`](https://github.com/infecting/akamai/tree/9390e7d9a09ccf9a0864728eb96fc66b48e548d4)
  is an unlicensed 2022 proof of concept for an older FedEx login flow and Akamai sensor version,
  not the current tracking endpoint. It is useful only as historical evidence that form events,
  timing and fingerprint coherence can affect acceptance.
- [`OXDBXKXO/akamai-toolkit` at `36b5e23`](https://github.com/OXDBXKXO/akamai-toolkit/tree/36b5e23aa111fd9099e3b5a0de618280b499fc73)
  is MIT-licensed analysis tooling for Akamai v1.70, last updated in 2021. Its observer-before-
  navigation method remains useful; its parser and script replacement are obsolete here.
- [`markswendsen-code/mcp-fedex` at `02aa3ce`](https://github.com/markswendsen-code/mcp-fedex/tree/02aa3ce2d1a71a13f09cd1539541499a1cb290f5)
  uses Chromium, stealth overrides and a retained context, but never captures the tracking API
  response or binds returned data to the requested number. A normal page shell with an API 403
  therefore escapes its blocker check, so it is not evidence that stealth fixes this failure.

## Limitations

- Cold browser sessions often get 403, and a retained session can lose acceptance at any
  time.
- Sender, recipient, signatory, service description, weight and dimensions are in the reply
  but never read; a test asserts it.

## Latest verification

- 2026-09-26: two fresh requests through the deployed Camoufox 152 retained-session runner
  reached the tracking API and received HTTP 403. Stock Chrome 154 in headless mode instead
  received FedEx's `System Down` shell before the form loaded, on both local and server egress.
- The same automated Chrome in headful mode loaded the tracker on both egress paths. Through
  the server path, its tracking preflight received HTTP 200 from `AkamaiGHost`, followed by an
  HTML HTTP 403 for the tracking POST. Chrome exposed that rejection to Playwright as
  `net::ERR_FAILED` because the denial lacked the normal CORS header; lower-level network
  metadata preserved the actual status.
- Waiting ten seconds after the form was ready allowed two additional first-party security
  posts but produced the same tracking denial. Pointer and Enter experiments did not dispatch
  the site's tracking request, while the page handler did. No browser switch, fixed wait or
  extra retry was deployed from this small sample; universal-provider recovery remains the
  reliable path.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/fedex` with
`FEDEX_LIVE_TRACKING_NUMBER` and `FLARESOLVERR_URL` set. The missing-browser check runs
without either.
