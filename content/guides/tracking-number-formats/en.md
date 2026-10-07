---
title: Tracking number formats: which carrier is it?
description: Tracking number formats for USPS, UPS, FedEx, DHL, Royal Mail, Evri and more, and how to tell which carrier a number belongs to from its letters and length.
slug: tracking-number-formats-by-carrier
picture: Three tracking-number labels split into coloured parts, a magnifying glass on the country code CH, and a curious Pip.
published: 2026-10-09
updated: 2026-10-09
---

A tracking number's letters and length often tell you which carrier has your parcel or package. `1Z` followed by 16 letters and digits is UPS, 22 digits starting `92` to `95` is USPS, and 13 characters shaped like `RR123456785CH` (two letters, nine digits, two letters) usually belong to a national post, with the issuing country in the last two letters. Plain digits are the hard case: 10, 12 or 14 digits each fit several carriers, so the shipping email, or a tracker that checks the candidates, has the final word.

## How do I tell which carrier a tracking number is from?

Four checks, in this order:

:::steps
- Read the letters | They narrow it down most. `1Z` at the start is UPS; two letters at the end usually mean a post.
- Count the characters | Length rarely decides on its own, but it rules carriers out. Leave out the spaces: they're printed to help you read, not part of the number.
- Check the email | The shop's shipping email or text usually names the carrier or links to its tracking page. That beats any guess.
- Try the candidates | Enter the number on each likely carrier's site. The one that shows scans for it has your parcel.
:::

If you'd rather skip the detective work, paste the number, a carrier link or the whole shipping email into [Peek](/): it picks out the number and detects the carrier among more than 3,500.

## Tracking number formats by carrier

Here's what the carriers and the postal standard say about the numbers you're most likely to meet in the US, the UK, Ireland, Canada and Australia:

