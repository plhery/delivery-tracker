# ParcelsApp

## Identity and scope

ParcelsApp (parcelsapp.com) is a universal tracking aggregator, not a carrier:
it has no last mile of its own and cannot be selected for a parcel. It is the
second provider of the discovery chain (`providers/README.md`). The provider
name persisted in routing state is `ParcelsApp`.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Public tracking page | `https://parcelsapp.com/en/tracking/{number}` | status, aggregated history, a result table repeating the tracking number, destination prompts for ambiguous numbers |

The page is also the link the app shows for a parcel whose history came from
ParcelsApp.

## What we retrieve

From a direct POST to the public website API (`/api/v2/parcels`), with browser
capture/rendered history as recovery when the direct protocol fails:

| Field | Source |
| --- | --- |
| `events[].time` | `states[].date` (API, always with an offset) or the `dd LLL yyyy HH:mm` pair rendered in the page, read as UTC |
| `events[].description`, `events[].stage` | `states[].status` or the rendered event title |
| `status`, `current_stage`, `last_status_text`, `last_update` | derived from the projected events |

Rows that ask for input (`require_fields`, a postal-code form, a destination
country selector) and rows the page renders without a time are notices, not
scans: they are skipped instead of failing the shipment. Sender, destination and
estimate fields are not retained.

## Tracking numbers

Any number the chain is given: uppercased with spaces, dots and dashes removed,
it must match `^(?=.*\d)[A-Z0-9]{4,40}$`. The API reply does not repeat the
number. A direct result is scoped to the single synchronous POST that supplied
the encoded number and its checksum; there is no shared session or polling
handle. A different `correctId` is rejected as an unverified alias. For browser
captures, the result table must still show exactly one matching `Tracking number`
row. Captured replies never use the direct request's identity exemption.

## How the adapter works

Two tiers, `direct` then `trawl`, run by `runSteps` within the per-provider
budget (30 s inside the chain):

1. [http.ts](http.ts) sends one form-encoded anonymous POST, capped at 10 s and
   2 MB, with no cookies, bootstrap page, cache or redirects. A stored postcode
   is submitted as `extra[zipcode]`. Whitespace is trimmed; leading zeros,
   internal spaces and letters are preserved.
2. On a challenge, transport failure or schema drift, the configured private
   browser service (`FLARESOLVERR_URL`) loads the tracking page with
   `skipHttp`, up to tier 3, and captures responses for
   `https://parcelsapp.com/api/v2/parcels` with a 15 s settle window.
3. Captured bodies are parsed newest first; polling replies and unrelated
   shipments are skipped.
4. When no body was readable, the rendered history in the returned HTML is
   parsed instead.

HTTP 429 and server outages retain their status and `Retry-After` without a
browser retry. `NO_DATA`, `NO_TRACKER` and empty histories are inconclusive;
they do not prove a shipment was never announced. A result containing only
recipient-input prompts including a postcode raises
`input_required`; prompts alongside real scans are skipped. An absent browser
service no longer prevents direct lookups. Browser recovery cannot submit a
postcode, and never retries a known input gate.

## Public request construction

Verified against the site's [tracking bundle](https://dvow0vltefbxy.cloudfront.net/packs/js/application-aa19cda6a00923f7e330.js)
and fresh HTTP lookups on 2026-09-12. The other `assets/application-…js` bundle
contains jQuery and UI libraries; the protocol lives in `packs/js/application-…js`.

- `trackingId`: shift each normalized ASCII character by 76 modulo 126
  (`2 * sum([1,2,8,4,5,6,7,5])`), URI-encode, then form-encode again.
- `carrier=Auto-Detect`, `language=en`, `country=Unknown`,
  `platform=web-desktop`, `wd=false`, `c=true`, `p=5`, `l=3`.
