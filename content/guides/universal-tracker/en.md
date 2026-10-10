---
title: Universal parcel tracking: all your parcels in one place
description: How universal parcel tracking works, what no tracker can see, and how 17TRACK, ParcelsApp, AfterShip and others compare on ads, accounts, notifications and price.
slug: universal-parcel-tracking
picture: Five vans in different colours, their dotted paths leading into one list on a phone, and Pip beaming from an open box.
published: 2026-10-09
updated: 2026-10-10
---

A universal parcel tracker (or universal package tracker) is a website or app that takes a tracking number from any carrier, works out whose it is, fetches the scans and keeps all your parcels in one list. It only shows scans the carrier has recorded, so it is never ahead of the carrier. Trackers differ in what they ask of you: an account, your inbox, a subscription for notifications or your patience with ads.

## Is there an app that tracks all your packages in one place?

Yes, and you may already have one: besides universal trackers, several national posts, Gmail, Apple Wallet, PayPal and Shop gather parcels. How a parcel gets in decides what the service sees:

| How the parcel gets in | What the service sees | Examples |
| --- | --- | --- |
| You paste a number or link | That number | Every tracker |
| You forward one email | That email | ParcelsApp, Shop, Deliveries |
| You connect your inbox | Your mailbox, filtered by its own rules | Shop, AfterShip, PayPal |
| The carrier or shop matches you | Your name, address, email or phone | USPS, Canada Post, Australia Post; Shopify orders in Shop |

## How do I see all the parcels coming to my house?

Start with the carriers' own free options:

| Country | Option | What it does |
| --- | --- | --- |
| US | USPS Informed Delivery | After an identity and address check, a Daily Digest email previews incoming mail and parcels |
| UK | DPD app | Lists DPD and DPD Local parcels matched to your phone or email and your address. Royal Mail's app only follows a tracking ID you enter or scan |
| Ireland | None found | The An Post app saves tracking numbers you enter and lets you pay customs charges, but lists nothing on its own |
| Canada | Canada Post automatic tracking | A personal account, verified with the name and address on your photo ID; business and PO box addresses aren't eligible |
| Australia | Australia Post app | Shows parcels automatically when the sender's data matches your MyPost details |

UPS My Choice does the same for UPS parcels in all five countries. Carrier by carrier, with the catches: [track a parcel without a number](guide:find-tracking-number).

Other options, with their limits:

- **Gmail** tracks only "for participating carriers in the US", with smart features on.
- **Apple Wallet** tracks orders from participating merchants.
- **PayPal** tracks purchases "whether you bought it with PayPal or not", in the US and UK among others, and is "rolling out to Australia and Canada". Ireland isn't named.
- **Shop** fills in Shopify and Shop Pay orders itself, and tracks only in its app.

## Which parcel tracking app is best?

None is best for everyone: it depends on your carriers and what you'll trade for notifications. Check these yourself, this page's claims included:

| Check | Where to look | Watch out for |
| --- | --- | --- |
| Account | Add one parcel without signing in | Guest caps: AfterShip's stops at 3 shipments |
| Ads | App Store: "Contains Advertising", under Age Rating. Google Play: "Contains ads" | Both rest on the developer's own answers |
| Notifications | The listing or help pages | Parcel keeps push notifications for subscribers |
| Your inbox | "Connect Gmail or Outlook" versus "forward an email" | Shop scans "the last 30 days" and keeps checking |
| Your data | The privacy label, Google Play's "Data safety", the privacy policy | The App Store label "has not been verified by Apple". Every tracker passes your number on |
| How long it keeps data | The privacy policy | Deliveries keeps forwarded emails "up to ten days"; ParcelsApp's Android listing says "Data can't be deleted" |
| Your carriers | Its carrier list | Counts are self-reported: 17TRACK says 2500+ on the App Store, 2800+ on its USPS page |

## Free or paid: the main trackers compared

Most start free, but with ads, a cap or no push notifications. Listed alphabetically, not ranked, from each one's own pages and US App Store listing on 7 October 2026. Peek, which publishes this guide, is listed like the others.

| Tracker | Account | Ads, as declared | Free use | Paid (US) |
| --- | --- | --- | --- | --- |
| 17TRACK | Needed to save and sync numbers | "Contains Advertising" | Quota not stated | $2.99 or $4.99 a month (quota: 100 or 200 a month) |
| AfterShip | Guest mode, up to 3 shipments | "Contains Advertising" | Free, with push notifications for "8 major" statuses | No in-app purchases listed |
| Deliveries | Optional, for Junecloud sync | None declared | None: a subscription is needed "to start using the app" | $4.99 a year or $0.99 a month |
| Parcel | No personal details required | "Contains Advertising" | 3 deliveries, no push notifications | $6.99 a year |
| ParcelsApp (Packages on iPhone) | "No registration required" | "Contains Advertising" | With ads | Premium removes ads and limits: $4.49 or $0.99, period not shown |
| [Peek](/) | Not to track; sign in to keep parcels together | None: it doesn't "serve advertising" | A daily lookup limit against bulk use | None: a "personal, non-commercial project" |

