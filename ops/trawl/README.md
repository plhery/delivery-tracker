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
