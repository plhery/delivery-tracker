# SF Express

The direct adapter uses the official [Taiwan tracking page](https://htm.sf-express.com/tw/en/dynamic_function/waybill/)
through the repository's TRAWL service. It accepts 12-digit references and `SF`
followed by 13 digits. The verified international reference returned 22 scans
from collection through recipient delivery on 2026-09-26.

## Retrieval

The public page opens a GeeTest v4 slider in bind mode, without the initial
verification button expected by TRAWL's generic solver. The scoped
[SF browser helper](../../../../ops/trawl/sf-express-session.mjs) waits for
stable widget geometry and uses the piece's transparent outline to locate the
gap. Interior color alignment provides an additional check when needed. Weak
or ambiguous matches are rejected before dragging. A hidden widget is not
proof of success: the browser must issue and receive the exact requested
shipment route response.

```text
GET https://htm.sf-express.com/sf-service-core-web/service/bills/{number}/routes?lang=en&region=tw&translate=&app=bill
```

The page supplies its own short-lived verification headers. No login, phone
suffix, CAPTCHA asset, validation token or signed-in session is stored by the
adapter. Each lookup uses a fresh isolated context on a leased browser, with
bounded cleanup. The normal 45-second adapter budget includes the TRAWL
client's 15-second transport allowance; caller cancellation and smaller
budgets propagate to the actual service request.

Two fresh automated sessions retrieved the matching 22-event history. The
production helper prototype, using the pool's normal humanized pointer mode,
completed in 14.6 seconds within its 30-second service budget. A separate
synthetic unknown reference also completed the challenge and reached the route
endpoint in 14.6 seconds, but received code `60000`, `运单路由查询被管控`
(query restricted). That is a challenge/restriction outcome, not confirmed
not-found. Empty successful envelopes likewise remain inconclusive.

After deployment, the adapter passed both live checks through the service's
normal API: exactly 22 scans in 14.6 seconds and the synthetic-query restriction
in 13.6 seconds. These checks establish the observed route, not an availability
guarantee for every challenge or shipment.

The separate [SF International portal](https://www.sf-international.com/us/en/support/querySupport/waybill)
uses Tencent verification, while the current Mainland China portal uses a
GeeTest and phone-verification flow. Neither is silently substituted for the
verified Taiwan route. One successful international reference does not prove
every domestic, restricted or expired shipment is available anonymously.

## Parsing and time

[parser.ts](parser.ts) requires exactly one result whose independent `id`
matches the requested reference. It retains only actual `routes` rows, rejects
invalid dates and malformed history, removes proof-access links and exact
repeats, and caps retained history at 100 of at most 500 input scans. Sibling
references and shipment-wide personal detail objects are not merged into the
selected history.

Operation codes classify each historical scan independently. The official
frontend's warehouse `delivered` group (`202`, 已出库) means warehouse dispatch,
not recipient delivery. Ambiguous code `8000` requires its `stayWhyCode`;
unknown combinations stay unclassified. Summary state `99` is broad transit
and yields to a more precise latest scan. [statuses.json](statuses.json)
distinguishes live observations from the current frontend's vocabulary.

`scanDateTime` has no offset or epoch. The Taiwan frontend simply formats it;
the different SF International API's timezone fields do not establish this
endpoint's semantics. The parser therefore returns `local_time` and
`last_update_local`, without inventing UTC, `delivered_at` or an ETA. It follows
the portal's wall-clock display order. The host archives this direct history
and still tries universal providers for usable instants and richer detail.

Delivered wording is normalized to `Delivered`; embedded contact controls and
proof links are removed. Internal facility IDs, personal detail blocks,
weights and unverified estimate fields are not projected.

## Validation

Synthetic fixtures and unit tests cover identity, status boundaries, dates,
negative/error distinctions, bounded payloads, capture matching, cancellation
and request budgets. Host tests check that unresolved local clocks survive
routing and persistence without replacing richer saved progress.

Supply `SF_EXPRESS_TRACKING_NUMBER` and `FLARESOLVERR_URL` outside the repository
to run the positive live adapter test. Optional `SF_EXPRESS_EXPECTED_EVENTS`
checks a known event count; `SF_EXPRESS_CHECK_RESTRICTION=1` enables the explicit
synthetic-query control. See [fixture provenance](fixtures/README.md).
