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
| `failed_attempt` | `EN_ATTENTE_INSTRUCTIONS`, state `ANOMALIE` | fixture |
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

## Verification log

- 2026-09-12: moved into this folder; the two-request protocol, the capability
  check and the status map are unchanged.
- 2026-09-12: `HeppnerTrackingError` replaced by the shared `NotFoundError`
  (same 404 status and message); payload and capability rejections became
  `SchemaError`.
