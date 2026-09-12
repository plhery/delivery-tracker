# PostNL

## Identity and scope

PostNL is the Dutch postal operator. This folder keeps the internal carrier id
`spring-gds` for parcels and clients that already store it, while the app and
the diagnostics use the PostNL name. Spring GDS is PostNL's international
subsidiary; its mailingtechnology.com portal can show additional transport
history for the same barcode (docs/CARRIERS.md).

Scope: Dutch postal numbers and PostNL's international `3S…` barcodes.
Checksum-valid S10 numbers ending in `NL` resolve here unless their prefix
belongs to another service (`PZ`, `XU`, `XW`, `XY` are excluded).

## Portals

| Portal | URL | What it is |
|---|---|---|
| International tracking | `https://postnl.post/track?barcodes={trackingNumber}` | Where a tracking link points; the canary probes its root. |
| Retired detail links | `postnl.post/details/{number}` | Still recognized when pasted, and repaired if stored on a parcel. |
| Spring GDS | `mailingtechnology.com/tracking?tn={number}` | Recognized when pasted; may show extra transport history. |

The international tracker calls `postnl.post/api/v1/auth/token` for a
short-lived visitor token, then posts the barcode to
`postnl.post/api/v1/tracking-items`. Both are keyless.

## What we retrieve

Retained: the shipment status and stage, the current stage, the newest status
text, every event with its timestamp, description, stage and country, the
sender name when it is a webshop or business name, and the delivered-at time.

Discarded: everything else an item can carry, including the recipient name,
the address and the signature link (exercised by `fixtures/delivered.json`).

Unavailable: a delivery estimate. The international endpoint publishes none, so
`expected_delivery` is always null rather than guessed.

## Tracking numbers

| Rule | Shape | Note |
|---|---|---|
| `spring-gds-1` | Two letters + 9 digits + `NL`, S10 checksum | `PZ`, `XU`, `XW` and `XY` prefixes are excluded. |
| `spring-gds-2` | `3S` + 1–4 letters + digits, 13 or 15 characters | PostNL's international barcode. |

`numbers.json` holds sixteen samples: official documentation examples, two
publicly reported numbers, and two quarantined documentation examples whose S10
check digit does not validate.

## How the adapter works

Two bounded POSTs per lookup — a fresh visitor token, then the batch tracking
call — declared as a single `direct` step: both are keyless HTTP on the same
host, so there is nothing for a second tier to do differently.

Each call replays once after a transport failure or an HTTP 502, 503 or 504,
and after an HTTP 429 only when it supplies a short, valid `Retry-After`
(docs/CARRIERS.md). Invalid data and other HTTP errors are never retried. The
token is refused when it is empty or implausibly long.

The answer echoes the requested barcodes, so the item whose `item` equals the
requested number is the only one read. PostNL answers an unknown barcode with
an ordinary item that has no events and says so in `message`; only the
recognized phrase is used, and none of the message reaches the error.

PostNL parcels use a thirty-minute daytime / hourly overnight sync schedule and
support manual refreshes.

## Status reference

| Stage | Wording (raw category) | Confirmed by |
|---|---|---|
| `registered` | `pre-advised`, `preparing` | fixture |
| `accepted` | `processing` | fixture |
| `in_transit` | `departed`, `arrived`, `in transit`, `transit` | fixture |
| `customs` | `customs` | fixture |
| `out_for_delivery` | `out for delivery` | fixture |
| `ready_for_pickup` | `pick-up point` | fixture |
| `delivered` | `delivered` | fixture |
| `failed_attempt` | `unsuccesfull`, `unsuccessful`, `undelivered`, `exception` | fixture |
| `returned` | `returned` | fixture |
| `pending` | — | not observed; reported as unmapped |

`unsuccesfull` is PostNL's own spelling; the corrected spelling is mapped next
to it. Categories are matched case-insensitively after trimming. An unfamiliar
category leaves the event without a stage and the shipment in transit.

## Limitations and privacy

- The endpoints are undocumented and keyless; they can change without notice.
- Event times are the provider's local strings; the catalog timezone (`UTC`) is
  applied by the host when they carry no offset.
- Only a webshop or business sender name is retained, capped at 200 characters
  and whitespace-collapsed. No recipient name, address or signature is kept.

## Verification log

- 2026-09-12: sixteen status categories recorded in `statuses.json`, each
  covered by a fixture-driven test.
- 2026-09-12: adapter moved into this folder from
  `src/server/upstreamAdapters.ts`; behaviour unchanged apart from the error
  taxonomy (`NotFoundError` / `SchemaError` replace the previous ad-hoc
  classes).
