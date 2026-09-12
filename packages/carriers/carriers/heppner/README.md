# Heppner

## Identity and scope

Heppner (Heppner Group) is a French groupage and palletized-freight network.
The parcels this app follows are its recipient shipments in France and
Switzerland, which is also what its public recipient portal covers. Automatic
tracking is enabled; the carrier is selectable in the manual picker on the web
and in both iPhone interfaces.

## Portals

| Purpose | URL |
|---|---|
| Recipient entry page | https://www.heppner-group.com/destinataire-suivez-votre-marchandise/ |
| Portal the entry page hands over to | https://myportal.heppner-group.com/tracking |

The portal shows the status and the milestone history, and — because it is a
recipient view — the shipment parties, the delivery address and, on some
shipments, delivery instructions and an appointment link. Only the status and
the history are retained.

## What we retrieve

| Field | Retained | Note |
|---|---|---|
| `status`, `current_stage` | yes | from the most recent mapped scan |
| `events[].time` | yes | normalized to UTC |
| `events[].stage` | yes | from `status.ts` |
| `events[].description` | yes | our own English wording, not the provider's |
| `events[].provider_code` | yes | the scan's event code, e.g. `PCH_CFM` |
| `events[].location` | no | always empty: the only location the endpoint offers is the delivery address |
| `expected_delivery` | no | the endpoint carries none |
| sender, recipient, references, merchandise, pickup code, appointment token | no | dropped in `parse()` |

Declared capabilities: `history`, `provider_code`.

## Tracking numbers

Eight digits, the shipment receipt number printed on the recipient notice
(`23456789`). The lookup also needs the delivery postcode: four digits selects
Switzerland, five digits selects France. That shape is too broad to identify
Heppner on its own, so the detection rule `heppner-1` is low-confidence and the
user confirms the carrier. `numbers.json` holds one invented sample which the
engine answers as `unknown` with Heppner among the candidates.

## How the adapter works

One step, `direct`, two bounded requests:

1. `GET /api/recipient/search/expedition?zipCode=…&receipt=…&countryCode=…`
   answers with a base64 capability that encodes `receipt&postcode&country`.
   The adapter decodes it and checks it equals the credential it sent, so a
   portal answering for another shipment cannot redirect the lookup.
2. `GET /api/recipient/search/detailexpedition?expedition=<capability>` returns
   the shipment with its scan list, which `parseHeppnerTrackingResponse()`
   projects.

HTTP 404 on either request is a clean not-found. The postcode is part of the
tracking credential: it is never logged, put in an issue, or committed.

## Status reference

Heppner sends identifiers, not wording. `step` is read first, then the event
code's prefix.

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| `returned` | `MARCHANDISE_RETOURNEE`, codes `SOL_*` / `RET_*` | fixture |
| `delivered` | `LIVREE`, codes `LIV_*` / `POD_*` | fixture |
| `exception` | `EN_ATTENTE_INSTRUCTIONS`, state `ANOMALIE` | fixture |
| `out_for_delivery` | `LIVRAISON`, codes `MLV_*` | fixture |
| `accepted` | `PRISE_EN_CHARGE`, codes `PCH_*` | fixture |
| `in_transit` | `ACHEMINEMENT`, `MARCHANDISE_REEXPEDIEE` | fixture |
| `pending` | not observed; reported as unmapped | — |
| `registered` | not observed; reported as unmapped | — |
| `customs` | not observed; reported as unmapped | — |
| `ready_for_pickup` | not observed; reported as unmapped | — |

Anything else keeps the neutral description "Heppner tracking update" and is
left for the sync's wording classifier to record.

## Limitations and privacy

- No estimate and no operational location: neither is reachable through this
  endpoint without also taking the delivery address.
- The lookup fails without a postcode; the adapter raises `InputRequiredError`
  rather than calling the portal with an empty credential.
- Scan stamps always carry an offset and are normalized to UTC, so the app
  never has to guess a zone.

## Implementation decisions

- **Two hops, not one.** The detail endpoint only accepts the capability the
  search endpoint issues, so the search call cannot be skipped. The capability
  is decoded and compared with the credential we sent before it is used; a
  capability for another shipment is a `SchemaError`, never a result.
- **The postcode is a credential.** It is half of the lookup key, so it is
  treated like a tracking secret: never logged, never in a fixture, never in an
  issue. The factory raises `InputRequiredError('Heppner', 'the delivery
  postcode')` when the parcel has none, instead of sending an empty one.
- **No location at all.** The only location-shaped field in the payload is the
  delivery address, so `events[].location` is always empty rather than
  selectively filtered. This is why `capabilities` omits `location`.
- **Our own English descriptions.** The endpoint carries no human wording, only
  identifiers, so `status.ts` supplies both the stage and the display text.
- **Milestone first, code prefix second.** Mapping reads `step`, then the code
  prefix. A new code inside a known milestone therefore still lands on the right
  stage instead of falling through to the unmapped default.
- **UTC timestamps, kept local.** The portal always stamps an offset, and this
  adapter normalizes to UTC. `explicitOffsetTime` from `core/time` preserves the
  source offset instead, so the local helper stays, with a comment saying why.

## Rejected alternatives

- **Reusing a capability across lookups.** It encodes one shipment plus its
  postcode and buys nothing on the next lookup; each lookup re-derives it.
- **Keeping `agency_location` as the event location.** On the shipments seen it
  repeats the delivery address rather than a depot or operational location.
- **Raising the detection rule above low confidence.** `^\d{8}$` collides with
  several carriers (the corpus sample resolves to `unknown` with Mondial Relay
  and Heppner as candidates), so the user confirms the carrier.


## Verification log

- 2026-09-12: moved into this folder; the two-request protocol, the capability
  check and the status map are unchanged.
- 2026-09-12: `HeppnerTrackingError` replaced by the shared `NotFoundError`
  (same 404 status and message); payload and capability rejections became
  `SchemaError`.
