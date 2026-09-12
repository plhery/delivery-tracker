# C Chez Vous

## Identity and scope

C Chez Vous (`cchezvous.fr`) delivers bulky retail orders in France on a booked
appointment: an order, not a parcel journey, made of one or more parcels that
each advance through a five-step progress bar. This folder covers its public
order-tracking page (`region.countries: ["FR"]`).

Timezone: `Europe/Paris`. Brand colour `#e50046`.

## Portals

| What | Where |
|---|---|
| Recipient portal and endpoint | `https://www.cchezvous.fr/suivi-colis/{trackingNumber}` |
| Canary | `https://www.cchezvous.fr/suivi-colis` |

The page is server-rendered and embeds the whole order record as JSON in a
`<tracking :tracking-results="…">` attribute, so the adapter reads exactly what
the recipient sees. Links pasted from `cchezvous.fr/suivi-colis/<reference>`
resolve to this carrier.

## What we retrieve

Declared capabilities: `eta`.

| Portal shows | We retain | We drop |
|---|---|---|
| five-step progress bar | status and current stage | — |
| appointment date | the day, as the estimate | — |
| appointment time window | — | time window ("Entre 08h00 et 13h00") |
| shop / dealer name and address | — | shop and dealer details |
| recipient name and address | — | recipient name and address |
| recipient phone and e-mail | — | contact details |
| ordered articles | — | order contents |

The embedded record carries everything the order knows about the customer.
`parse()` reads `package_number`, each parcel's `parcelStep` and `date`, and
nothing else. The offline test feeds a record whose shop, recipient, contact,
address and article fields are placeholders and asserts none of them, nor the
appointment window, reach the result.

There is **no scan history**: the result carries one event describing the
current step, so `history` is deliberately not declared as a capability.

**The reference is a secret.** The order reference alone opens the page. Treat
it like a password: never log it, quote it in an issue, or commit a real one.

## Tracking numbers

Two accepted shapes, uppercased with spaces removed:

- an 8- to 15-character order reference containing at least one digit
  (`FGRC45BKLM`); a 4-letter + 2-digit + 4-character reference is a
  high-confidence detection rule;
- an 11-character order followed by `--` and a French postcode
  (`4TZKO156790--59600`). Shared normalization strips punctuation, so the
  compact `4TZKO15679059600` is restored to the `--` form before use.

An invalid French postcode in the composite form is rejected before any request
is made. See `numbers.json` for the published examples.

## How the adapter works

One step, `direct`: a bounded `GET` of the tracking path with
`redirect: 'manual'` and `allowHttpError: true`, a 15 s timeout and a 1 MB cap.
Then:

1. A 404 or any 3xx is a not-found: an unknown order is bounced back to the
   tracking form.
2. Other non-2xx statuses become `UpstreamHttpError`.
3. `parse()` recognizes the page's "commande introuvable" text as a not-found,
   requires the `tracking` element's attribute, and checks the embedded
   `package_number` **and** the reference printed in the heading against the
   requested credential.
4. The order's step is the least advanced of its parcels, so a multi-parcel
   order is only complete when every parcel is. A parcel on a step outside 1–5
   makes the whole order unknown.
5. The estimate is the latest parcel appointment day, dropped once the order is
   delivered.

## Status reference

Machine steps with the wording the progress bar prints.

| Stage | Code (raw) | Wording | Confirmed by |
|---|---|---|---|
| registered | 1 | Commande enregistrée | fixture |
| registered | 2 | Prise de rendez-vous | official-doc |
| in_transit | 3 | Commande en préparation | fixture |
| out_for_delivery | 4 | Commande en livraison | fixture |
| delivered | 5 | Commande livrée | fixture |
| pending | not observed; reported as unmapped | | |
| accepted | not observed; reported as unmapped | | |
| customs | not observed; reported as unmapped | | |
| ready_for_pickup | not observed; reported as unmapped | | |
| failed_attempt | not observed; reported as unmapped | | |
| returned | not observed; reported as unmapped | | |

A step outside 1–5 gives a result with no `current_stage` and one event with no
stage; the sync classifies it and records it for review.

## Limitations and privacy

- Undocumented page; a markup or attribute change breaks parsing loudly.
- No scan history, no locations, no failure or return steps are exposed. A
  cancelled or failed order simply stops advancing.
- Day-resolution estimate only; the appointment window is dropped on purpose.
- The order reference is part of the tracking credential.

## Implementation decisions

- The page is parsed rather than a hidden API called: the record the frontend
  renders is already embedded in the HTML, so one bounded `GET` gets everything
  with no session, token or second request. One `direct` step.
- The order reference is checked twice — against the embedded `package_number`
  and against the reference printed in the heading — because the page is a
  single-page app shell and a stale or generic render would otherwise pass as a
  result for the wrong order.
- The order's step is the **least advanced** of its parcels. An order with one
  delivered and one still-preparing parcel is not delivered, and reporting it as
  delivered would stop notifications for the rest of it.
- Only the calendar day of the appointment is kept. `dateMessage` ("Entre 08h00
  et 13h00") is a fact about the recipient's day, and the offline test asserts it
  never reaches the result.
- `history` is not declared as a capability even though the result has an
  `events` array. The page has no scan history; the single event restates the
  current step, and declaring a capability the adapter cannot really deliver
  would make the capability list meaningless.
- 2026-09-12: a `parcelStep` outside 1–5 is no longer clamped to step 1. It used
  to report "Commande enregistrée", which claims an order has not started — a
  statement we cannot make about a step the provider just introduced. Such an
  order is now reported as unknown, with no stage, so the sync classifies it and
  records it for review.

## Rejected alternatives

- Reading `parcels[].pickupName`, `address`, `mail` or `mobile` for a richer
  status line: the adapter omits these recipient identity and contact fields.
- Keeping `articles` to label the shipment: order contents are customer data and
  are never retained.
- Declaring `pickup_point`: `pickupName` is the person receiving the order, not
  a parcel shop, despite the field name.
- Treating the redirect to the tracking form as a transport failure: it is the
  provider's stable way of saying it does not know the order, so it is a
  not-found.


## Verification log

- 2026-09-12: adapter, tests and the step map moved into this folder.
  `CChezVousTrackingError` was replaced by `NotFoundError('C Chez Vous')` with
  the same message and status; parse failures now raise `SchemaError`.
- 2026-09-12: a step outside 1–5 no longer reports the order as "Commande
  enregistrée"; it is reported as unknown.
- 2026-09-12: both references C Chez Vous prints under its own tracking form
  (`FGRC45BKLM` and `4TZKO156790--59600`) are retired orders and answer with the
  redirect to the form; the opt-in live test asserts the resulting not-found.
