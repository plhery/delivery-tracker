# UPU Global Track & Trace

Investigation verified locally on 2026-09-21. This is a candidate shared postal
provider; it has no adapter or production routing integration yet. UPU is the
data source, not the operator transporting a shipment.

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

Implementation must account for these observed details:

- Bind the returned `ID` to the requested item. An array response alone is not
  an identity check.
- `Events` contains predictions too: `EventCd: "DLV"` had the event name
  `Estimated delivery`. Keep it out of scan history and delivered-state inference. The
  ordinary reference used `EMI` with `Final delivery` for actual delivery.
- The wire format differs from the documentation examples: dates use WCF
  `/Date(milliseconds+offset)/` strings and `State` is numeric. Verify timestamp
  semantics and status mapping before normalizing; do not assume ISO dates or
  copy the example enum strings.
- Treat the observed empty body as an empty lookup, not an upstream JSON parse
  success. Broader invalid-input and expired-history behavior is unverified.
- Coverage can be incomplete. A comparison during the same investigation with the
  [EMS Cooperative route](../../carriers/china-post/README.md#working-official-alternative-ems-cooperative)
  returned six actual events there, including an export-office arrival missing
  from UPU's five actual events. The ordinary reference yielded only delivery.

These successes establish broader service eligibility than the EMS-only route,
not comprehensive national-post coverage. The wider comparison below covers
several European references. Retention, production-network behavior and rate
limits remain unverified.

## Comparison with existing providers

On 2026-09-21, eight public references were queried through UPU, the existing
Ship24 HTTP client/parser and the existing ParcelsApp HTTP client/parser.
The synthetic control above was also queried through UPU and Ship24. No browser
recovery or 17TRACK comparison was run. All requests ran locally; negative
responses and timeouts are not evidence of permanent carrier-wide exclusion.

The counts below are history entries after the existing provider projection,
with identified delivery estimates excluded. Aggregators can repeat the same
milestone in different wording or languages, so entry counts are not counts
of distinct physical scans.

| Public reference | UPU | Ship24 | ParcelsApp |
| --- | --- | --- | --- |
| China Post EMS, China → India | 5 entries | 6 entries | 17 entries |
| Ordinary China Post, China → Brazil | 1 delivery entry | 1 delivery entry | 10-second transport timeout |
| PostNL-issued item delivered by Posti, Netherlands → Finland | 1 delivery entry | 21 entries | 52 entries |
| French postal item, France → China | 7 entries; latest actual milestone August 5 | 19 entries; newer milestone August 6 | 10-second transport timeout |
| DHL postal item, `CG…DE` | Empty body | 18 entries, delivered | 18 entries, delivered |
| Royal Mail public reference, `VU…GB` | Empty body | HTTP 404 | 1 delivery entry |
| Royal Mail public reference, `GV…GB` | Empty body | HTTP 404 | 10-second transport timeout |
| DPD numeric reference | Empty body | HTTP 404 | 5 entries |

UPU returned usable history for four of eight references. Ship24 returned
history for five, and ParcelsApp for five; all four UPU successes also succeeded
on Ship24. The synthetic control returned an empty UPU body and Ship24 HTTP 404.
This small purposive set is not a population coverage or reliability estimate.

UPU took 20–84 ms (median 25 ms) across the eight references in one pass with
connection reuse. Ship24 took 116–2,023 ms (median 276 ms); successful ParcelsApp
requests took 187–9,133 ms, with three others reaching their 10-second transport
deadline. Timings exclude module startup; the adapter lookups also include
parsing. These figures include different amounts of upstream work and do not
establish production p95.

Sources beyond the two China Post reports above:

- [Posti CLI's published example](https://github.com/hatlabs/posti-cli), also
  recorded in the Posti corpus. A fresh call through the local Posti adapter
  independently returned 18 entries and a delivered status in 619 ms.
- [French postal report](https://www.chinapostaltracking.com/qa/delivery-ew176267205fr-from-france-160586/).
- [DHL public report source](https://fr.trustpilot.com/review/www.dhl.fr), recorded
  in the [DHL corpus](../../carriers/dhl/numbers.json).
- Royal Mail reports [one](https://www.reddit.com/r/royalmail/comments/1w25nnx/if_you_experienced_this_please_reply/)
  and [two](https://www.reddit.com/r/Sugargoo/comments/1we8q17/where_is_my_parcel/),
  recorded in the [Royal Mail corpus](../../carriers/royal-mail/numbers.json).
- [DPD public report source](https://www.paketda.de/fragen-antworten.php), recorded
  in the [DPD corpus](../../carriers/dpd/numbers.json).

Two comparisons materially affect integration:

- **Freshness:** the French reference's final actual UPU entry was customs
  release on August 5. Ship24 additionally showed departure from the import
  office and arrival at a post office on August 6. Returning immediately after
  UPU success would suppress newer progress, not only older history.
- **Timezone:** the Finnish delivery's UPU WCF timestamp encodes 14:42 UTC with
  a `+0200` suffix, while Posti's own event is 13:42:18 UTC on the same day.
  Both correspond to a displayed 16:42 when using their respective offsets.
  This suggests UPU encoded local wall time using a server offset; it does not
  establish the rule for all UPU events. Preserve that uncertainty before
  using its timestamps for cross-provider freshness. Ship24 also renders that
  delivery at 16:42 UTC; provider agreement alone is not timezone verification.

The comparison also exposed one `Estimated delivery` row in ParcelsApp's China
EMS history. Its current projection includes that row in `events` and
`last_update`. It was excluded from the count above; no runtime parser change
was made as part of this investigation.

### Ordering recommendation

UPU is a useful candidate for fast postal fallback. Keep Ship24 ahead of it
under the current first-success-wins policy: UPU's cheaper success can hide
newer or fuller history. A candidate order is **Ship24 → UPU for eligible postal
numbers → ParcelsApp → 17TRACK**, keeping dedicated carrier adapters and saved
working-provider affinity ahead of discovery as the host already does.

Putting UPU first would need an enrichment policy that can continue to a richer
provider after UPU succeeds, plus rules for merging history and comparing time.
The present evidence does not justify replacing that work with a global order
change. UPU's empty body must continue discovery, and postal-shaped numbers
alone must not be treated as proof of coverage. Runtime ordering is unchanged.

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

The anonymous JSON route remains a candidate for postal fallback, with bounded
requests, identity checks, explicit estimate handling and corrected timestamp
semantics. Broader first-choice routing needs the enrichment behavior described
above; local API success alone is insufficient.
