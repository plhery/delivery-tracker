# Tracking response compatibility

Stock TRAWL 1.3.1 ignores `captureResponses`. Version 1.5.0 adds it but refuses
compressed responses, including 17TRACK's, UPS's, FedEx's and Royal Mail's gzip JSON, and can stop on
polling code 100. This compatibility build retains the normal TRAWL API and
changes tier 2/3 tracking retrieval for six providers on their exact endpoints and public
page with one valid number: 17TRACK's `track/restapi`, UPS's `GetStatus`,
FedEx's `track/v2/shipments` and Royal Mail's per-number `microsummary`
(exact per-number capture and form submission), plus Postal Ninja's
`track/check` and `track/get`, and Australia Post's anonymous shipment query.
Every other capture request keeps stock behaviour.

The adapter observes the browser's response. For Royal Mail it preloads four
non-identifying "Decline all" preference cookies before navigation, avoiding the
consent banner and reload. If consent still appears, it declines and waits for
that reload before typing. It uses the page's own validation and hCaptcha
callback, retaining direct handler invocation because Camoufox's humanized mouse
click can stall on this page.

The hash route can start tracking automatically with consent already recorded.
Once the exact tracking GET starts, capture skips duplicate form submission and
TRAWL skips its CAPTCHA solver. Royal Mail may use an existing API session;
its first HTTP 401 with `E0015` is retained while the page automatically refreshes
the CAPTCHA token. Capture allows that one refresh within its existing deadline,
then settles on the next final reply or repeated rejection. Tracking connection failures end capture promptly
with an allowlisted network-error code; they must not become missing-checkbox
errors. A page without a tracking reply still fails its tier so ineffective
cached sessions are invalidated and normal provider recovery remains available.
Postal Ninja uses `https://postal.ninja/en/tools#trawl-number=<number>` as an
integration marker and requires both exact capture URLs. It fills the official
tracking iframe, unticks "save this parcel", and invokes the normal submit
handler. The page obtains its own Turnstile token and signs the check/get
requests. Matching `PROCESSING` replies establish a handle; capture waits
through `inProgress` until a completed matching reply, challenge or
`UNTRACEABLE` response. It does not turn an unrelated number/handle into a
completed lookup. Stock TRAWL does not submit this form from a URL alone.

After a completed compact reply establishes the requested number and a safe
handle, capture opens the normal `/en/track#/<handle>` page in the same context.
That page issues its own non-compact `track/get` request (`mode: "EXISTS"`).
Capture resets its settlement promise before navigation, so the compact reply
cannot end the wait for full history. Both phases share the original time and
response-size budgets. Empty and untraceable widget replies do not navigate.

17TRACK and UPS retain their navigation-only flow. FedEx uses the retained
browser session described below. Capture accepts at most 20 replies, limits
stored decoded bodies to 2 MB each / 4 MB total, checks declared size when
available, and waits at most the remaining scrape budget (30 seconds maximum).
`response.body()` reads data already decoded by the browser; run the browser
service with a container memory limit because Playwright has no streaming body
API. Pending, demo, incomplete and mismatched results still fail application
validation. Only Retry-After is retained from response headers.

Build and test from the repository root:

```sh
node --test ops/trawl/tracking-capture.test.mjs
node --test ops/trawl/fedex-session.test.mjs
node --test ops/trawl/australia-post-browser.test.mjs
docker build -t delivery-tracker-trawl:local ops/trawl
node ops/trawl/render-coolify.mjs > /tmp/trawl.Dockerfile
```

The final command renders the same source into a self-contained Dockerfile for
Coolify's Dockerfile application type. Store it in Coolify's application model
and deploy there; never patch only a running production container. Keep the
service on the private Docker network with its existing `flaresolverr` alias.
The upstream image is pinned by digest; the installer fails if its integration
point changes. Preserve the previous application configuration for rollback.
Re-render and redeploy after changing this directory.

