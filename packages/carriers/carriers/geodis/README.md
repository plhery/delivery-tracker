# GEODIS

## Identity and scope

GEODIS runs a French express and distribution network; its recipient portal
("Espace destinataire") lets anyone follow a shipment from its `1G…` number
alone. This folder covers that anonymous recipient lookup for French last-mile
shipments (`region.countries: ["FR"]`). GEODIS's freight and account portals are
out of scope.

Timezone: `Europe/Paris`. Brand colour `#00549f`.

## Portals

| What | Where |
|---|---|
| Recipient portal | `https://espace-client.geodis.com/services/destinataires/#/fr/suivi/{trackingNumber}` |
| Endpoint used | `POST https://espace-client.geodis.com/services/api/destinataire/recherche-envoi-anonyme` |
| Canary | `https://espace-client.geodis.com/services/destinataires/` |

Links pasted from `espace-client.geodis.com` or `geodis.com` carrying a
`noSuivi` or `trackingNumber` parameter resolve to this carrier.

## What we retrieve

Declared capabilities: `history`, `location`, `eta`.

| Portal shows | We retain | We drop |
|---|---|---|
| status and timeline steps | status, history | — |
| agency / sorting-centre name per scan | location | — |
| planned delivery date | eta | — |
| sender name and address | — | sender name and address |
| recipient name and address | — | recipient name and address |
| per-scan complementary information | — | delivery instructions |
| delivery-document links | — | proof-of-delivery documents |

The response carries the whole consignment record. `parse()` reads an allowlist
— `libelleSuivi`, `libelleCentre`, `dateSuivi`/`heureSuivi`, the timeline step
labels, the terminal-state booleans and the planned date — and copies nothing
else. The offline test feeds a payload whose sender, recipient, instruction and
document fields are placeholders and asserts none of them reach the result.

The estimated delivery date is dropped once the shipment is final
(`etatLivre`, `etatRetire` or `finDeVie`).

## Tracking numbers

One shape: `1G` followed by ten letters and digits, twelve characters in total,
uppercased and trimmed. It is a high-confidence rule — the `1G` prefix is
distinctive enough to select GEODIS on its own. See `numbers.json`.

## How the adapter works

One step, `direct`: a bounded `POST` with a 15 s timeout and a 1 MB cap. The
request carries the exact body `{"noSuivi":"…"}` and an `X-GEODIS-Service`
header that the recipient SPA computes as a SHA-256 over
`appKey;appId;timestamp;language;apiPath;body`. That app key is the public
client identifier shipped in the SPA, not an account secret; it can rotate when
the frontend is deployed.

`parse()` then:

1. requires a boolean `ok`. `ok: false` with a recognizable "envoi non trouvé"
   code is a not-found; any other rejection stays indeterminate, because it does
   not prove the shipment is absent.
2. requires `contenu.noSuivi` to equal the requested number; anything else is a
   schema error.
3. flattens `listJoursSuivis[].suivis[]` into events, de-duplicates on (time,
   location, description), sorts newest first and caps at 100.
4. prefers the active timeline step's label as the current status text, falling
   back to the newest scan; explicit terminal booleans override the wording.

Times are display strings (`DD/MM/YYYY HH:mm:ss`) kept verbatim; the endpoint
sends no offset, so no instant is invented.

## Status reference

