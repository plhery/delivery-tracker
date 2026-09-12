# GLS France

## Identity and scope

GLS France (General Logistics Systems France) is the French arm of the GLS
parcel network: business-to-consumer parcels delivered to the door, to a GLS
ParcelShop or to a GLS locker. This folder covers French last-mile shipments
only (`region.countries: ["FR"]`); GLS Switzerland and GLS Germany are separate
folders with their own endpoints and number formats.

Timezone: `Europe/Paris`. Brand colour `#ffdd00`.

## Portals

| What | Where |
|---|---|
| Recipient portal | `https://moncolis.gls-france.com/fr/{trackingNumber}` |
| Endpoint used | `GET https://public.infra-prod.prod.cloud.fr.gls-group.com/consignee-ws/api/v1/command/public/codes/{trackingNumber}` |
| Canary | `https://moncolis.gls-france.com/fr/` |

Links pasted from `moncolis.gls-france.com/fr/<number>` and from
`gls-group.com` / `gls-group.eu` `/FR/` pages with a `match`, `parcelNumber` or
`matchParcelNumber` parameter are recognized and resolve to this carrier.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`, `provider_code`.

| Portal shows | We retain | We drop |
|---|---|---|
| status, history, location, eta | status, history, location, eta | — |
| recipient name and address | — | recipient name and address |
| recipient contact details | — | recipient contact details |
| signature name | — | signature name |
| delivery instructions | — | delivery instructions |

The endpoint returns the parcel record, the event list, an address block and a
signature/comment block. `parse()` reads an allowlist of status codes,
timestamps and the operational location code; it never copies provider objects,
and the offline test feeds a payload full of recipient placeholders and asserts
none of them reach the result.

Locations are GLS facility codes such as `FR0012`, not addresses. The estimated
delivery date is the day part of `dateTheoriqueLivraison`.

## Tracking numbers

Two accepted shapes, both stored uppercase with spaces, dots and dashes removed:

- eight letters and digits, in practice starting `00` (high confidence when it
  starts `00` and mixes letters and digits);
- eleven digits (low confidence: the shape collides with several carriers).

Twelve-digit numbers printed by some merchants stay a low-confidence suggestion
with candidates rather than selecting GLS France automatically. See
`numbers.json` for the samples and what the engine answers for each.

## How the adapter works

One step, `direct`: a single bounded `GET` to the consignee endpoint with the
portal's `Origin` and `Referer`, a 12 s timeout and a 750 kB response cap.
`parse()` then:

1. verifies that the response echoes the requested number in `trackid`,
   `numeroalphaColis` or `numeroGp`, and rejects anything else as a schema
   error;
2. reads up to 500 events, de-duplicates them on (time, location, code), sorts
   newest first and returns at most 100;
3. resolves the parcel-level status from `statutColis`, falling back to the
   newest event's code.

Timestamps arrive in three shapes on the same fields (ISO with or without an
offset, a SQL-style wall clock, a bare calendar day). An explicit offset is
honoured; everything else is read in `Europe/Paris`. Empty timestamps arrive
padded with year 1 and are dropped.

## Status reference

GLS France sends codes, never wording, so the map is the only status source.

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| registered | CON | fixture |
| accepted | REC | official-doc |
| in_transit | EXP, PBC, DEP, DEK | official-doc |
| in_transit | DEL | fixture |
| customs | DOU | official-doc |
| out_for_delivery | TRV | official-doc |
| ready_for_pickup | LIK | fixture |
| ready_for_pickup | LIP, LTP, LTK, PAQ | official-doc |
| delivered | LIV | fixture |
| delivered | LTV, LTL, LIL, LIT, LTT | official-doc |
| failed_attempt | DEL with typeEvenement LIV | fixture |
| failed_attempt | INC, PBP, NLI, NLK, NLP, PBA, SIN | official-doc |
| returned | RET, LIR | official-doc |
| pending | not observed; reported as unmapped |  |

A code outside this map produces an event with a description and no stage; the
sync classifies it and records it for review.

## Limitations and privacy

- Undocumented consignee endpoint; it can change or start challenging requests
  without notice. Failures stay visible for retry.
- A validly shaped unknown number answers HTTP 404, which the runner reports as
  a definite not-found.
- No sender name, pickup-point name, weight or dimensions are exposed by this
  endpoint, so those capabilities are not declared.
- Everything identifying a person in the response is dropped before the result
  is built; see `PRIVACY.md` for the package-wide policy.

## Verification log

- 2026-09-12: adapter, tests and status map moved into this folder unchanged in
  behaviour except that unmapped codes no longer receive a default `in_transit`
  stage.
- 2026-09-12: a validly shaped wrong number (`00ZZ00Z0`) answers HTTP 404 with a
  plain-text body; the opt-in live test asserts that.
