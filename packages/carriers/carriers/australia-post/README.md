# Australia Post

Australia Post articles and consignments (10–34 alphanumeric characters), tracked through the
anonymous shipments API behind the official [tracking app](https://auspost.com.au/mypost/track/),
driven by the TRAWL browser service. Plain HTTP is challenged.

## How it works

1. `trawl`: TRAWL opens `/mypost/track/details/{number}` (tiers 2–3, no plain HTTP) and captures
   exactly `GET https://digitalapi.auspost.com.au/shipments-gateway/v1/watchlist/shipments?trackingIds={number}`.
   - The Australia Post helper ([`australia-post-browser.mjs`](../../../../ops/trawl/australia-post-browser.mjs),
     see [`ops/trawl/README.md`](../../../../ops/trawl/README.md)) reads the current public API key
     from the page's app module and makes that GET inside the browser session with
     `AP_CHANNEL_NAME: WEB_DETAIL`. The key is never pinned here, and browser state is never replayed
     over plain HTTP.
   - Each lookup gets a fresh browser context that is closed afterwards.

Budget: 45 s by default (max 60 s), including a 15 s TRAWL transport allowance; 15 s or less fails
before dispatch. The capture is capped at 1 MB. On the capture, 401/403 is a challenge and 429 is rate
limited; a missing capture or changed schema is an error for normal provider fallback.

## Notes

- The context uses `AUSTRALIA_POST_BROWSER_LOCALE` (default `de-DE`) because the pool's `en-US` and
  `en-AU` locales got HTTP 403 from the deployment network. Another network may need its own value.
  It does not affect status language or event time zones.
- The login iframe can return 403 while tracking still works; waiting for account bootstrap would
  discard usable data.
- Identity: exactly one entry must list the number in `trackingIds`, the article must match through
  `shipment.articles[].articleId`, and its single detail object must repeat the article and
  consignment IDs.
- A consignment number is accepted only when it has one article. Multi-article consignments are
  rejected as ambiguous, since one delivered sibling doesn't mean the consignment is delivered. An
  exact article number selects its own history; sibling and shipment-wide states never classify it.
- Not-found is only the HTTP 200 entry with `status: 400`, `errorCode: 21`, `Invalid Tracking ID`,
  `Failed`. Empty arrays, other identities and other errors are schema failures.
- Each scan is classified by its own `eventCode`, then its milestone label. Awaiting collection,
  attempted delivery and returns are not delivery.
- Event time comes from `localeDateTime` (explicit offset), else the epoch-ms `dateTime`. If both
  exist and disagree, the parse fails. Events are sorted by instant.
- `statusModificationDateTime` and summary milestone timestamps are not scan times (they can be hours
  off the delivery scan). `last_update` and `delivered_at` come from events.
- Delivered wording is replaced with `Delivered` so signature or safe-place text can't leak a name.

## Limitations

- No ETA.
- Recipient and sender blocks, addresses, barcodes, access instructions, proof links, collection
  credentials and facility IDs are never kept. At most 100 of 500 events are kept.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/australia-post` with `FLARESOLVERR_URL`. Add
`AUSTRALIA_POST_TRACKING_NUMBER` for the positive case; the synthetic not-found runs without it.