Wording only — the endpoint sends no status code.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| returned | retour / retourné à l'expéditeur, retour expéditeur | official-doc |
| failed_attempt | non livré, impossible de livrer, échec de livraison, livraison échouée, incident, anomalie, avarie, endommagé, refusé, destinataire absent | official-doc |
| ready_for_pickup | disponible pour retrait | fixture |
| ready_for_pickup | prêt à être retiré, mis à disposition, à retirer en agence, retrait disponible | official-doc |
| out_for_delivery | en cours de livraison | fixture |
| out_for_delivery | livraison en cours, en distribution, tournée de livraison, conducteur en route | official-doc |
| in_transit | va être livré | fixture |
| in_transit | sera livré, doit être livré, prêt à être livré | official-doc |
| delivered | colis / courrier / envoi / pli livré | fixture |
| delivered | livré at the start of the sentence, a été / est livré, livraison effectuée, remis au destinataire, retiré par le destinataire | official-doc |
| registered | enregistré | fixture |
| registered | en attente de récupération, en attente de prise en charge, information transmise, commande reçue | official-doc |
| in_transit | pris en charge | fixture |
| in_transit | acheminement, en transit, arrivé, départ, agence, centre, transport | official-doc |
| pending | not observed; reported as unmapped |  |
| accepted | not observed; reported as unmapped |  |
| customs | not observed; reported as unmapped |  |

Wording that matches nothing produces an event with its text and no stage; the
sync classifies it and records it for review.

## Limitations and privacy

- Undocumented endpoint with a signature the frontend computes. If GEODIS
  rotates its public app key the request starts failing loudly, not silently.
- `ok: false` without a recognizable not-found code is reported as indeterminate
  on purpose: a technical rejection is not evidence that a shipment does not
  exist.
- Day-and-clock display strings only; no offsets, so ordering uses a UTC-based
  sort key and the displayed value is what is stored.
- Sender and recipient blocks, per-scan complementary information and delivery
  documents are never retained.

## Implementation decisions

- The anonymous recipient endpoint is called directly rather than driving the
  SPA: the signature is a pure function of the request, so one bounded `POST`
  with no session replaces a browser. One `direct` step.
- The signing material (`appKey;appId;timestamp;language;apiPath;body`) is
  reproduced verbatim and covered by a fixed-timestamp test, so a change in the
  scheme fails a unit test instead of silently returning nothing.
- `PUBLIC_SPA_APP_KEY` stays in the source with a comment: it is a public client
  identifier shipped in the recipient SPA, not an account credential, and it can
  rotate when that frontend is deployed.
- Ordering of the wording rules is the design, not an accident. "En cours de
  livraison" and "va être livré" both contain the participle, so the
  out-for-delivery and future-delivery groups are matched first, and the
  delivered rules are anchored (sentence start, "a été livré", or a parcel noun
  before the participle) rather than a bare substring.
- Explicit booleans win over wording: `etatLivre` / `etatRetire` force
  `delivered`, `finDeVie` forces `exception` when nothing said delivered. The
  estimate is dropped once any of them is set.
- Times stay display strings. The endpoint sends a calendar day per group and a
  wall clock per scan with no offset; building an instant would guess a zone, so
  the UTC-based number is only a sort key.
- 2026-09-12: an `ok: false` whose `codeErreur` is not a recognizable "envoi non
  trouvé" now raises `IndeterminateError` instead of a bare `Error`. A technical
  rejection is not evidence that a shipment is absent, and the runner must not
  let it look like one.
- 2026-09-12: unmapped wording no longer defaults to `in_transit`. The scan is
  returned with no stage so the sync classifies it and records it for review.

## Rejected alternatives

- Retaining `expediteur.nom`: this endpoint returns the consignor of a freight
  movement next to its address, without distinguishing businesses from private
  senders. Dropped wholesale; no `sender_name` capability is declared.
- Keeping `listInformationsComplementaires`: it is free text written for the
  recipient and regularly contains access instructions. Never retained.
- Following `listImagesBordereauxLivr`: the adapter does not retrieve
  proof-of-delivery documents.
- Mapping `finDeVie` to `returned`: it means "end of life for this shipment
  record", which covers returns, write-offs and closures alike. `exception` is
  the honest stage.


## Verification log

- 2026-09-12: adapter, tests and wording rules moved into this folder. Behaviour
  unchanged except that unmapped wording no longer receives a default
  `in_transit` stage, and an unreadable `ok: false` is now an
  `IndeterminateError` instead of a bare `Error`.
- 2026-09-12: the grouped opt-in live suite asserts that a validly shaped unknown
  `1G…` number produces the structured not-found response.
