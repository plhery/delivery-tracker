# Evri

The direct adapter covers **Evri International**, using the
[GlobalEco tracker](https://globaleco.app/track/) linked by the official
[Evri tracking page](https://www.evri.com/track-a-parcel). Domestic UK tracking
uses a separate service and remains dependent on universal providers. A missing
international result does not establish that the parcel is unknown to Evri UK.

## Retrieval and identity

[adapter.ts](adapter.ts) makes one anonymous form POST to
`https://globaleco.app/track` with `tracking_number`. Fresh requests require no
cookie jar, form bootstrap, CSRF token, postcode, account or browser. The response
has a streaming 1 MB limit and a 15-second default deadline; caller cancellation
and a smaller caller budget are honored. There is no automatic retry.

The parser requires the exact requested identifier in both the shipment heading
and the **System Tracking** field, plus one expected history table. The search
input is not identity evidence: the portal can replace it with the partner's
tracking number. Only the explicit **Parcel not found** result, in the normal
search form returned by the exact submitted lookup, is treated as not found.
The not-found form clears its input, so its identity is scoped by the request;
a nonempty input naming another reference is rejected. HTTP failures,
changed markup, missing history and ambiguous identity remain errors.

The adapter retains event labels, locations and parcel weight. Sender names,
destination details, comments, tracking aliases and outbound links are omitted.
Exact duplicate scans are removed; at most 100 scans are returned. Every event
is classified independently by its exact label. Unknown labels remain visible
and unclassified; an unknown current label produces `unknown` status.

## Time and completeness

The portal prints timestamps without offsets or a documented timezone, including
international partner scans. The parser validates these values and preserves
them as offset-less ISO strings in `events[].local_time` and
`last_update_local`, keeping the portal's newest-first order. It does not sort
clocks across international legs or assign the UK timezone to other places.

`events[].time` is omitted and `last_update` is null. This keeps the host from
treating unknown local times as UTC in persisted events or freshness comparisons.
The host retains a bounded `direct_local_history` archive bound to the carrier
and tracking number, including across later universal-provider refreshes. It
checks universal providers for a dated timeline before accepting this local-time
result as the fallback. That fallback can establish initial progress but cannot
overwrite an existing richer-source summary without evidence of freshness.
Local-time scans do not populate the timeline of confirmed instants. No ETA or
delivered instant is inferred.

## Verification

On 2026-09-26 the public international reference from the
[coverage comparison](../../providers/COVERAGE.md) returned 20 scans and
**Delivery Attempted** through fresh direct HTTP, without cookies or postcode.
The synthetic unknown returned the explicit not-found page. Fresh HTTP requests
from the server network also returned all 20 rows and the correct negative
result; this verifies network retrieval, not deployment of the new adapter.
The same public reference returned empty results in the current domestic customer-tracking
search and the legacy domestic reference API, confirming the service boundary.

The international source has one fewer event than the 21-event ParcelsApp sample;
successful retrieval is not a claim of complete Evri history or UK coverage.
Fixtures are synthetic, with provenance in [fixtures/README.md](fixtures/README.md).
Run the positive live test by supplying `EVRI_TRACKING_NUMBER` outside the repository.

Offline tests exercise identity, aliases, negative results, schema changes,
calendar validation, chronology, status boundaries, privacy, cancellation,
response size and actual request serialization.
