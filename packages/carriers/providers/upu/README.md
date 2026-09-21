# UPU Global Track & Trace

Implemented as the final shared postal fallback on 2026-09-21. UPU is the
data source, not the operator transporting a shipment. The [adapter](adapter.ts)
uses one anonymous GET with an eight-second total budget, a two-megabyte body
limit, exact item identity and at most 1,000 input events. Eligibility requires
a checksum-valid S10 number; that does not prove coverage or identify a carrier.
No browser recovery, cookie cache, retry or CAPTCHA solver is involved.

## Working anonymous API

The [UPU API directory](https://www.upu.int/en/postal-solutions/technical-solutions/products/upu-api-documentation)
links the [GTT API documentation](https://upu.api.post/gtt/), which explicitly
documents anonymous tracking methods alongside separate token-based methods.
The following documented GET worked without solving the website CAPTCHA:

```text
https://globaltracktrace.ptc.post/gtt.api/service.svc/rest/ItemTTWithTrans/{itemID}/EN
```

A fresh Node `fetch` with default headers returned matching JSON in 101 ms.
Independent Python requests with the default urllib User-Agent also succeeded.
No API key, account, browser, landing-page bootstrap, CAPTCHA answer or incoming
cookie was needed. Responses set cookies, but these clients did not retain or
replay them. These are individual local measurements, not server-side or
production reliability measurements.

For a bounded reproduction, supply the live reference outside the repository:

```sh
curl --fail-with-body --max-time 15 \
  "https://globaltracktrace.ptc.post/gtt.api/service.svc/rest/ItemTTWithTrans/${UPU_LIVE_NUMBER:?Set a reference number locally}/EN"
```

`ItemTT/{itemID}` also worked, but event and country names were null. The
`ItemTTWithTrans` variant returned English labels. The documentation also lists
anonymous `POST /ListTT` and token-based `*Ext` methods; those were not tested.

## Observed coverage and parsing boundaries

| Control | Result |
| --- | --- |
| Public China Post EMS reference | HTTP 200, matching `ID`, origin China and destination India; five actual events plus one estimated-delivery row. |
| Public ordinary China Post `LZ…CN` reference | HTTP 200, matching `ID`, origin China and destination Brazil; one final-delivery event. The EMS-only website rejects this service class. |
| Synthetic, checksum-valid `EB000000005CN` | HTTP 200 with a zero-byte body, on both `ItemTT` and `ItemTTWithTrans`; not a JSON array or a successful tracking result. |

The references are the public
[EMS report](https://www.chinapostaltracking.com/qa/package-stuck-export-customskeep-pending-inspection-161051/)
and [ordinary postal report](https://www.chinapostaltracking.com/qa/demora-160174/).
Live identifiers and raw responses remain outside the repository.

The implementation handles these observed boundaries:

- Bind the returned `ID` to the requested item. An array response alone is not
  an identity check.
- `Events` contains predictions too: `EventCd: "DLV"` had the event name
  `Estimated delivery`. Keep it out of scan history and delivered-state inference. The
  ordinary reference used `EMI` with `Final delivery` for actual delivery.
- The wire format differs from the documentation examples: dates use WCF
  `/Date(milliseconds+offset)/` strings and `State` is numeric. The adapter keeps
  local wall time and maps verified event codes rather than copying example enums.
- Treat the observed empty body as an empty lookup, not an upstream JSON parse
  success. Broader invalid-input and expired-history behavior is unverified.
- Coverage can be incomplete. A comparison during the same investigation with the
  [EMS Cooperative route](../../carriers/china-post/README.md#working-official-alternative-ems-cooperative)
  returned six actual events there, including an export-office arrival missing
  from UPU's five actual events. The ordinary reference yielded only delivery.

These successes establish broader service eligibility than the EMS-only route,
not comprehensive national-post coverage. The [wider comparison](../COMPARISON.md) covers
several European references. Retention, production-network behavior and rate
limits remain unverified.

## Destination metadata and onward tracking

A raw-response recheck on 2026-09-21 of the public Venezuela reference from the
[non-EMS comparison](../COMPARISON.md#china-post-non-ems-follow-up) returned
`DestinationCountryCd: "VE"`, destination name `VENEZUELA`, origin `CN`/`CHINA`,
mail class `C`, the original `ID`, and four actual scans plus one excluded
delivery forecast. It supplied no alternate tracking number or destination
operator. Ship24's corresponding response also listed only the original number.
The documented anonymous and token-based GTT response schemas have no explicit
alternate-number or delivery-operator field; token-based access was not tested.
Our adapter currently projects events/status, not these country/class fields.

Destination country can suggest a direct operator lookup, but is not proof of
a handoff or a new identifier. The [Ipostel homepage](https://www.ipostel.gob.ve/)
links its [tracking application](http://pwa.ipostel.gob.ve/), whose shipped client
calls `GET http://api.ipostel.gob.ve:5001/api/v1/rastreo-seguimiento/{number}`.
A bounded lookup using the same public reference returned HTTP 404, which that
client presents as no information for the supplied number. This did not confirm
Ipostel coverage, receipt of the parcel, or any alternate number. The linked HTTP
application worked; its HTTPS variant failed certificate validation during this
check. No TLS validation was disabled. Live inputs and responses remain outside
the repository.

## History and time

The adapter retains each real scan's reported wall time as `local_time` and
leaves `time`/`last_update` unset. The WCF offset is not a verified event zone:
a Finnish delivery disagreed with Posti's own timestamp. ISO-shaped replies
receive the same conservative treatment. `DLV` and explicitly named delivery
forecasts are excluded entirely, including from ETA, status and freshness.
Known event codes determine stages; numeric `State` does not prove delivery.
Signature fields and recipient details are not projected.

The host accumulates up to 1,000 distinct UPU scans in
`carrier_data.upu_history`, scoped to the lookup number, with first-observation
times. A shorter response or recovery to another provider preserves that
archive and existing timestamped timeline rows. The visible timeline records
new current milestones at the time the app observed them, flagged
`observed_without_provider_timestamp`; it does not backfill uncertain historical
wall times as UTC scans. Thus stored UPU history is richer than the currently
rendered timeline. Repeated identical responses do not append another milestone.

UPU can establish initial progress and update its own local-time summary. It
cannot prove that its summary is newer than another source, so it preserves
saved richer progress; older UPU snapshots and terminal regressions are also
rejected. No UPU wall time advances the router's UTC event watermark. Richer
providers are retried after their normal cooldowns even after UPU succeeds.

See [provider tradeoffs and the dated eight-reference comparison](../COMPARISON.md)
for completeness, freshness, latency and the observed ParcelsApp forecast issue.

## Is it free?

The live endpoints above accepted anonymous requests without payment or signup.
The [2026 PTC schedule of charges, page 6](https://www.upu.int/UPU/media/PTC/Documents/PUBLIC/SOC/PTC_Schedule_of_charges_EN.pdf)
lists GTT as free in its postal-operator add-on table. That schedule addresses
designated operators; it is not an unlimited third-party API plan.

No public request quota, SLA or unrestricted third-party usage grant was found
in the reviewed material. The API directory also links a general
[API copyright notice](https://www.upu.int/UPU/media/PTC/Documents/PUBLIC/API/CopyrightNotice-API.pdf)
discussing licensed software and documentation. Anonymous technical access is
verified; commercial usage terms are not established by these tests.

## Website CAPTCHA and GitHub prior art

The [public form](https://globaltracktrace.ptc.post/gtt.web/Search.aspx) still
displays a four-character text CAPTCHA as an inline JPEG. Its ASP.NET postback
includes `txtCaptchaCode`, an encoded challenge in `txtCaptchaEncCode`, the item
field `txtItemID`, and the page's validation/state fields. This is a text-entry
challenge, unlike China Post's ordered Chinese-character clicks.

OCR is a plausible approach, but its accuracy was not measured. No successful
answer omission or current challenge replay was demonstrated. The documented
API makes solving this form unnecessary for the verified lookups.

| Project and inspected revision | Finding |
| --- | --- |
| [apoldev/trackchecker](https://github.com/apoldev/trackchecker/blob/277a339ffa3e39864e0c69bd7e260b6dcf70004b/configs/spiders.json), MIT; file last changed 2024-02-06 | Its `global-track-trace` entry calls `ItemTTWithTrans/[track]/en` directly. This independently identifies the working API route. Its date transformer expects ISO-shaped text; do not copy that assumption into a parser for the observed WCF response. |
| [AlienZaki/PostAPI GlobalTrack](https://github.com/AlienZaki/PostAPI/blob/c431f90647e9e11778b5dc86fb93fca59c64236f/GlobalTrack/global_track_service.py) and [solver](https://github.com/AlienZaki/PostAPI/blob/c431f90647e9e11778b5dc86fb93fca59c64236f/GlobalTrack/CaptchaSolver.py), GlobalTrack last changed 2023-01-16 | Posts the ASP.NET form, first tries a cached answer/encoded-challenge pair, then uses the external AZCaptcha service. This is a historical reuse hypothesis plus a service integration, not a verified current free OCR solver. No repository license was found; the code was inspected, not executed or copied. |
| [shikarkhane/postal-scanner](https://github.com/shikarkhane/postal-scanner/blob/fc738049afccacdcef14887850ae269bc7d22fcb/src/destination/fetcher.py), file last changed 2018-11-29 | Its Sri Lanka path automates the UPU form with Selenium but has no CAPTCHA solution. It does not establish a current workaround. No repository license was found. |

## Adapter verification

Fresh calls through the implemented adapter on 2026-09-21 returned five actual
EMS scans in 86 ms, one ordinary China Post delivery scan in 69 ms, and one
PostNL-to-Posti delivery scan in 19 ms. The synthetic unknown returned the
parcel-specific empty-lookup error in 33 ms. Every successful result retained
local wall time and left UTC freshness unset. These were local low-volume
checks, not deployment or update-cadence verification.

The API route is implemented independently; no prior-art code or credentials
were copied. Tests cover identity, sparse/forecast-only results, date semantics,
HTTP failures, cancellation, resource bounds, ordering and history preservation.
Local live checks are separate from deployment verification. Apply
`20260921100000_add_upu_provider.sql` before deploying the application so the
shared health store admits the new provider.
