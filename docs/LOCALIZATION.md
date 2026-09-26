# Tracking text languages

App copy is fully translated ([shared/locales](../shared/locales/README.md)). Carrier scan
text is a different problem. This page covers what happens to it today and a plan for
translating it (not implemented).

## Today

- Stage headings, app messages and the exact descriptions our adapters synthesize are
  translated through [`shared/tracking-messages.json`](../shared/tracking-messages.json).
- Any other carrier description is shown as the carrier wrote it, on web
  (`localizedEventDescription` in [`i18n.tsx`](../src/i18n.tsx)) and iOS
  (`eventDescription` in `Core.swift`). The [multilingual classifier](../packages/carriers/core/status/language.ts)
  reads wording to pick a stage. It doesn't translate.
- `TrackingInput` has no locale. UPU, EMS, Ship24, ParcelsApp, 17TRACK and Swiss Post are
  asked for English; La Poste for French. That doesn't guarantee the language of every
  event.
- Event identity ([`providerEventId`](../src/server/trackingSync.ts)) hashes carrier, time,
  location and description. Rewriting stored descriptions per language would duplicate
  scans, so translation has to happen at display time. DPD is the one source whose new
  wording takes over a stored scan, and only at that scan's exact instant: the row is
  updated in place. A universal copy that DPD took over keeps its identity, so its wording
  then follows whichever source answered last
  ([`eventIdentity.ts`](../src/server/eventIdentity.ts)).
- Pick tracking sources for coverage, freshness and identity, never for language. A handoff
  can bring English destination scans but never translates earlier origin scans.

## What upstreams offer

- **UPU** accepts a language in `ItemTTWithTrans/{itemID}/{langCd}`. French and Spanish
  returned native labels with identical codes, dates and places. German, Italian,
  Portuguese and Polish fell back to English. The adapter still requests `EN`.
- **17TRACK's public widget** has an interface language (`YQ_Lang`) that doesn't translate
  scans: China Post stayed Chinese, Correios Portuguese. Its separate translate toggle is
  third-party machine translation of the same scans, of mediocre quality. Don't reuse its
  client keys.
- **The official 17TRACK API** documents a `lang` parameter, but it needs an API key and
  costs extra quota. Not tested.

## Plan

1. **Keep semantics first.** Store provider, raw description, evidenced language, stable
   event codes and time provenance. Map codes before wording heuristics. Translation must
   never decide status, handoffs or freshness. 17TRACK sub-status codes are already mapped
   this way.
2. **Translate stable codes with shared templates.** Common scans get provider-scoped codes
   and validated messages in the shared catalog. This works on web and iOS without extra
   requests per language.
3. **Machine-translate the rest separately, with a cache.** Mark machine output as such
   and keep the original. Cache by source text, source language, target language and
   translator version. Send only the text, never the tracking number or raw payload, and
   give the integration its own timeout and quota.
4. **Fallback order: requested language → English → original.** A failed translation never
   delays a refresh or hides the original. Changing language never inserts scans, triggers
   notifications, changes status or switches source.

Done means: fallbacks work, originals stay available, web and iOS match, no duplicate events
across language changes, and status and notifications are unchanged.
