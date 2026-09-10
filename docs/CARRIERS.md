# Carrier support

Delivery Tracker can refresh these carriers automatically:

| Carrier | Notes |
| --- | --- |
| Swiss Post | Automatic tracking through the pinned upstream adapter. A contracted business API is preferable for long-term production use. |
| Hermes Germany | Automatic parcel tracking through the anonymous myHermes recipient API. Separate from Hermes Einrichtungs-Service. |
| GLS Germany | Automatic through the GLS Group recipient service. Accepts four-digit Swiss and five-digit German delivery postcodes. Ambiguous 11/12-digit numbers are verified with GLS during entry. |
| Delivengo | Automatic through La Poste. Choose it manually: its postal number ranges overlap other La Poste services. |
| DHL / Deutsche Post | Automatic German parcel and tracked-mail updates through DHL's public tracking session, with the existing private TRAWL browser as a challenge fallback. |
| DHL eCommerce | Automatic international parcel tracking through DHL’s global recipient API, with browser-established sessions when challenged. Separate from DHL Paket / Deutsche Post. |
| Swiss Post Cargo | Automatic through the official anonymous public tracker. |
| Quickpac | Automatic through Planzer's current tracking API. Existing Quickpac numbers keep their carrier label. |
| Planzer | Automatic. Shared `999.90.########` shipments need the complete shared tracking URL. |
| Cainiao / AliExpress | Automatic. |
| SunYou | Automatic. |
| Hermes Einrichtungs-Service | Automatic. |
| PostNL | Automatic. Recognises valid Dutch postal S10 numbers ending in `NL`, PostNL links, and Spring mailingtechnology.com links. |
| PostLogistics | Automatic. |
| Dachser | Automatic for Customer Iberia shipments when the complete public detail URL is supplied. |
| DPD Switzerland | Automatic through the myDPD guest flow. The parcel's delivery postcode unlocks verified scans and delivery windows. |
| GLS Switzerland | Automatic through GLS's public tracking services. The four-digit recipient postcode unlocks the detailed event history. |
| UPS | Automatic. Direct HTTP is tried first; a private TRAWL instance can handle browser challenges. |
| Amazon Shipping France | Automatic through Amazon Shipping's anonymous recipient tracker for `FR` followed by ten digits. |
| DPD France | Automatic through the recipient trace page. Direct HTTP is tried first; a private TRAWL instance is required when Cloudflare challenges it. |
| Mondial Relay | Automatic through the recipient web flow. Requires the five-digit recipient postcode and can use private TRAWL for Cloudflare. |
| Relais Colis | Automatic through the public recipient form and its CSRF-bound session. |
| La Poste / Colissimo | Automatic through La Poste's public unified tracking feed. |
| Chronopost | Automatic through the same privacy-minimizing La Poste unified feed; the Chronopost SOAP scraper is intentionally not used. |
| GLS France | Automatic through the public recipient-tracking JSON service. |
| Colis Privé | Automatic when the tracking input contains the 12-character shipment number followed by the five-digit recipient postcode. |
| GEODIS | Automatic for the official 12-character `1G…` recipient tracking format. |
| Colisweb | Automatic through the public recipient-search service. |
| C Chez Vous | Automatic through the public order-tracking page. |
| Heppner | Automatic through the public recipient flow. Requires the shipment receipt number and its four- or five-digit delivery postcode. |
| Ciblex | Automatic through the public parcel-tracking page for 14-digit shipment numbers. |
| Paack | Automatic through the public recipient flow. Requires the tracking number and delivery postcode. |

Unknown carriers (`unknown` and `intl-post`) now attempt automatic lookup through
ParcelsApp → 17TRACK → Ship24, with Postal Ninja opt-in. The first two use the existing
private TRAWL service (`FLARESOLVERR_URL`); Postal Ninja and Ship24 use a dedicated
fresh Chromium session (`TRACKING_CHROMIUM_PATH`). These services are **not
selectable carriers**.
Ambiguous numbers can be saved for automatic lookup; a known carrier can still
be selected manually. Pasted 17TRACK/ParcelsApp links resolve to a recognized
carrier when possible, otherwise to unknown. The external 17TRACK link remains
available and follows the app language.

Only history bound to the requested shipment is accepted. 17TRACK demo numbers,
initial polling replies, carrier-selection prompts, postcode forms, challenges,
and empty responses cannot manufacture progress. If all lookups fail, sync
reports an error and retains existing history. No authenticated commercial API
key is required. A saved arbitrary tracking URL is never fetched by the fallback.

