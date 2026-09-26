# Carrier coverage by tracking source

Checked in September 2026 with one public reference per carrier. Each reference was
looked up through the carrier's direct adapter and through every universal provider
separately. The first 30 carriers of the [carrier overview](../README.md) are in the
matrix. Results describe these references, not every number from a carrier.

Numbers are history rows after projection. Operators, translations and repeated reports
often describe the same milestone more than once, so read the notes below before
preferring the largest count. A check mark means history was retrieved, not that its
statuses map correctly.

- **✓ n**: matching history with n rows. **Intermittent**: retrieved, but other sessions
  were challenged.
- **No history**: nothing usable for this reference. **Summary only**: a response with
  no rows. **Sign-in**: only an account notice.
- **Error**: request, capture or identity check failed, so coverage is inconclusive.
  **Blocked**: the session was challenged.
- **N/A**: not an S10 number, so UPU is ineligible. **Unverified**: only an illustrative
  example exists.
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

## What the differences mean

Differing clock times are not counted as missing events: several feeds report local wall
times or infer offsets.

By source:

- **Direct adapters** keep actionable rows the aggregators drop or mislabel: La Poste
  pickup-ready, InPost locker-ready, Swiss Post delivery method. Some return local wall
  times with no verified zone (SF Express, Evri International, overseas Japan Post
  scans).
- **Ship24** is sparse for some references: label-only for UPS (a second UPS reference
  was complete), one old row for DPD, and it stops before La Poste's final events. Some
  postal legs come back undated (India Post, Japan Post).
- **ParcelsApp** often has the richest destination leg (DHL eCommerce, Canada Post,
  Japan Post), and was the only aggregator with GLS France and Evri history. It exposes
  internal labels (`swa_rex_*` for Amazon Shipping pickup), shows Amazon sign-in notices
  (excluded from counts), and maps `Final delivery` to pending.
- **17TRACK** gives the best multi-operator journeys, naming each operator: China Post
  plus Correios, Canada Post plus USPS, Japan Post plus Malta Post. It was the only
  aggregator with USPS and SF Express history. It misses some actionable rows (La Poste
  pickup-ready, InPost locker-ready). Its first poll can stay pending, and a second
  bounded call then completes.
- **Postal Ninja** often matches ParcelsApp and had the most rows for La Poste. Many rows
  are undated (PostNL, Australia Post, Japan Post), and some codes stay untranslated
  (`HoldForPickup`).
- **UPU** usually has final delivery only (DHL, China Post, Canada Post, Japan Post). EMS
  is the exception.

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
- **Chronopost, Hermes Germany, Mondial Relay, Poste Italiane, GLS France direct:** the
  public references are old, so the negatives say nothing about current coverage.

Mapping gaps seen in these samples: 17TRACK maps Swiss Post vehicle loading to in
transit; PostNL direct maps out-for-delivery as accepted; EMS export cancellation has no
dedicated stage.

## Other carriers

One public sample each, probed through Ship24, ParcelsApp and 17TRACK. Many samples are
old, so "–" often just means the history expired.

| Carrier | Route | Ship24 | ParcelsApp | 17TRACK |
| --- | --- | --- | --- | --- |
| An Post | universal | ✓ | – | ✓ |
| Blue Dart | universal | – | postcode prompt | – |
| bpost | universal | – | postcode prompt | – |
| BRT | universal | – | – | – |
| Ciblex | dedicated | – | postcode prompt | – |
| Colis Privé | dedicated | – | – | – |
| Correos Express | universal | – | – | – |
| CTT Express | universal | ✓ | ✓ | ✓ |
| CTT Portugal | dedicated | – | ✓ | ✓ |
| Delhivery | universal | – | postcode prompt | – |
| Ecoscooting | universal | – | – | – |
| GEODIS | dedicated | – | postcode prompt | – |
| J&T Express | universal | timeout | postcode prompt | – |
| MRW | universal | – | – | ✓ |
| NACEX | universal | – | – | rejects the `agency/number` format |
| Paack | dedicated | – | – | – |
| Packeta | dedicated | – | – | – |
| Relais Colis | dedicated | – | – | – |
| SEUR | universal | wrong carrier (DPD) | wrong carrier (DPD); SEUR asks for postcode | – |
| SpeedX | universal | – | – | – |
| SunYou | dedicated | – | ✓ | ✓ |
| TIPSA | universal | – | – | – |
| UniUni | universal | – | ✓ | – |
| YunExpress | universal | ✓ | ✓ | ✓ |

## Method

- Each source was called on its own through `UniversalTracker.fetchSource()` (45 s
  budget, UPU 8 s), with no stop at the first success. Dedicated adapters kept their own
  deadlines. Browser lookups ran one at a time, and TRAWL-based sources used the shared
  browser service.
- References are public (customer reports, complaints, documentation examples). Private
  numbers and postcodes were withheld, and no account was signed into.
- One reference per row. Extra references and bounded rechecks only investigated
  failures and are not averaged in.
