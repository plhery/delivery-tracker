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
| `exception` | "COMPLEMENT ADRESSE", "adresse incorrecte", "incident", "anomalie", "refusé" | fixture |
| `failed_attempt` | "destinataire absent", "non livré" | prior-art |
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

## Implementation decisions

- **The empty 200 is indeterminate, the echoed empty table is a 404.** The
  portal's honest wrong-number answer still renders the banner with the number
  it searched and an empty scan table; that is a clean `NotFoundError`. A
  completely empty body has also been observed transiently and proves nothing,
  so it raises `IndeterminateError` and the parcel is retried instead of being
  marked as unknown to the carrier.
- **Verify the echoed number first.** Nothing is read from the page until the
  banner's 14 digits match the number requested, so a session or cache that
  answers for another parcel can never become this parcel's history.
- **Places must look like a depot.** The place cell is free text; on failure
  rows it carries the recipient's address. The adapter keeps it only when it
  matches `CITY 68 (68)` — the same department number before and inside the
  parentheses — and drops it outright on exception rows.
- **Our own English descriptions.** The provider's French label decides the
  stage but is not returned; each mapped phrase supplies the wording we show.
- **`zonedTime` over a local parser.** The three date formats the page uses are
  naive French wall-clock values, which is exactly `core/time`'s `zonedTime`
  policy, so the local parser was replaced by a loop over it.

## Rejected alternatives

- **Treating the empty body as a 404.** It would mark live parcels as unknown
  to the carrier during a transient portal outage, and the routing layer would
  then back off for a day.
- **Keeping the place cell verbatim.** It is the recipient's address on exactly
  the rows a user is most likely to look at.
- **Returning the French label as the description.** Ciblex labels mix case and
  accents inconsistently ("Colis Livré" / "COLIS LIVRE"); mapping to our own
  wording keeps the timeline readable and the classifier deterministic.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `560815852502035603344150` (full_barcode, `public_shipment_report`, [source](https://fr.trustpilot.com/review/www.ciblex.fr)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — postcode + house-number notice (trans-o-flex) |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

Also tried `560815852502035613344150` on Ship24: 404.

## Verification log

- 2026-09-12: moved into this folder; the page shape, the identifier check and
  the status map are unchanged.
- 2026-09-12: `CiblexTrackingError` → `NotFoundError` (same 404 and message);
  the bare empty 200 → `IndeterminateError`; identifier and mismatch rejections
  → `SchemaError`.
- 2026-09-12: universal-provider probe with corpus number `560815852502035603344150`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