- `se`: comma-joined viewport/screen/document sizes, visibility, navigator
  properties, plugin/native-function checks, WebGL vendor/renderer/checks,
  base64 host and base64 stack (the bundle supports `undefined`). Append the
  telemetry string length, original number length, and unsigned MurmurHash2
  of `encodeURIComponent(number) + telemetry`, seeded with **978**. The hash
  excludes those three appended values. A checksum from a real browser
  request matched the reconstruction exactly.
- Form fields are nested under `extra`, so jQuery sends `extra[zipcode]` and
  `extra[email]`. The adapter only sends the supplied postcode. The frontend
  also supports optional `slug`, `gResponse`, and `extra[manualCountry]`,
  `extra[manualSlugs]`, `extra[detectedSlugs]`; none is needed for the verified
  anonymous lookups.

The tested fixed telemetry profile and `undefined` stack work without a browser
or session token. A request missing the final checksum/length tuple returned
`RELOAD`; adding it returned the expected 32-event YunExpress history. This
establishes acceptance of the implemented profile, not every possible profile.

## Status reference

The wording vocabulary is shared by the four universal providers and lives in
`../shared/result.ts`; see `../ship24/README.md` for the full table. ParcelsApp
declares no machine-readable stage of its own, so every stage comes from the
wording rules and the language classifier.

| Stage | Wording (raw) | Confirmed by |
| --- | --- | --- |
| delivered | `Delivered`, `Delivered by mailbox, PIN: …` (details dropped) | live 2026-09-08 |
| accepted | `Prise en charge de votre colis sur notre site logistique de …` | live 2026-09-08 |
| registered | `Electronic information submitted by shipper`, `Colis en préparation chez l'expéditeur` | live 2026-09-08 |
| in_transit | `In transit`, `Arrived`, `Departed`, `Sorted` | live 2026-09-08 |
| pending | `Additional information provided` and any other unmapped wording | live 2026-09-08 |
| not observed | `customs`, `failed_attempt`, `ready_for_pickup`, `returned`, `out_for_delivery` | reported as unmapped |

## Limitations and privacy

- An aggregator reports what the underlying carriers give it; a dedicated
  carrier adapter is always preferred when one exists.
- Ambiguous numbers make the page ask for a destination country. That prompt is
  a notice: it never becomes a shipment event and never invents progress.
- Postcodes are submitted by the direct tier. **A gated history unlock is not
  yet verified.** Both a real SEUR form submission and the reconstructed
  request repeat `require_fields` for an intentionally invalid postcode,
  rather than returning an explicit postcode error. Bpost behaved the same
  through HTTP. Do not interpret this as successful postcode validation.
- Email, phone, house number, account sign-in and destination-country forms
  remain outside this adapter's scope.
- Delivery wording can contain an access code or a signature. Any event whose
  stage is not `delivered` and that carries such details is dropped, and a
  delivered event's description is replaced by `Delivered`.
- The provider reports no courier name we can use, so ParcelsApp never produces
  a `discovered_carrier`.

## Implementation decisions

- **Direct POST first (2026-09-12).** Supersedes the September 10 browser-only
  decision: `se` contains a public checksum, not an issued credential. Known
  histories were retrieved with Node alone. Keep browser capture as bounded
  recovery for future protocol changes.
- **Bind identity to the transport.** Direct replies belong to one scoped
  POST. Browser captures still require the matching rendered result table,
  never merely the input field or requested URL. The frontend itself supplies
  the table's tracking-number label; the backend does not echo it.
- **Rendered history is a real fallback.** When the capture yields no readable
  body, the page's event list carries the same history and is parsed instead;
  the surrounding marketing copy is excluded by the `.tracking-info .parcel
  .events > .event` selector.
- **Notices are not events (2026-09-11).** Rows asking for a postal code or a
  destination country, and rows rendered with a date but no time, are skipped
  instead of failing the whole history or manufacturing a timestamp.
- **Rendered times are UTC (2026-09-08).** Verified against the live JSON: the
  English web app prints the UTC values of its API. The machine's local timezone
  is never used.

## Rejected alternatives

