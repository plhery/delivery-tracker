# TRAWL browser service

A patched build of TRAWL 1.5.0 (`ghcr.io/germondai/trawl`), a FlareSolverr-compatible browser
service. The app calls it through `FLARESOLVERR_URL` ([client](../../packages/carriers/core/transport/trawl.ts))
when a carrier needs a real browser: to pass a challenge, or to read the JSON a carrier page fetches
for itself (`captureResponses`). Tier 1 is a plain HTTP client, tier 2 a pooled browser with a
cached session, tier 3 a fresh browser that solves challenges. The pool runs Camoufox.

## Why a custom build

Stock 1.5.0 accepts `captureResponses` but:

- drops compressed bodies, and 17TRACK, UPS, FedEx and Royal Mail all answer with gzip JSON;
- settles on the first reply, so a polling API (17TRACK code `100`) comes back "pending";
- only navigates: it cannot fill a tracking form or run a carrier-specific flow.

The TRAWL API is unchanged. A request behaves differently only when its URL is a known carrier page
with one valid number **and** it captures that carrier's exact tracking endpoint. Everything else
runs stock TRAWL.

## How it works

- [`install.mjs`](install.mjs) patches TRAWL's tier 2 and tier 3 sources and its browser pool at
  build time. It fails the build if a source line it hooks into has changed, so an upstream bump
  cannot silently drop the integration.
- [`tracking-capture.mjs`](tracking-capture.mjs) reads `response.body()`, which the browser has
  already decompressed, and waits until a final reply names the requested number. Once the tracking
  request has started, TRAWL's CAPTCHA solver is skipped.
- Carrier runners take over matching plain GETs (no screenshot, body, extra headers or, at tier 3,
  proxy) before the tier's generic flow.
- Capture limits: JSON only, 20 replies, 2 MB per body and 4 MB total, `settleTimeout` default
  15 s (max 30 s). Generic capture keeps only `Retry-After`; the dedicated FedEx runner also
  keeps bounded `Content-Type` and `Server` values to classify edge denials. The adapter, not
  TRAWL, rejects pending, empty or mismatched replies.

## Carriers

| Carrier | What the build does |
| --- | --- |
| [17TRACK](../../packages/carriers/providers/seventeentrack/README.md) | Keeps reading `track/restapi` polls until the number's reply is no longer code `100`. |
| [UPS](../../packages/carriers/carriers/ups/README.md) | Reads the single `GetStatus` reply in the page; Akamai stalls that call from any plain HTTP session, even with browser cookies. |
| [FedEx](../../packages/carriers/carriers/fedex/README.md) | Captures `track/v2/shipments` from a retained browser session, see below. |
| [Royal Mail](../../packages/carriers/carriers/royal-mail/README.md) | Preloads TrustArc opt-out cookies, submits through the page's own handler (invisible hCaptcha), lets the page refresh its token once after `401 E0015`. |
| [Postal Ninja](../../packages/carriers/providers/postal-ninja/README.md) | On `/en/tools#trawl-number=<n>` (our marker, not a real deep link), submits the widget so the page runs Turnstile and signs its requests, then opens `/en/track#/<handle>` for full history. |
| [Australia Post](../../packages/carriers/carriers/australia-post/README.md) | [`australia-post-browser.mjs`](australia-post-browser.mjs) makes the page's anonymous `shipments-gateway` GET in a fresh context with its own locale. |
| [SF Express](../../packages/carriers/carriers/sf-express/README.md) | [`sf-express-session.mjs`](sf-express-session.mjs) solves the GeeTest v4 slider locally ([`sf-express-gap.mjs`](sf-express-gap.mjs), PNGs decoded by `ffmpeg`); only the page's own `routes` reply counts, not a closed popup. |

Shared behaviour:

- Australia Post and SF Express run in a fresh context on the leased browser with the normal outbound
  URL policy, closed on success, error or deadline; nothing is kept. A hung cleanup replaces the browser.
