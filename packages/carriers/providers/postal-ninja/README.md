# Postal Ninja

## Identity and scope

Postal Ninja (postal.ninja) is a universal tracking aggregator, not a carrier:
it has no last mile of its own and cannot be selected for a parcel. It is
**disabled by default** and remains experimental while unattended verification
is unresolved; `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it into the discovery
chain before 17TRACK. The provider name persisted in routing state is
`Postal Ninja`.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Embedded tracking widget | `https://postal.ninja/en/tools` | status and aggregated history after the number is submitted in the widget |

No stable public deep link to a parcel has been verified, so the app links to
the tracking form rather than to a per-parcel URL.

## What we retrieve

From the widget's own endpoint (`/track/get`):

| Field | Source |
| --- | --- |
| `events[].local_time` | `track.events[].dt` when it has no offset, kept as wall time |
| `events[].time` | `track.events[].dt` when it carries an explicit offset |
| `events[].description`, `events[].stage` | `track.events[].dsc` |
| `status`, `current_stage`, `last_status_text` | derived from the projected events |

`track.toAddress` and any other recipient field are never read. At most 1000
events are accepted.

## Tracking numbers

Any number the chain is given: uppercased with spaces, dots and dashes removed,
it must match `^(?=.*\d)[A-Z0-9]{4,40}$`. The reply must carry `status: FOUND`,
echo the requested number in `track.tc`, match its own handle (`track.hid` equals
`hid`) and be in a tracked state (`TRACKING`, `FINISHED`, `STOPPED`,
`ARCHIVED`).

## How the adapter works

One tier, `browser`, run by `runSteps` with the per-provider budget (45 s
standalone, 30 s inside the chain): a fresh local Chromium session
(`TRACKING_CHROMIUM_PATH`) opens `/en/tools`, fills the official embedded
widget, unticks its "save this parcel" checkbox, submits it, and reads the
`/track/get` response the widget produces. Opening a URL that contains the
number does not perform a lookup.

Because the provider gives local wall times for the whole journey, the projected
history keeps the provider's order instead of being re-sorted, and a shipment
whose newest scan has no offset reports `last_update: null` rather than an
invented instant.

## Status reference

The wording vocabulary is shared by the four universal providers and lives in
`../shared/result.ts`; see `../ship24/README.md` for the full table. Postal Ninja
declares no machine-readable stage, so every stage comes from the wording rules
and the language classifier.

| Stage | Wording (raw) | Confirmed by |
| --- | --- | --- |
| delivered | `Delivered`, `Delivered by Mailbox, PIN: …` (details dropped) | fixture |
| out_for_delivery | `Out for delivery` | fixture |
| in_transit | `In transit`, `Delivered to local carrier`, `En route` | fixture |
| accepted | `Accepted by the carrier`, `Picked up` | fixture |
| registered | `The package is being prepared by the sender …`, `En route to … awaiting processing` | fixture |
| pending | anything else | — |
| not observed | `customs`, `failed_attempt`, `ready_for_pickup`, `returned` | reported as unmapped |

## Limitations and privacy

- Experimental: fresh Chromium widget retrieval was recorded on September 10.
  Direct signed HTTP retrieval remains unverified; broad deployed coverage has
  not been established.
- The main tracking page can require an interactive challenge; only the embedded
  widget has worked unattended so far.
- Delivery wording can contain an access code or a signature. Any event whose
  stage is not `delivered` and that carries such details is dropped, and a
  delivered event's description is replaced by `Delivered`.
- Only one local browser session runs per server process; an overlapping lookup
  fails promptly and retries on the next sync.

## Implementation decisions

- **Opt-in only (2026-09-10).** No unattended success has been demonstrated for
  the direct protocol, so the provider is excluded from the chain unless
  `TRACKING_ENABLE_POSTAL_NINJA=true`. When enabled it runs before 17TRACK,
  which stays last.
- **Submit the embedded widget, do not navigate to a number.** The official
  widget on `/en/tools` passes an automatic browser check; the main tracking
  page can instead require an interactive challenge, and opening a URL that
  contains the number performs no lookup at all.
- **Untick "save this parcel".** The lookup must not leave a stored parcel
  behind in the provider's own account-less storage.
- **Local wall times are preserved, never converted.** `dt` values have no zone
  even when several countries are involved. They are kept as `local_time`, the
  provider's own order is preserved instead of sorting mixed wall times against
  UTC instants, and an undated newest scan leaves `last_update` null rather than
  fabricating an instant from the destination zone.
- **Identity is checked four ways.** `status: FOUND`, the echoed number, the
  handle matching the reply's own `hid`, and a tracked state. A challenge reply
  (`CHLNG_REQ`) or a mismatched handle is not history.

## Rejected alternatives

- **The direct check/get JSON protocol with request signing (2026-09-10).**
  Identified, but signing alone did not resolve verification in the tests run.
- **The RapidAPI integration** (`IrisKoBar/app_delivery_tracking`): uses a
  separately provisioned paid service.
- **Sorting the projected events.** Wall times sort only approximately against
  UTC instants; for a provider that omits offsets everywhere, the provider's own
  order is the more reliable one.


## Verification log

- 2026-09-10: the two-step check/get JSON protocol was identified, but signing
  alone did not resolve verification; the integration found in the same review
  uses a separately provisioned RapidAPI service. The provider stays opt-in.
- 2026-09-10: the embedded widget submission plus `/track/get` capture works in
  a fresh Chromium session with no saved login or cookie.
- 2026-09-12: moved into `packages/carriers/providers/postal-ninja` unchanged,
  now reporting one `browser` step per lookup.
