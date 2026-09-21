# Tracking event languages

Investigation dated 2026-09-21. The proposal below is not implemented. Choose
tracking sources for coverage, freshness and verified identity; choose display
language separately. A carrier handoff can improve destination history but
does not translate earlier origin scans.

## Current application behavior

- Web and iOS share seven UI catalogs: English, German, French, Italian,
  Spanish, Portuguese and Polish. Stage headings, app messages and exact
  synthesized carrier labels are already localized through
  [the shared message map](../shared/tracking-messages.json).
- Arbitrary carrier descriptions retain their original text in both
  [`localizedEventDescription`](../src/i18n.tsx) and the native
  [`eventDescription`](../ios/SwissDeliveryTracker/Core.swift). The multilingual
  [status classifier](../packages/carriers/core/status/language.ts) recognizes
  wording; it is not a translator.
- [`TrackingInput`](../packages/carriers/core/adapter/index.ts) has no locale.
  UPU and EMS request English; Ship24 and ParcelsApp request English; 17TRACK
  opens an English page; Swiss Post loads an English message dictionary.
  La Poste explicitly requests French. These settings do not establish the
  language of every returned event.
- [`providerEventId`](../src/server/trackingSync.ts) hashes carrier, time,
  location and description. UPU's archive identity also includes its label.
  Changing stored descriptions when a user changes language could duplicate
  scans. Translate presentation independently of stored event identity.

## Verified upstream behavior

The [UPU API](https://upu.api.post/gtt/) accepts a language code in
`ItemTTWithTrans/{itemID}/{langCd}`. Fresh anonymous requests for the public
Venezuela control used all seven app languages. The original English capture
and six new language responses had the same item identity, event codes, dates
and locations:

| Requested language | Actual labels on the four scans |
| --- | --- |
| `EN` | English |
| `FR` | French, including `Départ du bureau d'échange export` |
| `ES` | Spanish, including `Salida de la oficina de cambio de salida` |
| `DE`, `IT`, `PT`, `PL` | English fallback in this sample |

This verifies native event-label localization for French and Spanish, not
coverage of every UPU code/language. The excluded `DLV` forecast remained English
in Spanish and was French in the French response. Language requests must not
change forecast filtering or infer that all fields share the requested language.
The live adapter still uses `/EN`; changing locale does not fill missing history.

ChinaPostalTracking embeds the [17TRACK widget](https://www.17track.net/en/widget).
Its `YQ_Lang` option controls interface language. The English widget returned
Chinese China Post descriptions, Portuguese Correios descriptions and English
USPS descriptions in the [three-reference check](../packages/carriers/providers/COMPARISON.md#17track-widget-follow-up).
Checking its separate English translation toggle translated the Venezuela scans.
Network observation showed a failed Microsoft Translator request followed by a
successful Google translation request. Example wording included `Plane arriving`
and the awkward `email` for a postal item. This is machine translation of the
same scans, not a richer feed or verified carrier-authored English.

The [widget help](https://help.17track.net/hc/en-us/articles/228250808-Operation-Instructions)
describes translation separately from carrier selection and attributes it to
Bing; the observed fallback shows why that documentation alone does not prove
the active translation backend. Do not copy its client tokens/keys or assume
the widget grants a free backend translation API.

Separately, the [official 17TRACK API v2.4](https://api.17track.net/en/doc)
documents `lang` with carrier-native descriptions where supported and carrier
default or partner translation otherwise. This is an API-key integration;
[translation help](https://help.17track.net/hc/en-us/articles/37524580390809-How-to-translate-tracking-trace-info-into-different-languages)
also describes an additional tracking-quota charge. It was not provisioned or
tested here and is not equivalent to changing the public page's language.

## Recommended implementation sequence

1. **Preserve semantics before translating.** Retain provider/operator, raw
   description, language when evidenced, stable event codes and time provenance.
   Map verified codes before language heuristics. In particular, 17TRACK's
   nullable `stage` must not hide a useful `sub_status`; see its
   [parser findings](../packages/carriers/providers/seventeentrack/README.md#china-post-widget-investigation).
   Translation must not determine terminal status, handoffs or UTC freshness.
2. **Extend shared display messages by stable codes.** Use provider-scoped
   codes and validated templates for common scans, retaining details such as
   customs release versus presentation. Prefer native translated labels or a
   maintained shared catalog. This can cover web and iOS without seven tracking
   requests per sync or a routing change when the user changes language.
3. **Translate remaining free text as a separate, cached operation.** Keep the
   source available and mark machine translations. Cache by source text,
   evidenced source language, target language and translator/version; avoid
   shared caching of private free text. Supply only necessary text, not the
   tracking identifier or raw shipment payload. Use an explicitly configured
   translation integration, with its own timeout, quota and failure behavior.
4. **Use requested language → available English → original as display fallback.**
   A failed or unsupported translation must not delay parcel refresh or hide
   the original scan. Language changes must not insert scans, trigger progress
   notifications, change status or replace the successful tracking source.

Carrier switching remains subject to the existing
[handoff confirmation rules](tracking-routing.md). The US reference demonstrates
that destination history can already be English; the Brazil reference supplies
Portuguese instead. Destination country alone does not prove a delivery carrier
or a user's language. A source's readable but sparse history should not displace
richer movement merely to obtain English wording.

Before implementation is considered complete, verify source-language fallback,
translation failure, preservation of original detail, web/iOS parity, duplicate
event prevention across locale changes, and unchanged status/notification
behavior across carrier and provider changes. Live numbers and response bodies
from this investigation remain outside the repository; public provenance is in
the linked comparison.