Local App Store prices that day:

| Subscription | US | UK | Ireland | Canada | Australia |
| --- | --- | --- | --- | --- | --- |
| 17TRACK Standard, monthly | $2.99 | £2.99 | €3.49 | CAD 3.99 | AUD 4.99 |
| Deliveries, yearly | $4.99 | £4.99 | €5.49 | CAD 6.49 | AUD 7.99 |
| Parcel premium, yearly | $6.99 | £6.49 | €6.99 | CAD 6.99 | AUD 6.99 |

Prices change: check "In-App Purchases" on your country's store.

## How does universal parcel tracking work?

Most trackers work in five steps:

:::steps
- You paste | A tracking number, the carrier's link or the shipping email. A link is safest: it names the carrier.
- It reads the shape | Letters, length and check digit narrow it down. `1Z999AA10123456784` starts with UPS's `1Z`; `RR123456785CH` has the 13-character shape national posts share.
- It weighs the candidates | Some shapes fit several carriers: a plain 14-digit number can be DPD, SEUR, [BRT](carrier:brt) or Hermes Germany, among others. It asks more than one, or lets you choose.
- It fetches the scans | From the carrier or another tracker, into one timeline.
- It checks again | At set intervals, and notifies you of anything new.
:::

To read a number yourself, see [tracking number formats](guide:tracking-number-formats).

### Where the scans come from

- **The carrier's data feed**, on its terms: DHL's API forbids mixing its data with advertising and wants it deleted 30 days after delivery, unless agreed otherwise.
- **The carrier's website**, read automatically. ParcelsApp's Android app "shows information from official websites of national postal services".
- **A paid push.** Parcel says live updates from the carrier usually arrive within 10 minutes, but most such carriers "charge Parcel for each tracked delivery".
- **Another tracker.** PayPal's tracking is "powered by Aftership". Peek's privacy notice names "ParcelsApp, Ship24, 17TRACK and the Universal Postal Union" among the services it asks when needed.
- **The shop.** Apple Wallet "displays information provided by the merchant".

### Why two trackers can disagree

Each has its own sources and pace. ParcelsApp's FAQ says one service can show a local delivery partner that another has not shown yet. The carrier's own site is the reference.

## What happens when the parcel changes carrier?

Abroad, parcels often change hands, and the local carrier "may keep the original number or give the parcel a new one", says ParcelsApp's FAQ.

:::journey
- shop | Seller | Ships under number A
- warehouse | Export hub | Scans under number A
- plane | Flight | Crosses the border on number A
- handover | Local carrier | Takes over and may give it number B
- home | Your door | Last scans may be under number B only
:::

Trackers that link numbers, such as ParcelsApp, join A and B when B shows up in the first carrier's data. If it never does, look for a new number in the full history and try it on the local carrier's site. For orders from Chinese marketplaces, see [tracking a parcel from China](guide:tracking-from-china).

## What a tracker can't see

Anything the carrier hasn't published. ParcelsApp puts it plainly: it "cannot create a scan that the company has not recorded". A tracker also sees each scan after the carrier, so delays add up:

- DHL in Germany says a new shipment can take up to 24 hours to show in its own tracking.
- Parcel says its app trails the carrier's website by "up to 90 minutes (on average it is 45 minutes)".

**USPS changed the rules.** Since 1 April 2026, access to USPS's tracking data feeds is tied to the Mailer ID in the barcode, and "Service Providers and Others" can get paid access. 17TRACK warns that unverified USPS lookups "will be throttled, charged, or blocked entirely". If a USPS number shows little in a tracker, check usps.com.

Nor can a tracker act for you: to change a delivery, pay a charge or report a loss, ParcelsApp sends you to the carrier's website. If the tracking hasn't moved for days, read [why tracking stops updating](guide:tracking-not-updating). If it says delivered and nothing is there, see [delivered but not received](guide:delivered-not-received).

## Is 17TRACK safe and legit?

Its own documents say who runs it and where your data goes. 17TRACK's privacy policy names VASTAR SINGAPORE TECHNOLOGY PTE. LTD. as responsible for registered users outside mainland China and Hong Kong, and says account data is stored on Tencent Cloud servers in Guangzhou, China, and in the United States. Its App Store listing declares "Contains Advertising".

The checklist above works for ParcelsApp or any other tracker too.

## Can a scammer send a fake tracking number?

Yes, usually by text, with a link. The US Postal Inspection Service says USPS only texts or emails you if you first asked for updates on a number, and even then the message "will NOT contain a link".

> Never tap the link in a delivery message you didn't ask for. Open the shop's order page or type the carrier's address yourself, and look for the same request. Messages asking for a fee are covered in [parcels held at customs](guide:customs).

