# Tracking routing policy

Implemented September 2026. Carrier selection and retrieval provider are separate: a user can select FedEx while the dedicated browser adapter retrieves the history, with universal providers as fallback. A verified direct correction automatically updates the selected carrier. The web and native app show “Swapped automatically from XX” for 12 hours; ordinary refreshes preserve its original timestamp, and a manual carrier edit clears it.

## Provider order and affinity

1. Use the configured/confirmed direct adapter when available. Cainiao (`aliexpress`) is an aggregator too, but stays a targeted direct route for detected AliExpress/international formats and the existing Swiss Post handoff. It is not blindly queried for every parcel.
2. For discovery: **Ship24 → ParcelsApp → 17TRACK → UPU for checksum-valid S10 numbers**. Ship24 is first following verified sub-second direct JSON lookups in production. This is an operational preference based on those samples, not a broad reliability benchmark. Existing per-parcel success takes precedence, including a working 17TRACK affinity.
3. Postal Ninja is excluded by default while unattended verification is unresolved. Set `TRACKING_ENABLE_POSTAL_NINJA=true` to include it experimentally before 17TRACK; do not count it as working coverage without a fresh deployed test.
4. Remember a successful richer provider and the lookup number in `carrier_data.routing`. A subsequent check starts there, even when it is third in the default list. Respect provider cooldowns before requesting it. UPU never becomes preferred, never moves ahead through discovery rotation, and is excluded from shadow comparisons; an existing richer affinity survives a UPU fallback.

**Royal Mail (2026-09-22):** uses the normal universal-provider route while its
experimental browser adapter cannot retrieve reliably on the production server.
The adapter and investigation notes remain under
`packages/carriers/carriers/royal-mail/`, but it is not an active direct route.

**China Post exception (2026-09-22):** checksum-valid `C…CN` and `L…CN` lookup
numbers try **17TRACK → Ship24 → ParcelsApp → UPU**, with opt-in Postal Ninja
before UPU. The [live comparison](../packages/carriers/providers/COMPARISON.md#china-post-specific-recommendation)
found substantially richer history through the existing unattended route.
17TRACK precedes saved fallback affinity and discovery rotation; on failure or
cooldown the normal preferred fallback is available. Retry 17TRACK first once
its cooldown expires. Dedicated adapters still precede universals, including
EMS and confirmed destination carriers; `E…CN`, untested formats and invalid
checksums do not gain this priority. A confirmed handoff uses its active number.

On failure, try **every eligible enabled universal once in the same check**, stopping at the first usable result: Ship24 → ParcelsApp → 17TRACK → eligible UPU, or the saved richer provider first. A slow direct attempt does not consume the universal budget. ParcelsApp gets up to 45 seconds for a slow initial lookup and one bounded network retry; the other richer providers retain 30 seconds each. Add five seconds of transport allowance per provider, giving a 120-second fallback budget by default (155 seconds with experimental Postal Ninja enabled). Postal S10 lookups reserve an additional 13 seconds for UPU: at most eight seconds for its single HTTP request plus transport allowance. Non-postal lookups never acquire a UPU lease. Timeouts use integer milliseconds. Cooldowns, a recent-success 429 deferral, cancellation, and an exhausted overall budget still prevent calls. If a budget overrun leaves providers untried, the persisted discovery cursor advances for the next check.

Universal providers also receive the catalog zone of the parcel's carrier (the delivery leg's carrier for a handoff number), or none when that zone is UTC. They use it only for scans whose own time names no trustworthy zone, such as ParcelsApp's.

Universal-backed parcels refresh at most every **15 minutes during 08:00–22:00 Europe/Zurich**, hourly overnight. Manual refresh uses the same persisted cooldown. Direct adapters retain their existing schedules; GLS's longer limits also remain.

## Rotation and recovery checks

Keep affinity rather than round-robin successful providers. Once per day per parcel, a **scheduled** successful universal check may compare one other provider. This remains at most one comparison, even though failed discovery can now try all providers. The comparison cursor rotates. Adopt it only when it has strictly newer timestamped history, is not older than saved history, and does not overturn a terminal result. A comparison failure never discards the successful primary result. A direct success does not cause unnecessary universal comparison calls.
The scoped China Post 17TRACK success also skips shadow comparisons: do not
replace the verified richer feed using another source's inferred timestamp.

Retry failed direct routes after the recorded cooldown; successful direct recovery takes over from universal retrieval. Transport failures start at 15 minutes, verification/schema failures at one hour, and confirmed not-found at 24 hours. A universal provider that answers without history for the number (its own inconclusive verdict, not an HTTP 5xx) is recorded as `no_history` on the transport schedule. Repeated failures back off to six hours (24 hours for not-found). A pending parcel whose recorded failures are all not-found or `no_history` waits instead of reporting an outage. Respect a longer explicit Retry-After up to seven days.

## Requested scenarios

