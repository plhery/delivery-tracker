# Postal Ninja

## Identity and scope

Postal Ninja (postal.ninja) is a universal tracking aggregator, not a carrier:
it has no last mile of its own and cannot be selected for a parcel. It is
**disabled by default** and remains experimental while unattended verification
is unreliable in the production browser; `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it into the discovery
chain before 17TRACK. The provider name persisted in routing state is
`Postal Ninja`.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Embedded tracking widget | `https://postal.ninja/en/tools` | status and aggregated history after the number is submitted in the widget |

No stable public deep link to a parcel has been verified, so the app links to
the tracking form rather than to a per-parcel URL.

## What we retrieve

From the widget's own endpoint (`/track/get`). The widget requests
`compact: true`, which returns `track.firstEv` and `track.lastEv`, not a full
`events` array. The parser accepts both shapes; compact replies retain only the
reported first/latest scans and do not claim a complete timeline.

| Field | Source |
| --- | --- |
| `events[].local_time` | scan `dt` when it has no offset, kept as wall time |
| `events[].time` | scan `dt` when it carries an explicit offset |
| `events[].description`, `events[].stage` | scan `dsc` |
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

The adapter also observes `/track/check`. A matching `CHLNG_REQ` ends the
attempt with a challenge error instead of waiting for a `/track/get` response
that will never arrive. An identity-matched `FOUND`/`NO_INFO` reply remains
intermediate while `inProgress` is true; the completed empty lookup is
inconclusive, not proof that the shipment does not exist. Unrelated numbers
and handles cannot terminate the lookup.

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

- Experimental: the September 21 checks reproduced automatic widget success
  in regular Chrome, but isolated automated Chromium sessions failed Turnstile
  locally and using the production application image/network.
- Signed HTTP requests, including a local replay with freshly issued browser
  clearance cookies, were challenged by Cloudflare. Full history was retrieved
  through signed fetch inside a verified browser; this is not a working pure
  HTTP client.
- The widget provides first/latest scans. The full-history mode described below
  is manually verified but is not an additional adapter tier.
- Delivery wording can contain an access code or a signature. Any event whose
  stage is not `delivered` and that carries such details is dropped, and a
  delivered event's description is replaced by `Delivered`.
- Only one local browser session runs per server process; an overlapping lookup
  fails promptly and retries on the next sync.

## Implementation decisions

- **Opt-in only.** A working regular-browser session does not establish reliable
  server operation. `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it before
  17TRACK; eligible UPU remains the final fallback.
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

## Current protocol and verification layers

The public [tools page](https://postal.ninja/en/tools) embeds
`/widget/tracker?preview=true`. Its September 21 scripts were
`/assets/js/embed.fdTqqrcC.js`, `/assets/js/input-text.COkLGG-7.js` and
`/assets/js/main.D6x1c98t.js`. Inspection established three separate layers:

1. **Cloudflare page/API protection.** Fresh Node HTTP requests received 403
   with `cf-mitigated: challenge`. Loading the site in a browser could clear
   this layer while the application challenge below still failed.
2. **Application verification.** The widget executes Cloudflare Turnstile with
   action `widget` and sends the result in `X-RC-Token`, with a `TSI` suffix.
   Its token-acquisition failure is caught and becomes an empty token; the
   subsequent signed check can then return `CHLNG_REQ`. The widget opens the
   main tracker in a new tab on that failure. The main form uses managed
   Turnstile (`check`, `TSM`) and has a Google **reCAPTCHA v2** fallback modal
   titled "Please click to continue". No particular image puzzle was observed
   in this investigation; the old phrase "interactive challenge" did not
   identify which layer failed.
3. **Request signing.** `X-TW-Sign` contains API version 6, a millisecond
   timestamp and an HMAC-SHA256 signature over `version;timestamp;JSON-body`,
   encoded as base64. The shared public bundle contains the signing constant.
   A correct signature does not replace the separately issued challenge token.

The widget submits `POST /track/check` with `{tc, ds: null, lang}` and no
`save` flag. `PROCESSING` supplies a handle. It then calls `POST /track/get`
with `{hid, lang, t9n: true, mode: "GET", compact: true}` and, if needed,
one `AWAIT` request. In a verified regular Chrome session, the check carried
the Turnstile token and the subsequent get requests did not need another one.

Removing `compact` and signing the changed body returned a matching full
32-event history for the public YunExpress control in the verified browser.
The compact reply instead contained only `firstEv` and `lastEv`. The old
parser rejected that valid compact reply; it now handles both shapes.

## Other alternatives

- **Pure HTTP.** Fresh signed check/get calls with normal browser headers were
  challenged locally and from the production network. A fresh local browser
  bootstrap issued `cf_clearance`, but replay with its cookies and User-Agent
  still received the Cloudflare 403. This does not establish that every HTTP
  client or future session will fail.
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
- 2026-09-21: regular Chrome passed widget verification automatically. The
  existing public [YunExpress control](https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/)
  returned compact delivered history; a signed full-mode browser request
  returned 32 scans. Both public references in the
  [Royal Mail corpus](../../carriers/royal-mail/numbers.json) returned matching
  `NO_INFO` after polling, so Postal Ninja did not provide Royal Mail coverage
  for those samples.
- 2026-09-21: local headless and headed Playwright Chromium sessions, plus an
  isolated instance of the production application image on its server, loaded
  the widget but failed its Turnstile token acquisition. Their signed checks
  returned `CHLNG_REQ`. A failed Cloudflare subdomain request was observed but
  was not established as the cause. The provider remains opt-in. Live tokens,
  cookies, raw replies and recipient fields are not repository fixtures.
- The updated adapter reported the local automated challenge in 2.5 seconds,
  instead of waiting for the 30-second provider budget. This verifies failure
  handling, not successful automated retrieval. Compact parsing, privacy,
  identity, polling and browser cleanup are covered by synthetic tests.