:::sources
- [Peek: homepage](https://peektracker.com/) – no account needed
- [Peek: Privacy notice](https://peektracker.com/privacy.html) – no ads, services asked, daily lookup count
- [ParcelsApp: homepage](https://parcelsapp.com/en) – linked numbers
- [ParcelsApp: Privacy policy](https://parcelsapp.com/en/privacy) – forwarded emails
- [ParcelsApp: Why is my parcel not tracking?](https://parcelsapp.com/en/faq/why-is-my-parcel-not-tracking) – new numbers, no extra scans, fake messages
- [Google Play: Parcels](https://play.google.com/store/apps/details?id=com.brightstripe.parcels) – postal websites, data deletion
- [App Store: Packages](https://apps.apple.com/us/app/packages-track-your-parcels/id1229071393) – ads, Premium
- [Parcel: FAQ](https://parcelapp.net/help/faq/) – delay behind carriers
- [Parcel: Real-time notifications](https://parcel.app/help/real-time-notifications.html) – paid carrier pushes
- [App Store: Parcel](https://apps.apple.com/us/app/parcel-delivery-tracking/id375589283) – ads, free tier, price
- [Parcel: Privacy policy](https://parcelapp.net/privacy.html) – no personal details required
- [App Store: 17TRACK](https://apps.apple.com/us/app/17track-package-tracker/id1004956012) – account, ads, memberships
- [17TRACK: USPS tracking](https://www.17track.net/en/uspsTracking) – USPS limits, carrier count
- [17TRACK: Privacy Policy](https://www.17track.net/privacy-en.html) – controller, storage
- [App Store: AfterShip](https://apps.apple.com/us/app/aftership-package-tracker/id507014023) – ads, free notifications
- [AfterShip: Guest mode](https://support.aftership.com/en/tracking/articles/15441925-track-shipments-in-guest-mode) – three shipments
- [App Store: Deliveries](https://apps.apple.com/us/app/deliveries-a-package-tracker/id290986013) – prices
- [Junecloud: Subscriptions](https://junecloud.com/support/deliveries-ios/subscriptions.html) – subscription to start
- [Junecloud: Privacy overview](https://junecloud.com/support/deliveries-ios/deliveries-privacy-overview.html) – optional account, emails kept ten days
- [DHL Developer: Shipment Tracking API](https://developer.dhl.com/api-reference/shipment-tracking) – terms for tracking data
- [DHL: Probleme mit der Sendungsverfolgung](https://www.dhl.de/de/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html) – 24 hours to appear
- [USPS: Tracking API access changes](https://www.usps.com/business/api-access.htm) – Mailer ID access
- [USPIS: Smishing text scams](https://www.uspis.gov/news/scam-article/smishing-package-tracking-text-scams) – no links
- [USPS: Informed Delivery](https://www.usps.com/manage/informed-delivery.htm) – Daily Digest
- [Canada Post: Automatic tracking](https://www.canadapost-postescanada.ca/cpc/en/personal/manage-mail/automatic-tracking.page) – eligibility
- [Australia Post: App](https://auspost.com.au/personal/receiving/australia-post-app) – parcel matching
- [App Store UK: Royal Mail](https://apps.apple.com/gb/app/id1435168829) – tracking by ID or barcode
- [DPD UK: The DPD app](https://www.dpd.co.uk/lp/app/index.html) – parcels matched to your phone or email
- [UPS: UPS My Choice](https://www.ups.com/us/en/track/ups-my-choice) – UPS parcels to your address
- [App Store Ireland: An Post](https://apps.apple.com/ie/app/id399791956) – saved numbers, customs charges
- [Gmail Help: Package tracking](https://support.google.com/mail/answer/13073650?hl=en) – US carriers only
- [Apple Support: Track orders in Wallet](https://support.apple.com/en-us/105065) – merchant data
- [PayPal Help: Package tracking](https://www.paypal.com/us/cshelp/article/does-paypal-provide-package-tracking-help998) – AfterShip, countries
- [Shop Help: Delivery tracking](https://help.shop.app/en/shop/delivery-tracking) – automatic Shopify orders, app only
- [Shop Help: Track orders](https://help.shop.app/en/shop/delivery-tracking/track-orders) – inbox scan
- [Apple Developer: Age ratings](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) – advertising, developer's answers
- [Play Console Help: Ads declaration](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en) – "Contains ads" label
- [UPS: Sample package label](https://www.pld-certify.ups.com/CerttoolHelp/PLD0200/WebHelp_pld0200/LeadPackage.htm) – 1Z numbers
- [UPU: Standards](https://www.upu.int/en/postal-solutions/programmes-services/standards) – 13-character postal numbers
- [Universal Parcel Scraper: Carrier catalog](https://github.com/plhery/universal-parcel-scraper/blob/main/data/catalog.json) – shared 14-digit shape
:::
