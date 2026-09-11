# Carrier support

Delivery Tracker recognizes 104 carriers: 42 with dedicated direct or upstream
adapters plus 62 universal-fallback carriers. Tracking availability is shown below:

| Carrier | Notes |
| --- | --- |
| Swiss Post | Automatic tracking through the pinned upstream adapter. A contracted business API is preferable for long-term production use. |
| Hermes Germany | Automatic parcel tracking through the anonymous myHermes recipient API. Separate from Hermes Einrichtungs-Service. |
| GLS Germany | Automatic through the GLS Group recipient service. Accepts four-digit Swiss and five-digit German delivery postcodes. Ambiguous 11/12-digit numbers are verified with GLS during entry. |
| Delivengo | Automatic through La Poste. Choose it manually: its postal number ranges overlap other La Poste services. |
| DHL / Deutsche Post | Automatic German parcel and tracked-mail updates through DHL's public tracking session, with the existing private TRAWL browser as a challenge fallback. Recognises S10 `C…DE`/`L…DE`, `JJD`/`JVGL`/`JD` codes and `00340434`-prefixed 20-digit numbers; other bare 20-digit numbers stay out of DHL routing. |
| DHL eCommerce | Automatic international parcel tracking through DHL’s global recipient API, with browser-established sessions when challenged. Separate from DHL Paket / Deutsche Post. |
| Swiss Post Cargo | Automatic through the official anonymous public tracker. |
| Quickpac | Automatic through Planzer's current tracking API. Existing Quickpac numbers keep their carrier label. |
| Planzer | Automatic. 20-digit delivery IDs carry the `91346097` prefix; other bare 20-digit numbers stay out of Planzer routing. Shared `999.90.########` shipments need the complete shared tracking URL. |
| Cainiao / AliExpress | Automatic. |
| SunYou | Automatic. |
| Hermes Einrichtungs-Service | Automatic. |
| PostNL | Automatic. Recognises valid Dutch postal S10 numbers ending in `NL`, PostNL links, and Spring mailingtechnology.com links. |
| PostLogistics | Automatic. |
| Dachser | Automatic for Customer Iberia shipments when the complete public detail URL is supplied. |
| DPD Switzerland | Automatic through the myDPD guest flow. The parcel's delivery postcode unlocks verified scans and delivery windows. |
| GLS Switzerland | Automatic through GLS's public tracking services. The four-digit recipient postcode unlocks the detailed event history. |
| UPS | Automatic. Direct HTTP is tried first; a private TRAWL instance can handle browser challenges. |
| Amazon Logistics / Shipping | European country prefix + ten digits, or `TBA` + twelve digits. Account-only by default; public Shipping verification unlocks addition. |
| DPD France | Automatic through the recipient trace page. Direct HTTP is tried first; a private TRAWL instance is required when Cloudflare challenges it. |
| Mondial Relay | Automatic through the recipient web flow. Short shipment numbers require the five-digit recipient postcode. Validated 26-digit label barcodes work without it. Can use private TRAWL for Cloudflare. |
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
| Packeta | Automatic through the keyless consumer tracking endpoint (`Z` + 10 digits, no postcode). Naive event times are Europe/Prague wall time; sender and pickup-point names are discarded. Expired numbers return the same clean not-found as unknown ones. |
| Asendia | Automatic through universal lookup. `ASE…` identifiers are recognized; postal partner numbers stay with their issuing post. |
| ShipUp | Automatic through universal lookup. Kept as a manual record when no direct route exists. |
| India Post | Automatic. Recognises checksum-valid `IN` S10 identifiers. |
| InPost | Automatic through the keyless inposteasy.com hub (24-digit, legacy `JJD`/`JD`, `8YDR`); `JJD` needs domain or explicit selection against DHL. Open cross-border vocabulary reports unknown rather than guessing; event times carry explicit offsets. |
| Pos Malaysia | Automatic through the consumer track-and-trace API (`MYPM` barcodes and `MY` S10, no postcode). Unknown codes answer with null history (clean not-found); sender, recipient and proof-of-delivery data are discarded. |
| FedEx | Automatic through universal lookup. 12/15-digit numbers stay ambiguous suggestions; full routing barcodes are not treated as shipment IDs. |
| Amazon Shipping | Automatic public-recipient verification for eligible Shipping parcels; retail `FR…` deliveries stay account-only under Amazon France. |

### Universal-fallback carriers (62, no dedicated scraper yet)

Added September 2026 from public shipment/label reports, official documentation
examples, OSS fixtures and merchant integration samples. They are selectable in
the manual picker, use the default carrier color, and track automatically
through the universal fallback (Ship24 → ParcelsApp → 17TRACK) with the same
privacy and verification rules as `unknown`. Distinctive number families are
detected with high confidence; purely numeric families stay low-confidence
suggestions so ambiguous numbers are never misassigned. Full routing barcodes,
order references, short pick-up codes and quarantined checksum-failing S10
shapes are not positive oracles. See `src/lib/carriers.test.ts` for the
per-number source URLs and evidence roles.

