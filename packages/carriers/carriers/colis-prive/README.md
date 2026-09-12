# Colis Privé

## Identity and scope

Colis Privé is a French private parcel network delivering business-to-consumer
shipments to the door, to a relay point or to a locker. This folder covers its
French last mile only (`region.countries: ["FR"]`): the lookup credential ends
in a French postcode, so no other country is reachable through it.

Timezone: `Europe/Paris`. Brand colour `#e30613`.

## Portals

| What | Where |
|---|---|
| Recipient portal and endpoint | `https://colisprive.com/moncolis/pages/DetailColis.aspx?numColis={credential}&lang=fr` |
| Canary | `https://colisprive.com/moncolis/pages/DetailColis.aspx` |

There is no JSON feed: the detail page is server-rendered HTML and is both what
a person sees and what the adapter reads. Links pasted from `colisprive.com` or
`colisprive.fr` with a `numColis` parameter resolve to this carrier.

## What we retrieve

Declared capabilities: `history`.

| Portal shows | We retain | We drop |
|---|---|---|
| status banner | status | — |
| timeline (date + sentence) | history | — |
| recipient name | — | recipient name |
| full delivery address | — | full delivery address |

The `.divDesti` block that holds the recipient's name and address is removed
from the parsed document before a single character of text is read, so it
cannot leak into a description by accident. The page carries no scan location,
no estimated delivery date and no weight, so those capabilities are not
declared and `expected_delivery` is always `null`.

**The credential is a secret.** The 12-character shipment number alone does not
open the page; the recipient's 5-digit postcode appended to it does. Treat the
combined value like a password: never log it, quote it in an issue, or put it in
a fixture.

## Tracking numbers

One stored value: 12 letters and digits followed by the 5-digit French postcode
(`01`–`95`, `97`, `98` ranges), uppercased, no separators — for example
`99112233445575012`. Both the 17-character credential and a bare 12-character
shipment number are low-confidence detection rules: the shapes are shared with
other carriers, so a pasted number stays a suggestion and the user confirms.

## How the adapter works

One step, `direct`: a bounded `GET` of the detail page with `redirect: 'manual'`
and `allowHttpError: true`, a 15 s timeout and a 500 kB cap. Then:

1. A 404 or any 3xx is a not-found (`ColisPriveTrackingError`, a
   `NotFoundError`): an unknown shipment is bounced to the search page rather
   than answered with a 404.
2. Other non-2xx statuses become `UpstreamHttpError`.
3. `parse()` removes `.divDesti`, requires the `.BandeauInfoColis` banner,
   checks that the displayed 12-character number equals the credential's
   shipment part, and reads the status banner and the timeline rows.
4. Rows are de-duplicated on (date, sentence), sorted newest first and capped at
   100. The raw `DD/MM/YYYY` string stays the event time; there is no clock to
   build an instant from.

## Status reference

Wording only — the page prints no status code. Rows are compared with accents,
case and punctuation removed, and the first matching group wins.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| returned | retour / retourné à l'expéditeur, retour expéditeur | official-doc |
| failed_attempt | nous avons tenté de livrer | fixture |
| failed_attempt | n'avons pas pu livrer, échec de livraison, n'a pas pu être livré, subi un retard | official-doc |
| exception | adresse incorrecte, incident, anomalie, endommagé, refusé, perdu | official-doc |
| delivered | a été livré | fixture |
| delivered | vous a été remis au relais, remis au destinataire, livraison effectuée | official-doc |
| ready_for_pickup | vous attend au relais | fixture |
| ready_for_pickup | disponible au relais, disponible en point relais, disponible en consigne | official-doc |
| out_for_delivery | en cours de distribution par le livreur | fixture |
| out_for_delivery | en cours de livraison par le livreur | official-doc |
| registered | en cours de préparation par l'expéditeur | fixture |
| registered | sera confié prochainement, information transmise par l'expéditeur | official-doc |
| in_transit | arrivé sur notre agence | fixture |
| in_transit | pris en charge, en cours d'acheminement, arrivé dans notre agence, expédié vers, va être prochainement déposé, a été collecté | official-doc |
| pending | not observed; reported as unmapped |  |
| accepted | not observed; reported as unmapped |  |
| customs | not observed; reported as unmapped |  |

A sentence that matches nothing produces an event with its text and no stage;
the sync classifies it and records it for review.

## Limitations and privacy

- Undocumented HTML page; markup changes break parsing loudly (schema errors)
  rather than silently producing a wrong status.
- Day-resolution timestamps only. Two events on the same day keep their page
  order.
- The combined credential contains the recipient's postcode and is treated as a
  tracking secret.
- Recipient name and address are removed before parsing; the offline test asserts
  they are absent from the result.

## Implementation decisions

- The recipient detail page is parsed directly: it is the only public surface,
  there is no JSON feed behind it, and it needs no session or token. One
  `direct` step.
- `.divDesti` is removed from the parsed document before any text is read,
  rather than filtered out afterwards. A removal cannot be forgotten by a later
  selector; a filter can.
- The response must echo the credential's 12-character shipment part. A page for
  another parcel is a schema error, never a result.
- The raw `DD/MM/YYYY` string stays the event time. The page has no clock, so
  building an instant would invent a time of day; `dateKey()` only produces a
  sort key and rejects impossible dates such as 31/02.
- `ColisPriveTrackingError` survives the move as a named subclass of
  `NotFoundError`: the host's sync tests and the grouped live suite construct it
  and match on its name, and `error_type` is a Sentry label.
- The exception and return wording groups are checked before the delivery group.
  "Nous avons tenté de livrer" contains "livrer"; ordering is what keeps a failed
  attempt from being reported as a delivery.
- 2026-09-12: wording that matches no rule no longer defaults to `in_transit`.
  The row is still returned, with no stage, so the sync classifies it and the
  wording is recorded for review.

## Rejected alternatives

- Reading the recipient block for a "delivered to" hint: it is a name and a
  street address; the parser removes this block before reading the timeline.
- Treating the 3xx bounce to the search page as a transport failure: it is the
  provider's way of saying it does not know the shipment, and it is stable, so
  it maps to not-found.
- Splitting the shipment number and the postcode into `input.number` and
  `input.postcode`: the combined 17-character value is what is stored on the
  parcel today and what the detection rules describe. Changing it is a data
  migration, not an adapter change.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `HS0000329755` (shipment, `public_shipment_report`, [source](https://fr-be.trustpilot.com/review/boutikplus.fr)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt |
| 17TRACK | ⏳ Not verified in this pass — requires the pinned TRAWL build (see `../../providers/seventeentrack/README.md`) |

## Verification log

- 2026-09-12: adapter, tests and wording rules moved into this folder. Behaviour
  unchanged except that unmapped wording no longer receives a default
  `in_transit` stage.
- 2026-09-12: an unknown shipment is answered with a redirect to the search page,
  not an HTTP 404; the grouped opt-in live suite asserts the resulting
  not-found error.
- 2026-09-12: universal-provider probe with corpus number `HS0000329755`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
