# InPost

## Identity and scope

`inpost` — the Polish locker and courier network, plus its cross-border hubs.
Last mile evidenced in `PL`, `IT`, `PT` and `GB`. Tracked automatically; no
postcode or capability URL is needed.

## Portals

- Public tracker: `https://inpost.pl/sledzenie-przesylek`.
- The adapter reads the keyless per-country hub API at
  `https://inposteasy.com/api/tracking/{trackingNumber}`.
- Canary: `https://inposteasy.com/`.

Two public surfaces exist. The ShipX endpoint (`api-shipx-pl.easypack24.net`)
is keyless too, but its success shape was never confirmed, so only the
inposteasy hub is implemented; ShipX stays a future lead.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | from the `<PHASE>.<NNNN>` code, at parcel and event level |
| history | yes | newest first, at most 20 events |
| location | no | the hub response carries none |
| eta | no | the hub response carries none |
| origin / destination country | no | travels with the parcel, feeds no retained field |

Declared capabilities: `history`. The offline test asserts it against the fixture.

## Tracking numbers

Four rules: 24-digit numerics (low), legacy `JJD`/`JD` + 16 digits (low, so
`JJD` needs a domain hint or an explicit pick against DHL), and `8YDR` + 9
digits (high).

## How the adapter works

Single step, `direct`. One `GET` to the hub URL; no cookies, headers, account or
browser state. The response is bound to the request by the echoed
`trackingNumber`.

- HTTP 404 with a structured `NOT_FOUND` problem body is the unknown-number
  answer → `NotFoundError('InPost')`. Long-expired numbers answer the same way.
- The parcel-level `status` code decides the overall stage; each event's own
  code decides that event's stage.

Timestamps carry explicit offsets and are kept exactly as sent. An offset-less
value is dropped rather than stamped with a zone, because the PL/IT/PT/GB hubs
share this API and no single zone would be right.

Errors: `NotFoundError('InPost')`, `SchemaError` for a payload that does not
bind to the requested shipment, `UpstreamHttpError` for any other non-200.

## Status reference

| Stage | Code (raw) | Confirmed by |
|---|---|---|
| registered | `CRE.1001`, `FMD.1001` | prior-art |
| in_transit | `FMD.1002`, `MMD.1001`–`MMD.1004`, `LMD.1001`, `LMD.1002`, `LMD.3006`, `LMD.3014` | prior-art |
| ready_for_pickup | `LMD.1004`, `LMD.1005`, `LMD.9001` | prior-art |
| delivered | `EOL.1001`, `EOL.1003` | prior-art |
| failed_attempt | `LMD.9002`, `EOL.9001` | prior-art |
| returned | `LMD.9014`, `RTS.1001`, `RTS.1002` | prior-art |
| pending | — | not observed; reported as unmapped |
| accepted | — | not observed; reported as unmapped |
| out_for_delivery | — | not observed; reported as unmapped |
| customs | — | not observed; reported as unmapped |

The cross-border vocabulary is explicitly still being observed: an unmapped code
yields no stage, the result reports `unknown` with the raw wording preserved,
and the sync classifies and records it for review.

## Limitations and privacy

- No event locations and no delivery estimate: the hub response has neither, so
  a locker name never reaches the result even though the portal shows one.
- Origin and destination country codes travel with the parcel and are dropped.
- Recipient name, address, phone and signature fields are never retained; the
  offline test feeds a fixture carrying them and asserts the result JSON
  contains none of their values.

## Verification log

- 2026-09-10: `GET https://inposteasy.com/api/tracking/000000000000000000000000`
  answers HTTP 404 with a structured `NOT_FOUND` body in about 0.2 s, with no
  cookies, headers or account. Long-expired corpus numbers answer identically.
- 2026-08-31: the public cross-border vocabulary confirmed on IT/PT/GB
  consignments by the prior-art client.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
