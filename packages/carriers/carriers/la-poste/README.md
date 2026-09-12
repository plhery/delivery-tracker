# La Poste / Colissimo

## Identity and scope

La Poste, the French postal operator, and its Colissimo parcel brand. This
folder owns the adapter for the group's unified tracking feed, which also
serves tracked mail, **Chronopost** and **Delivengo**: those two carriers have
their own folders for identity, numbers and portal facts and point their
`tracking.adapter` here. Last mile in France (`region.countries: ["FR"]`).

## Portals

- Public tracker: `https://www.laposte.fr/outils/suivre-vos-envois?code={trackingNumber}`.
  The page may drop its query string after moving the number into its own
  search field.
- Feed the page calls: `https://www.laposte.fr/ssu/sun/back/suivi-unifie/{number}?lang=fr`,
  keyless.
- The portal shows status, the event history with its country, a delivery
  estimate, and — for some shipments — recipient identity and address. The last
  two are dropped.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`, `provider_code`.

Status and last status text, the event history with each event's timestamp
(offset included, as the feed sends it), its country, its stage and its
`group/code` pair as `provider_code`, plus the delivery estimate while the
shipment is not final. When a shipment has no events yet, the completed
timeline step supplies the status text and date.

## Tracking numbers

Three families are accepted: 13-character domestic numbers (two alphanumerics
plus eleven digits), UPU S10 identifiers, and 15-character foreign express
numbers (fourteen digits plus a letter). Domestic numbers beginning `6` or `8`
and checksum-valid `…FR` S10 numbers that are not a Chronopost prefix are
detected with high confidence; the broader alphanumeric family stays a
suggestion. `numbers.json` holds published merchant examples, two publicly
reported numbers and three synthetic numbers built to the published shapes.

No second input is required: the feed is keyless.

## How the adapter works

One request with two tiers of the same request, declared as
`tracking.steps: ["direct", "retry"]`.

1. `direct` — one bounded GET of the unified feed with the public tracker as
   `Referer`.
2. `retry` — the same request again, run at most twice, only after an HTTP 403,
   and only while the original 15-second deadline still has time left. Each
   attempt is bounded by the time remaining on that one deadline, so the
   retries never extend the lookup.

The response is matched on `shipment.idShip` before anything is projected: a
feed entry for another number is refused. `returnCode` 104 is a positive
not-found; any other non-zero code is reported as inconclusive.

## Status reference

Each event carries a coarse `group` and a finer `code`. The code outranks the
group, the group outranks the wording, and explicit incident wording outranks
all three, because La Poste keeps a failed delivery inside its original group.

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| `registered` | `EXPANN`, `DR1` | live / fixture |
| `accepted` | `PC1` | live |
| `in_transit` | `ACHNAT`, `DISARR`, `ET1`, `EP1` | fixture / live |
| `out_for_delivery` | `DISTOU`, `MD1` | live |
| `ready_for_pickup` | `DISMAD`, `disponible au point de retrait`, `disponible en point relais`, `attend au relais` | fixture / live |
| `delivered` | `DESBAL`, `DESTIN`, `DESLIVD`, `DI1` | fixture / live |
| `returned` | `RETOUR`, any wording containing `retour` | live |
| `failed_attempt` | `incident`, `échec`, `impossible`, `refusé`, `non livré`, `n'a pas pu vous être remis` | fixture |
| `pending` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

Wording that neither the codes nor the French rules recognize falls through to
the shared multilingual classifier in `core/status`, and is recorded for review
if that leaves it unresolved.

## Limitations and privacy

- The feed carries a recipient block on the shipment and a recipient address on
  individual events. Neither is read: events are built from an explicit
  allowlist of wording, time, country and codes.
- `location` is the event's country, not a city: the feed does not publish a
  finer operational location.
- The delivery estimate is dropped once the shipment is final.
- Timestamps are kept exactly as the feed sends them, offset included. Values
  that are not a real calendar date are dropped rather than repaired.
- La Poste's edge can reject an anonymous lookup with an HTTP 403 "Site
  indisponible" page before it can answer; that is what the `retry` tier is for.

## Verification log

- 2026-09-10: the tracking-link audit confirmed the public tracker page
  interactively (docs/CARRIERS.md).
- 2026-09-10: production HTTP 403s carried the "Site indisponible - Incident en
  cours" page, and immediately following checks succeeded — the evidence behind
  the two immediate retries.
- 2026-09-12: moved into this folder. The feed, the status map and the retry
  budget are unchanged; the retries are now expressed as runner steps (see
  NOTES.md).