TRAWL 1.5+ can return captured public API responses; ParcelsApp also supports
parsing the rendered result on existing TRAWL releases. During the September 8
checks, 17TRACK's onboarding and compressed response capture prevented automatic
history retrieval, so it fell through to ParcelsApp. A normal interactive
17TRACK browser did return real history. Aggregators can disagree or require
additional information, especially for ambiguous numeric identifiers. Carrier
adapters remain preferable when the carrier is known.

Postal Ninja submits its official embedded tracking widget on `/en/tools` and
reads `/track/get`; simply
opening a URL containing the number does not perform the lookup. Ship24 reads
its public web app's `/api/parcels/{number}?lang=en` response. Neither scraper
uses a paid API key or a saved browser login. Docker installs Chromium and sets
`TRACKING_CHROMIUM_PATH=/usr/bin/chromium`; local runs need an explicit executable
path. Chromium receives no application secrets. Sessions and cookies are deleted
when each lookup finishes. Only one form scraper runs per server process at a
time; overlapping requests fail promptly for retry on the next scheduled sync.
Each source has a 45-second default timeout, and the first successful source wins.
A full chain can therefore take roughly three minutes when every source times out.

Ship24's `timestamp` includes the carrier offset; its `datetime` field can contain
local wall-clock time mislabeled with `Z`, so that field is deliberately ignored.
Postal Ninja normally omits offsets entirely. Those values are retained as
`local_time` in the adapter result, with no fabricated UTC `time` or `last_update`.
The shipment status is usable, but those undated scans are excluded from the
persisted timeline by the existing sync normalizer. A newly observed status
change can still create a clearly marked observation at sync time, using the
existing `observed_without_provider_timestamp` path. Explicitly offset Postal
Ninja dates are accepted. Neither a delivery forecast nor a handoff described as
“Delivered to local carrier” is treated as final delivery. Delivery descriptions
are reduced to “Delivered” to omit signatures and access codes.

Offline coverage lives in `universalScrapers.test.ts`; the opt-in
`universalScrapers.live.test.ts` exercises both full browser workflows using a
public forum sample. Live site access can still be blocked by browser checks;
these failures preserve existing tracking data and continue the fallback chain.
On September 10, 2026, the full Ship24 scraper retrieved the public sample in a
fresh local Chromium session. Postal Ninja's captured interactive responses
validated its parser, but its unattended widget lookup still stalled at the
automatic challenge. It remains the last, experimental fallback; successful
Postal Ninja automation has not been established.

GLS links are routed by country path (`DE`, `FR`, `CH`/`EU`) instead of treating
all `gls-group.com` links as French. Hermes Germany's H-prefixed numbers are
recognized; shared numeric formats remain ambiguous. Delivery postcodes are
validated separately for Swiss and German GLS. Recipient addresses and
signatures are not copied from carrier payloads.

### Public sample checks, September 8, 2026

