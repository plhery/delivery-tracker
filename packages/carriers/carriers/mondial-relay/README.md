# Mondial Relay

## Identity and scope

`mondial-relay` — the French parcel-shop network, with last mile in `FR`, `BE`,
`ES`, `LU` and `PT`. This adapter reads the French recipient flow and validates
French recipient postcodes for short numbers. Validated 26-digit label
barcodes use a public alias without a postcode; this does not establish
coverage for every destination country.

## Portals

- Public tracker:
  `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition={trackingNumber}`.
  The link carries the shipment number only — never the postcode.
- The page is a Vue application that reads a server-rendered `token` attribute
  from its `#tracking` root and sends it as `RequestVerificationToken` to
  `GET /api/tracking`, with the shipment number and the recipient postcode.
  That endpoint is what the adapter reads.
- Canary: `https://www.mondialrelay.fr/suivi-de-colis/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | from the headline, then the events, then the milestones |
| history | yes | `Evenements`, deduplicated, newest first, at most 100 |
| eta | yes | `EstimatedDeliveryDate`, as a calendar day, cleared once terminal |
| location | no | the reply's only place fields belong to the relay, not to the parcel |
| pickup_point | no | the relay's name and address are shown to the recipient, never retained |
| recipient identity, relay address, contacts, coordinates | no | present in the reply, never retained |

Declared capabilities: `history`, `eta`. The offline test asserts both against
the fixture, and asserts every event location stays empty.

## Tracking numbers

- `^[0-9]{26}$` with both modulo-11 check digits and the parcel sequence valid,
  high confidence — the full label barcode. Its first 12 digits are a public
  alias that works without a postcode; the embedded 8-digit shipment number is
  the other identity an API reply may echo. The routing suffix is never read as
  a postcode.
- `^(?:\d{8}|\d{10}|\d{12})$`, low confidence — the shipment number a user
  types, per Mondial Relay's CONNECT guide. These need the 5-digit recipient
  postcode, which may be typed separately or appended to the number.

`numbers.json` carries publicly reported samples, a synthetic barcode, and the
negatives that prove the checksum gate.

## How the adapter works

One step, `trawl`: the browser service, with no direct attempt at all.
Direct requests were blocked by Cloudflare in the September 10 investigation,
so the current implementation starts with TRAWL. This records the chosen
transport, not a claim that HTTP-only retrieval can never work.

1. Load `/suivi-de-colis/` in a real browser and read the `token` attribute out
   of the captured response body. The Vue app replaces the `#tracking` root as
   soon as it boots, so the rendered HTML no longer carries it; the body is
   decoded from whichever shape the service returns it in.
2. Call `/api/tracking` through the same browser identity, carrying the token,
   and check that the URL it answered from still names the same shipment and
   postcode.
3. Parse the JSON, from the captured body or from the `<pre>` a browser
   navigation wraps it in, and verify the returned `Numero` against the
   credential before anything else.

Without a browser service the lookup fails immediately with
`ChallengeError('Mondial Relay challenged direct tracking; configure
FLARESOLVERR_URL for browser fallback')`. Lookups are serialized per adapter
instance so the page token and the API call stay on one solved identity.

Errors: `NotFoundError` for the endpoint's warning response, `ChallengeError`
when no token is issued, `SchemaError` for a malformed credential, a reply that
does not bind to the requested shipment, or a browser answer that is not
tracking data, and `InputRequiredError` when a well-shaped number arrives
without a usable recipient postcode, except for validated 26-digit barcodes.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| registered | Information transmise par l'expéditeur, Colis en cours de préparation par l'expéditeur, Étiquette créée, Colis enregistré; milestone `1` | fixture, prior-art |
| accepted | Prise en charge / Pris en charge | fixture |
| in_transit | En cours d'acheminement, En transit, Arrivé sur l'agence, Départ de l'agence, Expédié vers; milestone `2` | fixture, prior-art |
| out_for_delivery | En cours de livraison, En cours de distribution, En cours de mise à disposition | prior-art |
| ready_for_pickup | Disponible dans votre Point Relais, Disponible en consigne, Prêt à être retiré; milestone `4` | fixture, prior-art |
| delivered | Remis au destinataire, Retiré par le destinataire, Retrait effectué; milestone `5` | fixture, prior-art |
| failed_attempt | Échec de livraison, Livraison impossible | prior-art |
| exception | Anomalie, Incident, Adresse incorrecte, Colis endommagé, Colis refusé, Colis perdu | prior-art |
| returned | Retour à l'expéditeur, Retour en cours | fixture |
| pending | not observed; reported as unmapped | — |
| customs | not observed; reported as unmapped | — |

Matching is accent- and punctuation-free, so one entry covers every casing and
accenting the page uses. Wording that matches nothing leaves the shipment status
to the events, then to the milestone number, and finally to `unknown`; the sync
classifies the raw wording and records it for review.

## Limitations and privacy

