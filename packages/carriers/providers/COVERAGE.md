# Carrier coverage by tracking source

The first 100 carriers of the [carrier overview](../README.md) are compared using public
references, with each tracking source called separately. Results describe those
references, not every number from a carrier. Alternate direct samples are labelled when
the comparison reference is unavailable or outside the adapter's scope.

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
  (postcode)** when none was public); **Yes (tracking link)** needs the full link the
  carrier sent (**Not tested (link)** likewise); **Yes (optional postcode)** tracks
  without it and shows more with it; **Link only**; **Disabled** (universal providers
  are used instead); **No adapter**.

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
| [China Post](../carriers/china-post/README.md) | No adapter | Blocked | ✓ 1 | ✓ 1 | ✓ 39 | ✓ 17 | ✓ 1 |
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
| [Canada Post](../carriers/canada-post/README.md) | Yes | No history; alternate ✓ 11 | ✓ 12 | ✓ 11 | ✓ 25 | Error | ✓ 1 |
| [Australia Post](../carriers/australia-post/README.md) | Yes | ✓ 12 | No history | No history | No history | ✓ 12 | N/A |
| [Japan Post](../carriers/japan-post/README.md) | Yes | ✓ 13 | ✓ 13 | ✓ 27 | ✓ 27 | ✓ 28 | ✓ 1 |
| [India Post](../carriers/india-post/README.md) | Yes | ✓ 21 | ✓ 21 | No history | ✓ 21 | No history | No history |
| [Poste Italiane](../carriers/poste-italiane/README.md) | Yes | No history | No history | No history | No history | No history | N/A |
| [Correos Spain](../carriers/correos-spain/README.md) | Yes | ✓ 12 | Error | ✓ 12 | ✓ 12 | No history | N/A |
| [bpost](../carriers/bpost/README.md) | Yes | No history; alternate ✓ 11 | No history | Postcode prompt | No history | No history | N/A |
| [Austrian Post](../carriers/austrian-post/README.md) | Yes | ✓ 9 | ✓ 9 | ✓ 9 | ✓ 9 | ✓ 9 | N/A |
| [PostNord](../carriers/postnord/README.md) | Yes | ✓ 6 | ✓ 6 | ✓ 6 | ✓ 6 | ✓ 7 | No history |
| [TNT](../carriers/tnt/README.md) | Yes | No history; alternate ✓ 1 | No history | No history | No history | No history | N/A |
| [Aramex](../carriers/aramex/README.md) | Yes | No history; alternate ✓ 26 | No history | No history | No history | ✓ 16 | N/A |
| [YunExpress](../carriers/yunexpress/README.md) | Yes (browser) | ✓ 23 | ✓ 14 | ✓ 15 | ✓ 14 | ✓ 15 | N/A |
| [4PX](../carriers/four-px/README.md) | Yes | ✓ 26 | ✓ 25 | ✓ 26 | ✓ 26 | ✓ 26 | N/A |
| [Yanwen](../carriers/yanwen/README.md) | Yes | ✓ 29 | ✓ 1 | ✓ 29 | ✓ 29 | No history | No history |
| [J&T Express](../carriers/j-and-t/carrier.json) | No adapter | Blocked (Philippines) | No history | No history | No history | No history | N/A |
| [JD Logistics](../carriers/jd-logistics/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [ZTO Express](../carriers/zto/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [YTO Express](../carriers/yto/README.md) | Yes (China domestic) | ✓ 30 | Error | ✓ 30 | ✓ 20 | No history | N/A |
| [Yunda Express](../carriers/yunda/README.md) | Yes (China domestic) | Unverified; alternate ✓ 2 | Unverified | Unverified | Unverified | Unverified | N/A |
| [STO Express](../carriers/sto/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [Yamato Transport](../carriers/yamato/README.md) | Yes | ✓ 7 (yearless dates) | Error | Wrong carrier | No history | No history | N/A |
| [Correios Brazil](../carriers/correios-br/README.md) | Yes (local OCR) | No history; alternate ✓ 14 | ✓ 8 | No history | ✓ 8 | ✓ 8 | No history |
| [Singapore Post](../carriers/singapore-post/README.md) | Yes | ✓ 9 | ✓ 4 | ✓ 12 | ✓ 18 | ✓ 11 | ✓ 4 |
| [Hongkong Post](../carriers/hongkong-post/carrier.json) | No adapter | Blocked | ✓ 26 | ✓ 35 | ✓ 17 | ✓ 35 | No history |
| [Korea Post](../carriers/korea-post/README.md) | Yes (international) | Domestic unsupported; alternate ✓ 20 | No history | No history | No history | No history | N/A |
| [Planzer](../carriers/planzer/README.md) | Yes | ✓ 4 | No history | No history | No history | No history | N/A |
| [Quickpac](../carriers/quickpac/README.md) | Yes (via Planzer) | No history | No history | No history | No history | No history | N/A |
| [DPD France](../carriers/dpd-fr/README.md) | Yes | ✓ 10 | ✓ 10 | ✓ 5 | No history | No history | N/A |
| [Parcelforce Worldwide](../carriers/parcelforce/carrier.json) | No adapter | Not tested | No history | No history | No history | ✓ 3 | No history |
| [Purolator](../carriers/purolator/README.md) | Yes | ✓ 12, intermittent | No history | ✓ 12 | ✓ 12 | No history | N/A |
| [OnTrac](../carriers/ontrac/README.md) | Yes | ✓ 14 | No history | ✓ 14 | No history | ✓ 14 | N/A |
| [Delhivery](../carriers/delhivery/README.md) | Yes | No history; alternate summary + 1 undated scan | No history | No history | No history | No history | N/A |
| [Blue Dart](../carriers/blue-dart/README.md) | Yes | ✓ 15 | No history | No history | No history | No history | N/A |
| [DTDC](../carriers/dtdc/README.md) | Yes | No history; alternate ✓ 9 | No history | ✓ 35 | No history | No history | N/A |
| [Ninja Van](../carriers/ninja-van/README.md) | Yes (Malaysia NLMY) | No history; alternate ✓ 5 | No history | No history | No history | No history | N/A |
| [Packeta](../carriers/packeta/README.md) | Yes | No history | No history | No history | No history | No history | N/A |
| [Poczta Polska](../carriers/poczta-polska/README.md) | Yes | ✓ 5 | ✓ 10 | ✓ 19 | ✓ 21 | ✓ 18 | ✓ 6 |
| [Bring](../carriers/bring-posten/README.md) | Yes | Not tested; alternate ✓ 3 | ✓ 12 | ✓ 15 | ✓ 19 | ✓ 16 | ✓ 3 |
| [Posti](../carriers/posti/README.md) | Yes | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| [An Post](../carriers/an-post/carrier.json) | No adapter | Not tested | ✓ 4 | ✓ 4 | ✓ 4 | ✓ 4 | No history |
| [CTT Portugal](../carriers/ctt/README.md) | Yes | ✓ 4 | ✓ 4 | ✓ 5 | ✓ 5 | ✓ 3 | ✓ 2 |
| [CTT Express](../carriers/ctt-express/README.md) | Yes | ✓ 5 | ✓ 5 | ✓ 5 | ✓ 4 | ✓ 6 | N/A |
| [BRT](../carriers/brt/README.md) | Yes | Not tested; alternate ✓ 7 | No history | ✓ 23 | No history | ✓ 5 | N/A |
| [SEUR](../carriers/seur/README.md) | Yes | No history; alternate ✓ 6 | No history | ✓ 4 | ✓ 4 | ✓ 4 | N/A |
| [Correos Express](../carriers/correos-express/README.md) | Yes | ✓ 9 | ✓ 9 | ✓ 9 | No history | No history | N/A |
| [MRW](../carriers/mrw/carrier.json) | No adapter | Not tested | No history | No history | ✓ 1 | No history | N/A |
| [NACEX](../carriers/nacex/README.md) | Yes | Not tested; alternate ✓ 14 | Error | Error | Error | Error | N/A |
| [Colis Privé](../carriers/colis-prive/README.md) | Yes (postcode) | Not tested (postcode) | No history | No history | No history | No history | N/A |
| [Relais Colis](../carriers/relais-colis/README.md) | Yes | ✓ 4 | No history | ✓ 4 | No history | No history | N/A |
| [Paack](../carriers/paack/README.md) | Yes (postcode) | Not tested (postcode) | No history | No history | No history | No history | N/A |
| [Asendia](../carriers/asendia/README.md) | Yes (Asendia USA) | ✓ 5 | ✓ 2 | ✓ 6 | Error | ✓ 3 | ✓ 2 |
| [Landmark Global](../carriers/landmark-global/README.md) | Yes | ✓ 14 | ✓ 14 | ✓ 21 | No history | ✓ 21 | N/A |
| [NZ Post](../carriers/nz-post/README.md) | Yes | ✓ 16 | ✓ 20 | ✓ 20 | ✓ 16 | ✓ 20 | ✓ 4 |
| [Pos Malaysia](../carriers/pos-malaysia/README.md) | Yes | ✓ 2 | Error | ✓ 2 | ✓ 2 | No history | No history |
| [Thailand Post](../carriers/thailand-post/carrier.json) | No adapter | Not tested | ✓ 8 | ✓ 8 | No history | ✓ 8 | No history |
| [Ukrposhta](../carriers/ukrposhta/README.md) | Yes | ✓ 22; alternate ✓ 14 | ✓ 30 | ✓ 33 | ✓ 45 | ✓ 33 | Error |
| [Estafeta](../carriers/estafeta/README.md) | Yes | ✓ 4 | No history | No history | No history | No history | N/A |
| [Correos de Chile](../carriers/correos-chile/README.md) | Yes | No history; alternate ✓ 1 | No history | No history | ✓ 13 | No history | No history |
| [The Courier Guy](../carriers/the-courier-guy/README.md) | Yes | ✓ 14; alternate ✓ 13 | No history | No history | No history | No history | N/A |
| [GEODIS](../carriers/geodis/README.md) | Yes | Summary only | No history | Postcode prompt | ✓ 4 | ✓ 2 | N/A |
| [Dachser](../carriers/dachser/README.md) | Yes (tracking link) | Not tested (link) | No history | No history | No history | No history | N/A |
| [Old Dominion](../carriers/old-dominion/carrier.json) | No adapter | Not tested | Unverified | Unverified | Unverified | Unverified | N/A |
| [Swiss Post Cargo](../carriers/swiss-post-cargo/README.md) | Yes | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| [PostLogistics](../carriers/postlogistics/README.md) | Yes | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| [Hermes Einrichtungs-Service](../carriers/hermes/README.md) | Yes | ✓ 10 | No history | No history | No history | No history | N/A |
| [Heppner](../carriers/heppner/README.md) | Yes (postcode) | Not tested (postcode) | No history | Wrong carrier | No history | No history | N/A |
| [Ciblex](../carriers/ciblex/README.md) | Yes | ✓ 7 | No history | Postcode prompt | No history | No history | N/A |
| [C Chez Vous](../carriers/c-chez-vous/README.md) | Yes | No history | No history | No history | No history | No history | N/A |
| [Colisweb](../carriers/colisweb/README.md) | Yes | ✓ 2 | Wrong carrier | No history | No history | No history | N/A |
| [Delivengo](../carriers/delivengo/README.md) | Yes (via La Poste) | No history | No history | No history | No history | No history | No history |
| [UniUni](../carriers/uniuni/README.md) | Yes | ✓ 6 | ✓ 6 | ✓ 19 | ✓ 6 | ✓ 21 | N/A |
| [SpeedX](../carriers/speedx/carrier.json) | No adapter | Not tested | No history | No history | ✓ 2 | No history | N/A |
| [GOFO Express](../carriers/gofo/README.md) | Yes | ✓ 14 | ✓ 14 | ✓ 14 | ✓ 14 | ✓ 14 | N/A |
| [Ecoscooting](../carriers/ecoscooting/README.md) | Yes | ✓ 6 | ✓ 6 | ✓ 6 | No history | ✓ 22 | N/A |
| [TIPSA](../carriers/tipsa/carrier.json) | No adapter | Not tested | No history | ✓ 13 | No history | No history | N/A |
| [Canpar](../carriers/canpar/README.md) | Yes | ✓ 11 | No history | ✓ 11 | No history | ✓ 11 | N/A |

## What the differences mean

Differing clock times are not counted as missing events: several feeds report local wall
times or infer offsets.

By source:

- **Direct adapters** keep actionable rows the aggregators drop or mislabel: La Poste
  pickup-ready, InPost locker-ready, Swiss Post delivery method. Some return local wall
  times with no verified zone (SF Express, Evri International, overseas Japan Post
  scans, Aramex, Korea Post, bpost, Purolator, Poczta Polska, Correos Express,
  Landmark Global, Estafeta, Canpar, EMS and some PostNL, Pos Malaysia, Correios, 4PX,
  Singapore Post and YunExpress scans). Yamato omits the year. These histories remain
  available without fabricated scan instants ([ROUTING.md](../../../docs/ROUTING.md)).
- **Ship24** is sparse for some references: label-only for UPS (a second UPS reference
  was complete), one old row for DPD, one row for Yanwen, two postal rows for Asendia,
  and it stops before La Poste's final events. It had nothing for OnTrac, Purolator,
  Parcelforce, Canpar, SpeedX, the Indian carriers or most Spanish and French networks
  (BRT, SEUR, TIPSA, Relais Colis, Paack, Colis Privé, GEODIS), its browser recovery
  timed out twice for Yamato, YTO and Pos Malaysia, and it answered a Colisweb number
  with a DHL eCommerce parcel. Some histories come back undated (India Post, Japan Post,
  Austrian Post, PostNord, DPD France).
- **ParcelsApp** often has the richest destination leg (DHL eCommerce, Canada Post,
  Japan Post), and was the only aggregator with GLS France, Evri, DTDC, Relais Colis and
  TIPSA history. It exposes internal labels (`swa_rex_*` for Amazon Shipping pickup),
  shows Amazon sign-in notices (excluded from counts), repeats a delivery as
  `Final delivery`, and relays TIPSA's labels written twice (`ENTREGADOENTREGADO`), as
  TIPSA's own page shows them; the parser reads them once. It asks for a postcode for bpost's 24-digit numbers and for GEODIS
  and Ciblex numbers, and answered a Yamato number with a FedEx parcel and a Heppner
  number with another carrier's older parcel. Scans it sends without a date (one in its
  Asendia reply) are left out of the history.
- **17TRACK** gives the best multi-operator journeys, naming each operator: China Post
  plus Correios, Canada Post plus USPS, Japan Post plus Malta Post, and China Post after
  Singapore Post, Poczta Polska, Bring or Ukrposhta. It was the only aggregator with USPS,
  SF Express, SpeedX and Correos de Chile history, and the only one still holding a June
  MRW delivery. It misses some actionable rows (La Poste pickup-ready, InPost
  locker-ready) and had nothing for OnTrac, DTDC, DPD France, BRT, Correos Express,
  Landmark Global, Canpar, TIPSA or a domestic Thailand Post item. Its generic transit
  code also covers Swiss Post's vehicle loading and SpeedX's voided label; their exact
  wording makes them out for delivery and an exception. Its first poll can stay pending;
  a second bounded call completed except for Asendia. Chinese domestic scans can carry
  courier names and phone numbers.
- **Postal Ninja** often matches ParcelsApp and had the most rows for La Poste and
  Ecoscooting. It was the only source with Parcelforce rows and with a domestic Aramex
  delivery. Many rows are undated (PostNL, Australia Post, Japan Post), some codes stay
  untranslated (`HoldForPickup`), and it refuses Purolator, DTDC, JD, Relais Colis,
  Heppner, C Chez Vous, Colisweb and The Courier Guy formats.
- **UPU** usually has final delivery only (DHL, China Post, Canada Post, Japan Post), or
  posting and exchange-office scans (Singapore Post, where they match Ship24's; Poczta
  Polska, Bring, NZ Post, CTT Portugal and Asendia). EMS is the exception. For a returned
  Ukrposhta item it holds two records under one number, which the adapter treats as
  ambiguous.

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
- **Canada Post:** the adapter uses the full detail feed rather than its summary feed.
  Delivery-notice cards and numeric references first need one exact reference-to-PIN
  match. Explicit scan offsets establish instants; return transport remains separate
  from completed return. Expired and unknown references share an inconclusive response.
- **Royal Mail:** sources disagree on the delivery date, and more rows do not settle it.
- **Correos Spain:** all three successful feeds hold the same 12 scans. The direct adapter
  and 17TRACK surface the final one (pickup window expired, parcel going back); ParcelsApp
  still says in transit.
- **GLS Germany, GLS Switzerland, short Mondial Relay numbers:** direct history needs the
  recipient postcode, which no public reference had.
- **Chronopost, Hermes Germany, Mondial Relay, Poste Italiane, GLS France direct,
  Quickpac, Packeta:** the public references are old, so the negatives say nothing about
  current coverage.
- **bpost, Korea Post:** the older domestic references had no aggregator history.
  bpost's anonymous batch feed returns domestic and S10 history without the postcode
  required by its single-item lookup. S10 items also appeared in aggregators:
  a bpost `LD…BE` item through Landmark Global had 20
  rows in ParcelsApp and 14 in 17TRACK, and a Korea Post EMS item had 15 to 43 in every
  feed but Postal Ninja. Korea Post's international direct form returns 20 local-time
  scans; its domestic form is outside the adapter's scope.
- **J&T Express, Delhivery, Blue Dart, TNT:** no aggregator had history for any of two or
  three recent references each (J&T in the Philippines and Indonesia, TNT France's
  16-digit numbers). Blue Dart directly returns a full history. Delhivery's alternate
  direct sample has a dated current snapshot and one undated scan. TNT's alternate
  national reference has a booking scan.
- **Ninja Van:** the original public references had no provider history. A newer
  Malaysian reference has native history; the public timeline omits internal routing
  rows and marks a completed return separately from recipient delivery.
- **JD Logistics, ZTO, STO:** public posts mask Chinese domestic numbers, so only
  old examples were available.
- **YTO:** the direct feed and ParcelsApp have the same history;
  the anonymous direct endpoint accepts reads without the website's slider token.
  YTO's one public number had 30 rows in ParcelsApp,
  which relays YTO's own scan labels in Chinese or in its English translation, and 20
  Chinese rows in 17TRACK. Both show the return
  ([YTO README](../carriers/yto/README.md)).
- **Yunda:** the current domestic portal returns matching history after its native
  slider. The adapter matches a bounded PNG outline to a unique gap and submits once;
  uncertain matches remain challenges. Anonymous history is partial; the full
  timeline needs login. Empty identity maps are inconclusive.
- **Aramex:** a domestic delivery in the UAE had 16 undated rows in Postal Ninja only. An
  international shipment had the same 26 rows in Ship24, 17TRACK and Postal Ninja, and
  none in ParcelsApp. The direct portal returns those 26 rows as local wall times.
- **Planzer:** the direct adapter reads the `reference.shipment` numbers Planzer prints,
  stored with or without the dot, and returns 4 to 6 rows for the three public
  references. No aggregator knows Planzer.
- **Yamato:** ParcelsApp answered with an older FedEx parcel that shares the 12 digits
  (it reported FedEx and GLS), rather than the Yamato parcel. Routing ignores such a
  history ([ROUTING.md](../../../docs/ROUTING.md)). The direct form returns seven scans
  with month and day but no year; no scan year or freshness watermark is inferred.
- **DPD France:** direct and Ship24 return the same 10 rows, direct with depots and
  times. ParcelsApp condenses them into 5.
- **Hongkong Post:** for an AliExpress item, Ship24, ParcelsApp and Postal Ninja include
  the Cainiao origin leg (26 to 35 rows); 17TRACK keeps the two postal legs (17).
- **Singapore Post:** for an item to China, 17TRACK adds China Post's leg in Chinese;
  Ship24 and UPU have only the four exchange-office scans. The direct feed returns nine
  scans. Its Speedpost response uses local clocks rather than the mail feed's offsets.
- **PostNord, 4PX, Austrian Post:** the successful feeds hold the same
  scans, give or take one. Postal Ninja adds a "last day to pickup" row after PostNord's
  delivery.
- **Parcelforce:** only Postal Ninja had rows (booking and collection).
- **DTDC:** MyDTDC's separate consumer feed returns forward and return history for
  supported consignments. The alternate return sample has eight scans and a dated
  return snapshot; a delivered sample has five scans. Legacy failures are inconclusive.
- **YunExpress:** plain HTTP is challenged. Direct retrieval captures the official
  browser request through Chromium or Trawl. Trawl must retain decoded API response
  bodies. Interactive verification still requires provider fallback.
- **Purolator:** the public widget's anonymous API returns matching package history
  with its client key and browser user agent. AWS WAF can interrupt reads with an
  image challenge. Scan clocks remain local; ambiguous search matches are inconclusive.
- **Correios Brazil:** the anonymous portal returns identity-bound history after a
  text CAPTCHA. A bundled MIT-licensed model reads it locally in a CPU worker, with
  one fresh-image retry. Event codes and subtypes distinguish delivery from failed
  dispatches. Only explicit valid scan zones become instants; unbound period errors
  are inconclusive.
- **Poczta Polska, Bring, Ukrposhta:** each reference crossed to China. 17TRACK names both
  posts and adds China Post's leg in Chinese; ParcelsApp and Postal Ninja translate that
  leg. Poczta Polska's direct feed returns the five Polish-side scans, and a domestic
  Pocztex parcel had 10 direct rows, 10 in Ship24 and 18 in ParcelsApp. Ukrposhta's
  domestic reference had 14 rows in Ship24 and none in ParcelsApp. Bring's adapter
  supports single-piece consignments and Norwegian postal parcels.
- **Ukrposhta:** the adapter uses the native anonymous browser flow. A barcode-bound
  overview must agree with the full history's current scan and row count. Return
  completion stays separate from recipient delivery, and scans keep their local clocks
  across countries. Empty or unbound replies remain inconclusive.
- **Posti:** no recent public report ties a number to Posti; Finnish forum users hide
  their codes. The newest public numbers, a plugin issue's example link and a 2025
  inbound item, returned no history.
- **An Post, CTT Portugal, CTT Express, NZ Post:** the successful feeds hold the same
  scans, give or take UPU exchange-office rows, a repeated scan or ParcelsApp's delivery
  estimate. CTT Express's anonymous feed returns single-piece Spanish history;
  multi-piece shipments, empty histories and token errors remain inconclusive.
- **BRT, SEUR:** the references are DPD-group parcel numbers, and Ship24 had neither. For
  SEUR, ParcelsApp, 17TRACK and Postal Ninja name DPD and hold the same four rows. For
  BRT, ParcelsApp's 23 rows add Chronopost's French delivery scans to four DPD rows dated
  1 January and repeat the delivery; Postal Ninja keeps five DPD milestones. The direct
  BRT adapter supports fourteen-digit BRTcodes through the linked detailed event portal;
  the comparison reference is a different DPD-group identifier. SEUR's simplified
  lookup returns single-piece history without recipient verification; absent, recent
  and out-of-range histories share an inconclusive response.
- **Correos Express:** Ship24, ParcelsApp and the direct form hold the same nine scans.
  A failed-delivery row lacks a status label; the adapter keeps it as a neutral update
  without exposing the free-form incident note or promoting an older delivery.
- **MRW:** the newest reference is a June parcel reviewed in September; only 17TRACK
  still had it, as a single delivery row. A September parcel had 14 rows in Ship24,
  ParcelsApp and Postal Ninja and none in 17TRACK.
- **NACEX:** the providers reject the `agency/number` composite before sending it. No
  aggregator had history for the joined digits or the eight-digit shipment number either.
  The direct adapter submits the pair in a fresh anonymous session and preserves
  date-only scans without inventing a delivery time.
- **Colis Privé, Paack:** direct history needs the recipient postcode, which no public
  reference had (Colis Privé stores it after the number). No aggregator knew two current
  references each.
- **Relais Colis:** the direct adapter binds the result banner and expands grouped scans
  into the same four rows as ParcelsApp. Invalid sessions and generic endpoint errors do
  not prove parcel absence; unresolved clocks remain local history.
- **Asendia:** the A1 feed has the US hub scans of an item with a Swiss postal number;
  Ship24, UPU and Postal Ninja have two or three postal rows. ParcelsApp has the same
  scans as A1 plus WNDirect's manifest, and leaves out an Asendia Spain departure it
  lists without a date. Detection selects Swiss Post, which does not know the item.
- **Landmark Global:** the direct adapter and detection support eight or nine digits
  after `LTN`, including the `N1` alias. Ship24 has Landmark's scans; ParcelsApp and
  Postal Ninja add bpost's. The adapter binds the canonical parcel reference and retains
  the declared delivery partner for the host's independent handoff check.
- **Pos Malaysia:** direct, ParcelsApp and 17TRACK hold the same two scans of a March
  item. The adapter also returns international history. Its offsetless scans remain
  unresolved unless both endpoints identify a domestic Malaysian route. An undated
  delivery summary cannot borrow a movement scan's clock.
- **Thailand Post:** a domestic item had the same eight rows in Ship24, ParcelsApp and
  Postal Ninja, and none in 17TRACK or UPU.
- **Estafeta:** the adapter binds the ten-digit code to one full guide and rejects
  colliding codes and master-piece lists; Mexican clocks remain local. Both forms of the
  public reference return the same four scans, and no aggregator knew them. Detection
  selects full guides with a letter in the 13th or 14th place (two-day guides carry a
  `D` in the 14th); all-digit guides stay a suggestion shared with USPS and Austrian Post.
- **Correos de Chile:** an older item to China had 13 rows in 17TRACK and none
  elsewhere. Recent public references return a bound native scan. The adapter keeps
  wall clocks local and excludes recipient details and the branch directory.
- **The Courier Guy:** native product references preserve their printed separator and
  bind the exact custom reference to one canonical shipment. The direct feed returns
  14 scans for the cancelled collection and 13 for the Pudo delivery. Missing piece
  counts are accepted only for a single-piece cancelled precollection timeline; one
  delivered piece cannot complete the shipment. Product formats stay low-confidence
  candidates until native recognition confirms them.
- **GEODIS:** the anonymous lookup keeps a delivered May parcel's state and departure
  date after its scan list is gone. 17TRACK stamps four milestones with the delivery
  time, and Postal Ninja keeps the departure date.
- **Dachser, Heppner:** direct history needs Dachser's full link or Heppner's recipient
  postcode, which no public reference had. No aggregator knew either of two Dachser
  consignments.
- **Old Dominion, Swiss Post Cargo, PostLogistics:** no public post ties a number to
  these freight services. Both eos endpoints answer a Swiss Post parcel barcode with a
  third response type that relays Swiss Post's own two scans, coded `PST` and without
  places. The adapters report it as not found, so routing moves the parcel to the
  Swiss Post adapter, which returns the same scans with Swiss Post's codes and the
  sorting location.
- **Hermes Einrichtungs-Service, C Chez Vous:** the number alone opens the order, so their
  public references stay out of the repository. The Hermes service returns ten
  appointment updates for a September delivery that no aggregator knows; C Chez Vous
  knew neither public reference.
- **Ciblex:** the direct adapter submits the full 24-digit barcode unchanged and binds
  its exact result banner. It returns seven distinct scans, excludes private annotation and
  address fields, and preserves unresolved clocks. Shared numeric formats remain
  low-confidence candidates.
- **Colisweb:** the direct feed returns an April delivery's confirmation and an undated
  incident.
- **Delivengo:** the newest public number is a 2024 parcel; no source still has it.
- **UniUni:** the anonymous feed returns parcel history, with corrected per-scan seconds
  rather than the older numeric local clock; unresolved current clocks are kept apart and
  providers are asked for dated progress. Master shipments are inconclusive. Every
  feed holds the same six scans; ParcelsApp and Postal Ninja add translated or repeated
  rows. The compact `UUSC` and `U9999` families are supported by detection and native
  recognition.
- **SpeedX:** only 17TRACK knew the reference: a label, then "Parcel Void", which reads
  as an exception rather than transit because the label was cancelled before shipping.
  Detection selects both the 18- and the 24-character form: `SPX`, a three-letter hub,
  then 12 or 18 digits.
- **GOFO Express:** GOFO counts 15 scans for this reference but lists 14, the same 14
  the aggregators hold; its page shows the list and ignores the counter. The adapter
  accepts a larger counter only when the list runs from label creation to the current
  summary. GOFO's default clocks pair each scan's local time with Pacific's offset:
  Ship24 relays that offset, putting Mountain, Central and Eastern scans one to three
  hours late, and ParcelsApp's rows carry the local digits as UTC. The adapter requests
  Pacific clocks, whose offsets are real.
- **Ecoscooting:** the direct feed returns six last-mile scans for the Portuguese `CNPRT`
  reference, with identity-bound completion wording. Postal Ninja adds SunYou's origin
  leg; Ship24 and ParcelsApp hold the same last-mile history. Spanish numeric references
  and the older Spanish `CNESP` form are supported too; the published `CNESP` references
  now get the gateway's inconclusive query error.
- **TIPSA:** the native recipient form requires the destination postcode even for a
  full 22-digit reference, but the shop link ParcelsApp cites
  (`www.tip-sa.com/cliente/datos_prestashop.php?id={number}`) opens the history with the
  reference alone, beside the recipient's masked name and address. Of the aggregators
  only ParcelsApp had the Portuguese reference, with the same rows and clock digits as
  that page. The digits are Madrid time, Portuguese agencies included
  ([ParcelsApp](parcelsapp/README.md)). The rows carry TIPSA's Spanish labels (`REPARTO`,
  `Ausente`, `ENTREGADO`); with no TIPSA status map, the shared Spanish wording rules give
  them their stages.
- **Canpar:** direct, ParcelsApp and Postal Ninja hold the same 11 scans. The ambiguous
  clock shift remains local history; empty placeholder packages are inconclusive.

## Direct retrieval gaps

Universal providers remain the route where no anonymous, identity-bound carrier history
is supported. J&T's Philippine portal uses interactive verification and its Indonesian
portal asks for a phone suffix. JD Logistics and ZTO gate reads with sessions or
CAPTCHA; STO's old form redirects away. China Post's ordered-character challenge and
Hongkong Post's CAPTCHA remain unsupported. Parcelforce forwards to Royal Mail's
disabled direct route. An Post's consumer query is challenged, MRW's stateful result
has no usable history, and SpeedX's anonymous endpoints require verification. Old
Dominion and TIPSA have no adapter yet; TIPSA's locator form requires the destination
postcode, but its shop link needs only the 22-digit reference.

PostNL direct refines its overloaded processing category for the exact out-for-delivery
label. EMS export cancellation is an exception. Unresolved direct postal clocks remain
local history rather than inferred scan instants.

Detection selects or suggests the named carrier for the public numbers behind rows
31–100, with these exceptions. Planzer composites stay undetected on purpose (see the
[Planzer README](../carriers/planzer/README.md)), and DTDC's `Z` numbers share Packeta's
shape and stay with Packeta. S10 items from Poland and Ukraine go to the generic
postal carrier. Paack and Ukrposhta have no rule for their own
numbers; Posti, Dachser, Hermes Einrichtungs-Service, Swiss Post Cargo, PostLogistics,
Colisweb and Delivengo have none by design. Each answer is recorded in the
carrier's `numbers.json`.

## Other carriers

Spee-Dee, SunYou and ShipUp follow the first 100. SunYou's one public sample, an old
one, had history in ParcelsApp and 17TRACK and none in Ship24.

## Method

- Each source was called on its own through `UniversalTracker.fetchSource()` (45 s
  budget, UPU 8 s), with no stop at the first success. Dedicated adapters kept their own
  deadlines. Browser lookups ran one at a time, and TRAWL-based sources used the shared
  browser service.
- References are public (customer reports, complaints, documentation examples). Private
  numbers and postcodes were withheld, and no account was signed into.
- One reference per row. Extra references and bounded rechecks only investigated
  failures and are not averaged in.
- Rows 31–100 each use the newest public post found that ties a number to the carrier
  (Trustpilot reviews, complaint letters, Q&A threads, review sites, court filings, shop
  pull requests), skipping pages that print the author's contact details. The numbers
  and their sources are in each carrier's `numbers.json`, except C Chez Vous and Hermes
  Einrichtungs-Service references, which open the order on their own.
- For those rows, a first-call timeout, pending 17TRACK poll or Postal Ninja capture
  failure got one bounded recheck, and the cell shows the recheck. Every all-negative row
  got one or two more recent references where any existed; the notes say where they
  differed.
