# ParcelsApp

Second universal provider. It often returns fuller histories than Ship24, especially
destination legs, and is the only provider that uses the parcel's stored delivery
postcode. It reports no usable courier name, so it never sets `discovered_carrier`.
Persisted provider name: `ParcelsApp`. Link shown to users:
`https://parcelsapp.com/en/tracking/{number}`.

## How it works

All steps share a 45 s budget. The router reserves the same amount, and a shorter caller
deadline still wins.

1. `direct`: [http.ts](http.ts) sends one form-encoded anonymous
   `POST https://parcelsapp.com/api/v2/parcels`, capped at 30 s because cold lookups
   aggregate on demand (later requests hit ParcelsApp's cache), and at 2 MB. It uses no
   cookies, bootstrap page, cache or redirects. A stored postcode goes in
   `extra[zipcode]`, trimmed, with leading zeros, spaces and letters kept.
2. `retry`: after a network failure, timeout or cut-off body, one more direct attempt
   after 2 s, with the same input. The public frontend retries the same way. The deadline
   is the smaller of 30 s and the remaining budget. The retry is skipped if the backoff
   does not fit. Two network failures end the lookup without a browser.
3. `trawl`: on a challenge (`RELOAD`) or schema drift, TRAWL (`FLARESOLVERR_URL`) loads
   the tracking page (`skipHttp`, up to tier 3) and captures `/api/v2/parcels` replies
   with a 15 s settle window. Bodies are parsed newest first, skipping polling replies
   and other shipments. If no body is readable, the rendered event list
   (`.tracking-info .parcel .events > .event`) is parsed instead.

Outcomes that are not retried:

- HTTP errors on the direct step. A 429 or 5xx keeps its status and `Retry-After` and gets
  no browser attempt.
- `NO_DATA`, `NO_TRACKER` and empty histories are inconclusive, not proof that the
  shipment does not exist.
- A reply that only asks for a postcode raises `input_required`. Browser recovery cannot
  submit a postcode and never retries a known input gate.

## Request construction

Built from the site's tracking bundle (`packs/js/application-….js`; the
`assets/application-….js` bundle only holds jQuery and UI code):

- `trackingId`: each ASCII character shifted by 76 modulo 126, URI-encoded, then
  form-encoded again.
- Fixed fields: `carrier=Auto-Detect`, `language=en`, `country=Unknown`,
  `platform=web-desktop`, `wd=false`, `c=true`, `p=5`, `l=3`.
- `se`: a browser telemetry string (screen and document sizes, visibility, navigator and
  WebGL properties, base64 host and stack; `undefined` is accepted for the stack),
  followed by the telemetry length, the number's length, and the unsigned MurmurHash2
  (seed 978) of `encodeURIComponent(number) + telemetry`. The adapter sends one fixed
  telemetry profile. Without the trailing checksum tuple the API returns `RELOAD`.
- Of the optional fields (`slug`, `gResponse`, `extra[...]`), only `extra[zipcode]` is
  sent.

`se` is a public checksum, not an issued credential, so Node alone is enough. The browser
step exists for future protocol changes.

## Parsing

- Identity: the API reply does not echo the number, so a direct result is bound to the
  single POST that sent it. A different `correctId` is rejected as an unverified alias.
  A browser capture must render exactly one matching `Tracking number` row in the result
  table. The requested URL is not proof, because the page can render another shipment or
  an empty result for it.
- Times: `states[].date` is the scan's local clock, labelled as UTC or shifted into a
  wrong offset (a DPD scan at 14:05+02:00 comes back as `14:05+00:00`). The adapter
  keeps the UTC digits and re-reads them in the zone of the scan's carrier
  (`carriers[state.carrier]`), else the country at the end of `location`, else the
  parcel's carrier zone passed in by routing. With no zone, an offset is taken as given
  and an offset-less date fails the direct result.
- The rendered page prints the same UTC digits (`dd LLL yyyy HH:mm`) and names no carrier
  per scan, so only the parcel's zone applies. The server's timezone is never used.
- Cross-border replies stay uncertain: scans can be filed under the wrong operator (an
  India-to-France parcel listed La Poste scans under India Post).
- Notices are skipped, not events: `require_fields` rows, postcode, sign-in and
  destination-country prompts, and rows rendered with a date but no time.
- Sender, destination and estimate fields are not kept.

## Limitations

- Postcode unlock is unverified. For an invalid postcode, SEUR and bpost repeat
  `require_fields` instead of returning an explicit error, both in the real form and via
  HTTP. Verifying the unlock needs a known valid number and postcode pair.
- Email, phone, house-number, sign-in and destination-country forms are not supported.
- `Estimated delivery` forecast rows are projected as events and can set `last_update`.
- `Final delivery` wording (on UPU-relayed postal legs) maps to pending.

## Rejected approaches

- Plain GET of the tracking page: returns the application shell only.
- The API-key client (`locky42/parcels-app-provider`): needs a provisioned key.
- Browser-only lookups (as in `thefuga/parcelsapp-crawler`): slower, and unnecessary.

## Testing

`npm run test:carriers:live -- packages/carriers/providers/parcelsapp` with
`PARCELSAPP_LIVE_NUMBER` set, and optionally `PARCELSAPP_LIVE_POSTCODE`,
`PARCELSAPP_LIVE_EXPECTED_STATES` and `PARCELSAPP_LIVE_EXPECTED_EVENTS`. Keep live
values out of the repository. Unit tests use synthetic
[fixtures](fixtures/README.md) and never contact ParcelsApp.
