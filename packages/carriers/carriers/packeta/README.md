# Packeta

## Identity and scope

`packeta` — the Central European locker and pickup-point network, known as
Zásilkovna in Czechia. Last mile in `CZ`, `SK`, `HU`, `RO` and `PL`. Tracked
automatically; no postcode or capability URL is needed.

## Portals

- Public tracker: `https://tracking.packeta.com/en/{trackingNumber}`. The
  canonical path form; the legacy `?id=` form 301-redirects to it.
- The adapter reads the keyless consumer endpoint the page uses,
  `POST https://tracking.packeta.com/api/getPacketById/{code}/en`.
- Canary: `https://tracking.packeta.com/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | `packetStatusId` for the parcel, canned sentences for each event |
| history | yes | newest first, at most 20 events |
| sender_name | yes | `sender`, the merchant |
| pickup_point | yes | `branchAddress`, the Z-BOX or partner shop |
| delivered_at | yes | the newest event's timestamp once delivered |
| timezone | yes | always `Europe/Prague`, so clients can render the naive times |
| location | no | events carry none |
| eta | no | Packeta exposes none |

Declared capabilities: `history`, `sender_name`, `pickup_point`,
`delivered_at`. The offline test asserts each of them against the fixture.

## Tracking numbers

One high-confidence rule: `^Z\d{10}$`.

## How the adapter works

Single step, `direct`. One `POST` to the consumer endpoint with the locale
pinned to English; no cookies, headers, account or browser state. Identity binds
through the echoed `barcode`.

Packeta signals an unknown code twice, and both are domain outcomes rather than
failures:

- HTTP 404 with `{"error":"notFound"}`, and
- HTTP 200 carrying `error` instead of `item`.

Both become `NotFoundError('Packeta')`. Expired 2023-era codes answer the same
404, so unknown and expired are intentionally indistinguishable to an anonymous
caller.

Timestamps are naive wall-clock strings with no offset, read as
`Europe/Prague` — the zone the backend stamps, verified against real parcels by
the prior-art client.

Errors: `NotFoundError('Packeta')`, `SchemaError` for a payload that does not
bind to the requested shipment, `UpstreamHttpError` for any other non-200.

## Status reference

| Stage | Code (raw) / wording | Confirmed by |
|---|---|---|
| registered | `997`; `We are aware of your parcel and are waiting for the sender…`, `…assigned a tracking number…` | prior-art (code), live (sentences) |
| in_transit | `1`, `31`; `…successfully received the parcel for transport…`, `…on its way to the depot…`, `…arrived at the depot…`, `…handed over to the carrier…` | prior-art (codes), live (sentences) |
| out_for_delivery | `…on its way to you…` | live |
| ready_for_pickup | `2`; `The parcel is ready for pickup…` | prior-art (code), live (sentence) |
| delivered | `3`; `The parcel is with you…` | live |
| failed_attempt | `21`; `…investigating the status of the parcel…` | prior-art (code), live (sentence) |
| pending | — | not observed; reported as unmapped |
| accepted | — | not observed; reported as unmapped |
| customs | — | not observed; reported as unmapped |
| returned | — | not observed; reported as unmapped |

Only `packetStatusId` "3" is live-confirmed; the other ids are reconstructions,
so an unmapped id is treated as schema drift and the result reports `unknown`
without losing the shipment. An unrecognized event sentence keeps no stage and
the sync classifies and records it.

## Limitations and privacy

- No delivery estimate and no event locations.
- The backend stamps `Europe/Prague`. Romanian (EET) depot scans can therefore
  be off by one hour; there is no per-event locality to do better, so ordering
  within a parcel is preserved and the caveat is documented rather than solved.
- `sender` is a merchant name and `branchAddress` a pickup-point name; neither
  carries recipient data. Recipient name, address, phone and signature fields
  are never retained — the offline test feeds a fixture carrying them and
  asserts the result JSON contains none of their values.

## Verification log

- 2026-09-10: `POST .../getPacketById/Z0000000000/en` answers HTTP 404
  `{"error":"notFound"}` in about 0.2 s, with no cookies, headers or account.
  Expired 2023-era reported `Z` codes answer identically.
- 2026-09-10: the `?id=` tracking link confirmed to 301-redirect to the
  canonical `/en/{code}` path form.
- 2026-08-19: the canned English event sentences confirmed live against real
  delivered parcels by the prior-art client.
- 2026-09-11: sender and pickup-point retention added.
- 2026-09-12: adapter moved into this folder; both status maps moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
