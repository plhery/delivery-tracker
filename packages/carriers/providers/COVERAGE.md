# Carrier coverage by tracking source

Checked in September 2026 with one public reference per carrier. Each reference was
looked up through the carrier's direct adapter and through every universal provider
separately. The first 60 carriers of the [carrier overview](../README.md) are in the
matrix. Results describe these references, not every number from a carrier.

Numbers are history rows after projection. Operators, translations and repeated reports
often describe the same milestone more than once, so read the notes below before
preferring the largest count. A check mark means history was retrieved, not that its
statuses map correctly.

- **✓ n**: matching history with n rows. **Intermittent**: retrieved, but other sessions
  were challenged.
- **No history**: nothing usable for this reference. **Summary only**: a response with
  no rows. **Sign-in**: only an account notice. **Postcode prompt**: only a request for
  the recipient postcode.
- **Error**: request, capture or identity check failed, so coverage is inconclusive.
  **Blocked**: the session was challenged. **Wrong carrier**: history of another
  carrier's parcel with the same number.
- **N/A**: not an S10 number, so UPU is ineligible. **Unverified**: only an illustrative
  or years-old example exists.
- Direct support: **Yes**; **Yes (postcode)** needs the recipient postcode (**Not tested
  (postcode)** when none was public); **Yes (optional postcode)** tracks without it and
  shows more with it; **Link only**; **Disabled** (universal providers are used
  instead); **No adapter**.

## Coverage and history size