- French recipient postcodes only. The postcode is part of the tracking
  credential: it is stored with the parcel, used only for that lookup, and kept
  out of logs, links and fixtures. The historic `dpdPostcode` API property and
  `dpd_postcode` column carry it, for backward compatibility.
- Timestamps are Paris wall-clock without an offset and are read in
  `Europe/Paris`; a bare calendar day stays a day rather than being stamped
  with midnight.
- The reply carries the relay's address, phone, e-mail and coordinates, the
  recipient's name and postcode, and a replacement-relay block. None of it is
  retained; the offline test feeds a fixture containing all of them and asserts
  the result JSON contains none of their values.
- The estimate is dropped once the parcel is delivered or in exception.

## Implementation decisions

- 2026-08-30: read the page token from `#tracking` and send it as
  `RequestVerificationToken` to `/api/tracking`, which is exactly what the
  official tracking bundle does. Nothing is pinned: the token is fetched per
  lookup.
- 2026-09-10: go straight to the browser. Cloudflare blocks every non-browser
  client with an HTTP 403 WAF block, verified from several networks, so a direct
  attempt only burned time and reported a transport fallback on every sync. The
  adapter therefore declares a single step, `trawl`.
- 2026-09-10: support the 26-digit label barcode. Both modulo-11 check digits
  and the parcel sequence are validated; the first 12 digits are used as the
  public alias for links and lookups, and a reply must echo that alias or the
  embedded 8-digit shipment number.
- Never read the barcode's routing suffix as a postcode. It is a routing field
  that happens to look like one, and a wrong postcode silently returns another
  parcel's answer or nothing.
- Keep the postcode out of the tracking link. The link carries
  `numeroExpedition` only, so a shared link is not a shared credential.
- Decode the captured response body rather than the rendered HTML for the token:
  the Vue app replaces the `#tracking` root as soon as it boots.
- Serialize lookups through the adapter instance so the page token and the API
  call stay on the same solved browser identity.
- 2026-09-12: `MondialRelayTrackingError` was replaced by
  `NotFoundError('Mondial Relay')` — same message, same 404 — and
  `MondialRelaySessionRejected` by `ChallengeError`; neither carried data and
  nothing used `instanceof` on them.
- 2026-09-12: a well-shaped shipment number with no usable recipient postcode is
  now an `InputRequiredError` rather than a `TypeError`. A number that is not
  shaped like a Mondial Relay number at all stays a `SchemaError`. Both keep the
  original message, which names both halves of the credential.
- 2026-09-12: the local TRAWL body decoder was deleted in favour of
  `trawlBody()` in `core/transport`, which implements the same four shapes
  (string, byte array, serialized Node `Buffer`, index-keyed object). The 2 MB
  cap is passed explicitly so the decode bound is unchanged.

## Rejected alternatives

- Trying a direct HTTP request first and falling back: dropped 2026-09-10, see
  above. It never succeeded once.
- Deriving the postcode from the 26-digit barcode: the digits that look like one
  are routing information, not the recipient's postcode.
- Mapping the milestone numbers first: they say how far the progress bar has
  moved, not what happened. They are only consulted when no wording on the
  shipment classified.
- Retaining the Point Relais address so the app could show where to collect:
  this reply does not separate the shop name from the address block, so the
  parser omits the whole block.
- Stamping UTC on the offset-less timestamps: the backend is Paris, and the
  offsets in the output would have been wrong by an hour for half the year.


## Universal provider compatibility

Probed 2026-09-12 with the corpus number `73800244620101503002000732` (full_barcode, `public_shipment_report`, [source](https://forum.quechoisir.org/probleme-colis-mondial-relay-gls-t286523-40.html)).

| Provider | Result |
| --- | --- |
| Ship24 | ❌ No usable history — HTTP 404 |
| ParcelsApp | ❌ No usable history — destination-country prompt (Mondial Relay recognized) |
| 17TRACK | ❌ No usable history — provider reports lookup unavailable, code 400 (2026-09-13) |

Also tried `4744000791` on Ship24: 5 events but DPD UK (corpus attribution unverified); `87778793`, `98911884`: 404.

## Verification log

- 2026-08-30: protocol inspected in the official tracking bundle; the page
  token is read from `#tracking` and sent as `RequestVerificationToken`.
- 2026-09-10: Cloudflare answers every non-browser client with an HTTP 403 WAF
  block, verified from several networks. The direct path was dropped.
- 2026-09-10: interactive check of the public tracking page; the browser flow
  keeps the page token and the API call on one session.
- 2026-09-12: adapter moved into this folder; the wording classifier moved to
  `status.ts`, the flow moved onto `runSteps` and the shared TRAWL client, and
  the error classes moved onto the shared taxonomy.
- 2026-09-12: universal-provider probe with corpus number `73800244620101503002000732`: Ship24: no usable history; ParcelsApp: no usable history; 17TRACK: not verified in this pass.
- 2026-09-13: 17TRACK probe with corpus number `73800244620101503002000732` via prod TRAWL: no usable history (lookup_unavailable).