- Royal Mail and Australia Post end capture at once on a failed tracking request (allowlisted network
  error code). A page with no tracking reply fails the tier, so the cached session is dropped and tier 3 runs.
- Camoufox's humanized clicks can stall, so the Royal Mail and FedEx flows call the page's own click
  handlers, which still run its validation and CAPTCHA callbacks.

## Retained FedEx browser session

In the recorded comparison, copied cookies did not reproduce the acceptance retained by the original
browser context. That does not prove the context is intrinsically or cryptographically bound.
[`fedex-session.mjs`](fedex-session.mjs) keeps one verified context per pooled browser:

- Each lookup reopens the blank form (the results-page form can ignore a submit or keep the previous
  route), submits, and checks the posted number and returned package. Replies are never cached.
- The pool prefers a browser with a verified FedEx session, else the one least recently tried for
  FedEx, so a rejected browser does not become sticky.
- The context closes after 30 min idle, 2 h total, a rejected, malformed, missing or unrelated reply,
  or browser recycling. Overlapping use is refused.
- State lives only in browser memory. A restart needs a fresh session; cold sessions often get 403.

## Configuration

Set on the TRAWL service, not on the app (the app only needs `FLARESOLVERR_URL`):

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | `redis://default:<password>@<redis-host>:6379/0`. Enables the tier 2 session cache; unset, every browser request solves at tier 3. |
| `REDIS_SESSION_TTL_SECONDS`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_RETRY_DELAY_MS` | `3600`, `1000`, `5000` |
| `AUSTRALIA_POST_BROWSER_LOCALE` | Default `de-DE`. The carrier returned 403 to `en-US` and `en-AU` from the deployment network; check again on another network. |
| `FFMPEG_PATH` | Optional `ffmpeg` for SF Express; defaults to the image's. |

Session cache:

- Redis stores cookies and the User-Agent per domain, never tracking responses. Tier 2 injects them
  into a new page (preferring the browser last used for that domain); the page, its JavaScript state
  and full fingerprint are not kept. A success refreshes the TTL, which does not extend an upstream
  token; a failed tier 2 session is invalidated before tier 3.
- `skipHttp: true` skips tier 1 only. `maxTier: 3` allows a fresh solve when the cached session fails.
- Use a dedicated, password-protected Redis on the same private network, no published port,
  128 MiB container limit. The deployed image is pinned to
  `redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`. Sessions are disposable, so persistence is off:

  ```conf
  maxmemory 64mb
  maxmemory-policy allkeys-lru
  save ""
  appendonly no
  ```

- TRAWL tolerates Redis being down. To disable caching, remove the Redis variables and redeploy.

## Build and deploy

```sh
docker build -t delivery-tracker-trawl:local ops/trawl
node ops/trawl/render-coolify.mjs > /tmp/trawl.Dockerfile
```

- Production is a Coolify Dockerfile application. `render-coolify.mjs` keeps the digest-pinned base
  from the [`Dockerfile`](Dockerfile) and inlines every helper into one self-contained Dockerfile;
  store it in the Coolify app and deploy. Re-render after any change here.
- Never patch only the running container; the next deploy loses it. Keep the previous configuration
  for rollback and the env vars in Coolify so redeploys preserve them.
- Keep the service on the private Docker network under the alias `FLARESOLVERR_URL` points to.
- Set a container memory limit: Playwright cannot stream bodies, so each capture is held in memory.

## Testing

```sh
node --test ops/trawl/*.test.mjs   # also in npm run test:scripts
FLARESOLVERR_URL=http://<trawl-host>:8191 node ops/trawl/check-session-cache.mjs
npm run test:carriers:live -- packages/carriers/carriers/<id>   # with FLARESOLVERR_URL set
```

`check-session-cache.mjs` makes three Mondial Relay landing-page requests and requires the last two
to reuse a tier 2 session. Run it with private network access or pipe it into the container
(`docker exec -i <container> bun run -`). It prints only tier, status and timing: TRAWL's `timings`
entries hold full responses and cookies, so never log them.
