# Tracking routing

How a parcel refresh picks where to get its history. The code is
[`trackingRouting.ts`](../src/server/trackingRouting.ts) and
[`trackingSync.ts`](../src/server/trackingSync.ts).

The **carrier** (what the user sees) and the **source** (who answered) are separate. A
FedEx parcel can be served by the FedEx adapter or, as a fallback, by a universal
provider.

## Add preflight

Both detection endpoints ask the shape-matching carriers first. If none confirms the
number, Ship24 and ParcelsApp share a short lookup budget before browser confirmation.
They run only after the request allowance is granted. Once one has dated history, the
other gets one more second and is then cancelled; a cancelled call is not a provider
failure and is left out of the answer, health, metrics and Sentry. Without dated history
the check waits for both. A successful universal answer
returns immediately; direct confirmation continues after saving. Their outcomes distinguish missing
history, recipient input, cooldowns and service failures. Universal history proves that
tracking is available. A single catalog carrier named with dated movement by every provider
asked identifies an unknown parcel; conflicting names, a cancelled provider, bare brands and
registration-only history stay unresolved. Direct confirmation remains necessary to replace a selected carrier. The Add button stays
available while the check runs, and the saved parcel continues the full lookup chain.

Concurrent anonymous checks share work until their last caller cancels. A process-wide
cache lets the first sync consume a fresh, number-bound history before acquiring another
provider lease. This first result can be saved without waiting for speculative carrier
confirmation; later checks retain the usual confirmation policy. Credentialed lookups bypass it. Browser confirmation keeps the same reuse
policy. These caches are transient; persisted routing remains the source of retry times.

An explicit universal postcode requirement is retained separately from carrier inputs.
The owner supplies it through the carrier editor. It is bound to the current number,
kept private, and ignored for a different tracking number. Updating it invalidates an older
sync and clears universal providers' missing-input backoffs. Other failure backoffs stay in place. Missing recipient input does not
open the shared provider circuit. Another source with progress clears the prompt.
Clients show the earliest next-check eligibility; polling windows can delay the actual run.

## Source order

1. **The carrier's own adapter**, when it has one. Cainiao (`aliexpress`) is an aggregator
   too, but it is only queried for AliExpress-style numbers and the Swiss Post handoff.
2. **Carriers that recognize the number**, when the filed carrier cannot track it (see
   Carrier recognition below).