| Carrier | What the number looks like |
| --- | --- |
| UPS | `1Z` + 16 letters and digits, 18 characters in all, such as `1Z999AA10123456784`, an example that passes UPS's check digit |
| USPS | 22 digits starting `92`, `93`, `94` or `95`, printed in groups of four, such as `9212 3912 3456 7812 3456 70`; 26 digits on some labels; international items can carry the postal format ending `US` |
| FedEx | 12 digits on FedEx Ground Economy labels since 2022, where some shippers used to get 15-digit Ground numbers |
| DHL | DHL Express: 10 digits, never letters. DHL in Germany: 10 to 39 characters |
| Royal Mail, Parcelforce | 9 to 27 characters, says the Post Office; the postal format ends `GB` |
| Evri | 16 characters (Evri's page says both "16 digit" and "16 character") |
| DPD | 14 characters, says DPD Germany; 14 digits, say DPD Austria and Belgium. DPD UK's help page gives no length and asks for your postcode too |
| An Post | two letters, nine digits, two letters ending `IE` |
| Canada Post | 16 digits (online labels) or 13 characters ending `CA`; 12 digits for Priority Worldwide |
| Australia Post | its help page gives no format and calls it a "tracking number, or article ID"; numbers in the postal format end `AU` |
| YunExpress | `YT` + 16 digits (`YT` + 13 digits is YTO Express) |
| China Post, EMS | the postal format ending `CN`; international EMS numbers start with `E` |
| Amazon | Amazon publishes no format; `TBA` numbers are covered below |

### Whose tracking number starts with 9 or 420?

A 22-digit number starting `92` to `95`, or a 26-digit one starting `92` to `94`, is USPS. If you scanned the barcode and the digits start with `420`, that part is `420` plus the destination ZIP Code (5 or 9 digits). USPS uses it for routing and leaves it out of the printed number, so your tracking number starts at the `92`, `93`, `94` or `95` that follows.

## How many digits is a tracking number?

There's no single length. These are the lengths carriers give on their own pages, and the overlaps show why a bare number can fit several:

| Length | Who uses it |
| --- | --- |
| 10 digits | DHL Express; Mondial Relay (8, 10 or 12) |
| 12 digits | FedEx Ground Economy; Canada Post Priority Worldwide; Mondial Relay |
| 14 digits | DPD in Austria and Belgium (DPD Germany says 14 characters); La Poste in France |
| 15 digits | FedEx Ground numbers: FedEx told Ground Economy shippers receiving them that the length would change from 31 May 2022; Canada Post's Delivery Notice Card |
| 16 digits | Canada Post online labels; Evri (16 characters) |
| 22 digits | USPS; Portugal's CTT |
| 26 digits | USPS, on some labels |
| 9 to 27 characters | Royal Mail and Parcelforce |
| 10 to 39 characters | DHL in Germany |

## Whose tracking number starts with TBA?

Amazon. In the carrier data Peek uses, `TBA`, `TBC` or `TBM` followed by 12 digits means Amazon Logistics, Amazon's own delivery service, though Amazon's help pages don't describe the number itself. Those orders show as "shipped with Amazon", and Amazon tells you to track them in Your Orders.

## The postal format: two letters, nine digits, two letters

National posts share one 13-character format, set by the Universal Postal Union (UPU) in its standard S10. Here it is taken apart:

:::anatomy RR 12345678 5 CH
- RR | Type of item: R for a registered letter
- 12345678 | Serial number, eight digits
- 5 | Check digit, worked out from the serial
- CH | Country that issued the number: Switzerland
:::

For mail crossing a border, the first letter tells you the kind of item. Posts may use the letters differently at home.

- `E`: EMS, the posts' express service
- `C`: parcel
- `R`: registered letter
- `L`: tracked letter
- `V`: insured letter
- `U`: goods sent as a letter, without tracking for you

The last two letters are not always where the parcel started. The UPU says the code "cannot be used as a reliable indicator of the geographic origin of an item": Swiss Post uses `CH` on items it sends from its offices abroad, and Portugal's CTT gives codes ending `PT` to items its contract customers send from Spain, China and elsewhere.

The check digit catches typos. To test a number:

1. Multiply the eight serial digits by 8, 6, 4, 2, 3, 5, 9 and 7, and add the results.
2. Divide by 11 and take the remainder away from 11.
3. A result of 10 becomes 0, and 11 becomes 5.

For `RR123456785CH`: 8 + 12 + 12 + 8 + 15 + 30 + 63 + 56 = 204, which leaves 6, and 11 − 6 = 5. If a postal number you copied by hand fails this test, look for a mistyped or swapped digit.

### Whose tracking number starts with UL or UU?

If it has 13 characters and ends in two letters, such as `CN`, it's a postal number from the `U` range: goods sent as a letter. The last two letters show which country's post issued it. A longer number starting `UU` isn't in that format: check the shipping email for the carrier.

> On mail from abroad, a postal number starting with `U` (`UA` to `UZ`) is not meant for you to follow. The UPU uses that range for goods sent as letters "without customer-oriented tracking", and bpost says plainly that you cannot track such a parcel. Don't count on it to start updating later.

## Numbers that are not your tracking number

Other numbers travel with a parcel. Some lead back to it, some don't:

- **Order number.** The shop's own reference. DHL reminds you that a tracking number is not an order number.
- **Missed-delivery cards.** A FedEx door tag (`DT` + 12 digits, US and Canada only), an Evri calling card (8 digits), a Canada Post Delivery Notice Card (15 digits) and the barcode on a USPS PS Form 3849 all lead back to the parcel in their carrier's tracking.
- **An Post's Trans Ref ID.** It only records your transaction with An Post and tracks nothing.

Have only an order number? [Where to find a tracking number](guide:find-tracking-number) shows where to look in your order.

## Why your tracking number can change on the way

A parcel that crosses a border often changes hands, and each company can print its own label. The UPU lets the receiving post add its own barcode next to the original, as long as it isn't in the 13-character postal format.

:::journey
- shop | Seller | Prints the label and the first number
- plane | Long haul | Travels on that first number
- customs | Customs | Checked in your country
- handover | Local carrier | Can add its own label and number
- home | Your door | The last scans may sit under the new number
:::

- **Postal items** are the easy case: the UPU allows only one S10 number per item, so it usually works on both posts' sites.
- **FedEx Ground Economy** shipments in the US get a 12-digit FedEx number and a USPS tracking number as well.
- **AliExpress economy shipping:** Cainiao says tracking stops at the handover to the local carrier, and that the seller can tell you how to reach that carrier. More in [tracking a parcel from China](guide:tracking-from-china).

A number that returns nothing isn't always mistyped. Portugal's CTT gives two reasons: the code exists only for customs, or another company delivers the item. If a valid number simply hasn't moved yet, read [why tracking stops updating](guide:tracking-not-updating).

:::sources
- [UPU: S10 standard, Identification of postal items](https://www.upu.int/UPU/media/upu/files/postalSolutions/programmesAndServices/standards/S10-12.pdf) – the postal format, its letters, check digit and country code
- [USPS: Publication 199, Intelligent Mail package barcode](https://postalpro.usps.com/pub199) – 22 and 26 digits, 92 to 95, the hidden 420 and ZIP Code
- [USPS: How to find your tracking number](https://faq.usps.com/s/article/How-to-find-your-tracking-number) – the PS Form 3849 barcode
- [UPS: sample package label](https://www.pld-certify.ups.com/CerttoolHelp/PLD0200/WebHelp_pld0200/LeadPackage.htm) – the 1Z number
- [FedEx Developer: FedEx Ground Economy announcement](https://developer.fedex.com/api/en-us/announcements/Apr2022-FGEAnnouncements.html) – 12 and 15 digits, the USPS number alongside
- [FedEx Developer: Track API](https://developer.fedex.com/api/en-us/catalog/track/docs.html) – door tag numbers
- [DHL Express Netherlands: DHL Express or DHL eCommerce number](https://www.dhlexpress.nl/en/consumer/faq/express-account-zendingsnummer/my-shipment-number-dhl-express-or-dhl-ecommerce) – 10 digits
- [DHL: Sendungsverfolgung, Probleme und Lösungen](https://www.dhl.de/de/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html) – 10 to 39 characters, not an order number
- [Post Office: Track and trace](https://www.postoffice.co.uk/track-trace) – Royal Mail and Parcelforce references
- [Evri: Track a parcel](https://www.evri.com/track-a-parcel) – 16 characters and the calling card
- [DPD UK: How can we help](https://www.dpd.co.uk/content/how-can-we-help/index.jsp) – reference number and postcode
- [DPD Germany: Wo finde ich meine Paketnummer?](https://www.dpd.com/de/de/faq/wo-finde-ich-meine-paketnummer/) – 14 characters
- [DPD Austria: Wo finde ich die Paketnummer?](https://www.dpd.com/at/de/faq/wo-finde-ich-die-paketnummer-2/) – 14 digits
- [DPD Belgium: Where do I find the parcel number?](https://www.dpd.com/be/en/faq/where-do-i-find-the-parcel-number-2/) – 14 digits
- [Canada Post: How to use Track](https://www.canadapost-postescanada.ca/cpc/en/support/kb/tracking/how-to-use-track.page) – 16 digits, 13 characters, the Delivery Notice Card
- [Canada Post: Find your tracking number](https://www.canadapost-postescanada.ca/cpc/en/support/kb/tracking/find-your-tracking-number.page) – lengths by product
- [Australia Post: Help with tracking](https://auspost.com.au/help/parcel-tracking/tracking-support/help-with-tracking) – tracking number or article ID
- [An Post: Track a parcel](https://www.anpost.com/Post-Parcels/Track/Search) – the format and the Trans Ref ID
- [YunExpress: YunTrack](https://www.yuntrack.com/) – YunExpress's own tracking site
- [Cainiao: Help centre](https://global.cainiao.com/helpDoc.htm) – no tracking after the handover with economy shipping
- [bpost: Puis-je suivre mon colis en ligne ?](https://www.bpost.be/fr/faq/puis-je-suivre-mon-colis-en-ligne) – barcodes starting with U cannot be tracked
- [CTT: Encontrar o código de envio](https://www.ctt.pt/ajuda/particulares/seguir-ou-alterar-entrega/seguir/encontrar-o-codigo-de-envio) – 22 digits, PT codes from abroad, codes that return nothing
- [Mondial Relay Belgium: Suivi de colis](https://www.mondialrelay.be/fr-be/suivi-de-colis/) – 8, 10 or 12 digits
- [La Poste: Comment suivre mon colis ou ma lettre](https://aide.laposte.fr/professionnel/contenu/comment-suivre-mon-colis-ou-ma-lettre) – 14 digits
- [Amazon: Amazon Logistics](https://www.amazon.com/gp/help/customer/display.html?nodeId=GEW3XT9JEMBLTKRV) – shipped with Amazon, tracked in Your Orders
- [Universal Parcel Scraper: carrier catalog](https://github.com/plhery/universal-parcel-scraper/blob/main/data/catalog.json) – the TBA and YT shapes in Peek's carrier data
:::
