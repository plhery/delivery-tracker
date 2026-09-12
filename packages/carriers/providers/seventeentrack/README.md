# 17TRACK

## Identity and scope

17TRACK (t.17track.net) is a universal tracking aggregator, not a carrier: it
has no last mile of its own and cannot be selected for a parcel. It is the last
provider of the discovery chain (`providers/README.md`), and it stays last even
when Postal Ninja is enabled. The provider name persisted in routing state is
`17TRACK`; the folder is named `seventeentrack` because a directory cannot start
with a digit in an import path.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Public tracking page | `https://t.17track.net/en#nums={number}` | status, aggregated history per carrier leg, the carriers it recognized, an interactive verification when it suspects automation |

The page is also the link the app shows for a parcel whose history came from
17TRACK, and it follows the app language.

## What we retrieve

From the page's own API (`track/restapi`):

| Field | Source |
| --- | --- |
| `events[].time` | `shipment.tracking.providers[].events[].time_utc`, else `time_iso`; both must carry an offset |
| `events[].description`, `events[].stage` | `events[].description` and the provider-declared `events[].stage` |
| `status`, `current_stage`, `last_status_text`, `last_update` | derived from the projected events |
| `reported_carriers`, `discovered_carrier` | `providers[].provider.name`, mapped to a catalog id only when one unambiguous name is reported |

`shipping_info` (recipient address, phone) and the per-event `address` field are
never read. At most 20 carrier legs and 1000 events are accepted.

## Tracking numbers

Any number the chain is given: uppercased with spaces, dots and dashes removed,
it must match `^(?=.*\d)[A-Z0-9]{4,40}$`. Exactly one shipment in the reply must
echo the requested number; demo numbers and ambiguous replies are rejected.

## How the adapter works

One tier, `trawl`, run by `runSteps` with the per-provider budget (30 s inside
the chain):

1. The private browser service (`FLARESOLVERR_URL`) loads the tracking page with
   `skipHttp`, up to tier 3, and captures responses for
   `https://t.17track.net/track/restapi` with a 15 s settle window.
2. Captured bodies are parsed newest first. A reply whose shipment code is 100
   is the provider still polling; the loop continues and keeps the last
   structured failure in case no final history follows.
3. If nothing parsed, the failure says what happened: `capture_missing` (the
   service captured nothing), `capture_unreadable` (a body it could not read) or
   `history_missing` (replies without history).

This provider requires the pinned compatibility build of the browser service
(see `ops/trawl`): 1.3.1 ignores capture requests, and stock 1.5.0 refuses
compressed bodies and can finish before polling completes.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| registered | declared `InfoReceived`; `Electronic information submitted by shipper` | live 2026-09-10 |
| in_transit | declared `InTransit`; `Arrived`, `Departed`, `Processed` | live 2026-09-10 |
| ready_for_pickup | declared `AvailableForPickup` | prior-art |
| out_for_delivery | declared `OutForDelivery`; `Item out for delivery` | live 2026-09-10 |
| failed_attempt | declared `DeliveryFailure` | prior-art |
| delivered | declared `Delivered` | live 2026-09-10 |
| accepted, customs, returned | wording only (`Picked up`, `Customs`, `Returned to sender`) | prior-art |
| pending | anything else | — |

A declared stage is used only when the shared wording rules did not already
decide (a handoff or a negation outranks it). Unmapped wording stays `pending`
and is recorded by the sync for review.

| Provider code | Meaning | Error |
| --- | --- | --- |
| -11, -13, -14 | interactive verification required | `SeventeenTrackVerificationError` (challenge) |
| 100 (shipment) | lookup still polling | `SeventeenTrackLookupError`, reason `lookup_pending` |
| any other non-200 | lookup unavailable | `SeventeenTrackLookupError`, reason `lookup_unavailable` |

The provider's short `meta.message` is kept (truncated to 120 characters) so the
intermittent code 400 stays diagnosable in Sentry.

## Limitations and privacy

- An aggregator reports what the underlying carriers give it; a dedicated
  carrier adapter is always preferred when one exists.
- A provider code 400 with no history is an explicit lookup failure: never an
  invented delivery and never an automatic carrier correction.
- Demo numbers, polling replies, carrier-selection prompts and empty responses
  cannot manufacture progress.
- Delivery wording can contain an access code or a signature. Any event whose
  stage is not `delivered` and that carries such details is dropped, and a
  delivered event's description is replaced by `Delivered`.

## Implementation decisions

