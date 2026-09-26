# Ship24

First universal provider: fast, broad coverage, and useful carrier-name hints. Its
histories are sometimes sparser than other feeds for the same parcel, which is why a
richer provider that succeeds keeps affinity (see [COVERAGE.md](../COVERAGE.md)).
Persisted provider name: `Ship24`. Link shown to users:
`https://www.ship24.com/tracking?p={number}`.

## How it works

Both steps share one budget: 45 s standalone, 30 s inside the chain.

1. `direct`: one signed anonymous `POST https://www.ship24.com/api/parcels/{number}?lang=en`
   ([http.ts](http.ts)), capped at 8 s. Result labelled
   `tracking_source: structured-web-response`.
2. `browser`: the public tracking page in a fresh local Chromium
   (`TRACKING_CHROMIUM_PATH`), reading the same API response from the page. Result
   labelled `browser-session-response`.

The browser step runs only when a browser could fix the direct failure:

- HTTP 429 and 5xx are reported with their `Retry-After`, so the router backs off once
  instead of asking twice.
- HTTP 404 and 410 are final: the page calls the same API and only waits out the budget.
- The 8 s cap keeps most of the budget for the browser if the signing scheme changes.

Built without an HTTP client (as in browser tests), the adapter runs the browser step
alone. Only one local browser session runs per server process; an overlapping lookup
fails fast and retries on the next sync.

## Request signing

The website builds an `x-ship24-token` header from a timestamp, an opaque SHA-256
digest, a MurmurHash3 checksum bound to the tracking number, and an HMAC over the three.
[http.ts](http.ts) reproduces that algorithm. Its HMAC key and checksum salt are public
frontend configuration, copied from the site script cited in the file, not account
credentials. No account, cookie, fingerprint or issued token is used.

- A GET on the parcel API returns 404 and an unsigned POST returns 403. A signed POST
  returns 201 with the shipment.
- The constants are hard-coded, not fetched at startup. Fetching the page or its asset
  CDN at runtime was blocked by CloudFront from inside the production container.

## Parsing

- A reply counts only when `data.tracking_number` matches the requested number.
- Times come from `timestamp`, which carries the real offset. `datetime` can end in `Z`
  while holding the carrier's local time. Some legs (Chronopost, for example) have no
  offset in `timestamp`. Those scans are kept as `local_time` instead of dropping the
  shipment or inventing a UTC instant.
- `dispatch_code_id: 7` is treated as delivered.
- `couriers[].translation.name` becomes `reported_carriers`, and becomes
  `discovered_carrier` only when exactly one name maps to a catalog id.
- The aggregator's delivery estimate, courier phone/website and alternate numbers are
  not kept.

## Rejected approaches

- Browser-only lookups: roughly ten times slower than the signed POST.
- Ship24's paid API: needs a merchant key. This adapter uses the website's anonymous path.
- Running the site's script to get the token: executes remote code. The algorithm is
  small enough to reproduce and review.
- Proxies, IP rotation or container network changes: not needed.

## Testing

`npm run test:carriers:live -- src/server/universalScrapers.live.test.ts` with
`TRACKING_CHROMIUM_PATH` set runs the browser step against a public reference. Unit
tests use [fixtures](fixtures/README.md) and never contact Ship24.
