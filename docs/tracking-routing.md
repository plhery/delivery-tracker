# Tracking routing policy

Implemented September 2026. Carrier selection and retrieval provider are separate: a user can select FedEx while a universal provider retrieves the history. A verified direct correction automatically updates the selected carrier. The web and native app show “Swapped automatically from XX” for 12 hours; ordinary refreshes preserve its original timestamp, and a manual carrier edit clears it.

## Provider order and affinity

1. Use the configured/confirmed direct adapter when available. Cainiao (`aliexpress`) is an aggregator too, but stays a targeted direct route for detected AliExpress/international formats and the existing Swiss Post handoff. It is not blindly queried for every parcel.
2. For discovery: **Ship24 → ParcelsApp → 17TRACK**. Ship24 is first following verified sub-second direct JSON lookups in production. This is an operational preference based on those samples, not a broad reliability benchmark. Existing per-parcel success takes precedence, including a working 17TRACK affinity.
3. Postal Ninja is excluded by default while unattended verification is unresolved. Set `TRACKING_ENABLE_POSTAL_NINJA=true` to include it experimentally before 17TRACK (which stays last); do not count it as working coverage without a fresh deployed test.
4. Remember a successful provider and the lookup number in `carrier_data.routing`. A subsequent check starts there, even when it is third in the default list. Respect provider cooldowns before requesting it.

On failure, try **every eligible enabled universal once in the same check**, stopping at the first usable result: Ship24 → ParcelsApp → 17TRACK, or the saved successful provider first. A slow direct attempt does not consume the universal budget. Reserve 35 seconds per enabled provider: up to 30 seconds for lookup plus transport allowance, for a 105-second fallback budget by default (140 seconds with experimental Postal Ninja enabled). Timeouts use integer milliseconds. Cooldowns, a recent-success 429 deferral, cancellation, and an exhausted overall budget still prevent calls. If a budget overrun leaves providers untried, the persisted discovery cursor advances for the next check.

Universal-backed parcels refresh at most every **15 minutes during 08:00–22:00 Europe/Zurich**, hourly overnight. Manual refresh uses the same persisted cooldown. Direct adapters retain their existing schedules; GLS's longer limits also remain.

## Rotation and recovery checks

Keep affinity rather than round-robin successful providers. Once per day per parcel, a **scheduled** successful universal check may compare one other provider. This remains at most one comparison, even though failed discovery can now try all providers. The comparison cursor rotates. Adopt it only when it has strictly newer timestamped history, is not older than saved history, and does not overturn a terminal result. A comparison failure never discards the successful primary result. A direct success does not cause unnecessary universal comparison calls.

Retry failed direct routes after the recorded cooldown; successful direct recovery takes over from universal retrieval. Transport failures start at 15 minutes, verification/schema failures at one hour, and confirmed not-found at 24 hours. Repeated failures back off to six hours (24 hours for not-found). Respect a longer explicit Retry-After up to seven days.

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
| Border crossing/double carrier | Preserve origin history. Existing explicit Swiss Post identity/handoff confirmation selects the delivery leg only after real progress. Use its confirmed local number for universal recovery. Multiple reported carrier names alone are insufficient to switch; retain universal coverage for that journey. |
| Manual good → unsupported/wrong selection | Check the new choice first. Preserve history and revalidate the prior confirmed route as recovery. If it still works on this number, automatically restore it and show the temporary notice. Carrier changes invalidate queued/in-flight work through the existing generation/lease fencing. |
| Older fallback or terminal regression | Preserve the newer/terminal summary and prior event watermark. Provider success does not authorize a status regression. |

FedEx, Asendia, and ShipUp are marked automatic through universal lookup in the shared web/native catalog; this does not claim dedicated direct adapters for them. The 62 universal-fallback carriers added in the September 2026 detection pass (see `docs/CARRIERS.md` and `src/lib/carriers.test.ts`) use the same universal route. Packeta, InPost and Pos Malaysia have since graduated to dedicated adapters. Adding a dedicated adapter later changes the catalog and allows direct discovery/recovery to take over.

## Displayed tracking links

The primary web/iPhone link follows `tracking_provider` on the displayed successful result: 17TRACK, ParcelsApp or Ship24 opens that provider with the matching lookup number. It does not follow a speculative preference or a failed attempt. Direct recovery clears this field and restores the confirmed carrier link. Linked journeys retain the origin link and use the local number for the active provider. Saved capability URLs are reused only for the same carrier and number. Unknown provider names cannot inject a URL. Postal Ninja uses its public tracking form until a stable public parcel deep link is verified.

## Shared provider protection

`tracking_provider_health` is service-only. An atomic RPC grants one 90-second lease per universal provider across workers. Completion is token-fenced. A crashed worker's lease expires. A healthy completion leaves a five-second spacing interval; 429 opens a minimum 15-minute cooldown, verification one hour, and other failures exponential one minute to one hour. Not-found is parcel-specific and does not open a global outage circuit.

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
- `component:tracking-routing operation:carrier_coverage_discovered` — reported carrier names not mapped unambiguously; names are hints, not proven new adapters.
- `component:tracking-routing operation:fresher_provider_found` — evidence to reconsider default ordering.
- `component:tracking-routing operation:provider_recovered` — recovery signal (informational; does not auto-resolve an issue).

Existing sync attempt/step audits remain in place. Provider failures are reported before recovery, so a successful fallback does not conceal them. Shadow checks and provider cooldowns limit issue volume. Coverage names are reported once per parcel's retained name set. The reporter uses the existing `SENTRY_DSN`; this change does not create organization-level alert recipients or notification rules.

See [scraper monitoring](scraper-monitoring.md) for per-provider average/p95 timings, direct-path failures and recovery usage.

## Deployment and verification

Apply `20260912150000_tracking_provider_health.sql` and `20260912160000_preserve_carrier_change_history.sql` and `20260912170000_automatic_carrier_correction.sql` before enabling this application build. The correction migration saves carrier/inputs, notice, and tracking evidence atomically, renews generation only on a correction, and rejects stale workers. Ordinary status writes do not change the generation. The former adds service-only coordination RPCs; the latter preserves ownership/input validation, cancellation, and generation fencing while removing destructive history resets. No separate scheduled job is needed: rotation runs through the existing scheduler.

Tests cover routing, rollover/DST boundaries, failed and successful fallback, wrong-carrier confirmation, credential isolation, manual edits, polling persistence, summary preservation, real SDK event tags/grouping, and SQL admission/lease/cooldown/ownership behavior. Live availability is checked separately: on September 10, Ship24 returned matching delivered history from the production container with one HTTP POST each for two public examples (32 normalized events in 409 ms; 6 in 121 ms). Browser recovery remains available. This establishes those successful lookups, not universal coverage. Postal Ninja remains experimental.