| Carrier | Direct support | Direct sample | Ship24 | ParcelsApp | 17TRACK | Postal Ninja | UPU |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [DHL](../carriers/dhl/README.md) | Yes | Blocked | ✓ 10 | ✓ 14 | No history | ✓ 14 | ✓ 1 |
| [UPS](../carriers/ups/README.md) | Yes | ✓ 11 | ✓ 1 | ✓ 11 | ✓ 11 | ✓ 11 | N/A |
| [FedEx](../carriers/fedex/README.md) | Yes | ✓ 14, intermittent | ✓ 14 | ✓ 14 | ✓ 14 | ✓ 14 | N/A |
| [USPS](../carriers/usps/README.md) | Yes | ✓ 11 | No history | No history | ✓ 11 | No history | N/A |
| [Amazon Logistics](../carriers/amazon-logistics/README.md) | Link only | Not tested | No history | Sign-in | No history | No history | N/A |
| [Amazon Shipping](../carriers/amazon-shipping/README.md) | Yes | ✓ 12 | ✓ 12 | ✓ 12 | No history | ✓ 12 | N/A |
| [Royal Mail](../carriers/royal-mail/README.md) | Disabled | Error | No history | ✓ 1 | No history | ✓ 4 | No history |
| [Swiss Post](../carriers/swiss-post/README.md) | Yes | ✓ 8 | ✓ 8 | ✓ 8 | ✓ 8 | No history | N/A |
| [La Poste / Colissimo](../carriers/la-poste/README.md) | Yes | ✓ 15 | ✓ 11 | ✓ 16 | ✓ 14 | ✓ 26 | No history |
| [DPD](../carriers/dpd/README.md) | Yes (optional postcode) | ✓ 4 | ✓ 1 | ✓ 4 | ✓ 4 | ✓ 4 | N/A |
| [DHL eCommerce](../carriers/dhl-ecommerce/README.md) | Yes | ✓ 16 | ✓ 11 | ✓ 36 | No history | ✓ 34 | N/A |
| [AliExpress / Cainiao](../carriers/aliexpress/README.md) | Yes | ✓ 17 | No history | ✓ 17 | ✓ 17 | ✓ 17 | N/A |
| [China Post](../carriers/china-post/README.md) | No adapter | Not tested | ✓ 1 | ✓ 1 | ✓ 39 | ✓ 17 | ✓ 1 |
| [EMS](../carriers/ems/README.md) | Yes | ✓ 7 | ✓ 6 | ✓ 18 | ✓ 24 | ✓ 6 | ✓ 6 |
| [SF Express](../carriers/sf-express/README.md) | Yes | ✓ 22 | No history | No history | ✓ 27 | No history | N/A |
| [GLS Germany](../carriers/gls-de/README.md) | Yes (postcode) | Not tested (postcode) | No history | No history | No history | No history | N/A |
| [GLS France](../carriers/gls-fr/README.md) | Yes | No history | No history | ✓ 4 | No history | No history | N/A |
| [GLS Switzerland](../carriers/gls-ch/README.md) | Yes (postcode) | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| [Hermes Germany](../carriers/hermes-de/README.md) | Yes | No history | No history | No history | No history | No history | N/A |
| [Evri](../carriers/evri/README.md) | Yes (international) | ✓ 20 | No history | ✓ 21 | No history | No history | N/A |
| [Chronopost](../carriers/chronopost/README.md) | Yes (via La Poste) | No history | No history | No history | No history | No history | No history |
| [Mondial Relay](../carriers/mondial-relay/README.md) | Yes (postcode for short numbers) | No history | No history | No history | No history | No history | N/A |
| [InPost](../carriers/inpost/README.md) | Yes | ✓ 9 | ✓ 9 | ✓ 9 | ✓ 8 | No history | N/A |
| [PostNL](../carriers/spring-gds/README.md) | Yes | ✓ 16 | ✓ 16 | No history | No history | ✓ 16 | No history |
| [Canada Post](../carriers/canada-post/README.md) | Yes | Summary only | ✓ 12 | ✓ 11 | ✓ 25 | Error | ✓ 1 |
| [Australia Post](../carriers/australia-post/README.md) | Yes | ✓ 12 | No history | No history | No history | ✓ 12 | N/A |
| [Japan Post](../carriers/japan-post/README.md) | Yes | ✓ 13 | ✓ 13 | ✓ 27 | ✓ 27 | ✓ 28 | ✓ 1 |
| [India Post](../carriers/india-post/README.md) | Yes | ✓ 21 | ✓ 21 | No history | ✓ 21 | No history | No history |
| [Poste Italiane](../carriers/poste-italiane/README.md) | Yes | No history | No history | No history | No history | No history | N/A |
| [Correos Spain](../carriers/correos-spain/README.md) | Yes | ✓ 12 | Error | ✓ 12 | ✓ 12 | No history | N/A |
| [bpost](../carriers/bpost/carrier.json) | No adapter | Not tested | No history | Postcode prompt | No history | No history | N/A |
| [Austrian Post](../carriers/austrian-post/carrier.json) | No adapter | Not tested | ✓ 9 | ✓ 9 | ✓ 9 | ✓ 9 | N/A |
| [PostNord](../carriers/postnord/carrier.json) | No adapter | Not tested | ✓ 6 | ✓ 6 | ✓ 6 | ✓ 7 | No history |
| [TNT](../carriers/tnt/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [Aramex](../carriers/aramex/carrier.json) | No adapter | Not tested | No history | No history | No history | ✓ 16 | N/A |
| [YunExpress](../carriers/yunexpress/carrier.json) | No adapter | Not tested | ✓ 14 | ✓ 15 | ✓ 14 | ✓ 15 | N/A |
| [4PX](../carriers/four-px/carrier.json) | No adapter | Not tested | ✓ 25 | ✓ 26 | ✓ 26 | ✓ 26 | N/A |
| [Yanwen](../carriers/yanwen/carrier.json) | No adapter | Not tested | ✓ 1 | ✓ 29 | ✓ 29 | No history | No history |
| [J&T Express](../carriers/j-and-t/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [JD Logistics](../carriers/jd-logistics/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [ZTO Express](../carriers/zto/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [YTO Express](../carriers/yto/carrier.json) | No adapter | Not tested | Error | ✓ 30 | ✓ 20 | No history | N/A |
| [Yunda Express](../carriers/yunda/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [STO Express](../carriers/sto/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [Yamato Transport](../carriers/yamato/carrier.json) | No adapter | Not tested | Error | Wrong carrier | No history | No history | N/A |
| [Correios Brazil](../carriers/correios-br/carrier.json) | No adapter | Not tested | ✓ 8 | No history | ✓ 8 | ✓ 8 | No history |
| [Singapore Post](../carriers/singapore-post/carrier.json) | No adapter | Not tested | ✓ 4 | ✓ 12 | ✓ 18 | ✓ 11 | ✓ 4 |
| [Hongkong Post](../carriers/hongkong-post/carrier.json) | No adapter | Not tested | ✓ 26 | ✓ 35 | ✓ 17 | ✓ 35 | No history |
| [Korea Post](../carriers/korea-post/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [Planzer](../carriers/planzer/README.md) | Yes | ✓ 4 | No history | No history | No history | No history | N/A |
| [Quickpac](../carriers/quickpac/README.md) | Yes (via Planzer) | No history | No history | No history | No history | No history | N/A |
| [DPD France](../carriers/dpd-fr/README.md) | Yes | ✓ 10 | ✓ 10 | ✓ 5 | No history | No history | N/A |
| [Parcelforce Worldwide](../carriers/parcelforce/carrier.json) | No adapter | Not tested | No history | No history | No history | ✓ 3 | No history |
| [Purolator](../carriers/purolator/carrier.json) | No adapter | Not tested | No history | ✓ 12 | ✓ 12 | No history | N/A |
| [OnTrac](../carriers/ontrac/carrier.json) | No adapter | Not tested | No history | ✓ 14 | No history | ✓ 14 | N/A |
| [Delhivery](../carriers/delhivery/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [Blue Dart](../carriers/blue-dart/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [DTDC](../carriers/dtdc/carrier.json) | No adapter | Not tested | No history | ✓ 35 | No history | No history | N/A |
| [Ninja Van](../carriers/ninja-van/carrier.json) | No adapter | Not tested | No history | No history | No history | No history | N/A |
| [Packeta](../carriers/packeta/README.md) | Yes | No history | No history | No history | No history | No history | N/A |

## What the differences mean

Differing clock times are not counted as missing events: several feeds report local wall
times or infer offsets.

By source:

- **Direct adapters** keep actionable rows the aggregators drop or mislabel: La Poste
  pickup-ready, InPost locker-ready, Swiss Post delivery method. Some return local wall
  times with no verified zone (SF Express, Evri International, overseas Japan Post
  scans).
- **Ship24** is sparse for some references: label-only for UPS (a second UPS reference
  was complete), one old row for DPD, one row for Yanwen, and it stops before La Poste's
  final events. It had nothing for OnTrac, Purolator, Parcelforce or the Indian
  carriers, and its browser recovery timed out twice for Yamato and YTO. Some histories
  come back undated (India Post, Japan Post, Austrian Post, PostNord, DPD France).
- **ParcelsApp** often has the richest destination leg (DHL eCommerce, Canada Post,
  Japan Post), and was the only aggregator with GLS France, Evri and DTDC history. It
  exposes internal labels (`swa_rex_*` for Amazon Shipping pickup), shows Amazon sign-in
  notices (excluded from counts), and maps `Final delivery` to pending. It asks for a
  postcode for bpost's 24-digit numbers and answered a Yamato number with a FedEx parcel.
- **17TRACK** gives the best multi-operator journeys, naming each operator: China Post
  plus Correios, Canada Post plus USPS, Japan Post plus Malta Post, Singapore Post plus
  China Post. It was the only aggregator with USPS and SF Express history. It misses some
  actionable rows (La Poste pickup-ready, InPost locker-ready) and had nothing for OnTrac,
  DTDC or DPD France. Its first poll can stay pending, and a second bounded call then
  completes. Chinese domestic scans can carry courier names and phone numbers.
- **Postal Ninja** often matches ParcelsApp and had the most rows for La Poste. It was the
  only source with Parcelforce rows and with a domestic Aramex delivery. Many rows are
  undated (PostNL, Australia Post, Japan Post), some codes stay untranslated
  (`HoldForPickup`), and it refuses Purolator, DTDC and JD formats.
- **UPU** usually has final delivery only (DHL, China Post, Canada Post, Japan Post). EMS
  is the exception, and Singapore Post's four exchange-office scans match Ship24's.

By carrier:

- **Amazon:** TBA (Logistics) numbers have no anonymous history anywhere; Amazon requires
  sign-in. Amazon Shipping works directly and through most aggregators. Amazon's
  "Expired" reply is its retention limit, not an unsupported number. A TBA number alone
  does not say whether it is Logistics or Shipping.
- **USPS:** 17TRACK names the operator (USPS, key 21051) and matches the direct adapter
  milestone for milestone. For inbound China Post items it separates the China Post and
  USPS legs under the same number, with no replacement number.
- **China Post, Canada Post, DHL eCommerce:** the extra rows are the foreign or
  destination leg, which is the useful part. The rest are overlapping reports.
- **Royal Mail:** sources disagree on the delivery date, and more rows do not settle it.
- **Correos Spain:** all three successful feeds hold the same 12 scans. The direct adapter
  and 17TRACK surface the final one (pickup window expired, parcel going back); ParcelsApp
  still says in transit.
- **GLS Germany, GLS Switzerland, short Mondial Relay numbers:** direct history needs the
  recipient postcode, which no public reference had.
- **Chronopost, Hermes Germany, Mondial Relay, Poste Italiane, GLS France direct,
  Quickpac, Packeta:** the public references are old, so the negatives say nothing about
  current coverage.
- **bpost, Korea Post:** domestic numbers (bpost's 24 digits, Korea Post's 13) had no
  history anywhere. S10 items did: a bpost `LD…BE` item through Landmark Global had 20
  rows in ParcelsApp and 14 in 17TRACK, and a Korea Post EMS item had 15 to 43 in every
  feed but Postal Ninja.
- **J&T Express, Delhivery, Blue Dart, TNT:** no aggregator had history for any of two or
  three recent references each (J&T in the Philippines and Indonesia, TNT France's
  16-digit numbers). Ninja Van's newest public numbers, from February and April, had
  none either.
- **JD Logistics, ZTO, Yunda, STO:** public posts mask Chinese domestic numbers, so only
  2015 examples were available. YTO's one public number had 30 English rows in
  ParcelsApp, all but the pickup left pending, and 20 Chinese rows in 17TRACK, including
  the return.
- **Aramex:** a domestic delivery in the UAE had 16 undated rows in Postal Ninja only. An
  international shipment had the same 26 rows in Ship24, 17TRACK and Postal Ninja, and
  none in ParcelsApp.
- **Planzer:** the direct adapter reads the `reference.shipment` numbers Planzer prints,
  stored with or without the dot, and returns 4 to 6 rows for the three public
  references. No aggregator knows Planzer.
- **Yamato:** ParcelsApp answered with a January FedEx parcel that shares the 12 digits
  (it reported FedEx and GLS), not the July Yamato parcel. Nothing else had history.
- **DPD France:** direct and Ship24 return the same 10 rows, direct with depots and
  times. ParcelsApp condenses them into 5.
- **Hongkong Post:** for an AliExpress item, Ship24, ParcelsApp and Postal Ninja include
  the Cainiao origin leg (26 to 35 rows); 17TRACK keeps the two postal legs (17).
- **Singapore Post:** for an item to China, 17TRACK adds China Post's leg in Chinese;
  Ship24 and UPU have only the four exchange-office scans.
- **PostNord, 4PX, Austrian Post, Correios Brazil:** the successful feeds hold the same
  scans, give or take one. Postal Ninja adds a "last day to pickup" row after PostNord's
  delivery.
- **Parcelforce:** only Postal Ninja had rows (booking and collection).

Mapping gaps seen in these samples: 17TRACK maps Swiss Post vehicle loading to in
transit; PostNL direct maps out-for-delivery as accepted; EMS export cancellation has no
dedicated stage. The shared wording leaves many failed delivery attempts pending
(Aramex, Purolator, Yanwen's Italian leg, Japan Post's "Absence. Attempted delivery."),
maps OnTrac's "business closed" attempts to in transit, and leaves Aramex's delivery
round pending while its "new delivery instructions" row reads as out for delivery.
Shipper pre-advice (PostNord), unhanded labels (Aramex) and Austrian Post's handover to
a delivery partner map to accepted.

Detection selects or suggests the named carrier for the public numbers behind rows
31–60, except Planzer composites, which stay undetected on purpose (see the
[Planzer README](../carriers/planzer/README.md)). DTDC's `Z` numbers share Packeta's shape
and stay with Packeta. Each answer is recorded in the carrier's `numbers.json`.

## Other carriers

Carriers beyond the first 60, one public sample each, probed through Ship24, ParcelsApp
and 17TRACK. Many samples are old, so "–" often just means the history expired.

| Carrier | Route | Ship24 | ParcelsApp | 17TRACK |
| --- | --- | --- | --- | --- |
| An Post | universal | ✓ | – | ✓ |
| BRT | universal | – | – | – |
| Ciblex | dedicated | – | postcode prompt | – |
| Colis Privé | dedicated | – | – | – |
| Correos Express | universal | – | – | – |
| CTT Express | universal | ✓ | ✓ | ✓ |
| CTT Portugal | dedicated | – | ✓ | ✓ |
| Ecoscooting | universal | – | – | – |
| GEODIS | dedicated | – | postcode prompt | – |
| MRW | universal | – | – | ✓ |
| NACEX | universal | – | – | rejects the `agency/number` format |
| Paack | dedicated | – | – | – |
| Relais Colis | dedicated | – | – | – |
| SEUR | universal | wrong carrier (DPD) | wrong carrier (DPD); SEUR asks for postcode | – |
| SpeedX | universal | – | – | – |
| SunYou | dedicated | – | ✓ | ✓ |
| TIPSA | universal | – | – | – |
| UniUni | universal | – | ✓ | – |

## Method

- Each source was called on its own through `UniversalTracker.fetchSource()` (45 s
  budget, UPU 8 s), with no stop at the first success. Dedicated adapters kept their own
  deadlines. Browser lookups ran one at a time, and TRAWL-based sources used the shared
  browser service.
- References are public (customer reports, complaints, documentation examples). Private
  numbers and postcodes were withheld, and no account was signed into.
- One reference per row. Extra references and bounded rechecks only investigated
  failures and are not averaged in.
- Rows 31–60 each use the newest public post
  found that ties a number to the carrier (Trustpilot reviews, complaint letters, Q&A
  threads, shop pull requests), skipping pages that print the author's contact details.
  The numbers and their sources are in each carrier's `numbers.json`.
- For those rows, a first-call timeout, pending 17TRACK poll or Postal Ninja capture
  failure got one bounded recheck, and the cell shows the recheck. Every all-negative row
  got one or two more recent references; the notes say where they differed.