| Situation | Behavior |
| --- | --- |
| Wrong carrier; correct carrier supported | On failure, try high-confidence number detection first, then a saved unambiguous hint/confirmed route, then universals. A universal naming a supported carrier triggers direct confirmation in the same sync. Automatically swap only after the direct scraper returns real progress on the same number, at least as recent as known history. Ambiguous regional brands are not guessed; failed, empty, stale or conflicting confirmation keeps universal coverage. |
| Candidate needs postcode/capability | Report `carrier_input_required`, continue through universals; never borrow another carrier's credentials. Inputs from the previously confirmed same-carrier/same-number route may be reused. |
| Correct carrier only covered by one or two universals | Discovery finds a working provider and pins it. Others' failures are cached independently. No broad provider fan-out on ordinary successful checks. |
| Direct or universal returns 429 with recent success | If last **successful retrieval** was less than one hour ago by day or three hours overnight, preserve current progress and defer fallback until the earlier of freshness expiry and the next retry. The throttled provider's own cooldown still holds. A recent failed attempt never counts as success. |
| 429 with stale/no successful data | Report before fallback; try another eligible provider within the attempt/time budget. Do not retry the throttled provider early. |
| Unknown carrier | Try one strong direct candidate when available; otherwise discover and persist a universal provider. No carrier label is invented from a numeric shape or a generic brand. |
| Universal fails | Record provider/category, update parcel cooldown and shared health, then try a healthy alternative if allowed. Retain affinity until a replacement succeeds. If none succeed, preserve progress and store the next check time. |
| Border crossing/double carrier | Preserve origin history. A reported delivery partner can use any dedicated adapter that needs no additional inputs. Resolve structured names and official partner links through the carrier catalog, then confirm identity and real progress before selecting the delivery leg. With no named partner, a checksum-valid postal number and reported destination can propose one national-post lookup. Country and issuer suffix alone never confirm the operator. Pin a confirmed local number for refresh and universal recovery. |
| Manual good → unsupported/wrong selection | Check the new choice first. Preserve history and revalidate the prior confirmed route as recovery. If it still works on this number, automatically restore it and show the temporary notice. Carrier changes invalidate queued/in-flight work through the existing generation/lease fencing. |
| Older fallback or terminal regression | Preserve the newer/terminal summary and prior event watermark. Provider success does not authorize a status regression. |

ShipUp and Royal Mail are marked automatic through universal lookup in the shared web/native catalog; this does not claim active dedicated adapters for them. The universal-fallback carriers (see the overview in `packages/carriers/README.md`) use the same universal route. Packeta, InPost, Pos Malaysia, Correos, Poste Italiane, CTT, FedEx, USPS, Canada Post, Posti and Asendia have since graduated to dedicated adapters. Asendia's covers Asendia USA's platform only; its other numbers get a not-found there and continue through the universal providers. Adding a dedicated adapter later changes the catalog and allows direct discovery/recovery to take over.

La Poste retains its structured destination and resolves the partner's name,
official URL and reference; DHL arrival links use the same catalog resolver.
Other adapters can supply `delivery_carrier` and an optional
`delivery_tracking_number`, or include an official partner link in their events.
A standalone downstream reference is also retained: a unique high-confidence
catalog match proposes a lookup, with named partners taking precedence.
For a checksum-valid S10 reference with no named partner, the reported
destination can instead propose one national-post lookup through the shared
[catalog hints](../packages/carriers/core/catalog/hints.ts). PostNL retains its
structured `destination_code`; Cainiao's exact English country labels are also
accepted. A postal reference's issuer suffix does not override that destination.
This bounded fallback applies across origin carriers and requires a dedicated
destination adapter without additional credentials. It does not use transit
scan locations, try multiple national operators, or apply to arbitrary parcel
numbers. Destination-based candidates additionally require dated progress;
the same freshness, terminal-state protection and probe cooldown apply.
Unknown or conflicting partner evidence is ignored. Malformed optional hints
do not invalidate usable origin tracking. A lookup failure, pre-advice, unknown,
stale or conflicting delivery result keeps the origin active.
Partners confirming the same terminal milestone on the same
UTC day may disagree on its timestamp; retain both provider timestamps and
the newer saved summary/event watermark while adopting the verified route.
An older completion on another day does not qualify. Unsuccessful confirmations
wait 55 minutes unless origin history advances or the partner/reference changes.
The established AliExpress/international `L…CH` route retains a Swiss Post
confirmation probe when there is no partner or downstream reference and no
contradicting destination. It uses the same progress checks and cooldown as
other handoffs. Older confirmed `swiss_post_ready` routes continue directly
with Swiss Post. An explicitly selected Swiss postal route retains its Cainiao
fallback. These compatibility cases do not choose an operator from a country.

## Sparse postal history

Provider responses do not replace the saved timeline: event upserts retain
previous rows. UPU’s uncertain wall times are archived separately (up to 1,000
scans per lookup number), including when a shorter response omits past scans or
a richer provider recovers. Newly observed current UPU milestones enter the
visible timeline at observation time, explicitly flagged as lacking a provider
instant. Its complete local-time archive is not rendered as a dated timeline.

