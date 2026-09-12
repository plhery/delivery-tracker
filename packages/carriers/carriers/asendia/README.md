# Asendia

## Identity and scope

Asendia is a cross-border mail and e-commerce carrier (a Swiss Post / La Poste
joint venture) that hands parcels to a destination post for the last mile.
**Asendia is link-plus-universal**: `carrier.json` sets
`tracking.adapter: "universal"`, so lookups go through the universal providers,
and the parcel is saved with a direct link to Asendia's own portal. This folder
therefore has **no `adapter.ts`** — the generated registry would dispatch
Asendia to it and bypass the universal tier. What lives here instead is
`probe.ts`, the module behind the Asendia canary.

## Portals

| Purpose | URL |
|---|---|
| Official portal (link saved with the parcel) | https://track.asendia.com/track/{trackingNumber} |
| Canary target | https://t.17track.net/ |

Recognized tracking links: `track.asendia.com/track/<number>`.

The portal is gated by Cloudflare Turnstile: a human solves the challenge in the
browser, and the page then posts the resulting token with every search. It shows
the status, the harmonized scan history, the estimate and the recipient's name
and address.

## What we retrieve

`probe.ts` is not on the sync path; the fields below are what
`parseAsendiaTrackingResponse()` produces when a response is obtained.

| Field | Retained | Note |
|---|---|---|
| `status` | yes | from the parcel's own status wording, falling back to the newest mapped scan |
| `events[].time` | yes | offset preserved when present, otherwise read in Europe/Zurich |
| `events[].stage` | yes | from `status.ts` |
| `events[].description` | yes | the harmonized wording, with markup stripped |
| `events[].location` | yes | the scanning location, e.g. "Zurich, CH" |
| `events[].provider_code` | yes | the harmonized code, e.g. `ARRIVED_DESTINATION` |
| `expected_delivery` | yes | estimated or delivery date, dropped once delivered or in exception |
| order reference, recipient name, address, e-mail | no | never read |

Declared capabilities: `history`, `location`, `eta`, `provider_code`.

## Tracking numbers

`ASE` followed by 8 to 37 letters and digits is high-confidence and selects
Asendia (`asendia-1`). Asendia also moves parcels under UPU S10 numbers issued
by the partner post; those stay with their issuing post, which is the honest
answer — `numbers.json` records `LF079877211FR` resolving to La Poste and
`LN242142606US` to the generic postal rule, both with the source that attributes
them to Asendia.

## How the adapter works

Three bounded requests reproducing the portal's public protocol:

1. `GET /__env.js` publishes `NEXT_PUBLIC_BRANDED_HIT_KEY`, a browser-visible
   daily checksum key (not an account secret; it rotates with a frontend
   deployment).
2. `GET /api/1.0/branded-url/get-config-data/track.asendia.com` returns the
   public tenant's id, subsidiary and brand list.
3. `POST /api/1.0/branded-url/branded-parcel-search?sort=shipment_date` with an
   `X-Hit-Token` of `sha256(number + YYYY-MM-DD + key)` and a Turnstile token in
   the body.

The Turnstile token must come from an approved interactive browser flow and be
injected through `turnstileTokenProvider` (or `ASENDIA_TURNSTILE_TOKEN`). With
no usable token the probe fails before any network access.

## Status reference

The portal harmonizes every partner post's wording into one English vocabulary,
which is what the map keys on.

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| `delivered` | "Delivered" | fixture |
| `failed_attempt` | "Not delivered" | fixture |
| `in_transit` | "Arrived at destination" | fixture |
| `registered` | "Information received" | fixture |
| `returned` | "Return to sender", "Shipment returned" | prior-art |
| `ready_for_pickup` | "Ready for collection", "Available for pickup" | prior-art |
| `out_for_delivery` | "Out for delivery", "With delivery courier" | prior-art |
| `customs` | wording containing "customs" | prior-art |
| `accepted` | not observed; reported as unmapped | — |
| `pending` | reached through `registered` wording only | fixture |

## Limitations and privacy

- **The portal cannot be polled unattended.** The Turnstile gate is why Asendia
  is tracked through the universal providers rather than directly; the canary
  only verifies that a rejected token is still reported as a challenge, not that
  an anonymous lookup succeeds.
- The harmonized code is not used for mapping: the same code has been seen with
  different harmonized wording across subsidiaries.
- Offset-less stamps are read in Europe/Zurich, the portal's own zone, rather
  than guessed as UTC.

## Verification log

- 2026-08-30: public request protocol inspected on `track.asendia.com`
  (`__env.js`, `get-config-data`, `branded-parcel-search`); the checksum key is
  published by the frontend and the Turnstile token is a required body field.
- 2026-09-12: module moved to `probe.ts` in this folder, with `probe.test.ts`
  and `probe.live.test.ts`. No `adapter.ts` is created here on purpose.
- 2026-09-12: `AsendiaTrackingError` → `NotFoundError`; `AsendiaChallengeError`
  → `ChallengeError` (status 403 instead of 503; both already classified as a
  verification failure by routing); payload rejections → `SchemaError`.
