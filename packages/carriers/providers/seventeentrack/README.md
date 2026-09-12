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
- **Capture flows accept a 304 page (2026-09-13).** A cached page still carries
  a fresh captured API reply, so `shared/capture.ts` skips the solved-page gate
  and validates through the captured bodies instead. Tier and non-200/304
  statuses are still rejected before parsing, and without a usable capture the
  lookup still fails closed with a typed capture error. Found because every
  lookup after the first two of the corpus sweep failed on 304 pages that held
  complete histories.

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

Probed 2026-09-13 through the pinned TRAWL build (tunneled to production)
with one real `public_shipment_report` corpus number per carrier (36
carriers). ✅ means the reply echoed the requested number and carried events;
❌ rows name the exact failure. A code 400 (`lookup_unavailable`) or an empty
capture (`history_missing`) is a provider failure, not proof of a wrong
carrier; `lookup_pending` means the lookup was still polling at budget end.
Every carrier row below is also recorded in that carrier's own README.

Compatible (8): `aliexpress` (25 events, delivered, Cainiao),
`an-post` (13 events, An Post), `ctt-express` (4 events, CTT Express),
`ctt` (4 events, delivered), `dhl` (17 events, delivered),
`mrw` (1 event, in_transit), `sunyou` (8 events, delivered),
`yunexpress` (24 events, delivered). 17TRACK is the only aggregator that
reported `discovered_carrier` values (`aliexpress`, `an-post`).

| Carrier | Tested corpus number | Result 2026-09-13 |
| --- | --- | --- |
| `aliexpress` | `CNG00798678939847` | ✅ 25 events, delivered |
| `amazon-logistics` | `TBA333656997000` | ❌ polling only (code 100); account-only by design |
| `an-post` | `CP476340265IE` | ✅ 13 events |
| `blue-dart` | `90617363115` | ❌ lookup unavailable (code 400) |
| `bpost` | `323211216300000593107030` | ❌ lookup unavailable (code 400) |
| `brt` | `08454077486990` | ❌ lookup unavailable (code 400; API 500 on first try) |
| `ciblex` | `560815852502035603344150` | ❌ polling only (code 100) |
| `colis-prive` | `HS0000329755` | ❌ lookup unavailable (code 400; API 500 on first try) |
| `correos-express` | `7983000739053141` | ❌ lookup unavailable (code 400) |
| `correos-spain` | `PR110604670130400C` | ❌ lookup unavailable (code 400) |
| `ctt-express` | `0082800082809771393048` | ✅ 4 events |
| `ctt` | `RL402552798PT` | ✅ 4 events, delivered |
| `delhivery` | `32076610152736` | ❌ lookup unavailable (code 400) |
| `dhl` | `CG738165082DE` | ✅ 17 events, delivered |
| `dpd` | `06086216767970` | ❌ lookup unavailable (code 400) |
| `ecoscooting` | `380030000066362966` | ❌ polling only (code 100) |
| `geodis` | `1GWSKFLSKX4Y` | ❌ lookup unavailable (code 400) |
| `gls-de` | `10272483975` | ❌ lookup unavailable (code 400) |
| `gls-fr` | `20189360332` | ❌ captured replies without history |
| `hermes-de` | `02180171003654` | ❌ lookup unavailable (code 400) |
| `j-and-t` | `888058657515` | ❌ lookup unavailable (code 400) |
| `la-poste` | `8G45061126689` | ❌ captured replies without history |
| `mondial-relay` | `73800244620101503002000732` | ❌ lookup unavailable (code 400) |
| `mrw` | `02680I390427` | ✅ 1 event, in_transit |
| `nacex` | `2850/11247170` | ❌ provider rejects the slash composite (Invalid tracking number) |
| `paack` | `00100909086360120251130131718` | ❌ lookup unavailable (code 400) |
| `packeta` | `Z8328162946` | ❌ lookup unavailable (code 400) |
| `poste-italiane` | `CH166307960NL` | ❌ lookup unavailable (code 400) |
| `relais-colis` | `3380000318` | ❌ lookup unavailable (code 400) |
| `seur` | `01475194188635` | ❌ lookup unavailable (code 400) |
| `speedx` | `SPXMIA056745759994` | ❌ captured replies without history |
| `spring-gds` | `CK089862199NL` | ❌ lookup unavailable (code 400) |
| `sunyou` | `SYAE006809461` | ✅ 8 events, delivered |
| `tipsa` | `8104405448` | ❌ lookup unavailable (code 400) |
| `uniuni` | `4C003925742US` | ❌ lookup unavailable (code 400) |
| `yunexpress` | `YT2621200705470145` | ✅ 24 events, delivered |

Prior art, still valid: 2026-09-08 `7321315927723857` reported delivered
August 31 (`docs/CARRIERS.md`); 2026-09-10 seven events for a public example
through the captured page with the pinned build.


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
- 2026-09-13: corpus sweep completed through prod TRAWL over an SSH tunnel
  (no container runtime on this machine): 36 real numbers, 8 carriers with
  history (see Carrier compatibility above); offline suites pass
  (`seventeentrack/adapter`, `universal`, `universalScrapers`). Mid-sweep
  Coolify redeployed TRAWL (same pinned build, verified
  `tracking-capture.mjs` present); the tunnel was re-pointed at the new
  container. `shared/capture.ts` now accepts 304 pages with a fresh capture.
