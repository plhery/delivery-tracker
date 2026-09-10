# Tracking response compatibility

Stock TRAWL 1.3.1 ignores `captureResponses`. Version 1.5.0 adds it but refuses
compressed responses, including 17TRACK's gzip JSON, and can stop on polling
code 100. This small compatibility build retains the normal TRAWL API and
changes only tier 2/3 capture for the exact 17TRACK endpoint and one valid number.
ParcelsApp remains first in the application's discovery order.

The adapter observes the existing browser response; it neither copies cookies
nor makes additional tracking requests. It accepts at most 20 replies, limits
stored decoded bodies to 2 MB each / 4 MB total, checks declared size when
available, and waits at most the remaining scrape budget (30 seconds maximum).
`response.body()` reads data already decoded by the browser; run the browser
service with a container memory limit because Playwright has no streaming body
API. Pending, demo, incomplete and mismatched results still fail application
validation. Only Retry-After is retained from response headers.

Build and test from the repository root:

```sh
node --test ops/trawl/tracking-capture.test.mjs
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
17TRACK events. See the public example in `docs/CARRIERS.md`. Empty-history code
400 responses on other lookups are provider failures, not proof of a wrong
carrier. Sentry distinguishes capture_missing, capture_unreadable,
lookup_pending, lookup_unavailable and verification_required, plus numeric
provider status and HTTP status. No response body is attached to these tags.

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
Docker network, with no published host port. The production database is
`trawl-session-cache` (`ilo4e3n318kbhnb93n5vhv8r`), attached to `coolify` beside
TRAWL (`dqbhf3qfeer5b5nii1dimqna`). It runs Redis 7.4.10, pinned to
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

This caches cookies and browser identity per domain, **not tracking responses**:
every lookup still contacts the carrier. Successful sessions refresh the
one-hour TTL, and failed Tier 2 sessions are invalidated before Tier 3 recovery.
It benefits other TRAWL callers that reach the browser tiers too.

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
