---
title: Cainiao tracking: numbers, statuses and who to contact
description: Track a Cainiao parcel from AliExpress: which numbers are Cainiao's, what each status means, where a missed parcel waits and who to ask when it stalls.
slug: cainiao-tracking
published: 2026-10-10
updated: 2026-10-10
---

Cainiao is Alibaba's logistics group: it ships parcels abroad for sellers on platforms such as AliExpress, and its tracking site, [global.cainiao.com](https://global.cainiao.com/), follows Cainiao and AliExpress parcels only. Type the number there or in the box above. On AliExpress, the number is under My Orders: find the order and click Tracking.

## Cainiao tracking number: what it looks like

No Cainiao page gives the LP, CNG, DOFR or CNFR shapes. Its site takes letters and digits only, and its own example is a postal number: two letters, nine digits, then HK. The shapes, with invented digits:

| Number | Whose it is |
| --- | --- |
| `LP12345678901234` | LP and 14 digits: likely Cainiao, though not certain. |
| `CNG12345678900000` | CNG and 14 digits: likely Cainiao. |
| `CNG12345678975001` | The same, ending in what looks like a French postcode: Cainiao, or possibly [Colis Privé](carrier:colis-prive). |
| `DOFR1234567890123HD` | DOFR or CNFR, 13 digits, then HD: Cainiao. |
| `RR123456785CN` | A postal number: Cainiao's site tracks this shape, but so does the post, here China Post. |
| `YT1234567890123456` | Not Cainiao but [YunExpress](carrier:yunexpress). |

Cainiao's tracking also answers other shapes, such as AP and 14 digits. No Cainiao page says where the number appears outside AliExpress, and none mentions texts to recipients: see [how to find your tracking number](guide:find-tracking-number). If the site shows no tracking, Cainiao asks you to check that it really is a Cainiao or AliExpress number.

## Cainiao tracking statuses: what they mean

The main lines, in the order a parcel meets them:

| Cainiao says | What it means for you |
| --- | --- |
| `Shipment information received by warehouse electronically` | The seller's warehouse has the order data. |
| `Received by logistics company` | The first carrier scan. |
| `Export customs clearance complete` | Export clearance is done; the parcel is in transit. |
| `Departed from departure country/region` | Leaving the origin country. |
| `Import customs clearance started` | At customs in your country. |
| `Received by local delivery company` | Handed to the carrier that will deliver it, not to you. |
| `Out for delivery` | Out for delivery: the last mile. |
| `Delivery attempt unsuccessful.Unable to deliver to mailbox` | An attempt failed; the reason follows the first sentence. |
| `Arrived at pick-up point. Package available for collection.` | Waiting for you at a pickup point. |
| `Package delivered` | Delivered to you, or picked up by you. |

`Carrier update` is a Cainiao notice: the parcel is in transit. `Accepted for transportation by postal service` is a postal partner taking over after the hand-off, not a first scan; `Delivery Carrier Accepted` means the local carrier has it. The pickup-point line is signed for by the pickup point, not by you; `Package delivered` follows when you pick it up. `Processing delay at sorting center` is a hold-up, not a fault. `Delivery failed` closes the delivery after its attempts.

## Cainiao delivery attempt unsuccessful, pickup points and lockers

Cainiao says it delivers locally in nine countries and regions without naming them, and elsewhere names Spain, France and Poland, where it has its own lockers. For the UK, Ireland and the US, no Cainiao page names the local carrier or gives rules on delivery attempts. After the handover, the tracking page's "View Contact Information" button shows the local carrier's details when Cainiao has them.

Cainiao's `Tracking notice` says economy shipping "doesn't include tracking after a package has been handed to a destination country/region's carrier." For that carrier's name, ask the seller.

Cainiao's `Undelivered` covers nobody home, an address the driver couldn't find or a delivery rescheduled or put off at your request; it advises asking the carrier for a re-delivery or picking the parcel up. `Awaiting Collection` and `First Notification to recipient` also mean it's waiting for you. Pick it up at once, Cainiao advises, "or it might be returned to the sender."

In Spain, where Cainiao has its own network and gives Ecoscooting's contacts as its own, Ecoscooting's FAQ says it tries again within 3 working days of a failed attempt and holds parcels at its pickup points or lockers for 14 days, sending the PIN by email or SMS.

## Cainiao tracking not updating or parcel missing

**No tracking yet.** Cainiao's FAQ says tracking usually appears within 11 days of shipping; if nothing has changed after 12 days, you may contact the seller. `Not Found` can also mean a wrong number or that the carrier hasn't entered the parcel yet.

**Stuck after reaching your country.** Cainiao's FAQ says the destination country usually hasn't sent updates, and suggests asking the local post office. A wrong address or phone number can also hold it up; at customs, Cainiao tells recipients to contact customs. For long gaps, see [why tracking stops updating](guide:tracking-not-updating).

