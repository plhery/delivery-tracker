# Chronopost notes

## Decisions

- **No adapter of its own.** `tracking.adapter: "la-poste"`. The La Poste
  unified feed answers Chronopost numbers with the same shape, so a second
  implementation would only add a second thing to keep working. The mechanics
  live in [`../la-poste/NOTES.md`](../la-poste/NOTES.md).
- **The event `code` is the only status key here.** Chronopost shipments come
  back from the feed with an empty `group`, so `statuses.json` in this folder
  lists codes only and defers to the shared map for everything else.
- **Detection is split from La Poste by prefix.** `PZ`, `XU`, `XW` and `XY` S10
  prefixes select Chronopost; the La Poste S10 rule explicitly excludes them.
  Everything else numeric stays a suggestion the user confirms.
- **`carrier.json` keeps the Chronopost portal URL** even though tracking data
  comes from La Poste's feed: the link the app shows a user should be the one
  that brand prints on its label.

## Rejected alternatives

- **The Chronopost SOAP tracking service.** It exposes more consignment
  metadata than tracking needs and is not intended for automated extraction;
  the unified feed answers the same numbers with less.
- **Scraping `chronopost.fr` directly.** Same objection, plus a second portal to
  maintain for no additional field the app displays.
- **Claiming the Chronopost portal shows fields the feed hides.** Plausible —
  express shipments usually have a proof of delivery — but unverified, so
  `portal.unavailable` stays empty rather than guessing.

## Verification log

- 2026-09-12: a Chronopost shipment (`PZ…JF`, synthetic) normalized through the
  shared adapter with an empty `group` and code `DI1`, covered by
  `../la-poste/adapter.test.ts`.
- 2026-09-12: `numbers.json` records that two published examples attributed to
  Chronopost are resolved to La Poste / Colissimo by the detection engine; the
  expectations record what the engine answers rather than what the source
  claimed.
