# Provider tradeoffs and evidence

For the current carrier-by-carrier results, see the
[coverage and history comparison](COVERAGE.md).

Runtime policy lives in [tracking routing](../../../docs/tracking-routing.md).
Protocol details belong in each provider folder; this page records why the
providers have different roles. The default is **dedicated carrier → Ship24 →
ParcelsApp → 17TRACK → UPU for checksum-valid postal S10 numbers**. A working
richer universal retains affinity. UPU always stays last, including later
refreshes and discovery rotation. Postal Ninja is opt-in before 17TRACK. The
validated China Post `C…CN`/`L…CN` families now try 17TRACK first; see the
[scoped decision](#china-post-specific-recommendation).

| Source | Why use it | Limits and cost | Role |
| --- | --- | --- | --- |
| Dedicated carrier | Direct identity and carrier-specific detail; can confirm the local delivery partner | Coverage and anti-bot protections differ by carrier; some require a postcode or capability URL | First when available |
| [Ship24](ship24/README.md) | Fast signed anonymous HTTP path; broad coverage and useful carrier hints | Website protocol can change; browser recovery costs more; local/UTC timestamp semantics vary by carrier leg | First universal; retain successful affinity |
| [ParcelsApp](parcelsapp/README.md) | Often fuller history; anonymous direct API accepts a supplied delivery postcode | Queued lookups/polling can be slow; TRAWL recovery; duplicate or translated scans; the forecast-row issue below remains open | Second universal; retain successful affinity |
| [17TRACK](seventeentrack/README.md) | Broad aggregator coverage and structured captured history | Browser service/compatibility build and verification add latency and operational dependencies | First for validated China Post C/L families; otherwise after direct HTTP providers |
| [Postal Ninja](postal-ninja/README.md) | Alternative aggregator with verified TRAWL retrieval of normal-page history | Browser verification and latency; local Chromium remains compact-only; direct HTTP remains challenged | Opt-in before 17TRACK |
| [UPU](upu/README.md) | Official documented anonymous API; one cheap GET, no website CAPTCHA | Postal-only eligibility; sparse, sometimes stale histories; uncertain timezone semantics; no established quota/SLA | Final fallback; never sticky or a shadow replacement |
| [EMS Cooperative](../carriers/ems/README.md) | Official express-post route; the checked EMS reference had a scan missing from UPU | Express postal services, not all ordinary China Post; its own website/session protections | Service-specific source, not a universal replacement |
| [China Post website](../carriers/china-post/README.md) | Operator's own tracking site | Ordered Chinese-character click CAPTCHA; no verified unattended route from that form | Keep separate from EMS and UPU API coverage |

A successful lookup does not prove unrestricted API access, complete history,
or reliable timestamps. Website CAPTCHA and API access are separate findings.
Provider protocols, access requirements, dated deployment evidence and prior-art
licenses are linked above rather than duplicated here.

## Comparison with existing providers

On 2026-09-21, eight public references were queried through UPU, the existing
Ship24 HTTP client/parser and the existing ParcelsApp HTTP client/parser.
The synthetic control in the [UPU protocol notes](upu/README.md) was also queried through UPU and Ship24. No browser
recovery or 17TRACK comparison was run. All requests ran locally; negative
responses and timeouts are not evidence of permanent carrier-wide exclusion.

The counts below are history entries after the existing provider projection,
with identified delivery estimates excluded. Aggregators can repeat the same
milestone in different wording or languages, so entry counts are not counts
of distinct physical scans.

| Public reference | UPU | Ship24 | ParcelsApp |
| --- | --- | --- | --- |
| China Post EMS, China → India | 5 entries | 6 entries | 17 entries |
| Ordinary China Post, China → Brazil | 1 delivery entry | 1 delivery entry | 10-second transport timeout |
| PostNL-issued item delivered by Posti, Netherlands → Finland | 1 delivery entry | 21 entries | 52 entries |
| French postal item, France → China | 7 entries; latest actual milestone August 5 | 19 entries; newer milestone August 6 | 10-second transport timeout |
| DHL postal item, `CG…DE` | Empty body | 18 entries, delivered | 18 entries, delivered |
| Royal Mail public reference, `VU…GB` | Empty body | HTTP 404 | 1 delivery entry |
| Royal Mail public reference, `GV…GB` | Empty body | HTTP 404 | 10-second transport timeout |
| DPD numeric reference | Empty body | HTTP 404 | 5 entries |

UPU returned usable history for four of eight references. Ship24 returned
history for five, and ParcelsApp for five; all four UPU successes also succeeded
on Ship24. The synthetic control returned an empty UPU body and Ship24 HTTP 404.
This small purposive set is not a population coverage or reliability estimate.

UPU took 20–84 ms (median 25 ms) across the eight references in one pass with
connection reuse. Ship24 took 116–2,023 ms (median 276 ms); successful ParcelsApp
requests took 187–9,133 ms, with three others reaching their 10-second transport
deadline. Timings exclude module startup; the adapter lookups also include
parsing. These figures include different amounts of upstream work and do not
establish production p95.

Sources beyond the two China Post reports in the [UPU protocol notes](upu/README.md):

- [Posti CLI's published example](https://github.com/hatlabs/posti-cli), also
  recorded in the Posti corpus. A fresh call through the local Posti adapter
  independently returned 18 entries and a delivered status in 619 ms.
- [French postal report](https://www.chinapostaltracking.com/qa/delivery-ew176267205fr-from-france-160586/).
- [DHL public report source](https://fr.trustpilot.com/review/www.dhl.fr), recorded
  in the [DHL corpus](../carriers/dhl/numbers.json).
- Royal Mail reports [one](https://www.reddit.com/r/royalmail/comments/1w25nnx/if_you_experienced_this_please_reply/)
  and [two](https://www.reddit.com/r/Sugargoo/comments/1we8q17/where_is_my_parcel/),
  recorded in the [Royal Mail corpus](../carriers/royal-mail/numbers.json).
- [DPD public report source](https://www.paketda.de/fragen-antworten.php), recorded
  in the [DPD corpus](../carriers/dpd/numbers.json).

Two comparisons materially affect integration:

- **Freshness:** the French reference's final actual UPU entry was customs
  release on August 5. Ship24 additionally showed departure from the import
  office and arrival at a post office on August 6. Returning immediately after
  UPU success would suppress newer progress, not only older history.
- **Timezone:** the Finnish delivery's UPU WCF timestamp encodes 14:42 UTC with
  a `+0200` suffix, while Posti's own event is 13:42:18 UTC on the same day.
  Both correspond to a displayed 16:42 when using their respective offsets.
  This suggests UPU encoded local wall time using a server offset; it does not
  establish the rule for all UPU events. Preserve that uncertainty before
  using its timestamps for cross-provider freshness. Ship24 also renders that
  delivery at 16:42 UTC; provider agreement alone is not timezone verification.

The comparison also exposed one `Estimated delivery` row in ParcelsApp's China
EMS history. Its current projection includes that row in `events` and
`last_update`. It was excluded from the counts above; no runtime parser change
was made as part of this investigation.


## China Post non-EMS follow-up

A narrower local comparison on 2026-09-21 used three publicly reported,
checksum-valid China-issued postal identifiers, excluding `E…CN` EMS items.
The [UPU S10 service table, section 5.6](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf)
distinguishes `L` tracked letter post and `C` parcel post from `E` EMS. Here,
"non-EMS" does not mean the untracked ordinary small-packet service.

| Reference | UPU actual scans | Ship24 direct result | ParcelsApp direct result |
| --- | --- | --- | --- |
| `LZ…CN`, China → Brazil, delivered | 1, final delivery August 25 | Same one scan; courier name `UPU` | Same final-delivery wording, but our parser incorrectly classifies it as pending |
| `CY…CN`, China → Venezuela, in transit | 4; latest export-office departure June 30 | Same four scans; courier name `UPU` | 10-second transport timeout |
| `LZ…CN`, China → USA, delivered | 8; latest final delivery September 17 | Matching shipment metadata but no `events` array, including one later bounded recheck; rejected by our parser | 10-second transport timeout |

These are fresh direct lookups through the existing adapters/HTTP clients, not
browser recovery or a 17TRACK comparison. Ship24's declared source and matching
events support an inference that it is relaying UPU for the first two references;
they do not prove all non-EMS China Post history comes from UPU.

The [Brazil report](https://www.chinapostaltracking.com/qa/demora-160174/),
[Venezuela report](https://www.chinapostaltracking.com/es/) and
[USA report](https://www.chinapostaltracking.com/qa/wanted-an-update-on-my-package-160844/)
provide the public reference provenance. They also contain earlier reported
China Post movement beyond UPU's returned milestones. These are third-party
reports, not independently verified operator histories. Raw lookups and live
identifiers remain outside the repository. The two entries in China Post's
`numbers.json` remain SDK examples, not positive live controls.

UPU's verified codes give clean acceptance/customs/release/delivery meanings,
and avoid the observed ParcelsApp `Final delivery` classification error. Clean
structure does not establish completeness or reliable UTC times: the Brazil
snapshot has only delivery, and the USA snapshot jumps from export/customs
milestones to delivery without destination arrival or delivery-round scans.
Timezone uncertainty remains for these non-EMS results as well. Registered
`R` mail, untracked `U` mail and other China Post formats were not covered by
this follow-up; three examples are not a coverage benchmark.

### Manual China Post website baseline

In a follow-up to these API checks, the user inspected the same three references
on the [official China Post tracker](https://www.ems.com.cn/queryList). Each
unauthenticated result displayed exactly the two latest events and asked for
login to see more. This is user-observed website evidence, not an automated
capture. No authenticated history was inspected, and the total history count
is unknown. A two-row public preview must not be treated as a complete history
or compared directly with the API's total row count as a completeness score.

| Reference | Latest two events visible on China Post, as reported by the user | Comparison with the captured UPU history |
| --- | --- | --- |
| `LZ…CN`, USA | Out for delivery; delivered | UPU's eight scans include final delivery on September 17, but not out for delivery. Its additional rows are earlier milestones, not evidence of a more complete history. |
| `CY…CN`, Venezuela | Received by airline; flight arrival | Neither event is in UPU's four scans. Its latest scan remains export-office departure on June 30. The broad in-transit state agrees, but UPU omits the latest transport progress. |
| `LZ…CN`, Brazil | Out for delivery; delivered | UPU's one scan is final delivery on August 25 (`EMI`). The missing preview event is out for delivery. |

The user did not supply the website events' timestamps. Do not infer exact
timestamp agreement, a time lag, or authenticated-history completeness from
these observations. The latest broad states agree for all three references;
the latest detailed milestones do not all agree. The Venezuela gap matters
while a parcel is active, and both delivered examples omit the delivery-round
event that could have been useful before completion.

### 17TRACK widget follow-up

A subsequent Chrome check on 2026-09-21 followed ChinaPostalTracking's
[embedded 17TRACK flow](../carriers/china-post/README.md#chinapostaltracking-embeds-17track).
The same three public references returned matching identities and completed
JSON histories from `t.17track.net/track/restapi`:

| Reference | Origin leg | Destination leg | Additional evidence versus UPU |
| --- | --- | --- | --- |
| China → Venezuela | China Post: 15 rows | None; destination shown as unknown | Airline receipt and flight arrival on July 5, matching the meanings in the user's two-event China Post preview. UPU has four export/posting scans. |
| China → Brazil | China Post: 23 rows | Correios Brazil: 16 rows | Both legs include out-for-delivery and delivery, plus earlier history; UPU has delivery only. |
| China → USA | China Post: 43 rows | USPS: 17 rows | Both legs include out-for-delivery and delivery; UPU has eight scans and omits out-for-delivery. |

These are raw per-leg counts, not deduplicated events. The two operators can
describe the same milestone. All three `misc_info.local_number` values were
null; no replacement identifier was needed for the displayed destination legs.
The synthetic checksum-valid `LZ000000005CN` first returned shipment code 100
(polling), then code 200 with `NotFound` and no events. This control distinguishes
completed negative results from intermediate replies.

The widget investigation exposed parser defects: null `stage` plus populated
`sub_status` made the Venezuela scans pending, and four undated US rows caused
the whole dated history to be rejected. Both were fixed in the 2026-09-22
follow-up. The widget's overall `Expired` label is not evidence of a lost parcel.
For the USA sample, China Post and USPS report the same delivery wall time but
attach `+08:00` and `-07:00` respectively. The adapter now preserves the reporting
operator, original offset timestamp and whether the offset was inferred.
It still uses 17TRACK's converted UTC for the dated timeline: provenance alone
does not fix timezone estimates or remove overlapping carrier scans. The
[17TRACK notes](seventeentrack/README.md#china-post-widget-investigation) and
[localization proposal](../../../docs/tracking-localization.md) record the
remaining time-confidence and translation work.

### China Post-specific recommendation

**Implemented 2026-09-22: prefer 17TRACK for checksum-valid non-EMS `L…CN` and
`C…CN` references.** This supersedes the earlier UPU-first status/enrichment
proposal. After repairing the parser, fresh calls through the actual adapter
and existing deployed browser service returned:

| Reference | Adapter result | Dated rows | Duration |
| --- | --- | --- | --- |
| China → Brazil | Delivered | 39 | 3.3 s |
| China → Venezuela | In transit | 15 | 2.8 s |
| China → USA | Delivered | 56; four undated rows omitted | 2.7 s |
| Synthetic unknown | Typed not-found, no history | 0 | 2.0 s |

All positive replies echoed the requested number. These are individual samples,
not latency percentiles or a reliability guarantee; counts include overlapping
origin/destination reports. This was local application code using the deployed
browser service, not verification of a deployed application sync. No new
browser entry point, wrapper scraper or provisioned API account was needed.

17TRACK provides the richer history and latest milestones at a modest observed
browser cost. It now precedes saved fallback affinity and discovery rotation
for these number families. A challenge, timeout, not-found or cooldown keeps
the other providers available; after cooldown expires, a saved sparse fallback
must not permanently suppress 17TRACK. A successful scoped 17TRACK lookup skips
scheduled shadow comparisons. UPU stays last, with its independent low-cost
postal recovery and existing history-preservation guards.

Dedicated carriers still precede universals, including selected EMS and confirmed
destination routes. Untested formats and `E…CN` numbers retain ordinary discovery;
a China Post label alone is insufficient to enable this preference. English
page settings do not translate arbitrary scan text: mapped stages use the app's
existing localized headings, while the original descriptions remain available.

The comparison supports choosing this feed now; it does not establish complete
login-only China Post history, exact UTC accuracy, broader non-EMS coverage or
longitudinal update cadence. Revisit the scoped preference if service access or
comparative freshness changes.

## Why UPU stays last

UPU's fast success can hide newer or fuller data under first-success-wins
routing. Four UPU successes in this small comparison added no coverage over
Ship24, but offer independent recovery when another provider fails. There is
not enough evidence to make UPU first for every postal operator. The narrower
China Post 17TRACK preference above does not change that conclusion. Never promote UPU
globally ahead of richer sources merely because it answered during their outage.

Existing timestamped events are upserted, not replaced by a shorter history.
UPU local-time scans are additionally accumulated in a bounded archive; the
visible timeline records newly observed current milestones, using observation
time rather than inventing scan instants. Missing earlier scans cannot be
recovered by polling. No changing active UPU shipment has yet been followed
longitudinally; these samples prove snapshots, not update cadence or retention.
See [UPU persistence details](upu/README.md#history-and-time) for the exact limit.