**Very late or lost.** Cainiao asks you to wait until the latest promised delivery date. After that, for an AliExpress order, go to Customer Service (under Help) or Disputes&Reports on AliExpress. No Cainiao claim form for recipients was found: refunds go through AliExpress or the seller.

**Delivered but not there.** Cainiao advises contacting the sender or the carrier. For AliExpress parcels, its page may ask "Did you receive it?" and link to the Help Center. More in [delivered but not received](guide:delivered-not-received).

**Returned.** `Unclaimed` and `Storage term expired` mean nobody picked it up in time, `Unsuccessful delivery` an unclear address or phone number. Ask the seller what happens next.

## Cainiao customer service and contact number

As read on 9 October 2026, Cainiao's English contact page lists no phone number. It gives:

- **Email**: cainiaoglobalcs@service.cainiao.com, as "Customer Service", without saying whom it serves.
- **AliExpress orders**: a link to AliExpress customer service, whose Help Center offers an "Online Service" marked 24/7.

Its Chinese site's numbers serve China and merchants. Start with the seller or AliExpress, then the carrier in the tracking.

In Spain, Ecoscooting's FAQ lists +34 912 15 93 69, the free line +34 800 00 03 69 and customersupport@ecoscooting.com (weekdays 9:00–18:00, weekends 9:00–13:00); Cainiao España's merchant site gives the first number, the email and the same hours. In Portugal, Ecoscooting lists +351 300 609 006.

## Track a Cainiao parcel with Peek

[Peek](/) shows these parcels as "AliExpress / Cainiao". It recognises DOFR and CNFR numbers straight away; for LP and CNG numbers it asks Cainiao among the likely carriers. Postal numbers typed alone go to the post. For those and for AP numbers, paste the global.cainiao.com link with `mailNoList=`, which reaches Cainiao whatever the number. It doesn't recognise links from track.cainiao.com or AliExpress orders.

It checks every 10 minutes, every 2 minutes once the parcel is out for delivery, puts each scan on a map and can notify you of every scan, important steps only or "Delivery day only". It shows the status, the history, the place of a scan when Cainiao gives one, the expected delivery as a window of days when given, the delivery time and the local carrier's number when Cainiao publishes it. It can't contact Cainiao or file a claim for you.

## Questions about Cainiao tracking

### Where is my Cainiao package?

The latest tracking line gives its stage, and a town only when the scan names one. After `Received by local delivery company`, a carrier in your country has it; if economy tracking stops there, ask the seller which one.

### Is Cainiao legit?

Cainiao is Alibaba's logistics group, founded in 2013 and based in Hangzhou, China. AliExpress sends its buyers to Cainiao's tracking site.

### How long does Cainiao take to deliver?

It depends on the shipping option. Cainiao's promises to sellers, not a date for your order: Premium takes 5 to 10 calendar days to high-demand countries such as Spain, the Netherlands, the UK and Belgium; Standard 10 to 18 days to key countries (7 at the fastest after collection, to the UK, France or Germany); Economy 20 to 45.

### How long does Cainiao hold packages?

Cainiao gives no number of days and advises picking the parcel up at once. In Spain, Ecoscooting's FAQ gives 14 days at its pickup points and lockers.

:::sources
- [Cainiao: Global Express Tracking](https://global.cainiao.com/) – Cainiao and AliExpress only, example number
- [Cainiao: Guidance](https://global.cainiao.com/helpDoc.htm?slug=ofzig4) – letters and digits
- [Cainiao: Logistics Status Explanation](https://global.cainiao.com/helpDoc.htm?slug=phdx0i) – statuses, collection deadline
- [Cainiao: FAQ](https://global.cainiao.com/helpDoc.htm?slug=bp5fbp) – delays, customs, returns, disputes
- [Cainiao: tracking page language file](https://lang.alicdn.com/mcms/global-track/0.0.10/global-track.json) – economy notice, contact button
- [Cainiao: About Cainiao](https://www.cainiao.com/en/about-us-brief-introduction.html) – Alibaba, 2013, nine countries
- [Cainiao: Overseas Local](https://www.cainiao.com/en/global-local-capabilities.html) – Spain, France, Poland, lockers
- [Cainiao: Cross-border Express Delivery](https://www.cainiao.com/en/global-express.html) – delivery times
- [Cainiao: Contact Cainiao](https://www.cainiao.com/en/about-us-contact-us.html) – email, AliExpress link
- [Cainiao: 联系我们](https://www.cainiao.com/about-us-contact-us.html) – Chinese numbers
- [Cainiao España: Sobre Cainiao](https://es.cainiao.com/about-us.html) – own network in Spain, contact
- [Ecoscooting: Delivery](https://ecoscooting.com/) – Spanish and Portuguese lines, 3 days, 14 days
- [AliExpress: How to track my package?](https://service.aliexpress.com/page/knowledge?pageId=82&knowledge=1060063468&language=en) – My Orders, Online Service
- [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper) – what Peek shows
:::
