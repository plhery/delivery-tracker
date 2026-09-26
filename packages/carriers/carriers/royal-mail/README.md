# Royal Mail

Royal Mail is tracked through the universal providers (`tracking.adapter:
universal`). The browser adapter in this folder is experimental: it stays
registered for explicit calls and tests, but routing and handoff discovery never
call it because it doesn't work reliably from the production server.

## How the experimental adapter works

1. `trawl` (the only step): TRAWL, with the `ops/trawl` compatibility build
   (`tracking-capture.mjs`), loads
   `https://www.royalmail.com/track-your-item#/tracking-results/{number}` at tier
   2 or 3 and captures the page's own call to
   `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/{number}`.
   - Four TrustArc opt-out preference cookies are preloaded (no consent id or
     tokens). Changing consent reloads the page and erases the typed number, so
     hCaptcha never runs. With the cookies, the hash route starts the lookup
     itself; otherwise the number is typed with native key events and submitted.
   - Invisible hCaptcha usually auto-passes, or the page reuses an
     `x-rmg-api-session`. Once the tracking GET starts, TRAWL's solver is skipped.
   - A first `401 / E0015` stays open for the page's own CAPTCHA refresh (its
     bundle reruns hCaptcha on `E0015`); a second rejection, any other final
     reply or a connection failure ends capture at once.
   - No captured reply fails the tier, so TRAWL can drop a stale cached session
     and try a fresh context within the budget (60 s, 15 s settle).
2. The adapter parses the newest captured reply for the exact URL. A
   main-document 304 is accepted (cache revalidation).

No direct tier or HTTP replay of the browser session: Akamai refuses
non-browser clients. Without a browser service the adapter throws a
`ChallengeError` naming `FLARESOLVERR_URL`.

## Notes

- 429 is rate-limited (honours `Retry-After`), 401/403 and `E0015` are
  challenges, `E1142` ("cannot currently confirm the status") is inconclusive.
  Empty objects and gateway 404s are never not-found.
- Microsummary returns `mailPieces` as one object, not an array; `mailPieceId`
  must match. Summary-only replies are valid.
- Stage comes from `summary.statusCategory`, then wording. The category
  `Collected` means delivered, but a scan saying "Collected" means accepted.
  `Ready for Delivery` is not out for delivery.
- Offset-free times are kept as sent, not assumed UK: scans can be overseas.
- Delivered prose becomes "Delivered" (it names the signatory). Recipient,
  signature, photo, address and GPS fields are never read.

## Limitations

- No history: microsummary has none, and the page's "Get more details" call
  (`GET /mailpieces/v3/{number}/events`, fresh `x-rmg-recaptcha`) isn't captured.
- An interactive hCaptcha (drag-and-drop puzzle) can appear; TRAWL's
  checkbox/audio solver can't pass it.

## Why it fails

The CAPTCHA token is issued and the CORS preflight returns 200, then the
token-bearing GET is reset before any response: `ERR_HTTP2_PROTOCOL_ERROR` in
Chrome (NetLog: remote `RST_STREAM` right after the headers),
`NS_ERROR_NET_RESET` in Firefox. Some `ERR_FAILED` cases are local
cancellations of unknown cause. Fresh server profiles occasionally succeed, not
repeatably. Edge policy, browser signals, token validation and an upstream fault
can't be told apart from here.

Tried without a reliable fix:

- Plain HTTP, with or without the browser's headers and an unused token:
  timeouts or HTTP/2 `INTERNAL_ERROR` (curl, `curl_cffi`).
- Disabling HTTP/2 or HTTP/3: Firefox resets the same way; Chrome never sends
  the tracking GET. DNT/GPC signals: the consent reload still happens.
- Another egress IP, pinning the API peer, waiting before submitting, a newer
  TRAWL, persistent or incognito profiles, accepting cookies, locale and user
  agent overrides, native Chromium outside Docker.
- Other controllers: Camoufox (TRAWL's default), Patchright with Google Chrome
  injected through TRAWL's `BrowserPool.browserFactory`, stock Playwright (shows
  a visible hCaptcha), nodriver, SeleniumBase CDP (puzzle solved, GET still
  reset), raw CDP with `navigator.webdriver` false.
- Resubmitting the form after a failure: a new token, the same reset.

## What might work next

- Keep a successful page alive. On a Mac, Chrome kept on the same document
  ("Track another item", no reload) served repeated live lookups through
  `x-rmg-api-session`, also via the server's egress IP. Sessions last 120 s and
  requests don't extend them; after expiry the page renews with a fresh CAPTCHA
  on its own. TRAWL's cookie cache can't substitute, since only the live page
  renews the session. Untested on the server, where no fresh profile succeeded:
  first reproduce the working Mac environment (OS, Chrome build, graphics).
- Royal Mail's official Tracking API (needs account onboarding; not tried).

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/royal-mail` checks
the missing-browser-service error. With `FLARESOLVERR_URL` and
`ROYAL_MAIL_LIVE_TRACKING_NUMBER` (kept outside the repository) it runs a real
lookup and asserts no private fields come back.
