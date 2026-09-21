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
   CAPTCHA solver: that request follows the client token callback. This alone
   does not prove that Royal Mail accepted the token or its risk assessment. A failed
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
it`. Those microsummary replies contained no event history. No visible puzzle
or paid solver was needed for those samples.

In an existing ordinary Chrome profile, selecting **Get more details** made a
separate `GET /mailpieces/v3/<reference>/events` call on `api-web.royalmail.com`,
with a newly issued `x-rmg-recaptcha` token. Its HTTP 200 reply contained the same
`mailPieces` object and four events with `eventCode`, `eventName`, `eventDateTime`
and `locationName`. This verifies the live history vocabulary, but the adapter
currently captures only microsummary: automated history retrieval is not
implemented or deployed. The postcode-protected proof-of-delivery flow was not
accessed. No live response body was saved as a fixture.

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

Further IP, session and browser comparisons on the same date:

| Probe | Result |
|---|---|
| Same Camoufox process, fresh contexts, server egress versus Mac egress over a temporary CONNECT proxy | Both issued a CAPTCHA token, then the tracking connection reset |
| Visit the homepage, open the form without a tracking hash, wait 15 seconds, then submit | Same failure on both connections |
| Isolated TRAWL 1.6.2 build with the current consent and capture fixes | Same reset; an upgrade alone did not fix this sample |
| Camoufox with the API hostname pinned to the IPv4 peer used by successful ordinary Chrome | Same reset |
| Existing ordinary Chrome profile on the Mac | Identity-matched summary and full history, both HTTP 200; neither response came from disk cache or a service worker |
| Fresh headed Chromium 151 with a new persistent profile on the server | One identity-matched HTTP 200 summary in about 5.4 seconds; subsequent fresh-profile runs failed |
| Headed Chromium, including a repeat pinned to the API peer from its successful run | CORS preflight returned HTTP 200, but the tracking GET failed before a response; peer pinning did not make success repeatable |

The proxy changed the public IPv4 egress, without copying browser cookies or
tokens. It allowed the observed tracking, CAPTCHA and consent hosts; some
third-party homepage resources were refused, so it was not a perfect network-only
control. The successful server Chromium lookup rules out a blanket ban on that
server's access at that time. It does not rule out IP reputation as one input to
per-session decisions. Neither a persistent profile nor a particular API peer
was sufficient for reliable retrieval.

These observations locate the failing phase after the client CAPTCHA token
callback, and at the tracking connection. In the Chromium preflight probe, the
OPTIONS request succeeded and the GET failed. The evidence does not distinguish
edge policy, browser/session signals, backend token validation or an intermittent
service fault. A different egress, a delay, a new browser profile, a newer TRAWL
build and an API-peer override are not demonstrated fixes. Successful isolated
summary retrieval is demonstrated; reliable deployed retrieval is not.
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

### Chrome alternatives

TRAWL 1.5.0 and 1.6.2 do not expose a Chrome engine setting. Their normal and
headed pools both launch Camoufox. The internal
[`BrowserPool.browserFactory` hook](https://github.com/germondai/trawl/blob/v1.6.2/packages/browser/src/pool.ts)
accepts Playwright-compatible browser/context objects, so a scoped code change
can supply Chrome. On 2026-09-22, injecting Patchright with Google Chrome into
TRAWL's existing fresh-browser tier returned the expected controlled local test
page successfully. This establishes interface compatibility, not carrier access.

Google Chrome 153.0.8010.52 and nodriver 0.50.3 were installed in an isolated
diagnostic image on the production host. The following probes used fresh
profiles, a headed browser under Xvfb, the normal tracking form, and the same
four consent preferences. No existing user's cookies, custom user-agent or
proxy were used.

| Controller | Royal Mail result |
|---|---|
| Patchright 1.62.3 with Google Chrome, persistent context and no viewport override | Both public references reached a token-bearing GET; preflight returned HTTP 200, then GET failed with `net::ERR_HTTP2_PROTOCOL_ERROR` |
| Stock Playwright Core 1.60.0 with the same Chrome | A visible hCaptcha frame appeared; no tracking GET started. TRAWL's built-in solver returned false after timing out on `#checkbox` |
| nodriver 0.50.3 with the same Chrome, native keyboard/mouse events | The delivered public reference reached a token-bearing GET; preflight returned HTTP 200, then GET failed with `net::ERR_HTTP2_PROTOCOL_ERROR` |

The Patchright setup follows its documented
[Chrome recommendation](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs#best-practice---use-chrome-without-fingerprint-injection).
[nodriver](https://github.com/ultrafunkamsterdam/nodriver) is a separate Python/CDP
controller, not a replacement object for TRAWL's Playwright interface. Using it
would require another integration. The application already installs Chromium
for its existing Playwright transport; these probes do not justify adding
another production browser dependency or switching Royal Mail to that transport.
No Chrome backend was enabled in production by this investigation.

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