- **Keep the captured browser lookup (2026-09-10).** Unsigned direct POST probes
  returned HTTP 200 with rejection codes `-14` on the current endpoint and `-10`
  on the legacy one, not history. The maintained multi-carrier integration found
  in the same review uses an API key, and the newer JavaScript client requires a
  login, so the browser capture stays.
- **Pinned compatibility build required.** TRAWL 1.3.1 ignores capture requests;
  stock 1.5.0 refuses compressed bodies and can finish before polling completes.
  The compatibility build captures the browser-decoded JSON and waits through
  code 100 for a final matching reply (`ops/trawl`).
- **Rejection codes are typed, not generic failures.** `-11`, `-13` and `-14`
  mean an interactive verification is required (a challenge), a shipment code of
  100 means the lookup is still polling, and anything else means the lookup is
  unavailable. Routing needs that distinction for its cooldowns, and Sentry
  keeps `reason` and `providerCode` for triage.
- **A structured failure survives the capture loop.** The newest readable body
  wins; when none parses, the last typed lookup failure is thrown instead of a
  generic "no history", so a verification wall is never reported as an empty
  capture.
- **Capture failures are distinguished.** `capture_missing`,
  `capture_unreadable` and `history_missing` say whether the browser service can
  capture at all, could not read what it captured, or captured replies without
  history. They prove nothing about the shipment and are classified as
  indeterminate.

## Rejected alternatives

Prior clients inspected during the September 10 review:
[kamushadenes/tracker17](https://github.com/kamushadenes/tracker17/blob/6d87ce44b7d9db95085c70759633d95e9fd5547c/tracker17/__init__.py)
used a historical endpoint;
[mderazon/seventeen-track-js](https://github.com/mderazon/seventeen-track-js/blob/b8000c9/src/profile.ts)
required account sign-in. Neither established a working anonymous replacement.

- **The 2019 anonymous endpoint** (`kamushadenes/tracker17`, revision
  `6d87ce4`): historical, superseded by the current rejection codes.
- **The account-based client** (`mderazon/seventeen-track-js`, revision
  `b8000c9`): requires sign-in and the buyer API.
- **An API key integration** (`TA2k/ioBroker.parcel`, revision `3c4fb0e`): a
  useful reference, but its 17TRACK route needs a provisioned key.
- **Making this provider first in the chain.** It stays last; Ship24's verified
  sub-second direct lookups lead the order.


## Carrier compatibility

Per-carrier live verification with a real corpus number is pending for
17TRACK: it needs the pinned TRAWL compatibility build (`ops/trawl`), which
was unavailable in the 2026-09-12 sweep environment, and the public tracking
page does not replay a `#nums=` URL unattended (it renders demo data instead
of the requested shipment, and the landing form submit stays on the landing
page in an automation browser). The rows below therefore record design-level
evidence plus the pre-existing live verifications, not fresh per-carrier
probes. They will be replaced by real-number results once the TRAWL-backed
probe runs.

| Carrier | Evidence |
| --- | --- |
| `amazon-logistics` | ❌ incompatible by design: retail tracking lives behind the customer's Amazon account; the aggregators need the same access (`../amazon-logistics/README.md`) |
| prior art | ✅ 2026-09-08: `7321315927723857` reported delivered August 31 (`docs/CARRIERS.md`); ✅ 2026-09-10: seven events for a public example through the captured page with the pinned build |
| all other corpus carriers (35) | ⏳ not verified in this pass — requires the pinned TRAWL build; Ship24/ParcelsApp columns in the carrier READMEs hold the 2026-09-12 real-number results |

Do not read the ⏳ rows as incompatibility: an empty-history code 400 from
this provider is a provider failure, not proof of a wrong carrier (see
`ops/trawl/README.md`).


## Verification log

- 2026-09-10: unsigned direct POST probes answered HTTP 200 with rejection codes
  `-14` (current endpoint) and `-10` (legacy endpoint) instead of history. These
  probes do not prove that every possible direct request is impossible.
- 2026-09-10: live verification returned seven events for a public example
  through the captured page, with the pinned compatibility build.
- 2026-09-12: moved into `packages/carriers/providers/seventeentrack`. The
  lookup errors keep their names and their `reason` / `providerCode` fields, and
  now extend the shared taxonomy (verification is a challenge, a failed lookup
  is transport, a missing capture is indeterminate).
- 2026-09-12: per-carrier corpus-number sweep explicitly deferred: no TRAWL in
  this environment and the public page will not replay `#nums=` unattended.
  Carrier READMEs record Ship24/ParcelsApp real-number results; this
  provider's column there reads "not verified in this pass".