Verified on the production host on 2026-09-10: a public shipment produced seven
17TRACK events. See the public example in `docs/CARRIERS.md`. UPS was added on
2026-09-12 after Akamai began holding `GetStatus` open until the timeout for
every plain HTTP session, including one seeded with the browser's cookies; the
browser's own reply is the only structured answer left. Empty-history code
400 responses on other lookups are provider failures, not proof of a wrong
carrier. Sentry distinguishes capture_missing, capture_unreadable,
lookup_pending, lookup_unavailable and verification_required, plus numeric
provider status and HTTP status. No response body is attached to these tags.
FedEx was added on 2026-09-20 with the same single-reply semantics
(`output` present ends the wait; the adapter binds `packages` to the
requested `trknbr` itself). Royal Mail's hash route can start a lookup when
consent is recorded; the compatibility build also supports submitting the form
after a consent reload. A fresh browser on the production host reached the
API through invisible hCaptcha auto-pass on 2026-09-20; the public reference
returned `E1142` (status unavailable). On 2026-09-21, instrumentation of a later
failure found an empty form after the consent reload, before hCaptcha execution.
Re-entering the reference in the same session returned an identity-matched
HTTP 200 delivered summary without a visible challenge. Fresh-browser verification
of the reload wait also returned that summary in about 10 seconds. See the
[Royal Mail verification notes](../../packages/carriers/carriers/royal-mail/README.md)
for the remaining challenge and history limitations. Re-render and redeploy the
service after changing this directory.

The later consent/failure update on 2026-09-21 avoided the banner and duplicate
lookup, and returned a diagnosed tracking connection reset in 6.6 seconds through
the deployed service, without invoking the CAPTCHA solver. The upstream failure
still occurred; this is a failure-path measurement, not a tracking success.

On 2026-09-22, two fresh Camoufox contexts on the production host passed Postal
Ninja's widget Turnstile automatically and captured a matching delivered
YunExpress response in 7.0 seconds each. Earlier Chromium failures did not test
this execution path. A follow-up captured all 32 scans from the normal results
page using the verified handle, in 7.1 seconds total. TRAWL now follows that
route; the application requires the full response instead of accepting just
the widget's first/latest scans. See the
[Postal Ninja verification notes](../../packages/carriers/providers/postal-ninja/README.md).

The Royal Mail session-refresh update was deployed on 2026-09-22. Controlled
tests through Camoufox Tier 2 and Tier 3 retained an initial `401 / E0015` and
captured the matching successful follow-up. The deployed code matched the
repository source and the service was healthy. A final live lookup still hit
the separate tracking connection reset in 8.2 seconds; the refresh fix does
not establish reliable upstream access.

## Australia Post anonymous tracking

For one identifier on the official `/mypost/track/details/{number}` page and
its exact `shipments-gateway/v1/watchlist/shipments?trackingIds={number}`
capture URL, preparation makes the same anonymous GET as the frontend.
The site's optional account-login iframe can be challenged while this API
works; waiting for account bootstrap would incorrectly discard usable tracking.
The frontend explicitly permits an anonymous request when login is unavailable.

Preparation reads the current public `shipmentsGateway` client configuration
from the page's single same-origin application module. It does not execute
downloaded code or return the client value. Module retrieval has a 4 MB streaming
limit and shares a 15-second preparation deadline with the tracking request.
Tracking responses retain the existing 2 MB per-response capture limit.
Unknown or ambiguous configuration fails closed; no live key is stored in code.

The GET carries `AP_CHANNEL_NAME: WEB_DETAIL` and the page's ordinary browser
session. No account credentials, login token, CAPTCHA solver, proxy or headful
pool are required by this path. The adapter binds the returned tracking ID and
article identity and checks the actual scan offsets. HTTP 200 app HTML alone
cannot count as a successful lookup.

On 2026-09-26, the new helper returned 12 matching dated events in two fresh
headless contexts on the server network (6.6 and 6.7 seconds). A fresh synthetic
negative completed in 5.9 seconds with a matching error envelope. These are
individual checks, not an availability guarantee. Plain HTTP was still challenged.

The shared pool's English locale also received HTTP 403 even though its browser
engine and network could retrieve the data. Controlled checks isolated the
locale override: `de-DE` on a fresh context returned the same history, whereas
`en-US` and `en-AU` were rejected. The Australia-specific runner therefore opens
a temporary context on the leased browser with `AUSTRALIA_POST_BROWSER_LOCALE`
(default `de-DE`, verified on the deployment network). Other deployments should
verify their own locale/network combination. This does not change the shared
pool, require another browser process, or set a timezone for carrier events.

Both cached and fresh service tiers use that context with the normal outbound
URL policy. It returns only matching captures and closes on success, error or
deadline; failed cleanup asks the pool to replace the browser. No Australia Post
cookies or browser page are retained between lookups.

The deployed build passed both live Australia Post adapter tests on 2026-09-26:
matching dated history in 4.8 seconds and a synthetic unknown reference in
5.0 seconds. These checks exercise the adapter through the service's normal API.

## Retained FedEx browser session

For one valid FedEx number and its exact capture endpoint, `fedex-session.mjs`
opens the blank official tracker and submits its normal form. After an
identity-matched tracking reply with status or scans, it keeps that page and
context on the original pooled browser. Each lookup reopens the blank form
within that context, because the result-page form can ignore submissions or
retain the previous route. It submits a new request and checks both its
posted number and returned package identity. Tracking replies are not cached.

