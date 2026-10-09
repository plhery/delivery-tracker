---
title: BRT tracking: numbers, statuses and missed deliveries
description: Track a BRT parcel in or from Italy: where to find the BRTcode or shipment number, what BRT's English statuses mean, missed deliveries, lockers and contacts.
slug: brt-tracking
published: 2026-10-10
updated: 2026-10-10
---

BRT is an Italian express courier, part of the Geopost group like DPD. Track a parcel with the link in BRT's SMS or email, with "Where is my shipment?" on [brt.it](https://www.brt.it/en/) or by pasting the number in the box above. BRT sends that number, the BRTcode, when it takes charge of the parcel, if the sender gave it your contact details.

## BRT tracking number and where to find it

The BRTcode is in BRT's SMS and emails, on the waybill and on the paper notice left after a missed attempt.

BRT's own pages disagree on the length, so go by the shape:

| Shape (invented) | What it is |
| --- | --- |
| `012345678912` | 12 digits: the shipment number on the waybill. |
| `01234567891234` | 14 digits: a BRTcode or shipment number. |
| `012345678912345` | 15 digits: a parcel ID the sender puts on the parcel. |
| 19 digits | A BRTcode, per BRT's tracking form. |

BRT's 3-digit security code, used to change a delivery, isn't a tracking number.

