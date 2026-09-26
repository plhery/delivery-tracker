# Postal Ninja

Opt-in universal provider: `TRACKING_ENABLE_POSTAL_NINJA=true` inserts it before 17TRACK.
Through TRAWL it returns full histories, often with destination legs. Its scan times
usually have no zone. Persisted provider name: `Postal Ninja`. The results page needs a
handle from a verified lookup, which cannot be built from the tracking number, so the
link shown to users is the public form.

## How it works

One step, chosen by configuration, with a 45 s budget standalone and 30 s in the chain:

- `trawl` when `FLARESOLVERR_URL` is set. TRAWL's Camoufox passes the widget check on
  the production network. A failure moves on to the next provider without trying local
  Chromium.
- `browser` otherwise: local Chromium (`TRACKING_CHROMIUM_PATH`). It returns only the
  widget's first and latest scans, and automated Chromium usually fails the Turnstile
  check.

Both paths:

1. Open `https://postal.ninja/en/tools`, fill the official embedded widget, untick "save
   this parcel" so no stored parcel is left behind, and submit. The TRAWL
   [compatibility build](../../../../ops/trawl/README.md) uses `#trawl-number=<number>`
   as its own marker to trigger that submission. It is not an upstream deep link.
2. The widget gets a Turnstile token and signs its requests:
   `POST /track/check` with `{tc, ds: null, lang}` returns `PROCESSING` and a handle.
   Then `POST /track/get` with `{hid, lang, t9n: true, mode: "GET", compact: true}` (plus
   one `AWAIT` if needed) returns only `firstEv` and `lastEv`.
3. TRAWL only: once a completed reply matches the number and its own handle, the same
   session opens `/en/track#/<hid>`. That page requests `/track/get` with
   `mode: "EXISTS"` and no `compact`, which returns the full `track.events`. The capture
   wait restarts within the original budget. The app accepts the new URL only when its
   handle is bound to an identity-matched capture.

The TRAWL path requires full history: a widget-only capture falls through to the next
provider. Compact replies are accepted only on the local Chromium path.

`/track/check` can end a lookup early. A matching `CHLNG_REQ` is a challenge error, and
a matching `UNTRACEABLE` is inconclusive. `FOUND`/`NO_INFO` stay intermediate while
`inProgress` is true, and a completed empty lookup is inconclusive. Replies for other
numbers or handles cannot end the lookup.

## Protection layers

1. Cloudflare in front of the page and API: fresh Node requests get 403 with
   `cf-mitigated: challenge`.
2. Application check: the widget runs Turnstile (action `widget`) and sends the token in
   `X-RC-Token` with a `TSI` suffix. If that fails, the token is empty and the check
   returns `CHLNG_REQ`. The main entry form uses managed Turnstile (`check`, `TSM`) with a
   reCAPTCHA v2 fallback, which fails in automated sessions. This is why lookups go
   through the widget and then the results page, never the main form.
3. Signing: `X-TW-Sign` holds API version 6, a millisecond timestamp and a base64
   HMAC-SHA256 over `version;timestamp;JSON-body`, keyed by a constant in the public
   bundle. A valid signature does not replace the challenge token. The browser path
   lets the widget sign, so the adapter holds no signing constant.

## Parsing

- Identity: `status: FOUND`, `track.tc` equals the number, `track.hid` equals `hid`, and
  the state is `TRACKING`, `FINISHED`, `STOPPED` or `ARCHIVED`.
- `dt` has no zone, even across countries. It is kept as `local_time`, and as `time` only
  when it carries an explicit offset. The provider's order is kept, because wall times
  cannot be sorted reliably against UTC instants. If the newest scan has no offset,
  `last_update` is null.
- `track.toAddress` is never read. At most 1000 events.

## Rejected approaches

- Pure HTTP: signed check/get calls are challenged by Cloudflare locally and from
  production. Replaying fresh `cf_clearance` cookies with the same User-Agent still gets
  403.
- Signed full-mode `fetch` inside the verified browser: works, but the results page
  already makes that request.
- The RapidAPI integration (`IrisKoBar/app_delivery_tracking`): a separate paid service.

## Testing

`npm run test:carriers:live -- packages/carriers/providers/postal-ninja` with
`FLARESOLVERR_URL` set: two successive lookups of a public reference, and a synthetic
untraceable number that must stay inconclusive. The local Chromium path is covered by
`src/server/universalScrapers.live.test.ts` with `TRACKING_CHROMIUM_PATH`. Unit tests use
synthetic [fixtures](fixtures/README.md).
