# Japan Post

The direct adapter uses one anonymous GET to Japan Post's
[English tracking portal](https://trackings.post.japanpost.jp/services/srv/search?locale=en).
The request contains `reqCodeNo1` and `locale=en`; no browser, account, cookie,
postcode or API key is needed. The carrier's result table, rather than an
echoed form field, must match the requested tracking number.

The adapter accepts checksum-valid tracked S10 references and the portal's
documented 11–13 digit domestic format. U-prefixed customs labels are rejected:
[Japan Post explicitly says these are not tracking barcodes](https://www.post.japanpost.jp/service/send/oversea/information/ems_search_en.html).
The live positive check covers an international parcel; domestic parsing is
covered by a synthetic fixture variation, not a positive live domestic check.

Only the event date, status wording and office/prefecture/country are projected.
The alternating postal-code rows are not events. Free-form details, office
contact information and unrelated page content are excluded. The adapter
retains the latest 100 distinct events and fails on incomplete or changed
tables rather than silently dropping a newer malformed scan.

The history header explicitly labels overseas timestamps as local time.
Offset-less wall times are preserved in `events[].local_time` and
`last_update_local`, along with the carrier's sequence. The row's own
Prefecture / Country cell resolves `OSAKA`, `KANAGAWA` and `JAPAN` to
`Asia/Tokyo`, and `MALTA` to `Europe/Malta`. Only an unambiguous full local
timestamp in these confirmed places produces an explicit UTC event `time`.
Date-only, unknown-place, multi-zone, nonexistent spring-clock and ambiguous
autumn-clock values remain local. The latest row sets `last_update` only when
its own instant is resolved; otherwise it is null even when an older row has
a known instant. The catalog keeps its neutral timezone.

Unresolved dates remain in a bounded `direct_local_history` archive but do not
create UTC scan timestamps in the persisted timeline or establish cross-provider
freshness. When the latest scan has no resolved instant, routing also tries the
universal providers for a dated timeline and retains direct tracking as a
fallback. An unresolved fallback cannot overwrite an established richer-source
summary. This small
place map is deliberately conservative; a parcel-wide destination or another
scan's zone never supplies a missing timezone. Unknown wording stays unknown;
an item returned **from customs** is still in transit.

On 2026-09-26, fresh direct HTTP retrieval of the public reference already
listed in [provider coverage](../../providers/COVERAGE.md) returned 13 events
through final delivery; each had a resolved local event zone. A checksum-valid
synthetic unknown reference returned the official item-not-found row. A separate direct HTTP request from the server
also returned the matching history table and final-delivery row. These checks
establish the HTTP route on both networks; the deployed application's retrieval
has not been verified. Universal fallback remains available for errors or items
outside the portal's available history.

Parser fixtures are reconstructed with synthetic identities, dates and offices.
Set `JAPAN_POST_TRACKING_NUMBER` outside the repository for the optional live
positive test. The normal offline suite tests identity mismatches, ambiguous
tables, local-clock order, status semantics, malformed history, cancellation,
deadlines, response bounds and not-found classification.

Prior art inspected:
[BINM7MD/jp-post-api at 1d5fa05](https://github.com/BINM7MD/jp-post-api/blob/1d5fa05ca698d94c2330ee767f763011cefa499f/jp.js)
(MIT) uses the same direct endpoint and alternating rows. This adapter was
implemented against the current official response with independent identity,
schema, transport and status checks.
