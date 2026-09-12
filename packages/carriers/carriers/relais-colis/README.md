# Relais Colis

## Identity and scope

Relais Colis is a French pickup-point network: parcels travel to a neighbourhood
shop ("relais") where the recipient collects them, and unclaimed parcels go back
to the seller. Automatic tracking is enabled through the public recipient form
and its CSRF-bound session; the carrier is selectable in the manual picker on
the web and in both iPhone interfaces.

## Portals

| Purpose | URL |
|---|---|
| Recipient form (GET, then POST to the same URL) | https://www.relaiscolis.com/colis/suivre |

Recognized tracking links: `relaiscolis.com` URLs carrying `tracking_number`,
`trackingNumber`, `numeroColis` or `numColis`.

The page shows the status, the step list, the recipient's name and delivery
address, and the pickup point's details. Only the status and the step list are
retained.

## What we retrieve

| Field | Retained | Note |
|---|---|---|
| `status` | yes | from the most recent mapped step |
| `events[].time` | yes | `dd/MM/yyyy à HH:mm`, read in Europe/Paris |
| `events[].stage` | yes | from `status.ts` |
| `events[].description` | yes | the provider's own French sentence, kept verbatim |
| `events[].location` | no | always empty: the page's only place is the pickup point |
| `expected_delivery` | no | the page carries none |
| recipient name, delivery address, phone, pickup-point details | no | the blocks are removed before any text is read |
| `tracking_url`, `tracking_source` | yes | so the app can link back to the rendered page |

Declared capabilities: `history`.

## Tracking numbers

Ten to sixteen letters and digits with at least one digit. Two shapes are
recognized: `CC` followed by 10 to 14 digits (`CC200000000401`), which is
high-confidence and selects Relais Colis on its own, and a bare ten-digit form,
which is low-confidence and asks the user to confirm. `numbers.json` holds the
two made-up `CC…` samples the tests use plus one publicly reported ten-digit
number that resolves to `unknown` among several candidates.

## How the adapter works

One step, `direct`, two bounded requests over a cookie jar created for that
lookup only:

1. `GET /colis/suivre` picks up the session cookie and the Symfony CSRF token
   from `#track_package__token`. A page without that token is a `SchemaError`.
2. `POST /colis/suivre` sends `track_package[trackingNumber]`,
   `track_package[searchPackage]` and `track_package[_token]`.

A redirect (301/302/303/307/308) or an HTTP 404 on the POST is the network's
wrong-number answer, as is an error block rendered without any `.follow-step`.
The rendered page echoes the number it searched in the form field; that value is
verified before any step is read.

## Status reference

The page prints French sentences and no status code, so the map is phrase-based
and compared without case or diacritics.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| `returned` | "VOTRE COLIS A ÉTÉ RETOURNÉ À VOTRE VENDEUR" | fixture |
| `ready_for_pickup` | "Votre colis est disponible dans votre Relais Colis" | fixture |
| `out_for_delivery` | "Votre colis est en cours de livraison dans votre Relais Colis" | fixture |
| `delivered` | "Votre colis a été livré au destinataire" | fixture |
| `in_transit` | "Votre colis est en cours d'acheminement dans notre réseau", "Votre colis a été pris en charge" | fixture |
| `registered` | "Votre colis a été annoncé" | fixture |
| `failed_attempt` | "livraison impossible", "destinataire absent", … | prior-art |
| `accepted` | not observed; reported as unmapped | — |
| `pending` | reached through `registered` wording only | fixture |
| `customs` | not observed; reported as unmapped | — |

`statuses.json` lists every phrase in the map. Unrecognized sentences keep their
own text as the description and are left for the sync's classifier.

## Limitations and privacy

- The recipient, address and pickup-point blocks are removed from the document
  before any text is read, so they cannot leak through a selector change.
- Unlike the other French adapters here, the provider's sentence is kept as the
  event description. It is the status line a human sees and carries no
  personal data.
- An empty HTTP 200 proves nothing and is reported as `IndeterminateError`.

## Verification log

- 2026-09-12: moved into this folder; the CSRF flow, the identifier check, the
  address-block removal and the status map are unchanged.
- 2026-09-12: `RelaisColisTrackingError` now extends the shared `NotFoundError`
  and keeps its name, so the grouped live canary still matches; identifier,
  history and CSRF failures → `SchemaError`; the empty body →
  `IndeterminateError`.
