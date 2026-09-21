# Provider tradeoffs and evidence

Runtime policy lives in [tracking routing](../../../docs/tracking-routing.md).
Protocol details belong in each provider folder; this page records why the
providers have different roles. The default is **dedicated carrier → Ship24 →
ParcelsApp → 17TRACK → UPU for checksum-valid postal S10 numbers**. A working
richer universal retains affinity. UPU always stays last, including later
refreshes and discovery rotation. Postal Ninja is opt-in before 17TRACK.

| Source | Why use it | Limits and cost | Role |
| --- | --- | --- | --- |
| Dedicated carrier | Direct identity and carrier-specific detail; can confirm the local delivery partner | Coverage and anti-bot protections differ by carrier; some require a postcode or capability URL | First when available |
| [Ship24](ship24/README.md) | Fast signed anonymous HTTP path; broad coverage and useful carrier hints | Website protocol can change; browser recovery costs more; local/UTC timestamp semantics vary by carrier leg | First universal; retain successful affinity |
| [ParcelsApp](parcelsapp/README.md) | Often fuller history; anonymous direct API accepts a supplied delivery postcode | Queued lookups/polling can be slow; TRAWL recovery; duplicate or translated scans; the forecast-row issue below remains open | Second universal; retain successful affinity |
| [17TRACK](seventeentrack/README.md) | Broad aggregator coverage and structured captured history | Browser service/compatibility build and verification add latency and operational dependencies | After direct HTTP providers; retain successful affinity |
| [Postal Ninja](postal-ninja/README.md) | Alternative aggregator with dated successful browser evidence | Interactive verification, local Chromium; signed direct protocol remains unverified | Opt-in before 17TRACK |
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

This is evidence for considering a **China Post-specific UPU-first status
lookup with periodic richer-provider enrichment**, not for replacing the
current chain with first-success-and-stop. An initial UPU success under today's
router would prevent enrichment, and its conservative persistence policy
cannot prove freshness over a saved richer summary. Those policies must be
addressed together before promotion. Restrict any future exception by service
class as well as carrier: selecting EMS is separate, but bare `E…CN` detection
still retains China Post. Runtime routing remains unchanged by this follow-up.

## Why UPU stays last

UPU's fast success can hide newer or fuller data under first-success-wins
routing. Four UPU successes in this small comparison added no coverage over
Ship24, but offer independent recovery when another provider fails. There is
not enough evidence for UPU-first plus background enrichment. Never promote it
ahead of richer sources because it answered during their outage.

Existing timestamped events are upserted, not replaced by a shorter history.
UPU local-time scans are additionally accumulated in a bounded archive; the
visible timeline records newly observed current milestones, using observation
time rather than inventing scan instants. Missing earlier scans cannot be
recovered by polling. No changing active UPU shipment has yet been followed
longitudinally; these samples prove snapshots, not update cadence or retention.
See [UPU persistence details](upu/README.md#history-and-time) for the exact limit.