| Carrier | Detection |
| --- | --- |
| Royal Mail | Checksum-valid `GB` S10 outside Parcelforce `EA/EB/EC/ED/EE/CP` prefixes. |
| Parcelforce Worldwide | `EA/EB/EC/ED/EE/CP` + 9 digits + `GB` S10. |
| Evri | `H` + 15 alphanumerics (internal letters allowed; distinct from Hermes Germany `H` + digits). |
| An Post | Checksum-valid `IE` S10. |
| bpost | Checksum-valid `BE` S10 high; 18/24-digit numerics low. |
| Austrian Post | 22-digit numerics low (ambiguous with USPS/CTT Express). |
| PostNord | 11 digits + `SE` (not S10). |
| Posti | No exclusive detector yet; the sampled NL-handoff number routes to PostNL. |
| Correos Express | 16-digit numerics low. |
| SEUR | 14/21-digit IDs low; 7-digit references are not standalone tracking oracles. |
| MRW | 5 digits + letter + 6 digits high; 12-digit numerics low. |
| NACEX | `NNNN/NNNNNNNN` agency/shipment composite (slash preserved). |
| CTT Portugal | Checksum-valid `PT` S10. |
| CTT Express | `00` + 20 digits (22 total). |
| Poste Italiane | `RA` + 11 digits, `1UW/3UW/5P` 13-char families and `2IMA` + 10 digits high; NL handoffs stay with PostNL. |
| BRT | 14-digit low (shipment vs BRTcode roles preserved). |
| Ecoscooting | 18-digit low; foreign postal handoffs stay with their issuer. |
| TIPSA | 10-digit low. |
| Ukrposhta | No exclusive detector yet; the sampled SG-handoff routes to Singapore Post. |
| USPS | 20-digit numerics low (outside the Planzer/DHL prefixed ranges) and 22-digit numerics low (ambiguous with Austrian Post); `420…` 30/34-digit routing barcodes are not shipment IDs. |
| Canada Post | 16-digit numerics low. |
| Purolator | 3 letters (not `BYS`) + 9 digits high; 0–5-prefixed 12-digit numerics low. |
| Canpar | Prefix letter (`C/D/K/L/S/U/X/Z`) + 21 digits. |
| OnTrac | `C/D` + 14 digits, `L` + letter + 8 digits, `1LS` + 12–14 digits and `1LSCX` + 10 alphanumerics high. |
| SpeedX | `SPX` + 3 letters + 12 digits. |
| UniUni | `UUS` + 16 alphanumerics and `4C` + 9 digits + `US`. |
| Landmark Global | `LTN` + 8 digits + `N1`. |
| Old Dominion | `072/777/778/780` + 8 digits and `80` + 9 digits (11 total, freight PRO). |
| Spee-Dee | `SP` + 18 digits (keep the prefix; not a Planzer number). |
| GOFO Express | `GFUS` + 14 digits. |
| Estafeta | 10-digit low. |
| Correios Brazil | Checksum-valid `BR` S10; inbound `CN/HK` partner S10 routes to its issuer. |
| Correos de Chile | 13-digit numerics low. |
| YunExpress | `YT` + 16 digits. |
| 4PX | `4PX` + 13 digits + `CN`. |
| Blue Dart | 11-digit low. |
| Delhivery | 13/14-digit numerics low. |
| NZ Post | Checksum-valid `NZ` S10. |
| Singapore Post | Checksum-valid `SG` S10. |
| Japan Post | Checksum-valid `JP` S10. |
| SF Express | 12-digit and `SF` + 13 digits low. |
| STO Express | 12-digit low. |
| Yunda Express | 13-digit low. |
| YTO Express | `D` + 11 digits. |
| ZTO Express | 12-digit low. |
| JD Logistics | `VG` + 11 digits. |
| Yamato Transport | 12-digit low. |
| Korea Post | Checksum-valid `KR` S10. |
| Thailand Post | Checksum-valid `TH` S10. |
| DTDC | `N` + 8 digits. |
| Australia Post | No exclusive detector yet; tutorial fixtures stay with generic postal fallback. |
| Hongkong Post | Checksum-valid `HK` S10. |
| Ninja Van | No exclusive detector yet; shipper-dependent formats need a broader spec. |
| China Post | Checksum-valid `CN` S10. |
| Poczta Polska | `PX` + 10 digits high; 19-digit numerics low. |
| Bring | Checksum-valid `NO` S10. |
| Aramex | 11-digit low. |
| TNT | 9-digit low. |
| Correos | `PR` + 15 digits + `C`. |
| Yanwen | `BYS` + 9 digits. |
| The Courier Guy | No exclusive detector yet; 5-char short references are not tracking oracles. |
| J&T Express | 12-digit numerics low. |

Unknown carriers (`unknown` and `intl-post`) plus the 62 universal-fallback carriers above attempt automatic lookup through
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

