# Australia Post

The adapter reads the anonymous tracking response used by the official
[tracking application](https://auspost.com.au/mypost/track/). It requires the
repository's TRAWL browser service and its Australia Post capture preparation.
An account, user login and postcode are not required by the verified flow.

## Retrieval

[adapter.ts](adapter.ts) requests the official `/mypost/track/details/{number}`
page and captures only the exact requested query:

```text
GET https://digitalapi.auspost.com.au/shipments-gateway/v1/watchlist/shipments?trackingIds={number}
```

The browser preparation extracts the current public API key from the current
same-origin application module. It makes the anonymous GET within that browser
session with `AP_CHANNEL_NAME: WEB_DETAIL`, JSON content type and browser
credentials. The key is not pinned in the adapter, and browser state is not
replayed through a plain HTTP client. The login iframe's HTTP 403 does not
invalidate a successful anonymous tracking response.

Fresh isolated headless browser contexts on the server network returned the
same matching twelve-event shipment twice and the explicit negative control on
2026-09-26. After deploying the context runner, both live adapter tests passed
against the deployed TRAWL service: matched dated history and a synthetic
unknown reference, each in about five seconds. Plain HTTP was rejected. No
shared logged-in browser or headful browser pool is required by this observed flow.

The shared browser pool's English locale was separately rejected. TRAWL's
Australia-specific runner uses a fresh context with a verified network locale
(`AUSTRALIA_POST_BROWSER_LOCALE`, default `de-DE`) on that same pooled browser.
This setting does not select the language of shipment statuses or infer event
timezones. Contexts close after each lookup, and other carriers keep their
existing browser configuration. Different deployment networks need their own
compatibility check.

The total default budget is 45 seconds, including the TRAWL client's 15-second
transport allowance. Smaller caller budgets and cancellation propagate through
the service request and bounded recovery; a budget of 15 seconds or less fails
before dispatch. Captured tracking JSON is capped at 1 MB. A missing capture,
challenge, throttle or changed schema remains an error for normal provider
fallback. The adapter does not turn arbitrary HTTP errors into not found.

## Identity and negative results

The response is an array of lookup entries. Exactly one entry must include the
requested reference in `trackingIds`. A successful entry must identify the
requested article independently through `shipment.articles[].articleId`, and
its single detail object must repeat that article and its consignment identity.

A consignment reference is accepted only when it names a single article.
Multi-article consignments are deliberately rejected as ambiguous rather than
declaring an unfinished consignment delivered because one sibling arrived.
An exact article reference can select its own history from a multi-article
consignment; sibling and shipment-wide summary states do not classify it.

The observed unknown reference returned HTTP 200 with a matched entry carrying
`status: 400` and `errorCode: 21`, `Invalid Tracking ID`, `Failed`. Only that
specific domain signature is not found. Empty arrays, unrelated identities and
other error objects remain distinct schema failures.

## Status, time and privacy

Every historical scan uses its own event code or milestone label. The current
status comes from the selected article, and unknown values remain unclassified.
Pickup availability, attempted delivery and returns do not mean delivery.
Status provenance lives in [statuses.json](statuses.json).

Event `localeDateTime` carries an explicit offset; its epoch-millisecond
`dateTime` agreed with that instant in the observed history. The parser preserves
the offset or uses the verified epoch field when no offset is present, and
rejects conflicting dates. It sorts by absolute instant, removes exact duplicate
scans and retains at most 100 of up to 500 input events.

`statusModificationDateTime` and summary milestone timestamps are not scan times:
they differed from the delivered scan by about ten hours in the observed reply.
The parser ignores those values and derives `last_update` and `delivered_at`
from actual events. No ETA is inferred from null or unverified estimate fields.

Only status, dated events, coarse scan locations, provider event codes and the
delivery instant are retained. Recipient and sender blocks, street addresses,
barcodes, access instructions, proof links, collection credentials and facility
identifiers are discarded. Delivered wording is reduced to `Delivered` so a
signature or safe-place description cannot retain a person's name.

## Validation

Synthetic fixtures preserve the current response structure; see
[fixtures/README.md](fixtures/README.md). Unit tests cover identity isolation,
multiple articles, negative signatures, status boundaries, dates, privacy,
capture selection, serialization, cancellation, budgets and payload limits.
Supply `AUSTRALIA_POST_TRACKING_NUMBER` and `FLARESOLVERR_URL` outside the
repository to run the positive live adapter test. No live reference or response
is committed.
