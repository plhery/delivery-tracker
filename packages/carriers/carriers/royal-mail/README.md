# Royal Mail

The dedicated adapter reads the JSON response produced by Royal Mail's public
[tracking form](https://www.royalmail.com/track-your-item). It requires the
private TRAWL service with this repository's `ops/trawl` compatibility build.

## Retrieval

1. Attach capture for the exact requested `GET` URL under
   `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/`.
2. Load the public page, dismiss optional cookies, enter the number using native
   keyboard events and submit. The hash route alone only prefills the field.
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

Recipient, signature, photo, address and GPS fields are not retained. Delivered
prose is reduced to “Delivered”. Empty objects and generic gateway 404s never
become a claim that the shipment does not exist. Royal Mail's `E1142` response
says it cannot currently confirm the status; the adapter treats it as
inconclusive. `E0015` is a challenge failure.

## Verification and limitations

The parser fixtures are synthetic reconstructions of the current public page
bundle, with its nested summary and event vocabulary. They are not live success
captures. Offline tests cover identity, status semantics, ordering, privacy,
error classification, exact capture matching and form preparation.

A fresh browser on the production host submitted the public form, auto-passed
invisible hCaptcha and received an actual summary API response on 2026-09-20.
The public reference returned HTTP 404 / `E1142`; this proves the request path,
not successful tracking of a current shipment. The packaged Tier 3 and Tier 2
flows both reached that endpoint in 10.9 s and 11.3 s respectively.

TRAWL's native hCaptcha solver supports checkbox auto-pass and audio. Its image
challenge support is limited; Royal Mail's invisible widget has no checkbox.
Auto-pass depends on the browser session and upstream risk assessment, and is
not guaranteed for every request. No paid solver key is required for the
observed auto-pass path.

Supply a current number outside the repository as
`ROYAL_MAIL_LIVE_TRACKING_NUMBER`, configure `FLARESOLVERR_URL`, and run:

```sh
npm run test:carriers:live -- packages/carriers/carriers/royal-mail/adapter.live.test.ts
```

Never commit live responses or private test inputs.