17TRACK requires the pinned compatibility build in [`ops/trawl`](../ops/trawl/README.md).
TRAWL 1.3.1 ignores capture requests; stock 1.5.0 refuses compressed bodies and
can finish before polling completes. The compatibility build captures the
browser-decoded JSON and waits through code 100 for a final matching reply.
Live verification on September 10 returned seven events from a public example.
A provider code 400 with no history remains an explicit lookup failure, not an
invented delivery or an automatic carrier correction. ParcelsApp also supports
rendered history and remains the first discovery provider. Aggregators may need
additional information for ambiguous numbers; prefer a validated direct carrier.

Postal Ninja submits its official embedded tracking widget on `/en/tools` and
reads `/track/get`; simply
opening a URL containing the number does not perform the lookup. Ship24 makes one
anonymous JSON POST to `/api/parcels/{number}?lang=en`, using the public frontend's
checksum configuration. No browser, page bootstrap, cookies, or login is needed
on this path. The HTTP attempt has an eight-second budget; a failed signature,
transport, or unusable response can use Chromium within the remaining overall
budget. HTTP 429 and 5xx propagate directly for routing backoff. Neither scraper
uses a paid API key or a saved browser login. Docker installs Chromium and sets
`TRACKING_CHROMIUM_PATH=/usr/bin/chromium`; local runs need an explicit executable
path. Chromium receives no application secrets. Sessions and cookies are deleted
when each lookup finishes. Only one form scraper runs per server process at a
time; overlapping requests fail promptly for retry on the next scheduled sync.
The router gives each enabled provider one chance when previous providers fail,
with up to 30 seconds per lookup and a 105-second universal budget by default,
starting after direct attempts. It stops at the first success and honors cooldowns.
Production-container Ship24 checks on September 10 returned 32 and 6 normalized
events for two public examples in 409 and 121 ms, each with exactly one request.
The previous browser path took 2.6 and 2.3 seconds. The public signing scheme may
change; HTTP failures are reported before browser recovery. See the
[transport review](scraper-http-review.md) for sources, experiments, and limitations.

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

DHL eCommerce uses the public `www.dhl.com/utapi` recipient endpoint through a
fresh local Chromium session, which observes the site's own API request inside
that session. The endpoint answers every direct server request with an Akamai
crypto proof-of-work challenge (HTTP 428) that plain HTTP cannot solve, so no
direct attempt is made; browser clearance is never copied back to Node. The
direct path was dropped on September 10, 2026 after cookie replay and
page-visit-first session establishment were both verified to still return 428.
Rate limits and server errors go to routing without further browser work.
Browser work shares the existing concurrency limit.
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

DPD France, Mondial Relay, Relais Colis, La Poste / Colissimo, Chronopost, GLS
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
postcode as part of the tracking credential for short numbers. The 26-digit
label barcode is also supported: both modulo-11 check digits and the parcel
sequence are validated using the [official label specification](https://storage.mondialrelay.fr/etiquette-mondial-relay-v-24.pdf).
Its first 12 digits form a public alias that works without a postcode; API
responses must echo that alias or the embedded eight-digit shipment number.
Keep the full barcode as the parcel's stored identity, use the alias for official
links, and never interpret the routing suffix as a postcode. TRAWL's Redis-backed session cache
keeps the page token and API request on the same solved browser identity. Relais
Colis uses a normal bounded HTTP session: the adapter obtains the form's CSRF
token, submits the shipment number, verifies the echoed identifier and projects
only timeline fields.

These frontend endpoints are undocumented and can change without notice. The
adapters use bounded responses, timeouts, strict input and response-identity
checks, and privacy-safe projections; failures remain visible for retry. La
Poste's supported Okapi-key API is the preferred future production path when
deployment credentials are available.

Amazon Logistics and Amazon Shipping share tracking-number formats: a recognized
European country prefix followed by ten digits, or `TBA` followed by twelve digits.
The format initially resolves to `amazon-logistics`. The web and native add forms
immediately explain account-only tracking and disable addition while the server
checks the public Amazon Shipping endpoint. Only a structured SWA or MCF response
unlocks `amazon-shipping`; the create and carrier-change APIs independently verify
that choice. A timeout keeps addition blocked with a retry action. Expected
not-found results do not become Sentry failures.

The public portals use `track.amazon.fr`, `.it`, `.es`, `.co.uk`, and `.com` with
`/api/tracker/{number}`. Other European prefixes are checked through the French
portal and require the same positive evidence; there is no assumption that every
country or number is supported. Shipping sync calls the direct adapter without
universal fallbacks. Offset-free US event times are omitted because a `TBA` number
does not identify a timezone.

Amazon may recognize a Shipping/MCF parcel but return
`SHIPMENT_OLDER_THAN_SUPPORTED_AGE`. Its accompanying `IN_TRANSIT` summary is a
placeholder, not shipment movement. These parcels can be saved as references;
sync stores an explicit history-expired marker and the details explain the limit
in every locale. No scans or statuses are invented, and no repeated sync is due.

Existing account-only Logistics parcels link to the appropriate Amazon Your Orders
page and explain the limitation. Sync marks them unsupported without calling
direct or universal trackers, including previously misclassified Amazon numbers.

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
PostLogistics, Dachser, UPS, GLS Switzerland, DPD Switzerland, DPD France,
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
