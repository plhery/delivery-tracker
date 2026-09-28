# Tracking routing

How a parcel refresh picks where to get its history. The code is
[`trackingRouting.ts`](../src/server/trackingRouting.ts) and
[`trackingSync.ts`](../src/server/trackingSync.ts).

The **carrier** (what the user sees) and the **source** (who answered) are separate. A
FedEx parcel can be served by the FedEx adapter or, as a fallback, by a universal
provider.

## Source order

1. **The carrier's own adapter**, when it has one. Cainiao (`aliexpress`) is an aggregator
   too, but it is only queried for AliExpress-style numbers and the Swiss Post handoff.
2. **Carriers that recognize the number**, when the filed carrier cannot track it (see
   Carrier recognition below).
3. **Universal providers**: Ship24 → ParcelsApp → 17TRACK → UPU.
   - UPU is only for checksum-valid postal S10 numbers, always last, never remembered as
     the preferred source and never used for shadow checks.
   - Postal Ninja is off by default. `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it before
     17TRACK.
   - Exception: checksum-valid China Post `C…CN` and `L…CN` numbers try 17TRACK first,
     because it returns much richer history for them (see
     [COMPARISON.md](../packages/carriers/providers/COMPARISON.md)). Dedicated adapters such
     as EMS still go first.

**Affinity.** A provider that returns history is saved with its lookup number in
`carrier_data.routing`. The next check starts there, whatever its place in the default
order, as long as it isn't cooling down.

**Royal Mail** uses the universal providers. Its browser adapter exists but isn't an active
route (see its [README](../packages/carriers/carriers/royal-mail/README.md)).

## When a source fails

In one check, every eligible universal provider is tried once, stopping at the first
usable answer. Budgets per provider: 45 s for ParcelsApp (slow first lookups, one network
retry), 30 s for the others, plus 5 s transport allowance each. That's 120 s in total by
default, 155 s with Postal Ninja. Postal S10 lookups get 13 s more for UPU. A slow direct
attempt doesn't eat into this budget. If the budget runs out first, the discovery cursor
moves on so the next check starts elsewhere.

A failed source waits before it is retried for that parcel:

| Failure | First wait | Backs off to |
| --- | --- | --- |
| Transport, and `no_history` (provider answered but has nothing) | 15 min | 6 h |
| Verification or schema | 1 h | 6 h |
| Not found | 24 h | 24 h |

A longer `Retry-After` is honoured, up to 7 days. A pending parcel whose failures are all
not-found or `no_history` shows as waiting, not as an outage. When a failed direct adapter
recovers, it takes over from the universal provider again.

**Rate limits (429).** If the last successful retrieval is recent (under 1 h by day, 3 h
overnight), the parcel keeps its progress and skips fallback until that window or the
retry time runs out. Otherwise the router tries another provider. It never retries the
throttled one early.

## Refresh cadence

Daytime is 08:00–22:00 Europe/Zurich. Overnight, everything is checked hourly.

| Parcels | Daytime |
| --- | --- |
| Out for delivery (direct adapter) | every 2 min |
| Other stages (direct adapter) | every 10 min |
| Served by a universal provider | every 15 min |
| PostNL | every 30 min, also after a failure |
| GLS (DE, CH, FR) | at most hourly, 4 h after a failure, manual refresh included |
| No new event for 48 h (from when it was added) | hourly around the clock; manual refresh still allowed |

Cooldowns use the persisted `last_synced_at` and `sync_status`, so restarts and repeated
Refresh taps don't bypass them. New or reconfigured parcels are checked at once. A scheduled
run handles at most five due parcels per account, round-robin.

HTTP 429 without `Retry-After` is not retried immediately. Adapters that allow one
transient retry honour a `Retry-After` of up to one minute; longer windows fail the attempt.

**Shadow checks.** Once a day, a scheduled successful universal check may compare one other
provider, rotating through them. Its result is adopted only if it has strictly newer
timestamped history and doesn't overturn a terminal state. Direct successes and the China
Post 17TRACK route skip shadow checks.

## Scenarios

| Situation | Behaviour |
| --- | --- |
| Wrong carrier selected, right one supported | On failure, try the detected carrier, then a saved confirmed route, then the carriers that recognize the number, then universals. When a universal names a supported carrier, the router asks that carrier's adapter directly. A bare brand ("DPD Group") counts only when the number leaves one of the brand's catalog networks, by shape or a preferred rule such as a DPD depot range. It swaps only after that adapter returns real progress on the same number, at least as recent as what we have. The UI shows "Swapped automatically from X" for 12 h. |
| Carrier needs a postcode or capability URL | Report `carrier_input_required` and continue with universals. Inputs are never borrowed from another carrier. An optional input (DPD's postcode) does not block a lookup; the lookup runs without it. |
| Only one or two universals know the carrier | Discovery finds one and pins it. No fan-out on normal successful checks. |
| Unknown carrier | Try one strong direct candidate if there is one, then the carriers that recognize the number, otherwise discover a universal. Never invent a carrier from a number's shape: a probe adopts a carrier only on its own real progress. |
| A universal returns another parcel | Numbers are reused and carriers' number spaces overlap. For a parcel filed under a specific carrier, a universal history counts as no history when every carrier it names is a different catalog carrier and its newest scan is more than 30 days older than the parcel. The next provider is asked. |
| Everything fails | Keep progress, store the next check time, keep affinity until a replacement works. |
| User switches to a worse carrier | Check the new choice first. If the previously confirmed route still works, restore it with the same notice, using the postcode or link saved with it. Choosing the confirmed carrier again replaces those with what the user entered, so a cleared postcode is not reused. Generation fencing cancels in-flight work. |
| Older or regressing result | Keep the newer or terminal state. A successful response never downgrades status. |
| Same scans, new wording | Each wording is its own stored event. DPD is the exception: its scan takes over the one stored DPD or universal row at the exact same instant, which is updated in place. A universal row DPD took over keeps its identity, so the next universal reply rewords it in place again: its wording follows the source that answered last ([`eventIdentity.ts`](../src/server/eventIdentity.ts), [DPD README](../packages/carriers/carriers/dpd/README.md)). |

## Carrier recognition

A number whose shape fits several carriers is checked with the carriers that can answer
cheaply ([`carrierRecognition.ts`](../src/server/carrierRecognition.ts)). A carrier
qualifies when its `carrier.json` declares `tracking.recognition` and its adapter
implements `recognize()`: plain HTTP, a clean not-found, no browser. Carriers that only
answer through a browser (DHL, FedEx, UPS, USPS, DPD France, Mondial Relay, SF Express)
are left to the universals.

- **Which and in what order.** Low-confidence detection candidates that qualify: the
  carrier a universal named first, then those a `preferred` rule backs (a DPD depot
  range), then the catalog's `recognition.rank`, a hand-set popularity order. At most five
  are asked at once.
- **Settling.** Only an answer for a recent parcel counts; an old parcel can share a reused
  number. One answer wins; with several, the one number evidence backs, else the most
  common network of a single brand (GLS Switzerland and GLS Germany answer from one
  overview). Unrelated carriers that all know the number are a choice for the user.
- **In the Add sheet.** The detect route asks once the number is settled (the field loses
  focus, a paste, a shared number), within three seconds, and caches complete answers per
  number for ten minutes. A single answer selects the carrier, and its required inputs
  (the GLS postcode) appear before saving; several answers ask the user to choose. It
  never holds the Add button.
- **In routing.** When the filed carrier cannot track the number (no adapter of its own,
  or its adapter answered not-found; a transient failure does not count), the router asks
  before the universals, never another network of the filed carrier's brand, for open
  parcels in their first 30 days outside linked journeys. A carrier that knows the number
  and needs no input gets a full correction lookup, adopted only on real progress on the
  same number, at least as recent as what we have (a pre-advice is not enough), with the
  "Swapped automatically" notice. A carrier that needs the user's input is saved as
  `routing.input_needed`, and the parcel asks the user for it.
- **Retries.** Answers are kept in `routing.candidate_probes`, not with the carrier
  failures, so they decide neither the parcel's status, nor the filed carrier's retry, nor
  the health evidence of the check. The next check waits 1, 2, 4, then 6 hours, since a
  parcel appears once it is handed over, and a day after six misses.

## Handoffs (two carriers)

A parcel often changes carrier at the border. The origin history is always kept.

- Adapters can report `delivery_carrier`, `delivery_tracking_number` or an official
  partner link. Names and links are resolved through the carrier catalog.
- With no named partner, a checksum-valid S10 number and a reported destination country can
  propose **one** national-post lookup ([catalog hints](../packages/carriers/core/catalog/hints.ts)).
  The issuer suffix and transit scans never pick the operator.
- The partner is only adopted once its own adapter (no required inputs) returns dated,
  fresh progress. A partner whose only input is optional (DPD's postcode) is asked without
  it, and only with a reference of its own number shape, never the origin's postal number. Failed confirmations wait 55 min unless the origin history or the partner
  changes.
- Compatibility: AliExpress `L…CH` numbers keep a Swiss Post confirmation probe, and
  selected Swiss postal routes keep their Cainiao fallback.

## UPU history

UPU times have no reliable zone. Its scans are archived separately (up to 1,000 per
number). Only newly observed milestones enter the visible timeline, stamped at observation
time and flagged as lacking a provider time. UPU can update its own summary but never
proves freshness against another source, and forecasts are ignored. See the
[UPU README](../packages/carriers/providers/upu/README.md).

Universal providers also get the catalog timezone of the parcel's carrier, used only for
scans with no trustworthy zone of their own (ParcelsApp's, and Ship24's offset-less legs).
When that carrier's zone is UTC (Asendia, `unknown`), they get the zone of the carrier a
direct lookup confirmed for the same number instead, if any. The freshness watermark (`last_event_at`) reads
offset-less times in the result's zone, exactly as the stored events are read, and so does
the sync when it checks whether a returned summary is older than the watermark.

## Direct histories without complete timestamps

Some direct feeds omit scan clocks, offsets or the event year. The router keeps their bounded
history separately, including return-leg and summary markers. When the current status has no
complete timestamp, it tries providers for dated progress. If providers cannot help,
the direct current status remains available without advancing the freshness watermark.
An unresolved direct lookup cannot displace a carrier already confirmed by dated progress.
The sync preserves richer saved progress and records status changes as observations,
keeping observation time distinct from a carrier scan time.

## Tracking links

The link shown in the app follows `tracking_provider` of the result on screen: a 17TRACK,
ParcelsApp or Ship24 result links to that provider with the lookup number. Direct recovery
restores the carrier link. Postal Ninja and UPU link to their public forms. No deep links
are guessed.

## Shared provider protection

`tracking_provider_health` (service role only) coordinates workers:

- one 90 s lease per universal provider, token-fenced, expiring if a worker crashes;
- 5 s spacing after a healthy call;
- cooldowns: 429 → at least 15 min, verification → 1 h, other failures → 1 min to 1 h
  (exponential);
- not-found and `no_history` are per-parcel and never open a global cooldown.

If coordination fails, universal calls fail closed. A failed completion write never throws
away data already retrieved.

## Sentry searches

Routing events carry `component:tracking-routing` plus `operation`, `carrier`, `provider`
and `failure_category`. They are grouped by decision, provider and category, not by
parcel.

| `operation:` | Meaning |
| --- | --- |
| `transport_fallback` | A direct path needed browser/TRAWL recovery, even if it then succeeded |
| `provider_failed` | Add `failure_category:rate_limited` (needs less traffic) or `schema` (parser work) |
| `all_providers_unavailable` | Uncovered parcel or broad outage |
| `health_store_unavailable` | Migration or database coordination problem |
| `carrier_auto_swapped` | A carrier correction was committed |
| `carrier_mismatch_confirmed` | Detection rules could be improved |
| `candidate_probe_confirmed` | Carrier recognition found the carrier and it tracks the parcel (logs and breadcrumbs only) |
| `foreign_history_rejected` | A universal returned an older parcel of another carrier for the number (logs and breadcrumbs only) |
| `carrier_input_needed` | A recognized carrier needs the user's input (the GLS postcode); the parcel asks for it (logs and breadcrumbs only) |
| `direct_support_opportunity` | Candidate for a dedicated adapter |
| `carrier_coverage_discovered` | A provider named a carrier the catalog doesn't know |
| `fresher_provider_found` | Evidence to revisit the default order |
| `provider_recovered` | Recovery signal (doesn't auto-resolve issues) |

`carrier_coverage_discovered` fires once per parcel, only for names that are neither a
catalog name/alias nor a known network of DHL, DPD, GLS or Hermes. Timings and metrics are
in [OBSERVABILITY.md](OBSERVABILITY.md).