| Provider | Public source and sample | Observed result |
| --- | --- | --- |
| Hermes Germany | [Paketda Hermes forum](https://www.paketda.de/fragen-antworten.php?suche_carrier=hermes), `39181147009513` | Five dated events, delivered to a neighbour July 7. |
| GLS Germany | [Paketda GLS forum](https://www.paketda.de/fragen-antworten.php?suche_carrier=gls), `28286849236` | Explicit retired/not-found response (`E000`, HTTP 404); no postcode-protected details requested. Successful detail parsing is covered by synthetic fixtures. |
| Delivengo | [Philaseiten public postal example](https://www.philaseiten.de/cgi-bin/index.pl?PR=319289), `LD156008025FR` | Old May 2023 example; local public endpoint returned an access error, not usable history. Adapter routing and parsing use the existing La Poste tests. |
| Unknown → ParcelsApp | [Reddit AirReps discussion](https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/), `YT2621200705470145` | 32 events through the real unknown-carrier dispatcher and existing deployed TRAWL; delivered August 17. |
| Universal ambiguity | [Reddit tracking discussion](https://www.reddit.com/r/kakobuy/comments/1vvdv1x/is_this_normal_when_will_i_get_my_package/), `7321315927723857` | Interactive 17TRACK reported delivery August 31; ParcelsApp varied between an electronic announcement and a postcode prompt. Prompts are excluded from history. |

The opt-in `expandedCarriers.live.test.ts` repeats the public checks. Universal
lookup needs `FLARESOLVERR_URL`; other tests use anonymous public endpoints.
Forum samples age out, so retained-history success and explicit retention errors
are distinguished. Offline tests use synthetic identifiers and payloads rather
than recipient data. Protocol references: [myHermes public web app](https://www.myhermes.de/empfangen/sendungsverfolgung/),
[GLS Group](https://gls-group.eu/DE/de/paketverfolgung/),
[Delivengo FAQ](https://mydelivengo.laposte.fr/easy/faq/), and
[TRAWL native API](https://github.com/germondai/trawl/blob/main/apps/docs/api-reference/native-api.md).

Dutch postal numbers resolve to PostNL. Its automatic tracker uses
[PostNL international tracking](https://postnl.post/), and links open
`https://postnl.post/track?barcodes={trackingNumber}`. The retired `/details/`
links are still recognised when pasted and repaired if saved on a parcel.
[Spring GDS](https://www.spring-gds.com/) is PostNL's international subsidiary;
its mailingtechnology.com portal can show additional transport history for the
same PostNL barcode. The internal `spring-gds` carrier ID is retained for
existing parcels and client compatibility, while the app and diagnostics use
the PostNL name.

PostNL and Planzer / Quickpac tracking requests retry once after
a transport failure or HTTP 502, 503, or 504. HTTP 429 is retried only when it
supplies a valid, short `Retry-After`. A supplied `Retry-After`
is respected when it fits the one-minute retry budget; longer delays and
persistent failures remain visible as sync errors and in Sentry. Invalid
tracking data and other HTTP errors are not retried. PostNL uses a
thirty-minute daytime/hourly overnight schedule and supports manual refreshes.

Asendia and FedEx parcels are saved with a direct carrier link. Asendia's
public flow requires a fresh Cloudflare Turnstile
validation, while the supported FedEx tracking API requires provider
credentials. ShipUp can be kept as a manual record.

DHL detection includes checksum-valid German parcel and tracked-mail S10 numbers
(`C…DE` and `L…DE`, including `LF…DE`) plus tracking links on `dhl.com`, `dhl.de`
and `deutschepost.de`. Other postal ranges keep their existing carrier or generic
postal fallback. DHL documents its separate parcel and letter tracking entry
points in its [tracking help](https://www.dhl.de/en/privatkunden/hilfe-kundenservice/sendungsverfolgung/probleme-loesungen.html).

The automatic DHL adapter establishes a cookie/CSRF session using the public
`/int-verfolgen/data/config` endpoint, then reads `/search` with the same
`verfolgen-CSRF-token` and `verfolgen-wg` headers as DHL's recipient app. Cookies
stay in memory; an expired session, timeout or interrupted connection gets one
fresh HTTP session before TRAWL is used. Interrupted response bodies also take
this recovery path. Rate limits and server errors remain errors rather than
triggering a browser attempt. DHL's official business API credentials are not
needed for this public flow.

Only status, timestamps, broad event locations and the delivery estimate are
retained. Recipient/address/signature fields are discarded. The adapter checks
the shipment identifier, orders events newest first, distinguishes electronic
announcements from transit, and removes delivery estimates after completion.
It covers the German parcel/postal tracking service, including `LF…DE`; another
DHL division or a request for additional verification remains an explicit error
with the tracking website available, rather than being mistaken for a parcel
that has not yet been announced.

DHL eCommerce uses the public `www.dhl.com/utapi` recipient endpoint. A
challenge (including HTTP 428) or interrupted connection bootstraps cookies
through the private TRAWL browser and then retries the structured request.
Sessions are reused; rate limits and upstream server errors remain visible.
The API may return a customer-confirmation ID instead of the queried alias,
so the adapter accepts one eCommerce shipment only from its exact request URL.
It retains status, broad locations, delivery estimate and dated scans, never
recipient addresses or customer references. Local timestamps are converted
only for known countries or hubs; scans with unresolved timezones are omitted
rather than assigned a fabricated UTC timestamp.

The catalog distinguishes eCommerce portal links and disambiguates global DHL
tracking links using number candidates. `GM` identifiers are recognized;
16–17 digit numbers are low-confidence suggestions because other carriers use
similar formats. DHL documents these identifiers in its
[Americas reference](https://developer.dhl.com/api-reference/references-dhl-ecommerce-americas).
Apply `20260912140000_add_dhl_ecommerce.sql` before deployment
to enable the carrier in the owner-only create/change RPCs.

Carrier names, adapter modes, tracking links, required inputs, timezones and
detection rules are defined once in `contracts/openapi.json` under
`x-carriers`. They are generated into the Next.js app and the iPhone's offline
fallback, and are also published at `/api/carriers` for dynamic native refreshes.
The iPhone caches validated responses and accepts future string carrier IDs, so
backend additions using the existing input fields become visible without
another native release. Broad numeric formats are treated as suggestions and
require manual confirmation; UPU S10 identifiers must pass their check digit
before automatic detection.

## French carrier handling and privacy

Amazon Shipping France, DPD France, Mondial Relay, Relais Colis, La Poste / Colissimo, Chronopost, GLS
France, Colis Privé, GEODIS, Colisweb, C Chez Vous, Heppner, Ciblex and Paack
are visible in the manual carrier picker on the web and in both iPhone
interfaces. Recognized tracking links and distinctive number formats can still
select a carrier automatically. Broad numeric formats remain suggestions and
ask the user to confirm the carrier before saving.

La Poste's unified response covers Colissimo, tracked mail and Chronopost. The
adapter validates the returned shipment identifier and retains only normalized
status, date, country and event-code fields. Chronopost therefore does not need
the separate SOAP response, which exposes more consignment metadata and is not
intended for automated extraction.

GLS France and GEODIS responses can include recipient, sender, address, contact,
delivery-instruction and document data. Their adapters build results from a
small allowlist of status/timeline fields rather than copying upstream objects.
GEODIS's anonymous request signature uses the public client key shipped in its
recipient SPA; it is not an account secret, but it can rotate with a frontend
deployment.
Colis Privé's HTML adapter similarly removes the destination block before it
reads the status banner and timeline. The Colis Privé combined credential ends
in the recipient postcode, so treat it like a tracking secret and keep it out
of logs and public issues.

Colisweb, C Chez Vous, Heppner, Ciblex and Paack use their public recipient
flows. Their adapters verify the returned shipment identifier when the provider
supplies one and retain only normalized status, delivery estimate, scan time,
event code and coarse operational-location fields. Recipient names, street
addresses, contact details and delivery instructions are discarded. Heppner
and Paack require the delivery postcode; treat it as part of the tracking
credential. C Chez Vous order references grant access to a public order page
and should be handled the same way.

Colisweb currently returns an empty HTTP 500 for a validly shaped unknown
shipment. Because that response does not prove that the shipment is absent, the
adapter reports an indeterminate upstream failure instead of converting it to a
false not-found result.

DPD France exposes a server-rendered timeline rather than a reusable JSON feed.
Its adapter verifies the outbound or return parcel number before retaining only
timeline status, time and operational location fields. Cloudflare normally
requires the same private TRAWL browser fallback used for UPS. DPD France's
current [site terms](https://www.dpd.com/fr/fr/conditions-generales-utilisation/)
broadly restrict unapproved automated access and extraction, so this integration
is experimental and should be replaced by a contracted API before relying on it
as a long-term production integration.

Mondial Relay's current recipient page calls its own tracking endpoint with an
eight-, ten- or twelve-digit shipment number, the recipient postcode and a
page-scoped verification token. The historic `dpdPostcode` API property and
`dpd_postcode` database column are reused for that five-digit value to preserve
backward compatibility; they remain four digits for DPD Switzerland. Treat the
postcode as part of the tracking credential. TRAWL's Redis-backed session cache
keeps the page token and API request on the same solved browser identity. Relais
Colis uses a normal bounded HTTP session: the adapter obtains the form's CSRF
token, submits the shipment number, verifies the echoed identifier and projects
only timeline fields.

These frontend endpoints are undocumented and can change without notice. The
adapters use bounded responses, timeouts, strict input and response-identity
checks, and privacy-safe projections; failures remain visible for retry. La
Poste's supported Okapi-key API is the preferred future production path when
deployment credentials are available.

Amazon Shipping's public France tracker exposes the shipment summary and event
history used by its recipient page. The adapter retains only status, dates,
event codes and coarse city/region/country locations. It discards recipient,
full-address, postcode, shipper and proof-of-delivery fields. Amazon does not
echo the requested tracking ID in this response, so the adapter validates the
request format and response structure but cannot perform an echoed identifier
check. Detailed history is normally retained for only 45 days.

## Swiss carrier handling and privacy

Swiss Post Cargo uses the anonymous endpoint called by its official public
tracker. The adapter validates the response shape and retains only normalized
tracking history. GLS Switzerland first resolves the public parcel overview,
then uses the recipient's four-digit postcode to request its detailed history.
The GLS adapter keeps coarse scan city and country fields but drops street,
postcode, recipient and contact data returned alongside them. Treat the GLS
postcode as part of the tracking credential.

## AliExpress handoff to Swiss Post

Valid tracked letter-post S10 identifiers in the `L…CH` range are checked
against Swiss Post before every sync. Until Swiss Post announces the shipment,
Cainiao supplies the international tracking history. As soon as Swiss Post has
a usable record, the switch becomes sticky and later refreshes use Swiss Post
as the primary source. The parcel detail keeps links to both carriers and marks
Swiss Post as not ready during the international leg.

## A note about carrier integrations

Several carriers do not offer a supported public tracking API. Their websites
and undocumented endpoints can change without notice, so tracking is best
effort and failures remain visible for later retry. Provider-specific adapters
are isolated under `src/server/`, validate inputs, bound response sizes, and use
timeouts so one carrier cannot block the rest of a scheduled run.

### Opt-in live carrier tests

The regular test suite uses deterministic fixtures and does not depend on
carrier availability. To probe the current anonymous provider endpoints, run:

```bash
npm run test:carriers:live
```

The opt-in suite sends validly shaped, deliberately wrong shipment numbers
through every automatic adapter family. That includes Swiss Post, Swiss Post
Cargo, Planzer and Quickpac, Cainiao, SunYou, Hermes, PostNL,
PostLogistics, Dachser, UPS, Amazon Shipping France, GLS Switzerland, DPD Switzerland, DPD France,
Mondial Relay, Relais Colis, La Poste and Chronopost, GLS France, Colis Privé,
GEODIS, Colisweb, C Chez Vous, Heppner, Ciblex and Paack. It also checks
the still-resolving shipment number published by Swiss Post Cargo as its own
example and Hermes's public delivered sample. Retired official examples from
C Chez Vous, GLS Switzerland and Paack exercise the providers' current clean
not-found paths. Customer-posted tracking credentials are deliberately excluded
from committed fixtures, even when they remain publicly searchable. Amazon's
live suite always tests the official wrong-number response; set
`AMAZON_LOGISTICS_LIVE_TRACKING_NUMBER` to additionally exercise a real shipment
without committing that tracking credential.

Several canaries intentionally have different expectations. Colisweb's wrong-number
test asserts the observed empty upstream HTTP 500 is reported as an
indeterminate `502`, not mislabeled as a `404`. Ciblex normally returns an echoed
empty table (a clean `404`), but its transient bare-empty `200` remains an
indeterminate upstream error. DPD's canary likewise accepts its explicitly
recognized Cloudflare fallback when the guest API is temporarily unavailable.
The Dachser endpoint alternates between an explicit null-result error and a
generic HTTP 500 for the same invalid capability tuple; its canary requires a
recognized rejection but deliberately keeps the generic response indeterminate.
UPS, DPD France and Mondial Relay likewise accept only their exact recognized
browser-challenge errors when direct anonymous access is blocked. La Poste's
edge may reject an anonymous lookup with a provider-scoped HTTP 403 before it
can return the normal not-found response. Asendia remains link-only; its canary
verifies that a rejected Cloudflare Turnstile token is recognized as a
challenge, not that an anonymous tracking lookup succeeds. These tests contact
external services and are therefore excluded from the default test command.

## Planzer shared links

Shared Planzer shipments use a capability URL containing an `accessKey`. Paste
the complete `trackandtrace.planzergroup.com/shared/sendungen/...` URL. Treat it
like a tracking secret: keep it out of logs, screenshots and public issues.

Quickpac's 18-digit `44…` identifiers now use the same Planzer API and public
tracking page as ordinary Planzer deliveries. The separate Quickpac carrier ID
is retained for number detection and display only; it no longer selects the
legacy Quickpac adapter.

## Dachser Customer Iberia links

Dachser shipments require the complete
`customeriberia.dachser.com/customerarea/.../detalle?...` URL. Its query
parameters grant access to the shipment, so treat the URL like a password. The
adapter checks the exact Dachser host, path, shipment number and access fields,
then retains only normalized shipment status and event data. Sender, recipient,
address, contact and proof-of-delivery fields from Dachser are discarded.

## DPD postcode

When adding a DPD parcel, enter its recipient postcode. The app stores those
four digits with that parcel, uses them only for DPD verification, and prefills
the postcode from your most recently added DPD parcel next time.

## UPS browser fallback

UPS first uses a bounded direct HTTP flow and keeps its cookie jar in memory.
When Akamai challenges that request, the service can use a private
[`TRAWL`](https://github.com/germondai/trawl) endpoint to establish a browser
session, then return to ordinary HTTP for structured tracking updates:

```dotenv
FLARESOLVERR_URL=http://trawl:8191
```

Do not expose TRAWL publicly. It controls a real browser and is only a best-effort
fallback when a carrier requires interactive proof.

### Public links shown in the UI

Run the rendered-page checks separately from scraper data retrieval:

```bash
npx playwright install chromium
npm run test:tracking-links
# Or use an existing browser binary:
TRACKING_CHROMIUM_PATH=/path/to/chromium npm run test:tracking-links
```

The existing daily carrier-canary workflow also runs these checks. They call
`parcelTrackingLinks`, including the ParcelsApp fallback, with synthetic numbers.
They check HTTP errors, final tracking routes, rendered tracking content, and
whether the number is prefilled, displayed, or submitted to a lookup API. DPD's
observed guest unknown-number response is recognized separately. La Poste can
remove its query string after transferring the number into its search field.

A 404/410 is a broken page, but a 200 can also be a soft 404, empty application,
or homepage redirect. Conversely, “shipment not found” inside a working tracker
is expected for a synthetic or expired number. Bot challenges and browser
transport failures are **unverified skips**, never successful verification.
Transport failures can skip only when a separate HTTP GET reaches the expected
route without evidence of a broken page. `TRACKING_LINKS_STRICT=1` makes those
unverified cases fail as well. DNS failures, missing pages, unexpected redirects,
missing rendered content, and lost tracking inputs remain failures by default.

The September 10 audit checked all 11 stored carriers, plus GLS, Cainiao and
ParcelsApp links used for earlier legs or fallback. Seven routes passed headless
checks; seven were unverified because of bot protection or browser transport.
Interactive checks confirmed the remaining tracking pages: La Poste, DPD,
17TRACK, Mondial Relay, UPS, DHL eCommerce and GLS. DPD's synthetic number returns
a guest “not assigned” result. No broken page URL was found in this sample;
this does not establish successful tracking-data retrieval for every parcel.

### Audited history regression fixture

`src/server/fixtures/auditedTrackingHistory.json` contains 129 reviewed,
distinct provider-description-code cases from the September 10 history audit.
It contains no package/user IDs, tracking numbers, actual timestamps, or
shipment locations. The test reconstructs minimal provider envelopes with
synthetic values; these are not full captured responses. Expectations are
reviewed delivery stages, including corrections, rather than copied stored
classifications. Provider event provenance is retained across carrier changes.

`intuitiveHistoryTranslations.ts` adds English, French, German and Italian
equivalents: each of the 129 audited cases is replayed in the other three
languages (387 generated cases). French and German originals are also translated
back into English. Each row explicitly marks its generated provenance and links
to the observed source wording. The original fixture remains unchanged. Provider
codes and categories are retained; translations replace only the description.

These translations are intuitive expectations, not evidence that a carrier uses
that wording. Comments identify exceptions such as Planzer's observed “Shipped”
meaning delivered. Verified carrier semantics and structured stages take priority
over the inferred language fallback. When real wording contradicts a generated
case, retain the observed evidence, revise the generated row/rule and document why.
`trackingLanguage.test.ts` also labels generated boundary cases for negation,
future delivery, handoffs, privacy and carrier-specific precedence. Run `npm test`
to check all these regressions; no live tracking request or personal data is needed.

The audit fixed DHL delivery-vehicle/collection wording, DHL eCommerce bag/sack
handling, La Poste's failed delivery wording, and French/untranslated universal
fallback events, including clearance completion and future international handoff.
Unknown wording remains unknown in the universal parser. The guarded migration
`20260912180000_repair_audited_tracking_stages.sql` repairs matching stored
events with raw-description and source checks. It preserves raw evidence,
timestamps, event IDs and notification receipts, and updates the package summary
only if its latest meaningful event changes.