Nothing found on brt.it? The number may be mistyped, archived after 30 days or not yet in BRT's network. BRT's [Advanced Search](https://vas.brt.it/vas/sped_numspe_par.htm) covers 12 months, or 2 for parcel IDs.

Fourteen digits also fit DPD in Germany, Switzerland and the UK, and twelve fit Mondial Relay, Colis Privé and others, so check which carrier the shop's email or the SMS names. More in [tracking number formats](guide:tracking-number-formats).

## What BRT's tracking statuses mean

BRT's tracking at vas.brt.it opens in Italian, with a switch to English; these are its English wordings. Headers stay Italian: Data (date), Ora (time), Filiale (branch to ask), Evento (event). myBRT, where brt.it's box leads, may word them differently.

| BRT's status | What it means for you |
| --- | --- |
| `SHIPPING INFO SENT TO BRT` | BRT has the sender's details, not the parcel yet. |
| `COLLECTED` | BRT has collected it from the sender. |
| `DEPARTED` | It has left a BRT branch or hub. |
| `ARRIVED AT DEPOT` | It's at the branch named in the Filiale column. |
| `FOR DELIVERY` | It's out with the courier. |
| `UNKNOWN/INCOMPLETE CONSIGNEE` | Not delivered: the recipient or address wasn't found. |
| `DELIVERED` | Delivered. |
| `ARRIVED AT BRT-fermopoint` | Waiting for you at a BRT-fermopoint shop. |
| `COLLECTED AT BRT-fermopoint` | Picked up at the fermopoint. |
| `ARRIVED AT BRT LOCKER` | Waiting in a BRT locker. |
| `COLLECTED AT BRT LOCKER` | Taken out of the locker. |
| `RETURNED TO SENDER` | Going back to the sender. |

`COLLECTED` alone is BRT's pickup from the sender, not yours. In `UNKNOWN/INCOMPLETE CONSIGNEE` the consignee is you; BRT lists an unknown recipient or incomplete address among its reasons for a hold (below). A `DELIVERED` after `RETURNED TO SENDER` means the parcel is back with the sender.

## BRT parcel not delivered: missed attempts, fermopoints and lockers

If you're out, BRT leaves a notice by email, SMS or on paper, and the new attempt is usually the next working day. BRT's service charter adds a second attempt and, if that fails, a call from the branch.

With the link in BRT's message, or in the myBRT app or on [mybrt.it](https://www.mybrt.it) with your BRTcode and postcode or PIN, you may be able to pick another day or time slot, choose a BRT-fermopoint or the branch, release a parcel on hold or change the address if the sender allows it.

**On hold ("in giacenza").** Reasons include an absent or unknown recipient, a wrong or incomplete address and refused goods; the tracking detail shows which. Release it from BRT's message or the tracking. BRT asks the sender for instructions; without written ones, its charter says the parcel goes back 10 days after the sender was told, unless the shop's contract sets other days. Once the sender has given instructions, the tracking detail shows whether storage costs are charged, to the sender or to you; BRT publishes no amount.

**At a branch**, pick it up in person or send someone with their ID, a copy of yours and BRT's delegation form.

**BRT-fermopoint** shops (newsagents, tobacconists, stationers and others, some open at weekends) message you when the parcel arrives and keep it 10 days.

**BRT lockers** (in shops, shopping centres and petrol stations; outdoor ones open 24 hours) take single parcels up to 20 kg: scan the QR code from BRT's message or type the 8-digit PIN. For a faulty screen or an empty drawer, use the form at the bottom of BRT's pickup email.

## BRT parcel late, lost or damaged

BRT calls its delivery times indicative, and its pages say nothing about what to do when tracking stops moving. Ask the branch named in the tracking, or the shop, which holds the contract with BRT; see [tracking that isn't updating](guide:tracking-not-updating).

For loss or damage, if you paid the transport costs, use BRT's damage form with photos; if not, tell the sender. At the door, note visible damage on the waybill specifically (BRT says general remarks count for nothing), and report hidden damage in writing within 8 calendar days of receipt for parcels within Italy.

Recipients can complain too: attach BRT's complaint form, a PDF on its [Carta dei servizi page](https://www.brt.it/it/carta-dei-servizi/), to the form at services.brt.it/it/form-agcom. BRT answers within 45 days. Without a satisfying answer, conciliation follows via conciliazioni@brt.it with Casa del Consumatore, which you must join (€50 a year, €25 for disputes up to €50), then the regulator, AGCOM. No BRT page covers a parcel [marked delivered but not received](guide:delivered-not-received); this complaint route is the one that applies.

## BRT contact number and customer service

BRT's channels for recipients, as read on 9 October 2026:

- **Forms** on the English [Contact us](https://www.brt.it/en/customer-service/contact-us/) page, which shows no phone number.
- **Freephone** 800 278 708, Monday to Friday, 8.30am to 6.30pm, per BRT's Italian service charter. BRT doesn't say it works from abroad.
- **Email** assistenzaclienti@brt.it, also per the charter, with your name, surname, pickup and delivery postcodes and BRTcode, or BRT won't answer.
- **Chat** on brt.it, or your **branch**, via the [branch finder](https://services.brt.it/en/customer-service/search-for-a-branch).

The Bologna number on BRT's documents is its office, not customer service.

> On 16 April 2026 BRT warned of fake SMS and emails using its name, for example about missed deliveries. Check the sender and, if in doubt, don't click links or open attachments.

## Tracking BRT parcels with Peek

[Peek](/) recognises BRT's 12-, 14- and 15-digit numbers. Other carriers share them, so it asks BRT among the likely ones. Links from vas.brt.it with `brtCode=` work too; 19-digit BRTcodes and mybrt.it links don't.

Peek shows BRT's English statuses, except that a locker or fermopoint pickup appears as "Delivered". It puts each scan's place on a map, shows the weight and can notify you when the status changes. It drops the sender, recipient, merchant reference, parcel count and volume. It shows no expected day or pickup-point details and doesn't follow parcels handed to DPD abroad. BRT's scan times carry no time zone, so the times shown can differ from BRT's page, and some scans may not appear separately.

## Questions about BRT tracking

### Where is my BRT shipment?

BRT's latest tracking line tells you: `ARRIVED AT DEPOT` names the branch holding it, `FOR DELIVERY` means it's with the courier. Nothing yet? It may not have reached BRT.

### Is BRT the same as DPD?

Not exactly: both are brands of the Geopost group. For a parcel leaving Italy on DPD's network, BRT's tracking detail links to DPD's tracking.

### How long does BRT take to deliver?

Generally 24 to 48 hours in Italy, says BRT, plus 12 to 24 hours for Calabria, Sicily, Sardinia and places over 800 km away; 48 to 72 hours to most European countries.

### Where is the nearest BRT parcel shop?

BRT's [fermopoint finder](https://www.mybrt.it/it/mybrt/parcel-shops/search) lists the BRT-fermopoint shops near you. Parcels over 20 kg can't go to one.

:::sources
- [BRT: FAQ](https://www.brt.it/en/customer-service/faq/) – BRTcode, deliveries, holds, times, damage
- [BRT: Codes and Support](https://www.brt.it/en/customer-service/codes-and-support/) – where the BRTcode appears
- [BRT: Home](https://www.brt.it/en/) – "Where is my shipment?"
- [BRT: Rintraccia spedizione](https://vas.brt.it/vas/sped_numspe_par.htm) – lengths, search windows
- [BRT: Shipment detail help](https://vas.brt.it/vas/aiuto/aiuto.hsm?urlaiuto=sped_det_show.htm&lang=en) – holds, charges, branches, DPD
- [myBRT: Le mie spedizioni](https://www.mybrt.it/it/mybrt/my-parcels/search?lang=it) – not-found reasons
- [BRT: Privati](https://www.brt.it/it/privati/) – myBRT, fermopoint finder
- [BRT: BRT-fermopoint](https://www.brt.it/en/brt-fermopoint/) – shops, weekends, 10 days
- [BRT: Locker](https://www.brt.it/en/network/locker/) – QR code, PIN, limits
- [BRT: Branch pickup FAQ](https://www.brt.it/en/faq/can-i-pick-up-my-shipment-at-a-brt-branch/) – delegates
- [BRT: Contact us](https://www.brt.it/en/customer-service/contact-us/) – forms, branch finder
- [BRT: Carta dei servizi PDF](https://www.brt.it/wp-content/uploads/sites/275/2026/03/Carta-dei-Servizi_marzo_2026.pdf) – attempts, holds, damage, contacts, 45 days
- [BRT: Carta dei servizi](https://www.brt.it/it/carta-dei-servizi/) – complaints, conciliation, AGCOM
- [BRT: Modulo di Reclamo](https://www.brt.it/wp-content/uploads/sites/275/2026/02/2.-Modulo-Reclamo.pdf) – recipients may file
- [BRT: Conciliation instructions](https://www.brt.it/wp-content/uploads/sites/275/2026/02/3.-Modulo-di-Conciliazione-con-istruzioni.pdf) – membership fee
- [BRT: Condizioni generali](https://www.brt.it/wp-content/uploads/sites/275/2026/01/CONDIZIONI-GENERALI-CONTRATTO-TARIFFARIO_IT_CON-LOGO_REV-31.pdf) – agreed hold days
- [BRT: Alert phishing](https://www.brt.it/en/news/2026/04/16/alert-phishing-sms-email/) – fake messages
- [DPD: Home](https://www.dpd.com/en/) – Geopost's brands
- [Universal Parcel Scraper](https://github.com/plhery/universal-parcel-scraper) – what Peek reads
:::
