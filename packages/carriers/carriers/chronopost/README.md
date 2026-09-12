# Chronopost

## Identity and scope

Chronopost, the express arm of the La Poste group in France, including its
Chrono Shop2Shop relay service. Last mile in France
(`region.countries: ["FR"]`).

Chronopost has no adapter of its own: `tracking.adapter` points at `la-poste`,
because the same unified feed answers Chronopost numbers. Read
[`../la-poste/README.md`](../la-poste/README.md) for the protocol, the tiers and
the projection rules; this folder carries Chronopost's identity, numbers and
portal facts.

## Portals

- Public tracker: `https://www.chronopost.fr/tracking-no-cms/suivi-page?langue=fr&listeNumerosLT={trackingNumber}`
  — the link the app shows.
- Recognized link domains: `chronopost.fr`, `chronotrace.chronopost.fr`,
  `chronoshop2shop.fr`, with the `listeNumerosLT`, `listeNumeros` and
  `numeroLT` parameters.
- Tracking data is not read from this portal: it comes from La Poste's unified
  feed (`suivi-unifie`).

## What we retrieve

Declared capabilities: `history`, `location`, `eta`, `provider_code` — the same
projection as La Poste, because it is the same feed and the same `parse()`.

## Tracking numbers

Three families: the `PZ`, `XU`, `XW` and `XY` S10 prefixes Chronopost issues
(detected with high confidence once the S10 check digit passes), 15-character
numbers of fourteen digits plus a letter, and the generic S10 shape. The last
two stay low-confidence suggestions. `numbers.json` records published examples
attributed to Chronopost that detection resolves to La Poste / Colissimo
instead; the records keep what the engine actually answers.

## How the adapter works

The `la-poste` adapter, unchanged: one keyless request to `suivi-unifie`, plus
up to two immediate retries after an HTTP 403 inside the original deadline
(`tracking.steps: ["direct", "retry"]`). The feed returns Chronopost shipments
with an empty `group`, so the event `code` is the only status key.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `registered` | `DR1` | fixture |
| `accepted` | `PC1` | live |
| `in_transit` | `ET1`, `EP1` | live |
| `out_for_delivery` | `MD1` | live |
| `delivered` | `DI1` (observed with "Livraison effectuée") | fixture |
| `returned` | any wording containing `retour` | live |
| `failed_attempt` | incident wording (see `../la-poste/statuses.json`) | fixture |
| `pending` | not observed; reported as unmapped | — |
| `ready_for_pickup` | not observed on Chronopost shipments; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

The group column of the shared map does not apply here: Chronopost events
arrive without one.

## Limitations and privacy

- The same projection allowlist as La Poste applies: recipient blocks and
  addresses in the feed are never read.
- Chronopost's own portal may show more than the unified feed exposes
  (`portal.unavailable` is left empty because that difference has not been
  verified, not because it is known to be none).
- The Chronopost SOAP service is deliberately not used: it exposes more
  consignment metadata than tracking needs and is not intended for automated
  extraction.

## Implementation decisions

- **No adapter of its own.** `tracking.adapter: "la-poste"`. The La Poste
  unified feed answers Chronopost numbers with the same shape, so a second
  implementation would only add a second thing to keep working. The mechanics
  live in [`../la-poste/README.md`](../la-poste/README.md).
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

- 2026-09-12: normalization of a Chronopost shipment through the unified feed
  is covered by `../la-poste/adapter.test.ts` ("normalizes Chronopost shipments
  returned by the same unified API").
- 2026-09-12: folder documented; `tracking.steps`, `capabilities` and the
  portal fields were filled in to match the shared adapter.
