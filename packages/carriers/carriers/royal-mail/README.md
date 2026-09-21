# Royal Mail

The dedicated adapter reads the JSON response produced by Royal Mail's public
[tracking form](https://www.royalmail.com/track-your-item). It requires the
private TRAWL service with this repository's `ops/trawl` compatibility build.

## Retrieval

1. Attach capture for the exact requested `GET` URL under
   `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/`.
2. Load the public page, dismiss optional cookies, wait for the consent-triggered
   reload, enter the number using native keyboard events and submit. Verify the
   number in the same document as the click. The hash route alone only prefills
   the field.
3. Allow invisible hCaptcha to auto-pass and invoke the site's own callback.
   If no response arrives, TRAWL's native solver gets the remaining budget.
   Skip that solver once the API has answered: the callback resets the widget,
   so clicking its absent checkbox after success only wastes time.
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

The parser fixtures are synthetic reconstructions of the current public page
bundle, with its nested summary and event vocabulary. They are not live success
captures. Live summary replies have since confirmed the single `mailPieces`
object, identity field and summary vocabulary; live event history remains
unverified. Offline tests cover identity, status semantics, ordering, privacy,
error classification, exact capture matching and consent reload races.

A fresh browser on the production host submitted the public form, auto-passed
invisible hCaptcha and received an actual summary API response on 2026-09-20.
The public reference returned HTTP 404 / `E1142`; this proves the request path,
not successful tracking of a current shipment. The packaged Tier 3 and Tier 2
flows both reached that endpoint in 10.9 s and 11.3 s respectively. Follow-up
checks on 2026-09-21 exercised the complete adapter through the TRAWL API in
10.3 s and 10.8 s, including a revalidated (304) browser document. Form
submission invokes the normal button handler directly to avoid a Camoufox
mouse-action stall.

Later checks on 2026-09-21 used two recent, publicly posted shipment references.
Neither produced a summary reply, and TRAWL's subsequent solver timed out looking
for `#checkbox`. Instrumentation then reproduced the failure without invoking
the solver: cookie consent reloaded the document, discarding the typed number.
The click reached a replacement form with an empty input, which displayed
"Please enter a reference number." No `hcaptcha.execute` or `getcaptcha` request
followed. The missing-checkbox timeout was secondary, not evidence of an
interactive challenge or a rejected CAPTCHA token.

Re-entering the number in that same session invoked `execute`, received the
success callback with a token, and returned an identity-matched HTTP 200 summary
with category `Delivered`. The other public reference returned an identity-matched
summary with category `We're expecting it`. Neither reply contained event history.
Waiting for the consent reload before typing and checking the input at the click
fixes the reproduced race. A fresh browser with that change returned the delivered
summary in about 10 seconds, without invoking a solver or showing a challenge.
A separate fixed-flow attempt received the hCaptcha success callback but its
subsequent tracking request failed with `NS_ERROR_NET_RESET`. This was a transport
failure after verification, not an interactive CAPTCHA. Browser/network failures
can still require normal provider recovery.
After deploying the reload fix, both complete adapter checks still returned
TRAWL HTTP 500. An instrumented run of TRAWL's full Tier 3 path reproduced a
successful hCaptcha callback followed by the same tracking connection reset.
The subsequent native solver again timed out on the absent checkbox. Successful
summary retrieval is demonstrated in isolated browser sessions; reliable
retrieval through the deployed service remains unverified.

TRAWL's native hCaptcha solver attempts checkbox auto-pass and an audio fallback.
The audio path is unverified; hCaptcha's current [accessibility documentation](https://www.hcaptcha.com/accessibility)
describes optional text challenges instead. Royal Mail's invisible widget has no checkbox.
Invisible mode removes the checkbox; it does not establish that a site's
challenge difficulty is passive. These observations do not establish Royal
Mail's difficulty setting or verify recovery from an interactive challenge.
No paid solver key is required for the observed auto-pass path.

An upstream review on 2026-09-21 found the hCaptcha solver identical in TRAWL
1.5.0, [1.6.2](https://github.com/germondai/trawl/blob/v1.6.2/packages/tiers/src/solvers/hcaptcha.ts)
and the development branch. Upgrading alone does not remove its unconditional
checkbox click or add visual challenge solving. Newer browser fingerprint fixes
may affect auto-pass, but do not establish reliable challenge recovery. An
isolated 1.6.2 build with the original capture patch reproduced the checkbox
timeout for both public references. It still had the consent reload race;
that result did not establish a CAPTCHA-solving failure. The image remains on
1.5.0 with the form preparation fix.

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
