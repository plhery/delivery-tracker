# Ciblex

## Identity and scope

Ciblex is a French express network for time-critical and pharmaceutical
deliveries. Automatic tracking is enabled through its public parcel-tracking
page; the carrier is selectable in the manual picker on the web and in both
iPhone interfaces.

## Portals

| Purpose | URL |
|---|---|
| Public parcel page | https://secure.extranet.ciblex.fr/extranet/client/corps.php?module=colis&colis={trackingNumber} |
| Entry page that links to it | https://ciblex.eu/suivi-colis-express/ |

Recognized tracking links: any `secure.extranet.ciblex.fr` URL carrying a
`colis` parameter.

The page shows the status banner, the scan table and — on failure rows — the
recipient address in the place column, next to a customer and order block.
Only the status and the scan table are retained.

## What we retrieve

| Field | Retained | Note |
|---|---|---|
| `status`, `current_stage` | yes | from the most recent mapped row |
| `events[].time` | yes | `dd/MM/yyyy` plus optional time, read in Europe/Paris |
| `events[].stage` | yes | from `status.ts` |
| `events[].description` | yes | our own English wording, not the provider's |
| `events[].location` | yes | only when the cell matches the depot shape `CITY 68 (68)`, and never on a failure row |
| `expected_delivery` | no | the page carries none |
| customer and order block, recipient address | no | never read |

Declared capabilities: `history`, `location`.

## Tracking numbers

Fourteen digits, the parcel number printed on the Ciblex label
(`12345678901234`). That shape is shared with several European carriers, so the
detection rule `ciblex-1` is low-confidence and the user confirms the carrier.
`numbers.json` also holds two publicly reported 24-digit values which are full
label barcodes rather than the number a user types; the engine claims neither.

## How the adapter works

One step, `direct`, one bounded GET of the public page. The response is parsed
with Cheerio:

1. `.t_bandeau_detail td` must echo `SUIVI COLIS : <14 digits>`, and that value
   must equal the number requested. A different number is a `SchemaError`.
2. Each `table[border="2"] tr` with exactly four cells becomes a candidate
   event; the header row is skipped by comparing its first cell to "date".
3. Rows are de-duplicated on time, stage and place, sorted newest first and
   capped at 100.

## Status reference

The page prints French action labels and no status code, so the map is
phrase-based and compared without case or diacritics.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| `returned` | "Retour expéditeur" | fixture |
| `delivered` | "Colis Livré" | fixture |
| `out_for_delivery` | "Mis en livraison" | fixture |
| `ready_for_pickup` | "Disponible au relais" | fixture |
| `failed_attempt` | "COMPLEMENT ADRESSE" | fixture |
| `in_transit` | "Colis Contrôle" | fixture |
| `accepted` | "Colis pris en charge" | fixture |
| `registered` | "annonce", "information reçue" | prior-art |
| `pending` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |

`statuses.json` lists every phrase in the map, including the spelling variants
inherited from the pre-package adapter. Unrecognized wording keeps the neutral
description "Ciblex tracking update" and is left for the sync's classifier.

## Limitations and privacy

- A completely empty HTTP 200 has appeared transiently. It proves nothing about
  the shipment, so it is an `IndeterminateError`, not a 404. The wrong-number
  answer is different and recognizable: the page echoes the number with an
  empty table.
- Places are only retained when they match the depot shape the portal uses, and
  never from an exception row, because those rows describe the recipient's own
  address.

## Verification log

- 2026-09-12: moved into this folder; the page shape, the identifier check and
  the status map are unchanged.
- 2026-09-12: `CiblexTrackingError` → `NotFoundError` (same 404 and message);
  the bare empty 200 → `IndeterminateError`; identifier and mismatch rejections
  → `SchemaError`.
