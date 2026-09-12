# ParcelsApp notes

## Decisions

- **Keep the browser capture (2026-09-10).** The current bundle constructs
  protected request fields (including `se`) for its own API call. Both inspected
  anonymous crawlers drive Chromium and capture `/api/v2/parcels`; the PHP
  client found in the same review requires an API key. A raw HTML GET loads the
  application rather than established shipment history, so no browser-free
  replacement was verified.
- **Bind the result to the rendered number.** The API reply omits the tracking
  number. Identity is taken from the page's own result table (exactly one
  `Tracking number` row, equal to the requested number), never from the input
  field or from the URL that was requested.
- **Rendered history is a real fallback.** When the capture yields no readable
  body, the page's event list carries the same history and is parsed instead;
  the surrounding marketing copy is excluded by the `.tracking-info .parcel
  .events > .event` selector.
- **Notices are not events (2026-09-11).** Rows asking for a postal code or a
  destination country, and rows rendered with a date but no time, are skipped
  instead of failing the whole history or manufacturing a timestamp.
- **Rendered times are UTC (2026-09-08).** Verified against the live JSON: the
  English web app prints the UTC values of its API. The machine's local timezone
  is never used.

## Rejected alternatives

- **A plain HTTP GET of the tracking page.** Returns the application shell.
- **The API-key client** (`locky42/parcels-app-provider`, revision `708726c`):
  requires a provisioned key; this adapter stays on the anonymous public path.
- **Trusting the requested URL as identity.** A page can render another
  shipment or an empty result for the same URL, so only the rendered result
  table is accepted.

## Verification log

- 2026-09-08: rendered timestamps compared against the captured JSON; both are
  UTC.
- 2026-09-10: transport review — no browser-free replacement verified; TRAWL
  capture retained.
- 2026-09-11: notice row with an empty time observed live for a not-yet-scanned
  Colissimo label.
- 2026-09-12: moved into `packages/carriers/providers/parcelsapp`; the capture
  now goes through the shared `TrawlClient` and reports a `trawl` step. The
  browser service's transport allowance is the client's standard 15 s instead of
  the previous hand-written 5 s.
