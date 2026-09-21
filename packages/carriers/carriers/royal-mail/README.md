# Royal Mail

The dedicated adapter reads the JSON response produced by Royal Mail's public
[tracking form](https://www.royalmail.com/track-your-item). It requires the
private TRAWL service with this repository's `ops/trawl` compatibility build.

## Retrieval

1. Attach capture for the exact requested `GET` URL under
   `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/`.
2. Set the site's four non-identifying TrustArc opt-out preference cookies, then
   load the public page. With those preferences present, the hash route can
   start the lookup itself. Otherwise, enter the number using native keyboard
   events and submit, verifying the input in the same document as the click.
   If a consent banner still appears, decline and wait for its reload first.
3. Allow invisible hCaptcha to auto-pass and invoke the site's own callback.
   Once the exact tracking GET starts, skip further form submissions and TRAWL's
   CAPTCHA solver: that request follows successful verification. A failed
   tracking connection ends capture promptly with a bounded network-error code.
   If no tracking request starts, the native solver still gets the remaining
   budget; interactive-challenge recovery is unverified.
4. Parse the captured JSON. Cookies and challenge tokens stay in the browser;
   the adapter does not replay the request through another HTTP client.

Both fresh and cached TRAWL tiers run form preparation before captcha solving.
A missing tracking reply fails the tier so TRAWL can invalidate a stale cached
session and try a fresh browser context within the remaining budget.
Capture ignores preflight requests and unrelated tracking numbers. A browser
main-document response of 304 is accepted only at Tier 2/3; tracking still
requires its own captured JSON reply. The adapter
allows 60 seconds of browser work, with the shared client's transport allowance.
Upstream challenges, throttles, HTTP failures and schema errors remain failures
so normal universal-provider recovery can run.

## Response contract

The public application reads a single `mailPieces` object, not an array:

| Field | Use |
|---|---|
| `mailPieces.mailPieceId` | Exact identity check |
| `summary.statusDescription` | Current status |
| `summary.statusCategory` | Canonical summary stage; falls back to description when unrecognized |
| `summary.lastEventDateTime` | Latest update, when present |
| `estimatedDelivery.date` | Expected calendar day, discarded after delivery |
| `events[].eventName` | Scan description |
| `events[].eventDateTime` | Scan time; preserve explicit offsets |
| `events[].locationName` | Scan location |
| `events[].eventCode` | Provider code |

Summary-only replies are supported. History is deduplicated and sorted before
trimming to 100 events. Unknown wording stays unknown; arrival at a delivery
office is not proof that collection is available. Offset-free times remain
unresolved rather than assuming all scans happened in the UK.

Summary categories use the public bundle's vocabulary. `Collected` is a
completed delivery in that vocabulary, while a history scan saying only
“Collected” can indicate carrier acceptance. `Released from Customs` establishes
transit, and `Ready for Delivery` alone does not establish out-for-delivery.

Recipient, signature, photo, address and GPS fields are not retained. Delivered
prose is reduced to “Delivered”. Empty objects and generic gateway 404s never
become a claim that the shipment does not exist. Royal Mail's `E1142` response
says it cannot currently confirm the status; the adapter treats it as
inconclusive. `E0015` is a challenge failure.

## Verification and limitations

The fixtures are synthetic reconstructions of the public application bundle.
Live HTTP 200 replies on 2026-09-21 confirmed a single `mailPieces` object with
matching `mailPieceId` and summary categories `Delivered` and `We're expecting
it`. Those replies contained no event history; event-history retrieval remains
unverified. No visible puzzle or paid solver was needed for those samples.

Instrumentation identified two separate failure paths:

- Changing cookie consent reloaded the page and erased the number. The form
  displayed "Please enter a reference number" without invoking hCaptcha. Waiting
  for that reload fixed the race; preloading the opt-out preferences avoids it.
- Later attempts received an hCaptcha token and sent the tracking GET, but the
  connection failed before an HTTP response. Firefox reported `NS_ERROR_NET_RESET`;
  headed Chromium reported `net::ERR_HTTP2_PROTOCOL_ERROR`. A repeated submission
  in the same Firefox session failed too. Both deployed adapter checks failed.
  The native solver's subsequent missing-checkbox timeout was secondary.

Further transport and consent probes on 2026-09-21:

| Probe | Result |
|---|---|
| Anonymous direct HTTP | No tracking response; request timed out |
| Direct HTTP with the browser's captured headers and token | Timed out |
| curl over HTTP/2, IPv4 and IPv6 | Stream closed with `INTERNAL_ERROR` |
| curl over HTTP/1.1 | Timed out |
| Firefox with HTTP/2 and HTTP/3 disabled | Same tracking connection reset |
| Headed Chromium on the same host | Page loaded, then tracking requests failed with HTTP/2 protocol errors |
| Native DNT and GPC, including request headers | Consent banner and its reload still occurred |
| Four opt-out preference cookies, without consent ID or browser/session tokens | Banner and consent reload avoided; API connection failure remained |

These observations locate the remaining failure after CAPTCHA completion and
at the tracking connection. They do not identify whether the upstream cause is
an edge policy, browser/network fingerprint, or a service fault. Successful
isolated summary retrieval is demonstrated; reliable deployed retrieval is not.
The consent and failure-handling update was deployed and verified: one production
attempt returned the diagnosed connection reset in 6.6 seconds, compared with
about 35 seconds before the change, without a redundant CAPTCHA attempt. This
improves failure handling; it does not establish successful production tracking.
A [Firefox compatibility report](https://github.com/webcompat/web-bugs/issues/207281)
also describes Royal Mail's tracking request failing, but our Chromium result
means a browser switch alone is not a demonstrated fix.

The public request carries an `x-ibm-client-id` and the issued CAPTCHA token in
`x-rmg-recaptcha`. A browser-bootstrap-and-HTTP-replay path did not work in the
probe. No working anonymous direct-HTTP alternative was demonstrated. Royal
Mail's official account Tracking API is a separate access path requiring
onboarding; these probes do not test it.

Invisible hCaptcha removes the checkbox; it does not establish Royal Mail's
passive/difficulty setting. TRAWL's checkbox/audio fallback remains unverified
for this widget, and current hCaptcha [accessibility documentation](https://www.hcaptcha.com/accessibility)
describes text challenges. Its solver is identical in TRAWL 1.5.0 and
[1.6.2](https://github.com/germondai/trawl/blob/v1.6.2/packages/tiers/src/solvers/hcaptcha.ts).
The service remains on 1.5.0 with the scoped consent and capture fixes.

The two recent public references and their original forum URLs are recorded in
[numbers.json](numbers.json) as `public_shipment_report`. Their detection
expectations do not assert a current shipment status. Parser fixtures remain
synthetic; never copy recipient details or raw live responses into fixtures.

Supply a current number outside the repository as
`ROYAL_MAIL_LIVE_TRACKING_NUMBER`, configure `FLARESOLVERR_URL`, and run:

```sh
npm run test:carriers:live -- packages/carriers/carriers/royal-mail/adapter.live.test.ts
```

Never commit live responses or private test inputs.