The pool prefers an available browser with a verified FedEx session. Without
one, it chooses the available browser least recently tried for FedEx, so a
rejected browser does not become permanent affinity. This adds no retries to a
lookup and does not change other providers' browser selection. Cached Redis
cookies are not injected into the retained context.

At most one FedEx context is retained per pooled browser. It closes after
30 minutes idle, two hours total, or a rejected, malformed, missing or unrelated
reply. Browser shutdown/recycling also discards it. Lookup budgets still apply;
overlapping use of one session is refused, and a hanging cleanup asks the pool
to replace the browser. Page request interception retains the normal outbound
URL policy. New contexts count toward the pool's existing recycling limit.

The state stays in private browser memory; no profile, cookies, local storage
or tracking response is written to repository files or Redis by this path.
Keeping cookies alone did not reproduce a working context in the live checks.
Browser or service restarts therefore require a fresh session. Cold startup can
still receive HTTP 403; the carrier adapter preserves that challenge and the
application's universal-provider fallback remains available.

Verified on 2026-09-23: the deployed service returned the reference's 14 scans
on a new session and its warm refresh (15.0 s and 12.2 s). A later control-number
lookup received 403 and discarded the session. See the
[FedEx verification log](../../packages/carriers/carriers/fedex/README.md#verification-log)
for the limits of this small live sample.

## Redis session cache

TRAWL 1.5.0 disables session caching unless `REDIS_URL` is set. `skipHttp: true`
skips Tier 1 only; Tier 2 still runs when a cached session exists. `maxTier: 3`
allows a fresh solve when the session expires or is rejected.

Configure these **runtime-only variables on the TRAWL application**, not on
Delivery Tracker, and redeploy through Coolify:

```dotenv
REDIS_URL=redis://default:<password>@<redis-container-uuid>:6379/0
REDIS_SESSION_TTL_SECONDS=3600
REDIS_CONNECT_TIMEOUT_MS=1000
REDIS_RETRY_DELAY_MS=5000
```

Use a dedicated, password-protected Coolify Redis database on the same private
Docker network as TRAWL, with no published host port. A compatible configuration
uses Redis 7.4.10, pinned to
`redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`,
with a 128 MiB container memory/swap limit and this custom configuration:

```conf
maxmemory 64mb
maxmemory-policy allkeys-lru
save ""
appendonly no
```

Coolify supplies the generated password through its database model; do not put
it in this repository. Keep these settings in Coolify's database/application
models so redeployments preserve them. Sessions are disposable, so Redis disk
persistence is disabled. A cache restart causes a fresh Tier 3 solve. TRAWL
also tolerates unavailable Redis and retries its connection in the background.

This stores cookies and the recorded User-Agent per domain, **not tracking
responses**. Browser HTTP caching is separate. Successful sessions refresh the
Redis entry's one-hour TTL, and failed Tier 2 sessions are invalidated before
Tier 3 recovery. That TTL does not extend an upstream token's expiry.

Except for the retained FedEx route above, Tier 2 injects those cookies into a pooled context and opens a new page; Tier 3
closes its temporary context after retrieval. The pool prefers an available
browser last used for that domain, but Redis does not retain the successful
page, its JavaScript state or an entire browser fingerprint. This distinction
matters for the [Royal Mail session checks](../../packages/carriers/carriers/royal-mail/README.md#retaining-the-successful-page).

Check from a machine with private access, or pipe the script into the running
TRAWL container with `docker exec -i <container> bun run -`:

```sh
FLARESOLVERR_URL=http://trawl:8191 node ops/trawl/check-session-cache.mjs
```

The check makes three public Mondial Relay landing-page requests and requires
the last two to use Tier 2. It prints only timing/status fields: upstream
`timings` entries contain complete responses and cookies, so never log them
directly. The first request can already be warm; do not flush live sessions
just to manufacture a cold measurement.

Production verification, 2026-09-11: Redis was initially unset and requests
always used Tier 3. After enabling it, a cold landing-page request took 5.76 s
(Tier 3), followed by 4.54 s and 4.39 s at Tier 2. A subsequent complete lookup
used Tier 2 for both bootstrap (2.60 s) and tracking API (1.02 s), with the
shipment identity verified and four events returned. These are individual
live samples, not a guaranteed per-request latency reduction.

To disable caching, remove the four Redis variables from the TRAWL application
and redeploy it through Coolify. Leave Redis running until TRAWL is healthy;
no application code or parcel data rollback is needed.
