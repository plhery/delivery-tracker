# Ship24

## Identity and scope

Ship24 (ship24.com) is a universal tracking aggregator, not a carrier: it has no
last mile of its own and cannot be selected for a parcel. It is the first
provider of the discovery chain (`providers/README.md`), used when no dedicated
carrier adapter can answer for a number. The provider name persisted in routing
state is `Ship24`.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Public tracking page | `https://www.ship24.com/tracking?p={number}` | status, full aggregated history, the couriers it recognized, its own delivery estimate |

The page is also the link the app shows for a parcel whose history came from
Ship24.

## What we retrieve

From the page's own parcel API (`/api/parcels/{number}?lang=en`):

| Field | Source |
| --- | --- |
| `events[].time` / `events[].local_time` | `events[].timestamp`, kept as a UTC instant when it carries an offset and as wall time when it does not |
| `events[].description`, `events[].stage` | `events[].status`, plus `dispatch_code_id` 7 as a declared delivery |
| `status`, `current_stage`, `last_status_text`, `last_update` | derived from the projected events |
| `reported_carriers`, `discovered_carrier` | `couriers[].translation.name`, mapped to a catalog id only when one unambiguous name is reported |

Nothing else from the payload is kept: no courier phone or website, no
recipient, no alternate numbers, no estimate (the aggregator's estimate is not
the carrier's).

## Tracking numbers

Any number the chain is given: uppercased with spaces, dots and dashes removed,
it must match `^(?=.*\d)[A-Z0-9]{4,40}$`. There is no format rule and no
checksum on this side — a result is accepted only when the payload echoes the
requested number back.

## How the adapter works

Two tiers, run by `runSteps` with one budget for both (45 s standalone, 30 s
inside the chain):

1. `direct` — one signed anonymous JSON POST to `/api/parcels/{number}?lang=en`,
   limited to 8 s of the budget. The signature is rebuilt from the public
   frontend's checksum configuration (see `http.ts`); no account, cookie,
   browser fingerprint or issued token is used. Results are labelled
   `tracking_source: structured-web-response`.
2. `browser` — the public tracking page in a fresh local Chromium session
   (`TRACKING_CHROMIUM_PATH`), reading the same API response from the page.
   Results are labelled `tracking_source: browser-session-response`.

The browser tier runs only when the direct tier failed for a reason a browser
can repair. HTTP 429 and 5xx are reported as they are, with their `Retry-After`,
so the router backs off instead of asking twice. The adapter is created by the
chain with an HTTP client; constructed without one, it runs the browser tier
alone.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
| --- | --- | --- |
| delivered | `dispatch_code_id: 7`; `Delivered`, `Delivery completed` | live 2026-09-10 |
| out_for_delivery | `Out for delivery` | live 2026-09-10 |
| ready_for_pickup | `Ready for pickup`, `Available for collection` | prior-art |
| in_transit | `Delivered to local carrier`, `In transit`, `Arrived`, `Departed`, `Processed` | live 2026-09-11 |
| accepted | `Picked up`, `Collected`, `Handed over` | live 2026-09-10 |
| registered | `Electronic information submitted by shipper`, `Label created`, `Shipment announced` | live 2026-09-10 |
| customs | `Customs`, `Clearance` (except a completed clearance, which is transit) | prior-art |
| failed_attempt | `Not delivered`, `Delivery attempt`, `Unable to deliver` | prior-art |
| returned | `Returned to sender` | prior-art |
| pending | anything else | — |

Wording that matches no rule keeps `stage: pending` and is recorded by the sync
for review; it never inherits the shipment's current stage. The vocabulary is
shared by the four universal providers and lives in `../shared/result.ts`.

## Limitations and privacy

- An aggregator reports what the underlying carriers give it; a dedicated
  carrier adapter is always preferred when one exists.
- Courier names are hints. Routing may try the named adapter, but only that
  adapter confirming the shipment adopts the carrier.
- Delivery wording can contain an access code, a door number or a signature.
  Any event whose stage is not `delivered` and that carries such details is
  dropped, and a delivered event's description is replaced by `Delivered`.
- Only one local browser session runs per server process; an overlapping lookup
  fails promptly and retries on the next sync.

## Implementation decisions

- **One signed POST first, browser second (2026-09-10).** The official frontend
  builds `x-ship24-token` from a timestamp, an opaque SHA-256 digest, a
  MurmurHash3 checksum bound to the tracking number and an HMAC over the three.
  Its HMAC input constant and checksum salt are public frontend configuration,
  not account credentials. The adapter reproduces that small algorithm itself
  and cites the script it was read from; it never executes downloaded scripts
  and never stores captured tokens.
- **No bootstrap request (2026-09-10).** Fetching the public configuration at
  runtime worked on the host but failed inside Docker: explicit probes returned
  403 over IPv4 and 200 over IPv6 for the page, and both the page and the asset
  CDN were blocked by CloudFront inside the container. Referencing the reviewed
  public constants directly removed those calls, and the adapter then succeeded
  from Docker over its normal connection with one POST per lookup.
- **Eight seconds for the direct tier.** If the public signing scheme changes,
  the fast path fails quickly and the browser can still use the rest of the
  lookup budget.
- **429 and 5xx are never retried in a browser.** A rate limit or an outage is
  reported with its `Retry-After` so the router's backoff applies once.
- **Offset-less legs are kept (2026-09-11).** `datetime` can end in `Z` while
  holding the carrier's local time; `timestamp` carries the real offset, except
  for some legs (Chronopost, observed 2026-09-11) that omit it entirely. Those
  scans are kept as `local_time` rather than losing the shipment or inventing a
  UTC instant.
- **The HTTP client is injected (2026-09-12).** The chain and the adapter
  factory build it from the environment's fetcher. A tracker constructed without
  one exercises the browser tier alone, which is what the browser tests want.

## Rejected alternatives

- **Browser-only lookups** (the path before 2026-09-10): approximately 2–3 s per
  lookup against 121–409 ms for the signed POST.
- **A merchant API key.** Ship24 sells an API; this adapter deliberately stays
  on the public anonymous path the website itself uses.
- **Running the site's own script to obtain the token.** Reproducing the small
  published algorithm keeps the adapter auditable and avoids executing remote
  code.
- **Adding a proxy, IP rotation or a container network change.** None were
  needed and none were added.


## Carrier compatibility

Probed 2026-09-12 through the `direct` signed POST with one real
`public_shipment_report` corpus number per carrier (81 numbers across 36
carriers; every public shipment/full-barcode record was tried, not just the
representative below). ✅ means the payload echoed the requested number and
carried events from the expected carrier; ❌ means no usable history for the
tested numbers (HTTP 404 or 201 without history). A 404 on an old corpus
number usually means the shipment expired from the aggregator, not proof the
carrier is unsupported — but only the ✅ rows prove compatibility.

| Carrier | Tested corpus number | Result 2026-09-12 |
| --- | --- | --- |
| `aliexpress` | `CNG00798678939847` | ✅ 25 events, Cainiao |
| `amazon-logistics` | `TBA333656997000` | ❌ 404; account-only by design, aggregators need the same login |
| `an-post` | `CP476340265IE` | ✅ 13 events, An Post |
| `blue-dart` | `90617363115` | ❌ 404 |
| `bpost` | `323211216300000593107030` (+2 more, all 404) | ❌ no history |
| `brt` | `08454077486990` (+1 more, both 404) | ❌ no history |
| `ciblex` | `560815852502035603344150` (+1 more, both 404) | ❌ no history |
| `colis-prive` | `HS0000329755` | ❌ 404 |
| `correos-express` | `7983000739053141` (404; `3230002125829719` 201 without history) | ❌ no history |
| `correos-spain` | `PR110604670130400C` | ❌ 404 (2015 number, likely expired) |
| `ctt-express` | `0082800082809771393048` | ✅ 14 events, CTT Express (`…1598159` ✅ 11 events; `…8638008391` 201 without history) |
| `ctt` | `RL402552798PT` | ❌ 201 without history (ParcelsApp has this shipment) |
| `delhivery` | `32076610152736` | ❌ 404 |
| `dhl` | `CG738165082DE` | ✅ 11 events, DHL (`00340434633751428115` 404) |
| `dpd` | `06086216767970` | ❌ 404 |
| `ecoscooting` | `380030000066362966` (+4 more, all 404) | ❌ no history |
| `geodis` | `1GWSKFLSKX4Y` | ❌ 404 |
| `gls-de` | `10272483975` | ❌ no GLS history: 12 events but CDEK Russia (corpus attribution unverified); `Z6E5E29R` 404 |
| `gls-fr` | `20189360332` (+2 more, all 404) | ❌ no history (ParcelsApp has `20189360332`) |
| `hermes-de` | `02180171003654` (+2 more, all 404) | ❌ no history |
| `j-and-t` | `888058657515` | ⏳ lookup timed out twice at 8–10 s; indeterminate, not proven incompatible |
| `la-poste` | `8G45061126689` (+1 more, both 404) | ❌ no history (2013/2014 numbers, likely expired) |
| `mondial-relay` | `73800244620101503002000732` | ❌ 404 (`4744000791` returns 5 events but DPD UK, wrong carrier; `87778793`, `98911884` 404) |
| `mrw` | `02680I390427` (+4 more, all 404) | ❌ no history |
| `nacex` | `2850/11247170` (+1 more, both 404) | ❌ no history |
| `paack` | `00100909086360120251130131718` (+4 more, all 404) | ❌ no history |
| `packeta` | `Z8328162946` (+2 more, all 404) | ❌ no history |
| `poste-italiane` | `CH166307960NL` (7× 404; `2IMA0051035900` 201 without history) | ❌ no history |
| `relais-colis` | `3380000318` | ❌ 404 |
| `seur` | `01475194188635` | ❌ no SEUR history: 9 events but DPD Germany (corpus attribution unverified); `046999610972820260807` 404 |
| `speedx` | `SPXMIA056745759994` (+3 more, all 404) | ❌ no history |
| `spring-gds` | `CK089862199NL` | ✅ 18 events, PostNL (`LA681049820NL` ✅ 16 events) |
| `sunyou` | `SYAE006809461` | ❌ 201 without history (ParcelsApp has this shipment) |
| `tipsa` | `8104405448` | ❌ 404 |
| `uniuni` | `4C003925742US` (404; `UUS5B60564241706199` 201 without history) | ❌ no history (ParcelsApp has `4C003925742US`) |
| `yunexpress` | `YT2621200705470145` | ✅ 33 events, Yun Express + GOFO |

Compatible here: 6 carriers (`aliexpress`, `an-post`, `ctt-express`, `dhl`,
`spring-gds`, `yunexpress`). Every carrier row above is also recorded in that
carrier's own README; see `docs/CARRIERS.md` for the dated public-sample
checks this table extends.


## Verification log

- 2026-09-10: GET on the parcel API answers 404 and an unsigned POST answers
  403; a freshly signed POST answers HTTP 201 with the matching shipment. Two
  public examples returned 32 and 6 normalized events in 409 ms and 121 ms from
  the production container, with one POST each.
- 2026-09-11: a shipment mixing La Poste and Chronopost legs showed that some
  legs omit the offset in `timestamp`; those scans are kept as local wall time
  instead of dropping the shipment.
- 2026-09-12: moved into `packages/carriers/providers/ship24` unchanged; the
  step ids (`direct`, `browser`) and the provider name are preserved.
- 2026-09-12: compatibility sweep over 81 real corpus numbers (36 carriers)
  through the direct signed POST: 6 carriers with correct-carrier history
  (see Carrier compatibility above); `gls-de`, `mondial-relay` and `seur`
  corpus numbers returned other carriers' history and prove nothing for those
  carriers; `j-and-t` timed out twice and stays indeterminate.