3. **Universal providers**, by default ParcelsApp → Ship24 → 17TRACK → UPU.
   - A carrier with results in [coverage.json](https://github.com/plhery/universal-parcel-scraper/blob/main/providers/coverage.json)
     gets its own order, listed in [COVERAGE.md](https://github.com/plhery/universal-parcel-scraper/blob/main/providers/COVERAGE.md):
     providers by the tier its results give them (full history, partial history, nothing
     conclusive, answered without history), HTTP providers (ParcelsApp, Ship24) before the
     browser-service 17TRACK within a tier, then the default order. A
     full history outranks a cheaper partial one because a parcel keeps the provider that
     answers first. A provider that never had history and answered with another carrier's
     parcel or refused the number format is not asked, unless no other would remain.
   - The order is the one of the carrier the lookup is for (the delivery leg's carrier for
     its number), else of the carrier confirmed or discovered for the number, else the
     default.
   - UPU is only for checksum-valid postal S10 numbers, always last, never remembered as
     the preferred source and never used for shadow checks.
   - Postal Ninja is off by default. `TRACKING_ENABLE_POSTAL_NINJA=true` adds it after the
     other aggregators, whatever its tier, before UPU.
   - Exception: checksum-valid China Post `C…CN` and `L…CN` numbers try 17TRACK first,
     because it returns much richer history for them (see
     [COMPARISON.md](https://github.com/plhery/universal-parcel-scraper/blob/main/providers/COMPARISON.md)). Dedicated adapters such
     as EMS still go first.

For new lookups, the iPhone's device region takes precedence over a trusted Cloudflare
`CF-IPCountry` header as a country hint.
A destination reported by a carrier takes precedence. The hint puts that country's carriers
first when recognition asks carriers whether they know the number. It does not establish
the carrier, set the delivery destination or change scan clocks. Universal providers receive neither the hint nor the visitor's IP address. Reopening a shared parcel does not change its hint.

**Affinity.** A provider that returns history is saved with its lookup number in
`carrier_data.routing`. The next check starts there, whatever its place in the order, as
long as it isn't cooling down. Providers in a better tier for the carrier are asked before
it, each within its own backoff, so a parcel moves up to a fuller history and never back
down.

For a parcel that already has movement, a provider answering with only pending or
registered history does not gain affinity. The router asks the remaining eligible
providers in the same check. If none has progress, the first usable answer follows the
normal preservation path while the previous affinity and event watermark stay. A parcel
still waiting for its first progress keeps the first usable answer as before.

**Royal Mail** starts with its own adapter using the container's local Chromium. A failed
direct lookup follows the normal provider fallback route (see its
[README](https://github.com/plhery/universal-parcel-scraper/blob/main/carriers/royal-mail/README.md)).

## When a source fails

In one check, every eligible universal provider is tried once, stopping at the first
usable answer with movement if the parcel already has some. Budgets per provider: 45 s
for ParcelsApp (slow first lookups, one network retry), 30 s for the others, plus 5 s
transport allowance each. That's 120 s in total by default, 155 s with Postal Ninja,
less when a carrier's order leaves a provider out. Postal S10 lookups get 13 s more for UPU. A slow direct
attempt doesn't eat into this budget. If the budget runs out first, the discovery cursor
moves on so the next check starts with another of ParcelsApp, Ship24 and 17TRACK. Postal
Ninja and UPU stay after them.

A failed source waits before it is retried for that parcel:

| Failure | First wait | Backs off to |
| --- | --- | --- |
| Transport, and `no_history` (provider answered but has nothing) | 15 min | 6 h |
| Verification or schema; not found by a carrier's own adapter | 1 h | 6 h |
| Not found by a universal provider | 24 h | 24 h |

A longer `Retry-After` is honoured, up to 7 days. A carrier often doesn't know a label
before its first scan, hence its shorter not-found wait. When a universal provider shows
progress the parcel hasn't had yet and names a carrier that said not found, that carrier is
asked again in the same check. A pending parcel whose failures are all not-found or
`no_history` shows as waiting, not as an outage. When a failed direct adapter recovers, it
takes over from the universal provider again.

When every source fails, the parcel keeps its last progress. The error chip appears only
after two consecutive checks fail and the last successful check
is at least 1 h old by day or 3 h overnight. An answer with progress, or one for a parcel
awaiting its first movement, resets the streak. Thin answers for a universal-only parcel
count as missed checks and keep the time of the last successful check. Checks that only
wait for cooldowns leave it unchanged. Provider failures remain in the audit and health
evidence while the chip is hidden.

An adapter whose answer has only local clocks or an undated status summary keeps its
evidence while a universal provider dates the timeline. It is asked again 6 h later,
not on every check.

**Rate limits (429).** If the last successful retrieval is recent (under 1 h by day, 3 h
overnight), the parcel keeps its progress and skips fallback until that window or the
retry time runs out. Otherwise the router tries another provider. It never retries the
throttled one early.

## Refresh cadence

Daytime is 08:00–22:00 Europe/Zurich. Overnight, everything is checked hourly.

| Parcels | Daytime |
| --- | --- |
| Out for delivery (direct adapter) | every 2 min |
| Out for delivery, until 30 min before its delivery window opens | every 10 min |
| Other stages (direct adapter) | every 10 min |
| Served by a universal provider, out for delivery too | every 15 min |
| PostNL | every 30 min, also after a failure and out for delivery |
| GLS (DE, CH, FR) | at most hourly, 4 h after a failure, manual refresh included |
| Registered or accepted, no new event for 12 h (from when it was added) | hourly around the clock; manual refresh still allowed |
| No new event for 48 h (from when it was added) | hourly around the clock; manual refresh still allowed |
| Nobody waiting for it | hourly around the clock; manual refresh still allowed |
| Number no carrier or provider has seen (no carrier identified, no history, no input asked) | hourly for 6 h after it was added, then every 6 h, daily after 48 h, around the clock; manual refresh still allowed |
| Archived, with a new event in the last 30 days (from when it was added), and no alert on a link shared with someone | daily around the clock; manual refresh still allowed |

Cooldowns use the persisted `last_synced_at` and `sync_status`, so restarts and repeated
Refresh taps don't bypass them. New or reconfigured parcels are checked at once. A scheduled
run handles at most five due parcels per account, round-robin.

**Someone is waiting** for a parcel while a notification can reach them: its account has
browser or phone notifications or the delivery email on and the parcel is not muted for
them, the account has a Live Activity device, or one of the parcel's links has an alert on.
So is someone who looked lately: for an hour after the account's apps read its parcels
(recorded at most every five minutes) or one of the parcel's links was opened. Any other
open parcel is checked hourly
([`unwatched_package_ids`](../supabase/migrations/20261003180000_unwatched_parcels.sql)).

**Out for delivery**, the news is the delivery. A carrier's own adapter is cheap and as
fresh as the carrier, so a parcel it answers for is checked every 2 minutes whether or not
anyone is looking, unless nobody is waiting for it or the carrier sets a longer interval of
its own. A universal provider has quotas, costs more and lags behind the carrier: its
parcels keep the regular cadence, and the 15 minutes routing waits after each of its
answers, even while someone is looking. A parcel counts as served by a universal provider
while the summary it shows came from one (`tracking_provider` in `carrier_data`).

**A delivery window** the carrier announces, such as `2026-10-08 13:00–15:00`, holds the
2-minute checks back: until 30 minutes before it opens, the regular cadence still catches a
changed slot. Inside the window and after it ends, they resume. The times are read in the
zone the carrier's answer declares (`timezone` in `carrier_data`, the recipient's for Paack),
else in the carrier's catalog zone. A single time, or a
window whose zone is unknown (UTC in the catalog), is not waited for.

**Archived parcels** stay on the schedule until they have gone 30 days without a new
carrier event, so one put away while it waits at a pickup point still shows its collection.
They go through the same scheduled run, routing and cooldowns as the others, and their
checks tell their owner nothing ([ARCHITECTURE.md](ARCHITECTURE.md)). One shared with
someone who turned its link's alerts on keeps its regular cadence, as does one brought back
to the list. Archived or not, a delivered or returned parcel is not checked.

**Parcels followed without an account** are checked only while one of their links was
opened in the last 24 hours or has an alert on. Otherwise a parcel waits until a link is
opened again; that read queues a check at once when the schedule would run one, and never
more often than the schedule, however often the link is polled. One whose number nobody
has seen 6 h after it was added leaves the schedule too; opening a link still queues a
check at its cadence. A scheduled run checks at most ten of them, after every account's
share, the least recently checked first. Their own checks queue behind every account's
refresh and the scheduled run. A delivered or returned one is not checked.

HTTP 429 without `Retry-After` is not retried immediately. Adapters that allow one
transient retry honour a `Retry-After` of up to one minute; longer windows fail the attempt.

**Shadow checks.** Once a day, a scheduled successful universal check may compare one other
provider, rotating through those in the same or a better tier for the carrier. Its result is adopted only if it has strictly newer
timestamped history and doesn't overturn a terminal state. Direct successes and the China
Post 17TRACK route skip shadow checks.

## Scenarios

| Situation | Behaviour |
| --- | --- |
| Wrong carrier selected, right one supported | On failure, try the detected carrier, then a saved confirmed route, then the carriers that recognize the number, then universals. When a universal names a supported carrier, the router asks that carrier's adapter directly. If the adapter refuses the number as one it does not issue (a failed check digit), the router forgets the name. A bare brand ("DPD Group") counts only when the number leaves one of the brand's catalog networks, by shape or a preferred rule such as a DPD depot range. It swaps only after that adapter returns real progress on the same number, at least as recent as what we have. The UI shows "Swapped automatically from X" for 12 h. |
| Carrier needs a postcode or capability URL | Report `carrier_input_required` and continue with universals. Inputs are never borrowed from another carrier. An optional input (DPD's postcode) does not block a lookup; the lookup runs without it. |
| Only one or two universals know the carrier | The carrier's order asks them first, and the one that answers is pinned. No fan-out on normal successful checks. |
| Unknown carrier | Try one strong direct candidate if there is one, then the carriers that recognize the number, otherwise discover a universal. A number's shape stays a suggestion. One carrier explicitly named by universal dated movement can identify an unknown parcel while the universal remains its source. Replacing a selected carrier still needs direct confirmation. Once found, the carrier replaces it without the "Swapped automatically" notice, as it does an unknown postal carrier: no carrier was chosen. |
| A universal returns another parcel | Numbers are reused and carriers' number spaces overlap. For a parcel filed under a specific carrier, a universal history counts as no history when every carrier it names is a different catalog carrier and its newest scan is more than 30 days older than the parcel. The next provider is asked. |
| Everything fails | Keep progress, store the next check time, keep affinity until a replacement works. |
| User switches to a worse carrier | Check the new choice first. If the previously confirmed route still works, restore it with the same notice, using the postcode or link saved with it. Choosing the confirmed carrier again replaces those with what the user entered, so a cleared postcode is not reused. Generation fencing cancels in-flight work. |
| Older or regressing result | Keep the newer or terminal state. A successful response never downgrades status. For a carrier with its own adapter, a fallback provider that answers without progress for a parcel that has some is kept out the same way: the saved summary, timeline and freshness watermark stay, and the parcel shows no error. Without an adapter of its own to ask again, the same answer is an error (`progress_disappeared`). A newer scan that only announces or accepts the parcel, such as a delivery notice, never replaces a later stage (in transit, customs, out for delivery, missed attempt, ready for pickup) unless the router swapped carriers: the summary and timeline still update (`early_stage_regression`). The apps show the scan before such a notice too. A new label after a problem, a return or a delivery starts over. |
| Same number followed more than once (several accounts, or also without one) | A scheduled run asks each carrier, provider or recognition once for what it sends (carrier or provider, number, link, postcode, timezone) and every copy saves the answer for itself. Copies that send the same, with the same country hint, also follow the routing of the copy checked last before the run: which provider answers, cooldowns, the carrier recognised or confirmed for the number and delivery-partner checks. Each keeps its own carrier choice, check streak, freshness watermark and next check. Nothing else of one copy (name, notes, other inputs) reaches another, and a copy whose saved route used inputs it no longer has shares only answers ([`sharedLookups.ts`](../src/server/sharedLookups.ts)). |
| Same scan from several sources | Stored once. A universal copy of a stored scan is not stored: the same instant with the same wording or stage, a source that keeps only minutes, or a zone the provider misread. With no row at the scan's own instant, a row at an instant no other scan of the reply shows matches with the same wording when one of the two is dated to the minute the other falls in, or else when it is a whole number of quarter hours up to 14 h away; against a carrier's scan it may be worded otherwise when it is at least an hour away, its time has seconds other than zero and the stages agree or one is pending. Times to the minute fall whole quarter hours apart too often by chance, and carriers stamp some scans 15 or 30 minutes after another to the second. A carrier's scan takes over, on its own clock, the universal copy stored while its lookup was down. A match across an offset, not just within a minute, records the `provider_clock_offset` anomaly with the check. The scraper's identity policy can also allow a scan to update its one stored row at the same instant, checking the provider code, wording, stage or location as required by that source. Required provider codes distinguish scans sharing an instant when each incoming and stored scan has exactly one matching counterpart. Swiss Post and universal scans can also gain a location there with unchanged wording and stage and unique matches. A policy's `relabelledFrom` names the zone a source once put on every wall clock (India Post's scans abroad, read on India's clock until October 2026): a scan whose wall clock carries another offset takes over the one stored row with its provider code and location whose wall clock in that zone is the same, and back again, whatever the wording. In a handoff's sync the earlier carrier's scans follow that carrier's policy. The row keeps its identity, creation time and notification receipts, so richer details do not announce an old scan again, unless they make it a delivery or pickup readiness the parcel had not shown ([ARCHITECTURE.md](ARCHITECTURE.md#where-things-live)). Undated observations and ambiguous matches are stored separately ([`eventIdentity.ts`](../src/server/eventIdentity.ts)). |

## Carrier recognition

A number whose shape fits several carriers or only the generic postal carrier is checked
with eligible direct carriers ([`carrierDetection.ts`](../src/server/carrierDetection.ts)).
HTTP recognition uses the catalog's `tracking.recognition` and the adapter's `recognize()`.
If no recent carrier is confirmed, the server checks candidates declaring
`tracking.browserRecognition` through `recognizeWithBrowser()`. Definite HTTP misses do
not get a browser retry. Browser confirmation requires dated shipment activity; shells,
undated defaults and old reused numbers cannot identify a carrier. Candidate selection
comes from the scraper's catalog, and the Add sheets show the possible candidates.
While checking, they show a general progress indicator; only the server's answer names
the carriers checked. A failed request does not manufacture a queried-carrier list.

- **Which and in what order.** Matching low-confidence rules that qualify, including
  those hidden by the generic postal detection: the
  carrier a universal named first, then those a `preferred` rule backs (a DPD depot
  range), then networks based in or serving the device or visitor country, then
  optional aggregate priorities for the number's shape and the catalog's
  `recognition.rank`. Country and aggregate hints change query order only; the
  answer's `asked` list identifies the carriers actually checked. At most five are asked
  at once. Aggregate priorities contain no tracking numbers and fall back to catalog order
  when the production evidence is too sparse.
  `CARRIER_RECOGNITION_PRIORITIES_PATH` optionally points to a server-owned aggregate file
  from the scraper's analyzer; it reloads periodically and contains no raw inputs. See the
  scraper's [architecture](https://github.com/plhery/universal-parcel-scraper/blob/main/ARCHITECTURE.md).
- **Settling.** Only an answer for a recent parcel counts; an old parcel can share a reused
  number. Only valid scan instants with explicit offsets establish activity age;
  unresolved local clocks cannot rank a match. One answer wins; with several, the one
  number evidence backs, else the most common network of a single brand
  (GLS Switzerland and GLS Germany answer from one
  overview). Unrelated carriers that all know the number are a choice for the user.
- **In the Add sheet.** The detect route asks once the number is settled (the field loses
  focus, which includes opening the carrier picker, a paste, a shared number), within
  three seconds for HTTP, then up to twenty seconds for browser confirmation. At most two
  browser recognitions run per process, and identical requests share work. Complete answers
  are cached per number and country hint for ten minutes; browser answers and their history for five minutes,
  failures for thirty seconds. Changing the number or leaving the form cancels its request;
  the final cancelled caller also stops shared browser work. The answer lists
  the carriers asked (`asked`) and those that failed or ran out of time (`unanswered`), so
  the sheet can tell "not found yet" from "could not check". With automatic detection a
  single answer selects the carrier, and its required inputs (the GLS postcode) appear
  before saving; for a carrier picked by hand it only points out the one that has the
  parcel. Several answers ask the user to choose. Automatic detection stays a valid
  choice throughout, and the check never holds the Add button.
  When dedicated carriers cannot confirm the number, preflight also asks the fast universal
  providers. Saving continues the full provider chain. Only a newly created parcel's first
  saved check can ask a second batch of unqueried HTTP candidates when the first found
  none. Both batches share the existing HTTP budget; detection and later refreshes ask
  one batch. Reused universal history still takes precedence over speculative confirmation.
  A pasted number continues into that lookup when recognition
  finds no carrier or cannot answer, so the universals can retrieve its history. A typed
  number waits for Track. Multiple carrier matches and missing inputs still require a choice.
- **In routing.** When the filed carrier cannot track the number (no adapter of its own,
  its adapter answered not-found, or an unconfirmed carrier failed and is absent from
  the low-confidence format's candidate list), the router asks
  before the universals, never another network of the filed carrier's brand, for open
  parcels in their first 30 days outside linked journeys. A carrier that knows the number
  and needs no input gets a full correction lookup, adopted only on real progress on the
  same number, at least as recent as what we have (a pre-advice is not enough). Browser
  confirmation follows unresolved HTTP checks and uses the same candidate cooldowns. Fresh
  browser history is consumed once by the correction lookup or the first saved sync, with the
  "Swapped automatically" notice. A carrier that needs the user's input is saved as
  `routing.input_needed`, and the parcel asks the user for it.
  A transient failure of a matching carrier and failures of an already confirmed carrier
  do not trigger recognition.
- **Retries.** Answers are kept in `routing.candidate_probes`, not with the carrier
  failures, so they decide neither the parcel's status, nor the filed carrier's retry, nor
  the health evidence of the check. The next check waits 1, 2, 4, then 6 hours, since a
  parcel appears once it is handed over, and a day after six misses.

## Handoffs (two carriers)

A parcel often changes carrier at the border. The origin history is always kept.

- Adapters can report `delivery_carrier`, `delivery_tracking_number` or an official
  partner link. Names and links are resolved through the carrier catalog.
- With no named partner, a checksum-valid S10 number and a reported destination country can
  propose **one** national-post lookup ([catalog hints](https://github.com/plhery/universal-parcel-scraper/blob/main/core/catalog/hints.ts)).
  The issuer suffix and transit scans never pick the operator.
- The partner is only adopted once its own adapter (no required inputs) returns dated,
  fresh progress. A partner whose only input is optional (DPD's postcode) is asked without
  it, and only with a reference of its own number shape, never the origin's postal number. Failed confirmations wait 55 min unless the origin history or the partner
  changes.
- Until then the parcel is followed on the origin. The cards, parcel links and the delivered email
  already name the partner the origin names (`delivery_carrier`) as who delivers, and the cards and
  links show its number (`delivery_tracking_number`) after the followed one.
- Once adopted (`handed_over_at`), the partner answers for the parcel. The origin publishes
  some scans late, so for a day it is still asked alongside the partner, at most every 55 min
  (`earlier_checked_at`). Its scans join the history; its failures and its clock do not touch
  the parcel's summary or freshness watermark. A scan of the origin's that reaches the parcel
  after a later one announces no push or link alert
  ([`relayCopies.ts`](../src/server/relayCopies.ts)); one newer than everything stored does.
- After the handoff the origin often goes on telling the partner's scans in its own
  words, within a minute of them. Both rows are stored, since the same rule now and then
  pairs two scans of their own. A row of the earlier carrier at the same stage as another
  source's, within 60 s either way, is served with `relay_of`, that row's id (closest pairs
  first, one pair per row). The apps show its words as a line under that row instead of a
  step of its own. Of a pair, the row stored second announces no push or link alert, and
  the delivered email quotes the other one ([`relayCopies.ts`](../src/server/relayCopies.ts)).
- Compatibility: AliExpress `L…CH` numbers keep a Swiss Post confirmation probe, and
  selected Swiss postal routes keep their Cainiao fallback.

## UPU history

UPU times have no reliable zone. Its scans are archived separately (up to 1,000 per
number). Only newly observed milestones enter the visible timeline, stamped at observation
time and flagged as lacking a provider time. UPU can update its own summary but never
proves freshness against another source, and forecasts are ignored. See the
[UPU README](https://github.com/plhery/universal-parcel-scraper/blob/main/providers/upu/README.md).

Universal providers also get the catalog timezone of the parcel's carrier, used only for
scans with no trustworthy zone of their own (ParcelsApp's, and Ship24's offset-less legs).
When that carrier's zone is UTC (Asendia, `unknown`), they get the zone of the carrier a
direct lookup confirmed for the same number instead, if any. The freshness watermark (`last_event_at`) reads
offset-less times in the result's zone, exactly as the stored events are read, and so does
the sync when it checks whether a returned summary is older than the watermark. A universal
copy of a stored scan counts at the stored scan's instant, and a copy a carrier's scan takes
over at that scan's instant. A provider that misread the zone therefore cannot set the
watermark hours ahead and make the carrier's own reply look older.

When a scraper fix changes a stored scan's instant, a data migration repairs its row,
summary and watermark together, preserving its creation time and notification receipts.
A source the fix still reads can instead name the old zone in its identity policy, and its
next sync moves each row in place.

## Direct histories without complete timestamps

Some direct feeds omit scan clocks, offsets or the event year. An adapter may guess a clock
it knows the feed uses, such as PostNL's own records on Amsterdam time. The guess stands
only if it fits between the feed's dated scans and isn't after the lookup
([`settleGuessedClocks`](https://github.com/plhery/universal-parcel-scraper/blob/main/core/time/index.ts)). The router keeps
histories that are still incomplete separately, including return-leg and summary markers.
When the current status has no complete timestamp, it tries providers for dated progress. If
providers cannot help, the direct current status remains available without advancing the
freshness watermark. An unresolved direct lookup cannot displace a carrier already confirmed
by dated progress. A status summary without scans also preserves previously saved direct
history. The sync preserves richer saved progress and records status changes as
observations, keeping observation time distinct from a carrier scan time.

## Tracking links

The link shown in the app follows `tracking_provider` of the result on screen: a 17TRACK,
ParcelsApp or Ship24 result links to that provider with the lookup number. Direct recovery
restores the carrier link. When the carrier's own lookup answered the same check and only its
missing clock sent the result elsewhere, the result is marked `carrier_answered` and the link
stays with the carrier. Postal Ninja and UPU link to their public forms. No deep links are
guessed.

## Shared provider protection

`tracking_provider_health` (service role only) coordinates workers:

- one 90 s lease per universal provider, token-fenced, expiring if a worker crashes;
- 5 s spacing after a healthy call or one without history. A check that finds a provider
  free again within 6 s waits for it (twice at most) when the call still keeps its full
  lookup budget, rather than recording a cooldown and moving on;
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
| `carrier_auto_swapped` | A carrier correction was committed. When detection already names the new carrier for the number, the log line has `category` `detected` and no issue is opened |
| `carrier_mismatch_confirmed` | A carrier that detection does not name for the number tracks the parcel: detection rules could be improved |
| `detected_carrier_confirmed` | The carrier detection names for the number tracks a parcel filed as unknown or under another carrier, such as one added before a detection rule existed (logs and breadcrumbs only) |
| `candidate_probe_confirmed` | Carrier recognition found the carrier and it tracks the parcel (logs and breadcrumbs only) |
| `foreign_history_rejected` | A universal returned an older parcel of another carrier for the number (logs and breadcrumbs only) |
| `carrier_input_needed` | A recognized carrier needs the user's input (the GLS postcode); the parcel asks for it (logs and breadcrumbs only) |
| `direct_support_opportunity` | Candidate for a dedicated adapter |
| `carrier_coverage_discovered` | A provider named a carrier the catalog doesn't know |
| `fresher_provider_found` | A shadow check found newer history at another provider and the parcel moved to it (logs and breadcrumbs only). Evidence to revisit the default order |
| `coverage_contradicted` | A provider disagreed with the carrier's coverage results: `failure_category:history` when one that answered without history has the parcel, `no_history` when one with history does not while another has it (logs and breadcrumbs only). Evidence to rerun the coverage probe |
| `provider_recovered` | Recovery signal (doesn't auto-resolve issues) |

`carrier_coverage_discovered` fires once per parcel, only for names that are neither a
catalog name/alias nor a known network of DHL, DPD, GLS or Hermes. The postal union's feed,
which an aggregator lists as "UPU" beside a parcel's carriers, is not reported either.
Timings and metrics are in [OBSERVABILITY.md](OBSERVABILITY.md).
