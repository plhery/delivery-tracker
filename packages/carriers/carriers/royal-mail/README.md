# Royal Mail

Royal Mail uses the normal **universal-provider route**, like other carriers
without an active dedicated scraper. Automatic tracking remains enabled, with
the shared provider order, saved affinity and cooldowns.

The experimental adapter and these investigation notes remain in the repository,
but the catalog and registry route Royal Mail to `universal`. Its browser flow
has not worked reliably on the production server and is not called by normal
tracking or delivery-handoff discovery. The notes below describe that experiment,
which requires the private TRAWL service with this repository's `ops/trawl`
compatibility build and [Royal Mail's tracking form](https://www.royalmail.com/track-your-item).

## Retrieval

1. Attach capture for the exact requested `GET` URL under
   `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/`.
2. Set the site's four non-identifying TrustArc opt-out preference cookies, then
   load the public page. With those preferences present, the hash route can
   start the lookup itself. Otherwise, enter the number using native keyboard
   events and submit, verifying the input in the same document as the click.
   If a consent banner still appears, decline and wait for its reload first.
3. Allow invisible hCaptcha to auto-pass and invoke the site's own callback.
   The page can also reuse an existing `x-rmg-api-session`. Once the exact
   tracking GET starts, skip further form submissions and TRAWL's CAPTCHA
   solver. A first HTTP 401 containing `E0015` stays open for the page's own
   CAPTCHA refresh within the capture deadline; a second rejection ends the
   wait. Other final responses and tracking connection failures end capture
   promptly. A client token does not prove server acceptance.
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
in the experimental adapter. Normal tracking goes straight to the shared
universal-provider route without attempting this browser flow.

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

Invisible hCaptcha does not require an initial checkbox, but can present an
interactive challenge. A drag-and-drop puzzle was observed and completed in
the controller checks below. TRAWL's checkbox/audio fallback remains unverified
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
diagnostic image on the production host. The initial probes below used fresh
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
for its existing Playwright transport. No Chrome backend was enabled in
production by this investigation; live integration remains unsuccessful in the
follow-up below.

### Loading time and intermittent success

Further headed Google Chrome/Patchright probes on 2026-09-22 separated an extra
loading delay from waiting for a failed request:

- After the page's load event and CAPTCHA API readiness, waiting another 30
  seconds before typing and submitting still failed. The preflight returned
  HTTP 200. Chrome NetLog recorded `HTTP2_SESSION_RECV_RST_STREAM` for the
  tracking GET 184 ms after sending its headers, before any response headers.
  The remote peer ended that stream; the browser did not exhaust its timeout.
- In a separate fresh persistent profile, the first lookup failed with
  `net::ERR_FAILED`. A resubmission five seconds later sent a different CAPTCHA
  token and returned an identity-matched HTTP 200 summary in about 9.9 seconds
  overall. Recovery from the HTTP/2 reset itself was not demonstrated.
- Two more fresh persistent profiles, one for each public reference, returned
  matching HTTP 200 summaries on their first submissions in about 4.3–4.6 seconds.
  Categories were `Delivered` and `We've got it`. Neither used disk cache or a
  service worker. These successes required no extra loading delay or visible
  CAPTCHA solving.
- A live lookup through TRAWL Tier 3, with Chrome injected into `BrowserPool`
  and the current consent/capture fixes, still failed with the HTTP/2 error in
  about 5.7 seconds. The tier used its normal fresh context and tracking hash
  route. It did not enter the redundant missing-checkbox fallback.

The sample establishes intermittent automated Chrome access, not a reliable
delay or retry remedy. It does not isolate session/form differences from an
upstream service or policy decision. Raw NetLogs and response bodies were not
retained; only allowlisted timing, protocol and response-shape metadata was read.

A [Mozilla Royal Mail report](https://bugzilla.mozilla.org/show_bug.cgi?id=1944309#c2)
records a first-attempt HTTP 401 with `E0015`, a successful second attempt, and
separately interrupted tracking connections with tracking protection disabled.
It was later closed as working in Android Firefox without an identified root
cause. A [Playwright report](https://github.com/microsoft/playwright/issues/36001)
documents `ERR_HTTP2_PROTOCOL_ERROR` changing with browser mode and environment
on another site. These are related symptoms, not proof of the same cause here.

### Controlled retry check

A follow-up on 2026-09-22 used six fresh sessions per setup, three for each
public reference. The setups were interleaved on the same host, with headed
Google Chrome 153.0.8010.52 and Patchright 1.62.3 held constant. Each failed
first attempt received one form resubmission five seconds after failure,
in the same browser session. The site's callback supplied the token; no API
request or token was replayed directly.

| Setup | First-attempt successes | Failed lookups retried | Successful retries | Final successful sessions |
|---|---|---|---|---|
| Standalone Patchright, new persistent profile, normal form | 1/6 | 5 | 0/5 | 1/6 |
| TRAWL Tier 3 with injected Chrome, normal fresh context and tracking hash | 0/6 | 6 | 0/6 | 0/6 |

The TRAWL test used the current consent/capture integration plus a temporary
wrapper that rearmed response capture and resubmitted the form before the tier
closed its context. This tested recovery inside the actual tier, rather than
starting an unrelated browser after the failure.

All 11 resubmissions sent different CAPTCHA tokens and failed with
`net::ERR_HTTP2_PROTOCOL_ERROR`. The initial failures comprised eight HTTP/2
errors and three `net::ERR_FAILED` errors. The sole successful lookup returned
an identity-matched HTTP 200 summary without disk cache or a service worker.
Median total session duration was about 9.2 seconds for standalone Chrome and
9.0 seconds for TRAWL, including browser setup, the retry where needed and
cleanup.

This series did not reproduce the earlier successful resubmission: the tested
five-second retry recovered none of the 11 failures. These counts describe a
short test window, not a long-term success rate or the outcome of other recovery
strategies. The retry wrapper remained an isolated experiment; no production
retry or Chrome backend was deployed. Raw responses and CAPTCHA tokens were
not retained.

### Session refresh and further controller checks

Further checks on 2026-09-22 varied consent, context reuse, network egress and
the Chrome controller. None established reliable retrieval:

- Keeping a Chrome context open, with a full navigation before each lookup,
  produced several matching HTTP 200 replies. Some first returned HTTP 401,
  then the page obtained a fresh CAPTCHA token and returned HTTP 200. Fast
  repeated replies could have come from browser cache; a separate
  cache-disabled run still failed intermittently. The later retained-page
  check below separates browser cache from fresh successful retrieval.
- The public bundle stores an `x-rmg-api-session` response header as a cookie
  and uses that session instead of a CAPTCHA token when available. Its error
  handler runs hCaptcha again for `E0015`. This explains why treating every
  first tracking reply as final can terminate a legitimate recovery sequence.
- The same headed Chrome configuration through a temporary Mac HTTPS CONNECT
  proxy returned one matching HTTP 200 and one `net::ERR_FAILED`. Direct server
  controls also failed. Changing egress alone did not establish reliability.
- Accepting all cookies, using an incognito context, opening only the hash URL,
  removing the extra CDP observer and disabling HTTP/2 did not establish a
  repeatable fix. The HTTP/2-disabled cases never started a tracking GET, so
  they do not demonstrate a tracking response over HTTP/1.1.
- NetLog distinguished local cancellation after successful preflight in two
  `net::ERR_FAILED` samples from a remote stream reset in another sample.
  The local cancellation's cause remains unidentified; these failures should
  not all be described as server resets or insufficient loading time.
- [SeleniumBase 4.54.10 CDP mode](https://github.com/seleniumbase/SeleniumBase/blob/master/examples/cdp_mode/ReadMe.md)
  presented a visible drag-and-drop hCaptcha. Completing a puzzle caused the
  token-bearing tracking GET to start, but that GET still failed with
  `net::ERR_HTTP2_PROTOCOL_ERROR`. Solving the interactive challenge alone did
  not fix that sample.
- Launching Chrome directly with a minimal CDP controller, without Playwright,
  Patchright or SeleniumBase, also produced token-bearing GETs followed by
  HTTP/2 errors for both public references. `navigator.webdriver` was false.
  The previously tested controller libraries are not the sole cause.

Capture now preserves the first `401 / E0015` while allowing one automatic
refresh within the existing deadline. It retains a rejection if recovery never
arrives, ends repeated rejection promptly, and keeps other final errors final.
The parser already reads the newest matching capture. Synthetic regression
tests cover recovery and rejection, and controlled tests through actual TRAWL
Tier 3 and Tier 2 both captured `[401, 200]` and the correct synthetic mailpiece.
Those tests establish the recovery behavior, not Royal Mail availability.
The update was deployed through Coolify and verified against the source hash.
The service remained healthy, but its final live check still failed with a
tracking connection reset in 8.2 seconds. Reliable deployed retrieval remains
unproven; no Chrome backend or general network retry was enabled.

### Retaining the successful page

A further 2026-09-22 experiment launched installed Google Chrome directly with
a minimal CDP controller, native keyboard/mouse events, opt-out preferences and
fresh temporary profiles. After a successful lookup it kept the same browser,
context and document, using **Track another item** instead of reloading. It
cleared the HTTP cache before every subsequent lookup and checked the response
identity and CDP cache flags. No user profile or existing user cookies were used.

| Environment | New-profile attempts | Subsequent lookups on the successful page |
|---|---|---|
| Mac, Chrome 153.0.8010.53, direct connection | 1/1 succeeded | 4/4 succeeded across both public references |
| Mac, second direct profile, including expiry | 1/1 succeeded | 3/3 succeeded, including renewal after expiry |
| Mac Chrome through the server's SOCKS5 egress | 1/1 succeeded | 4/4 succeeded across both public references |
| Server, Chrome 153.0.8010.52 under Xvfb | 0/3 succeeded | No successful session available to test |

All 14 Mac replies were identity-matched HTTP 200 responses, with no disk,
memory-cache event or service-worker hit. The initial request used a CAPTCHA
token; all four subsequent requests in the first series used
`x-rmg-api-session` without a CAPTCHA token. Those four network responses took
398–560 ms. This establishes live session reuse locally, rather than merely
repeated cached parcel data. It does not establish that page retention caused
success, since the first fresh Mac
lookup also worked. All three fresh server profiles failed with
`net::ERR_HTTP2_PROTOCOL_ERROR`; two bounded replacements did not recover that
lookup. The server's retained-page hypothesis therefore remains untested.

Issued session tokens declared a 120-second lifetime. Successful subsequent
requests returned tokens with their original expiry, rather than extending it.
In the second direct profile, waiting 125 seconds after a successful warm lookup
let the token expire. The same document then automatically obtained a fresh
CAPTCHA token, returned a matching HTTP 200 and received a new 120-second
session. The next lookup successfully used that new session. Keeping the page
open can preserve a working renewal flow; periodic requests did not extend the
original token. No manual CAPTCHA solving or paid solver was needed in these
successful sequences.

The egress comparison used a temporary loopback-only SSH SOCKS5 forward; a
separate proxy check confirmed the server's public IPv4. No cookies were moved
between hosts. The successful proxied Mac sequence argues against that IP alone
being sufficient to cause failure. It does not isolate the remaining OS,
Chrome patch version, graphics or container differences. The next useful server
experiment is reproducing the successful browser environment and then testing
page retention, rather than assuming more identical retries will work. This
small series does not establish a long-term success rate or deployed retrieval.

Only allowlisted response metadata and token expiry metadata were retained;
token values and live response bodies were not saved. Temporary profiles and
the proxy were removed. TRAWL's one-hour Redis TTL cannot keep an upstream token
valid: its cookie cache is distinct from retaining the successful browser page.
Production behavior was not changed by this experiment.

Additional server-only probes on 2026-09-22 also failed after the token-bearing
tracking request started. Native Chromium outside Docker, with its normal
sandbox, still reported `ERR_HTTP2_PROTOCOL_ERROR`. Language and Mac browser
identity overrides did not recover the request. A separate `curl_cffi` replay
failed with an HTTP/2 stream error even when the browser's request was intercepted
before transmission so its fresh CAPTCHA token had not already been submitted.
These experiments did not establish a working server session. They do not prove
which browser or network property caused rejection. The production route is
therefore restored to the existing universal providers; the scraper remains
available only for explicit experimental calls and tests.

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