UPU can update its own summary but cannot demonstrate cross-provider freshness;
keep an existing richer summary, the UTC event watermark and terminal progress.
Delivery forecasts never enter UPU history or freshness. See
[UPU’s contract](../packages/carriers/providers/upu/README.md#history-and-time)
and the [provider comparison](../packages/carriers/providers/COMPARISON.md).

## Displayed tracking links

The primary web/iPhone link follows `tracking_provider` on the displayed successful result: 17TRACK, ParcelsApp or Ship24 opens that provider with the matching lookup number. It does not follow a speculative preference or a failed attempt. Direct recovery clears this field and restores the confirmed carrier link. Linked journeys retain the origin link and use the local number for the active provider. Saved capability URLs are reused only for the same carrier and number. Unknown provider names cannot inject a URL. Postal Ninja and UPU use their verified public tracking forms; no parcel deep link is guessed. UPU’s form may ask the user for a CAPTCHA even though its API does not.

## Shared provider protection

`tracking_provider_health` is service-only. An atomic RPC grants one 90-second lease per universal provider across workers. Completion is token-fenced. A crashed worker's lease expires. A healthy completion leaves a five-second spacing interval; 429 opens a minimum 15-minute cooldown, verification one hour, and other failures exponential one minute to one hour. Not-found and `no_history` are parcel-specific and do not open a global outage circuit.

The table records attempts, successes, consecutive failures, last failure category, last success, duration, and next eligible time. Coordination failure is reported and fails closed for universal calls; a completion-write failure never discards already-retrieved data. Global health persists through restarts, as do per-parcel affinity/cooldowns.

## Sentry operations

Routing sends fixed messages with `component:tracking-routing`, `operation`, `carrier`, `provider`, `failure_category`, and safe error class. Fingerprints group by decision/provider/category rather than parcel or attempt. Sentry retains original exceptions, stacks, causes, custom error properties, request/response details, tracking numbers and inherited SDK context without application-level field redaction. Byte/time limits on response inspection and Sentry tag lengths are resource limits. Logging/SDK failures cannot block tracking.

Useful issue searches:

- `component:tracking-routing operation:transport_fallback` — a direct HTTP/session path needed browser, TRAWL or page recovery, even if it succeeded.
- `component:tracking-routing operation:provider_failed failure_category:rate_limited` — which direct/universal provider needs less traffic.
- `component:tracking-routing operation:provider_failed failure_category:schema` — parser/protocol investigation.
- `component:tracking-routing operation:all_providers_unavailable` — uncovered parcels or broad outage.
- `component:tracking-routing operation:health_store_unavailable` — migration/database coordination problem.
- `component:tracking-routing operation:carrier_auto_swapped` — a correction was committed successfully (informational).
- `component:tracking-routing operation:carrier_mismatch_confirmed` — improve carrier detection rules.
- `component:tracking-routing operation:direct_support_opportunity` — candidate dedicated adapters.
- `component:tracking-routing operation:fresher_provider_found` — evidence to reconsider default ordering.
- `component:tracking-routing operation:provider_recovered` — recovery signal (informational; does not auto-resolve an issue).

Existing sync attempt/step audits remain in place. Cross-provider failures are reported before recovery, so a successful fallback does not conceal them. Internal tier warning timing is documented in [scraper monitoring](scraper-monitoring.md). Shadow checks and provider cooldowns limit issue volume. Carrier names a universal provider reports without an unambiguous mapping are hints, not proven new adapters: they are logged as `tracking_routing` lines with `decision: carrier_coverage_discovered`, once per parcel's retained name set, and kept in the parcel's routing state (`reported_carriers_seen`) for review. They do not open Sentry issues, because nobody acts on one as it happens. The reporter uses the existing `SENTRY_DSN`; this change does not create organization-level alert recipients or notification rules.

See [scraper monitoring](scraper-monitoring.md) for per-provider average/p95 timings, direct-path failures and recovery usage.

## Deployment and verification

Apply `20260912150000_tracking_provider_health.sql` and `20260912160000_preserve_carrier_change_history.sql` and `20260912170000_automatic_carrier_correction.sql` before enabling this application build. The UPU addition also requires `20260921100000_add_upu_provider.sql` to extend the shared provider allowlist. The correction migration saves carrier/inputs, notice, and tracking evidence atomically, renews generation only on a correction, and rejects stale workers. Ordinary status writes do not change the generation. The former adds service-only coordination RPCs; the latter preserves ownership/input validation, cancellation, and generation fencing while removing destructive history resets. No separate scheduled job is needed: rotation runs through the existing scheduler.

Tests cover routing, rollover/DST boundaries, failed and successful fallback, wrong-carrier confirmation, credential isolation, manual edits, polling persistence, summary preservation, real SDK event tags/grouping, and SQL admission/lease/cooldown/ownership behavior. Live availability is checked separately: on September 10, Ship24 returned matching delivered history from the production container with one HTTP POST each for two public examples (32 normalized events in 409 ms; 6 in 121 ms). Browser recovery remains available. This establishes those successful lookups, not universal coverage. Postal Ninja remains experimental.