Prior browser implementations inspected during the September 10 review:
[thefuga/parcelsapp-crawler](https://github.com/thefuga/parcelsapp-crawler/blob/e3085dc9a3144829d0689a4f12705f61a87258ec/main.go)
and [dustindog101/parcelsapp-cli](https://github.com/dustindog101/parcelsapp-cli/blob/b0c57c2/parcels.py).
These are protocol leads, not current availability evidence.

- **A plain HTTP GET of the tracking page.** Returns the application shell.
- **The API-key client** (`locky42/parcels-app-provider`, revision `708726c`):
  requires a provisioned key; this adapter stays on the anonymous public path.
- **Trusting a browser's requested URL as identity.** A page can render another
  shipment or an empty result for the same URL, so only the rendered result
  table is accepted.


## Carrier compatibility

Probed 2026-09-12 in a real browser on `parcelsapp.com/en/tracking/{number}`
with one real `public_shipment_report` corpus number per carrier (36
carriers). ✅ means the page's own result table echoed the requested number
and rendered shipment events; ❌ means no usable history — an empty result, a
destination-country prompt, or a notice row asking for a postcode, sign-in or
contact details (those rows are notices, never events). Wrong-carrier history
is called out explicitly: it proves the number exists, not that the filed
carrier is compatible.

| Carrier | Tested corpus number | Result 2026-09-12 |
| --- | --- | --- |
| `aliexpress` | `CNG00798678939847` | ❌ empty result (Ship24 has this shipment) |
| `amazon-logistics` | `TBA333656997000` | ❌ sign-in notice only; account-only by design |
| `an-post` | `CP476340265IE` | ❌ empty result (Ship24 has this shipment) |
| `blue-dart` | `90617363115` | ❌ recipient-postcode notice (GLS) |
| `bpost` | `323211216300000593107030` | ❌ recipient-postcode notice (Bpost) |
| `brt` | `08454077486990` | ❌ destination-country prompt (BRT Bartolini recognized) |
| `ciblex` | `560815852502035603344150` | ❌ postcode + house-number notice (trans-o-flex) |
| `colis-prive` | `HS0000329755` | ❌ destination-country prompt |
| `correos-express` | `7983000739053141` | ❌ destination-country prompt |
| `correos-spain` | `PR110604670130400C` | ❌ destination-country prompt (2015 number) |
| `ctt-express` | `0082800082809771393048` | ✅ CTT EXPRESS history |
| `ctt` | `RL402552798PT` | ✅ delivered via Portugal CTT / Italy Post (Ship24 has no history here) |
| `delhivery` | `32076610152736` | ❌ recipient-postcode notice (GLS/DPD) |
| `dhl` | `CG738165082DE` | ✅ DHL / La Poste history |
| `dpd` | `06086216767970` | ✅ 5 events, accepted (direct tier 2026-09-13; page showed empty 2026-09-12) |
| `ecoscooting` | `380030000066362966` | ❌ destination-country prompt |
| `geodis` | `1GWSKFLSKX4Y` | ❌ recipient-postcode notice (GEODIS E-space recognized) |
| `gls-de` | `10272483975` | ❌ recipient-postcode notice (GLS) |
| `gls-fr` | `20189360332` | ✅ delivered via GLS (Ship24 has no history here) |
| `hermes-de` | `02180171003654` | ❌ destination-country prompt |
| `j-and-t` | `888058657515` | ❌ recipient-postcode notice (GLS) |
| `la-poste` | `8G45061126689` | ❌ destination-country prompt (2014 number) |
| `mondial-relay` | `73800244620101503002000732` | ❌ destination-country prompt (Mondial Relay recognized, no history) |
| `mrw` | `02680I390427` | ❌ destination-country prompt (MRW recognized) |
| `nacex` | `2850/11247170` | ❌ destination-country prompt (Nacex recognized) |
| `paack` | `00100909086360120251130131718` | ❌ destination-country prompt (MRW, not Paack) |
| `packeta` | `Z8328162946` | ❌ destination-country prompt (Packeta recognized) |
| `poste-italiane` | `CH166307960NL` | ❌ destination-country prompt (PostNL/UPU, not Poste Italiane) |
| `relais-colis` | `3380000318` | ❌ destination-country prompt (DHL Express) |
| `seur` | `01475194188635` | ❌ no SEUR history: DPD history (corpus attribution unverified); `046999610972820260807` asks for SEUR postcode/phone/email |
| `speedx` | `SPXMIA056745759994` | ❌ destination-country prompt (SpeedX recognized) |
| `spring-gds` | `CK089862199NL` | ❌ destination-country prompt (PostNL recognized, no history; Ship24 has this shipment) |
| `sunyou` | `SYAE006809461` | ✅ delivered 2021 via SunYou (Ship24 has no history here) |
| `tipsa` | `8104405448` | ❌ destination-country prompt (DHL Express) |
| `uniuni` | `4C003925742US` | ✅ delivered via UNI Express (Ship24 has no history here) |
| `yunexpress` | `YT2621200705470145` | ✅ delivered via Yun Express / GOFO |

Compatible here: 8 carriers (`ctt-express`, `ctt`, `dhl`, `dpd`, `gls-fr`,
`sunyou`, `uniuni`, `yunexpress`). Five of them (`ctt`, `dpd`, `gls-fr`,
`sunyou`, `uniuni`) have no Ship24 history for the same numbers, so the two
providers complement each other. Every carrier row above is also recorded in
that carrier's own README.


## Verification log

- 2026-09-08: the English web app renders the UTC values of its own API, so the
  rendered `dd LLL yyyy HH:mm` pair is read as UTC rather than in the machine's
  local timezone.
- 2026-09-10: a raw HTML GET returns the application shell, not established
  history; the current bundle builds protected request fields. TRAWL capture is
  retained.
- 2026-09-11: a not-yet-scanned Colissimo label rendered a notice row with a
  date and an empty time; those rows are skipped.
- 2026-09-12: moved into `packages/carriers/providers/parcelsapp` unchanged, now
  reporting one `trawl` step per lookup.
- 2026-09-12: compatibility sweep over 36 real corpus numbers in a real
  browser: 7 carriers with usable history (see Carrier compatibility above);
  postcode/country/sign-in prompts are notices, never events, and are recorded
  as no usable history with their reason.
- 2026-09-12: reconstructed direct POST returns 32 states for a YunExpress
  reference (about 0.4 s) and 19 for a DHL reference (about 1.9 s),
  including the known first/last events. No TRAWL, cookies or page bootstrap.
  Bpost and SEUR repeated the prompt for invalid test postcodes; the real SEUR
  browser form behaved identically. A known valid gated pair is still needed
  for unlock verification.
- 2026-09-12: both controls also pass through the actual adapter's opt-in live
  tests. DHL's 19 upstream states become 18 projected events because the shared
  parser normalizes and deduplicates two delivery messages at the same instant.
  The reconstructed HTTP request also returned all 19 DHL states from the
  production application container in about 0.2 s; this was a protocol
  check, not a deployed-adapter verification.

- 2026-09-13: direct-tier parity re-probe of the same 36 corpus numbers (no
  postcode, no TRAWL): the 7 browser-verified carriers confirm (ctt-express
  15, dhl 18, ctt 8, sunyou 8, yunexpress 32, uniuni 27 events), and `dpd`
  flips to compatible (5 accepted events the page had shown empty). `gls-fr`
  fails only the direct tier (offset-less timestamps); trawl recovery still
  serves it. `aliexpress` times out on both paths. No other row changes.

Live reference values stay outside the repository. To run a reference lookup,
set `PARCELSAPP_LIVE_NUMBER` and optionally `PARCELSAPP_LIVE_POSTCODE`,
`PARCELSAPP_LIVE_EXPECTED_STATES` and `PARCELSAPP_LIVE_EXPECTED_EVENTS`, then run
`adapter.live.test.ts` with `vitest.carriers-live.config.ts`. Default unit tests
use synthetic identifiers and never contact the upstream service.
