# Carrier coverage by tracking source

Live comparison for the first 15 carriers in the [carrier overview](../README.md#carriers),
checked **2026-09-22**. Each row compares the **same reference** across the
carrier's direct adapter and all five universal providers. This is observed
coverage for these samples, not a promise that every number from a carrier works.

**Numbers are usable history rows**, after the existing adapter projection and
manual exclusion of sign-in notices and identified forecasts. Different
operators, translations and repeated updates can describe the same physical
milestone more than once. Read the history notes before choosing the largest count.

- **✓ n:** matching history retrieved, with n rows.
- **None:** no usable history for this reference; this does not establish that
  the entire carrier is unsupported.
- **Error:** a request, browser capture or identity check failed; coverage is
  inconclusive. **Blocked** specifically means a challenged tracking session.
- **Sign-in:** account-access notice, with zero shipment scans.
- **N/A:** the supplied format is not eligible for UPU, which requires a valid
  postal S10 identifier.
- **No adapter / Link only:** no direct implementation to execute in this app.
  “Direct” includes the dedicated adapter's browser recovery where implemented.

## Coverage and history size

| Carrier / reference | Direct | Ship24 | ParcelsApp | 17TRACK | Postal Ninja | UPU |
| --- | --- | --- | --- | --- | --- | --- |
| [DHL](../carriers/dhl/README.md) | Blocked | ✓ 10 | ✓ 14 | None | ✓ 14 | ✓ 1 |
| [UPS](../carriers/ups/README.md) | ✓ 11 | ✓ 1 | ✓ 11 | ✓ 11 | ✓ 11 | N/A |
| [FedEx](../carriers/fedex/README.md) | Error | ✓ 14 | ✓ 14 | ✓ 14 | ✓ 14 | N/A |
| [USPS](../carriers/usps/README.md) | ✓ 11† | None | None | ✓ 11 | None | N/A |
| [Amazon Logistics](../carriers/amazon-logistics/README.md) | Link only | None | Sign-in | None | None | N/A |
| [Amazon Shipping](../carriers/amazon-shipping/README.md) | ✓ 12 | ✓ 12 | ✓ 12 | None | ✓ 12 | N/A |
| [Royal Mail](../carriers/royal-mail/README.md) | Error | None | ✓ 1 | None | ✓ 4 | None |
| [Swiss Post](../carriers/swiss-post/README.md) | ✓ 8 | ✓ 8 | ✓ 8 | ✓ 8 | None | N/A |
| [La Poste / Colissimo](../carriers/la-poste/README.md) | ✓ 15 | ✓ 11 | ✓ 16 | ✓ 14 | ✓ 26 | None |
| [DPD](../carriers/dpd/README.md) | ✓ 4 | ✓ 1 | ✓ 4 | ✓ 4 | ✓ 4 | N/A |
| [DHL eCommerce](../carriers/dhl-ecommerce/README.md) | ✓ 16 | ✓ 11 | ✓ 36 | None | ✓ 34 | N/A |
| [AliExpress / Cainiao](../carriers/aliexpress/README.md) | ✓ 17 | None | ✓ 17 | ✓ 17 | ✓ 17 | N/A |
| [China Post](../carriers/china-post/README.md) | No adapter | ✓ 1 | ✓ 1 | ✓ 39 | ✓ 17 | ✓ 1 |
| [EMS](../carriers/ems/README.md) | ✓ 7 | ✓ 6 | ✓ 18 | ✓ 24 | ✓ 6 | ✓ 6 |
| [SF Express](../carriers/sf-express/carrier.json) | No adapter | None | None | ✓ 27 | None | N/A |

A check mark confirms retrieved history, not correct status mapping; the notes
identify mapping issues.

**† USPS direct recheck:** the corrected timeline parser returned 11 events for
the same domestic reference in a later successful browser session. See the
[USPS follow-up](#usps-follow-up-direct-history-and-operator-attribution).

The initial ParcelsApp failures prompted a [timeout and recovery fix](parcelsapp/README.md#implementation-decisions):
the old direct request stopped after 10 s, and browser recovery could return an
unfinished page. The adapter now allows 30 s initially and one network retry
within 45 s. All four histories were verified after the fix with unchanged event
counts. The matrix preserves the original observations at the commit below.

**17TRACK recheck, 2026-09-22:** all seven previously failing references again
returned no history, so their cells now say **None**. DHL, DHL eCommerce and
the three UK/FR Amazon Shipping references returned a matching shipment code
400 with null history; both TBA references completed with explicit `NotFound`.
A later check of the supplied TBA reference stayed pending and again supplied
no history. The China Post control still returned 39 events. The adapter now recognizes
that matching code-400 response as `no_history`, separately from transport,
verification and unfinished polling failures. This is coverage for the checked
references, not a carrier-wide unsupported verdict.

## What the missing or extra events mean

The comparisons below concern event meanings and coverage of the journey.
Exact clock-time differences are not treated as missing events: several feeds
report local wall times or infer offsets, and international operators can
report the same milestone in different zones.

| Carrier | Useful differences and limits |
| --- | --- |
| DHL | ParcelsApp and Postal Ninja return the same 14 rows, including Swiss destination sorting/forwarding details, repeated customs and delivery reports, and an earlier handoff classified as delivered. Ship24 retains an older electronic-registration event absent from both. UPU has only final delivery, losing the transport, customs and delivery-depot history. The larger counts alone do not establish a better timeline. |
| UPS | Direct, ParcelsApp, 17TRACK and Postal Ninja return the same 11 milestones, including parcel drop-off, access-point preparation, pickup, hub movements, import scan and delivery. Ship24 returns only label creation, missing the actual journey and final delivery. This is a meaningful gap for this reference; the additional public return reference below works fully with Ship24. |
| FedEx | The four general aggregators return the same 14 milestones: registration, pickup, hub movements, requested delivery changes, delivery round and delivery. Differences are wording, timezone conversion and stage mapping, rather than missing scans. The direct capture failed, so completeness against FedEx itself is unverified. |
| USPS | Direct tracking and 17TRACK now return the same 11 domestic milestones: forwarding, facility movements, failed delivery/no access, a redelivery reminder, scheduled redelivery and final delivery. The direct lookup initially hit a challenge; the later successful page exposed a table-only parser bug, now fixed to read timeline cards. Stage mappings differ, and direct preserves a date-only reminder without inventing a clock time. See the follow-up and international reference below. |
| Amazon Logistics | ParcelsApp's apparent event is a request to sign in to Amazon, not parcel progress; it is excluded. No anonymous history was established for the checked retail reference. |
| Amazon Shipping | Direct, Ship24, ParcelsApp and Postal Ninja return the same 12 milestones for the public documentation reference. Direct and Ship24 clearly label availability for pickup and customer collection. ParcelsApp exposes internal `swa_rex_*` labels for those two events; Postal Ninja leaves `HoldForPickup` untranslated. These are interpretation/wording gaps, not fewer scans. |
| Royal Mail | Ninja adds older sender-dispatch and parcel-shop acceptance history to ParcelsApp's delivery-only result, plus two delivery rows. Their reported delivery dates conflict (September 2 versus September 21); more history does not resolve which date is correct. The direct lookup failed. |
| Swiss Post | Direct, Ship24, ParcelsApp and 17TRACK contain the same eight milestones, including loading into the delivery vehicle. Direct retains the delivery-method detail; 17TRACK maps vehicle loading to in-transit rather than out-for-delivery. No missing older or foreign-country leg was found between these successful feeds. |
| La Poste / Colissimo | Ship24 stops before the later failed attempt, pickup availability, delivery preparation and delivery. 17TRACK includes the other later events but omits the actionable **ready-for-pickup** row present directly. ParcelsApp adds customs-payment information and overlapping failed-attempt wording, but also misses that pickup notice. Ninja adds destination-carrier customs-payment/hold and redelivery-preparation details, mixed with overlapping origin/destination reports; it too lacks the explicit pickup notice. Direct and the aggregators contribute different useful information. |
| DPD | Ship24 has only an older out-for-delivery row: it misses acceptance and the later **return-to-sender** and onward movement. Direct, ParcelsApp, 17TRACK and Ninja all return those four milestones. This is a meaningful progress gap, not just verbose depot detail. 17TRACK's stages label the return and subsequent movement as exceptions. |
| DHL eCommerce | Direct has 16 rows and already reports delivered in its summary, but its event list mainly contains linehaul, sack/container and processing scans. Ship24's 11 rows omit some older operational details and the latest movement; its summary still says in transit. ParcelsApp's 36 and Ninja's 34 rows add destination-carrier customs, depot, out-for-delivery and delivery history, with overlapping carrier reports. Both omit some older sack/bag details present directly. ParcelsApp's higher count includes repeated label/delivery wording, so it does not establish two additional physical scans over Ninja. The destination leg is the useful improvement. |
| AliExpress / Cainiao | All four successful sources return the same 18 upstream rows, including one last-mile forecast (shown directly as “Carrier update” at the matching event time). Excluding that forecast leaves **17 scans each**. Both origin and destination legs, customs, delivery round and delivery are present; extra carrier-note wording is not extra history. |
| China Post | 17TRACK supplies 23 China Post and 16 Correios Brazil rows. Ninja supplies mainly the 16-row Brazilian leg plus a repeated final-delivery report, omitting most Chinese sorting, export and airline history. Ship24, ParcelsApp and UPU provide final delivery only: they lose both older transport history and useful customs/payment and out-for-delivery milestones. ParcelsApp misclassifies its final-delivery row as pending; Ninja includes delivery text but its projected summary remains out for delivery. 17TRACK gives the most useful combined history here, with overlapping reports still counted separately. |
| EMS | Direct's seven rows include a new **export cancellation** absent from Ship24's six and 17TRACK's longer history. ParcelsApp includes the cancellation and export-office arrival; its extra rows largely repeat posting, customs and dispatch milestones in different operators' wording. UPU and Ninja contain the cancellation but omit export-office arrival. 17TRACK adds older China Post domestic sorting, security-return and India Post reports, with overlaps; its longest feed is not the freshest. The cancellation text is present but not mapped to a dedicated stage by the current parsers. |
| SF Express | Only 17TRACK returned usable history: 27 rows covering pickup, international flights, customs release, the delivery round and delivery, plus repeated loading/unloading and weighing details. It establishes useful international and last-mile coverage for this reference. Other feeds returned no history and there is no direct adapter, so the count cannot establish completeness against SF Express itself. |

## Additional Amazon references

The three supplied online references were also checked individually. Their
results are separate from the working documentation example in the main matrix,
so an expired or account-only reference cannot determine carrier-wide coverage.

| Carrier / reference | Direct | Ship24 | ParcelsApp | 17TRACK | Postal Ninja | UPU |
| --- | --- | --- | --- | --- | --- | --- |
| `FR3020087832` | Expired | None | None | None | None | N/A |
| `UK3962812222` | Expired | None | None | None | None | N/A |
| `TBA584861749000` | None | None | Sign-in | None | None | N/A |

**Expired** is Amazon’s explicit history-retention response, not an unsupported
carrier verdict. The TBA reference is not found by Amazon’s public Shipping
endpoint; ParcelsApp returns only the account sign-in notice. Its Logistics
versus Shipping subtype cannot be established from the number alone.

The FR and TBA references were supplied as public online examples; their original
source URLs were not supplied. The UK reference also
appears in a [merchant response](https://uk.trustpilot.com/review/simplesciencesupplements.com).

## Additional UPS and international USPS checks

| Carrier / reference | Direct | Ship24 | ParcelsApp | 17TRACK | Postal Ninja | UPU |
| --- | --- | --- | --- | --- | --- | --- |
| UPS public return reference | ✓ 9 | ✓ 9 | ✓ 9 | ✓ 9 | Error | N/A |
| USPS inbound from China | ✓ 13† | Error | ✓ 21 | ✓ 56 | Error | ✓ 8 |

- **UPS:** the public return reference has the same nine milestones in direct,
  Ship24, ParcelsApp and 17TRACK. Ship24’s sparse result in the main row is
  therefore sample-dependent. A third known UPS reference returned no usable
  history from any source.
- **Postal Ninja:** both additional controls ended in a browser capture without
  full history. This is a retrieval failure, not a confirmed no-history response.
- **USPS inbound:** 17TRACK retains **43 China Post + 13 USPS dated rows**. Its
  parser drops four undated upstream rows. ParcelsApp’s 21 rows contain the
  destination delivery sequence plus a shorter postal/export history and
  overlapping delivery reports. The extra 17TRACK rows mostly add **foreign
  origin sorting, airline movements and security-return history**, rather than
  35 extra US delivery scans. UPU’s eight rows retain posting/export/customs
  and final delivery but miss US arrival, domestic depot movement and
  out-for-delivery. The original direct adapter rejected the `…CN` identifier
  locally. After the foreign-number and timeline-parser fixes, direct USPS
  returned the same 13 milestones as 17TRACK's USPS operator group. Its smaller
  count omits China Post's additional 43 rows, not USPS delivery scans.

## USPS follow-up: direct history and operator attribution

Additional checks on **2026-09-22** used three public US-format numbers, without
forcing a carrier in 17TRACK. The table records fresh calls after the timeline
parser repair; the two older 17TRACK lookups needed a second bounded attempt
after their initial polling replies stayed pending.

| Public reference | Direct USPS | 17TRACK | Operator attribution |
| --- | --- | --- | --- |
| `9400130109355440699868` — [August merchant response](https://www.bbb.org/us/wa/vancouver/profile/gold-buyers/gold-to-cash-1296-1000129797/complaints) | ✓ 11, delivered | ✓ 11, delivered | All 11 events: USPS |
| `9589071052702449080343` — [public court record, p. 5](https://www.govinfo.gov/content/pkg/USCOURTS-ilsd-3_25-cv-02196/pdf/USCOURTS-ilsd-3_25-cv-02196-0.pdf) | ✓ 3, in transit | ✓ 3, in transit | All 3 events: USPS |
| `9500113562366007585132` — [same public record, p. 5](https://www.govinfo.gov/content/pkg/USCOURTS-ilsd-3_25-cv-02196/pdf/USCOURTS-ilsd-3_25-cv-02196-0.pdf) | None | None | USPS selected, but no history returned |

The matching 17TRACK responses explicitly identify the operator as **USPS**,
key **21051**, homepage **https://www.usps.com/**. The two positive examples
contain only USPS events, with the same milestone sequences as the direct page.
This establishes 17TRACK's reported operator attribution, rather than inferring
it from the number format. It does not expose how 17TRACK obtains data internally.

The original domestic control also has 11 USPS-attributed 17TRACK events. For
the incoming control, 17TRACK explicitly separates **13 USPS (21051)** events
from **43 China Post (3011)** events. Both operators were retrieved with the
same original number; no replacement tracking number was used.

The direct adapter now reads `.tb-step` cards, including collapsed history.
Its earlier table-only selector missed all events even when the page loaded.
Browser access varied across sessions: the earlier challenges were real, and
the later successful lookups do not guarantee every future session will pass.

## Method and reference provenance

The initial checks used the dedicated adapters at
[`2b8aeed`](https://github.com/plhery/delivery-tracker/tree/2b8aeed3851ebff0a2052032c43be97b8bf72847) and
`UniversalTracker.fetchSource()` for each provider individually; they did not
stop after the first successful fallback. Postal Ninja was included explicitly.
The 17TRACK recheck described above used the same references and lookup budget.
HTTP requests and local Chromium ran locally; adapters requiring TRAWL used the
existing browser service. This is fresh automated retrieval, not a deployed
application-sync test or a website-advertised support list.

Universal calls received a 45-second budget (UPU retains its shorter limit);
dedicated adapters retained their own internal deadlines. Browser lookups were
serialized to limit upstream and browser-service load. An unavailable direct
adapter and an ineligible UPU format were recorded without inventing a network result.
No accounts were signed into. Existing postcode input was supplied where needed.

Counts describe one selected reference per main row. Additional references and
bounded rechecks investigate failures; they are not averaged into the row or
used to claim a reliability percentage. No exact shipment address, recipient
detail, private tracking number or postcode is included here.

| Main row | Reference provenance and scope |
| --- | --- |
| DHL, UPS, FedEx, Swiss Post, La Poste, DPD, DHL eCommerce, Cainiao | Known references; private identifiers and postcode inputs withheld. One chosen reference per carrier, with separate UPS controls as described above. |
| USPS | `70041160000026196575`, a domestic certified-mail reference published in [FCC 26-44](https://docs.fcc.gov/public/attachments/FCC-26-44A1.pdf). |
| Amazon Logistics | `TBA333656997000`, the older public reference in the [tracking-number corpus issue](https://github.com/jkeen/tracking_number_data/issues/2). The additional supplied TBA reference also yielded no anonymous history. |
| Amazon Shipping | `UK4696062386`, published in [Amazon’s Deliver to Counter documentation](https://developer-docs.shipping.amazon.com/apis/docs/tutorial-deliver-to-counter-via-amazon-shipping). The live endpoint returned 12 matching dated rows; the example is not a permanent positive test fixture. |
| Royal Mail | `VU493136052GB`, the [public customer report](https://www.reddit.com/r/royalmail/comments/1w25nnx/if_you_experienced_this_please_reply/) already recorded in the corpus. |
| China Post | `LZ430297212CN`, China-to-Brazil [public shipment report](https://www.chinapostaltracking.com/qa/demora-160174/); a non-EMS postal item. |
| EMS | `EB865157741CN`, China-to-India [public shipment report](https://www.chinapostaltracking.com/qa/package-stuck-export-customskeep-pending-inspection-161051/). |
| SF Express | `SF6047789135544`, the August delivery reference in a [public customer report](https://www.trustpilot.com/review/sf-express.com). |

Additional public controls: UPS `1ZA976V81223109974` from the
[BBB complaint record](https://www.bbb.org/us/ga/atlanta/profile/delivery-service/united-parcel-service-0443-8866/complaints?page=4),
and USPS inbound `LZ464222669CN` from the
[China-to-USA shipment report](https://www.chinapostaltracking.com/qa/wanted-an-update-on-my-package-160844/).
Source pages establish reference provenance; all counts above come from the
fresh adapter calls, not from the reports’ claims.

For routing rationale and earlier dated evidence, see
[provider tradeoffs](COMPARISON.md). This comparison does not itself change
provider order, carrier selection or parser behavior.
