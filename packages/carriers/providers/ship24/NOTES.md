# Ship24 notes

## Decisions

- **One signed POST first, browser second (2026-09-10).** The official frontend
  builds `x-ship24-token` from a timestamp, an opaque SHA-256 digest, a
  MurmurHash3 checksum bound to the tracking number and an HMAC over the three.
  Its HMAC input constant and checksum salt are public frontend configuration,
  not account credentials. The adapter reproduces that small algorithm itself
  and cites the script it was read from; it never executes downloaded scripts
  and never stores captured tokens.
- **No bootstrap request (2026-09-10).** Fetching the public configuration at
  runtime worked on the host but failed inside Docker: explicit probes returned
  403 over IPv4 and 200 over IPv6 for the page, and both the page and the asset
  CDN were blocked by CloudFront inside the container. Referencing the reviewed
  public constants directly removed those calls, and the adapter then succeeded
  from Docker over its normal connection with one POST per lookup.
- **Eight seconds for the direct tier.** If the public signing scheme changes,
  the fast path fails quickly and the browser can still use the rest of the
  lookup budget.
- **429 and 5xx are never retried in a browser.** A rate limit or an outage is
  reported with its `Retry-After` so the router's backoff applies once.
- **Offset-less legs are kept (2026-09-11).** `datetime` can end in `Z` while
  holding the carrier's local time; `timestamp` carries the real offset, except
  for some legs (Chronopost, observed 2026-09-11) that omit it entirely. Those
  scans are kept as `local_time` rather than losing the shipment or inventing a
  UTC instant.
- **The HTTP client is injected (2026-09-12).** The chain and the adapter
  factory build it from the environment's fetcher. A tracker constructed without
  one exercises the browser tier alone, which is what the browser tests want.

## Rejected alternatives

- **Browser-only lookups** (the path before 2026-09-10): approximately 2–3 s per
  lookup against 121–409 ms for the signed POST.
- **A merchant API key.** Ship24 sells an API; this adapter deliberately stays
  on the public anonymous path the website itself uses.
- **Running the site's own script to obtain the token.** Reproducing the small
  published algorithm keeps the adapter auditable and avoids executing remote
  code.
- **Adding a proxy, IP rotation or a container network change.** None were
  needed and none were added.

## Verification log

- 2026-09-10: method, signing and transport verified separately — GET 404,
  unsigned POST 403, signed POST 201 with the matching shipment. Two public
  examples: raw histories of 33 and 7 entries, normalized to 32 and 6.
- 2026-09-10: source of the checksum configuration recorded in `http.ts`
  (`https://cdn.ship24.com/assets/main.16f5bc7c0914804e.js`).
- 2026-09-11: mixed-carrier shipment confirmed the offset-less `timestamp` legs.
- 2026-09-12: `measureScrape`/`recoverScrape` replaced by `runSteps`; the step
  ids `direct` and `browser` and the `Ship24` label are unchanged, so the
  existing Sentry scraper dashboard keeps working.
