# Delivengo

## Identity and scope

Delivengo (Delivengo Easy), La Poste's lightweight international export
service for small parcels and packets sent from France. Its `region.countries`
is deliberately empty: Delivengo hands a shipment to the destination country's
postal operator, so it is never the last-mile carrier itself.

Delivengo has no adapter of its own: `tracking.adapter` points at `la-poste`,
because the same unified feed answers Delivengo numbers. Read
[`../la-poste/README.md`](../la-poste/README.md) for the protocol, the tiers and
the projection rules; this folder carries Delivengo's identity, numbers and
portal facts.

## Portals

- Public tracker: the La Poste page,
  `https://www.laposte.fr/outils/suivre-vos-envois?code={trackingNumber}`.
- No Delivengo-specific link rule: the service publishes its FAQ at
  `mydelivengo.laposte.fr` but sends recipients to La Poste's tracker.
- Once a shipment leaves France, the destination post's own tracker is where
  the remaining history lives; this folder does not link to it.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`, `provider_code` — the same
projection as La Poste, because it is the same feed and the same `parse()`.

## Tracking numbers

Delivengo uses UPU S10 identifiers issued in France, such as the published
`LD…FR` family. It declares no detection rules of its own: its ranges overlap
other La Poste services, so a Delivengo parcel is added by choosing the carrier
manually and the engine resolves such numbers to La Poste / Colissimo.
`numbers.json` holds one synthetic number built to the published shape and
records that expectation explicitly.

## How the adapter works

The `la-poste` adapter, unchanged: one keyless request to `suivi-unifie`, plus
up to two immediate retries after an HTTP 403 inside the original deadline
(`tracking.steps: ["direct", "retry"]`).

## Status reference

No Delivengo status vocabulary has been observed, so `statuses.json` records a
gap rather than entries. Whatever the feed returns is classified by the shared
La Poste map in [`../la-poste/statuses.json`](../la-poste/statuses.json).

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| every stage | not observed on a Delivengo shipment; reported as unmapped | — |

## Limitations and privacy

- The same projection allowlist as La Poste applies: recipient blocks and
  addresses in the feed are never read.
- A public sample checked on 2026-09-08 returned an access error rather than
  usable history from the local public endpoint, so no Delivengo response has
  been parsed end to end. Routing and parsing rely on the La Poste tests.
- Because the destination post performs the last mile, a Delivengo lookup can
  go quiet after export even when the parcel is still moving.

## Implementation decisions

- **No adapter of its own.** `tracking.adapter: "la-poste"`. Delivengo numbers
  are answered by the same La Poste unified feed. The mechanics live in
  [`../la-poste/README.md`](../la-poste/README.md).
- **No detection rules.** Delivengo's number ranges overlap other La Poste
  services, so adding a rule would either steal numbers from Colissimo or
  produce another ambiguous suggestion. The carrier stays selectable in the
  manual picker and `numbers.json` records that the engine resolves its sample
  to La Poste / Colissimo.
- **`region.countries` is empty on purpose.** Delivengo is an export service
  from France: the last mile belongs to the destination post, and the field
  records last-mile coverage.
- **`statuses.json` records a gap instead of copying the La Poste entries.**
  Nothing has been observed on a Delivengo shipment, and inventing entries would
  claim evidence this folder does not have.

## Rejected alternatives

- **Adding a Delivengo detection rule anyway.** It would collide with La Poste
  and Chronopost without giving the user a better answer than the manual picker.
- **Linking to `mydelivengo.laposte.fr`.** That portal is the sender's account
  area and its FAQ, not a recipient tracker; the La Poste page is where a
  recipient can follow the parcel.
- **Copying the La Poste status table into this README.** It would read as
  Delivengo evidence. The table says "not observed" and points at the shared
  map instead.


## Verification log

- 2026-09-08: the published `LD…FR` sample (Philaseiten, a May 2023 example)
  returned an access error from the local public endpoint — not usable history
  (docs/CARRIERS.md).
- 2026-09-12: folder documented; `tracking.steps`, `capabilities` and the
  portal fields were filled in to match the shared adapter.
