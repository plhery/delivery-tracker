# Australia Post

Automatic tracking currently uses the universal providers. No active dedicated
adapter is registered: successful manual tracking has not yet translated into
repeatable retrieval in the app's browser service.

The official [MyPost tracking application](https://auspost.com.au/mypost/track/)
allows anonymous queries. Its current bundle issues a GET to
`https://digitalapi.auspost.com.au/shipments-gateway/v1/watchlist/shipments/{number}`
for a detail link. The response contains `articles`, each with an `articleId`,
`trackStatusOfArticle`, and `details[].events`. Bind an exact article and its
detail identity; a consignment can contain several articles with different
statuses. The search endpoint also carries full history, so a second detail
request is unnecessary when that response already identifies the article.

On 2026-09-26, the ordinary local browser flow returned 12 dated events for the
same public reference in [coverage](../../providers/COVERAGE.md), including
lodgement, transit, out-for-delivery and final delivery. Scans carry an explicit
`localeDateTime` offset; no single Australian timezone needs to be guessed.
The history also contains administrative updates and a delivery preference.

Plain HTTP received a DataDome challenge. In the app's server browser, the
silent login bootstrap received a verification challenge before any shipment
request began, leaving only the application shell. A successful main-document
HTTP 200 therefore does not establish tracking success. Longer capture waits
cannot repair that bootstrap failure. No active adapter is advertised on the
strength of the local manual result, and no raw live response or client key is
committed.

The separately documented [Shipping and Tracking API](https://developers.auspost.com.au/apis/shipping-and-tracking/reference/get-shipments)
requires issued account credentials; those are not available through the
anonymous website integration. Future work must establish a repeatable browser
session and capture the exact matching shipment reply, with synthetic tests for
multi-article identity, source offsets and challenge responses.
