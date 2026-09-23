# FedEx

## Identity and scope

`fedex` — Federal Express, a global integrator. The dedicated adapter reads
the public page's tracking reply; no postcode or capability URL is needed.

**Current limitation:** a fresh or previously accepted browser can still receive HTTP 403 from the
tracking API. The browser service now retains a verified page/context for
later lookups, with bounded expiry and immediate disposal on rejection.
This improves session reuse without guaranteeing cold startup; the app's
existing universal-provider recovery remains available.

## Portals

- Public tracker: `https://www.fedex.com/fedextrack/?trknbr={trackingNumber}`
  (the page redirects to its `/wtrk/track/` application and posts the number
  to `https://api.fedex.com/track/v2/shipments`, which is what the adapter
  reads once a browser holds a session).
- Canary: `https://www.fedex.com/fedextrack/`, the portal front door, so the
  canary is not itself subject to the tracking edge.
- The portal shows status, history with locations, the delivery estimate, the
  shipper, the recipient address, the signatory and service options.

## What we retrieve

| Field | Source |
|---|---|
| `status`, `current_stage` | `keyStatusCD` first, then the `keyStatus`/`statusWithDetails` prose |
| `last_status_text` | `keyStatus`, replaced by "Delivered" once delivered |
| `last_update` | newest scan's `date`/`time`/`gmtOffset`, as an offset-carrying ISO string |
| `expected_delivery` | `estDeliveryDt`, as a calendar day, dropped once delivered |
| `delivered_at` | `actDeliveryDt`, once delivered |
| `events[].time`, `.location`, `.description`, `.stage` | `scanEventList` items: `date`/`time`/`gmtOffset`, `scanLocation`, `status` plus `scanDetails`, `statusCD` |

Declared capabilities: `history`, `location`, `eta`, `delivered_at`. The
recipient and shipper blocks, the signatory, the service description, the
weight and the dimensions present in the payload are never read into a
result; the offline test asserts it.

## Tracking numbers

- `^\d{12}$`, low confidence — the printed 12-digit number. Shared with
  several carriers, so it stays a suggestion and never selects FedEx alone.
- `^\d{15}$`, low confidence — the 15-digit variant, shared with DPD France.

The adapter re-checks this shape itself and refuses anything else before any
request. Longer label barcodes from open-source examples are not user-typed
numbers and are refused the same way.

## How the adapter works

One step, `trawl`: the private browser service receives the tracking page URL with
`captureResponses: [https://api.fedex.com/track/v2/shipments]`, and the reply
the page itself received is parsed newest-first. For this exact lookup the
service opens the blank tracker and uses its normal form. It keeps the page
and browser context only after a matching tracking response with status or
scans. Each lookup reopens the blank form in that context, because the
result-page form can ignore submissions or retain the previous route.
The service matches the outgoing request number as well as the response;
retaining a session never means reusing an old parcel response.

The context remains on its original pooled browser and is preferred for later
FedEx lookups. It closes after 30 minutes idle, two hours total, any failed
tracking validation, or a browser restart. Session state stays in private
browser memory; copying cookies to a new context did not preserve acceptance.
See the [browser-service lifecycle](../../../../ops/trawl/README.md#retained-fedex-browser-session).
The browser's session is never replayed over plain HTTP.

There is no plain HTTP step. Direct POST probes and fresh automated browser
sessions received HTTP 403 on 2026-09-22, while the anonymous OAuth endpoint
answered 200. Successful token acquisition does not establish access to the
tracking API. The earlier 2026-09-20 checks also found the legacy
`trackingCal/track` endpoint blocked.

The rendered page is read only to tell a challenge from an inconclusive
load. It renders its "can't find that tracking number" notice both for
unknown numbers and for tracking calls the edge refused, so rendered text
never decides not-found: only the structured reply does, and a load with no
readable reply fails as a transport problem. A recipient-gated shipment
(`TRACKING.AUTHORIZATION.ERROR`) fails as input-required rather than
retrying a verification the parcel does not carry.

Errors: `ChallengeError` when no browser service is configured, the page
carries a challenge, or the captured tracking API returns 401/403.
`RateLimitedError` preserves a captured 429 and its Retry-After delay;
upstream 5xx responses keep their HTTP classification. A bare API 404 remains
a transport failure, not proof that the shipment is unknown. Missing captures
remain `TransportError`; unreadable JSON and identity mismatches remain
`SchemaError`; recipient gates remain `InputRequiredError`.

A newer API rejection takes precedence over an older successful capture.
A later successful response can recover from an earlier rejection. Parser
failures are no longer hidden behind a generic missing-response error.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| registered | `OC`; Shipment information sent to FedEx | bundle, prior-art |
| accepted | `PU`; Picked up, Tendered at FedEx location | bundle, prior-art |
| in_transit | `AR`, `DP`, `IT`; Departed FedEx location, On the way | bundle, prior-art |
| customs | Clearance delay, Clearance in progress | prior-art |
| out_for_delivery | `OD`; On FedEx vehicle for delivery | bundle, prior-art |
| delivered | `DL`; Delivered | bundle, prior-art |
| failed_attempt | `DE`; Delivery exception, Customer not available | bundle, prior-art |
| exception | `DY`, `SE`, `CA`; Shipment exception, Unable to deliver | bundle, prior-art |
| returned | Returning to shipper | prior-art |
| ready_for_pickup | not observed; reported as unmapped | — |

The map produces the result-level status and, when the code or wording is
known, the `current_stage`. `failed_attempt` and `returned` both surface as
the result status `exception`. A `delivered` code is terminal and outranks
the wording; a delivered scan's description is replaced by "Delivered"
because the original line names the signatory.

`statuses.json` holds the full list.

## Limitations and privacy

- No sender name, weight or dimensions: the endpoint returns them, but they
  are deliberately dropped (see "What we retrieve").
- Scans without a usable `date`/`time`/`gmtOffset` triple keep no time
  rather than being stamped with a guessed zone.
- A gated shipment needs recipient verification the adapter cannot supply;
  it fails fast instead of polling.
- Duplicate numbers (the same digits under several qualifiers) are refused
  rather than resolved to the newest: the qualifier is opaque and picking
  would risk another recipient's parcel.

## Implementation decisions

- Read the page's own `/track/v2/shipments` reply rather than the rendered
  DOM: it returns the whole scan history with per-scan offsets, where the
  page carries only the current view.
- One step, like Mondial Relay: with the direct path proven refused, a
  direct tier would only burn the budget and report a fallback on each sync.
- Keep the capture newest-first with at most 20 replies, like UPS: a later
  reply is the page's final answer.
- Bind strictly to `trackingNbr`: an unmatched single package and a
  multi-match are both schema failures, never another parcel's history.
- 2026-09-20: the not-found envelope is unobserved (every probe parcel was
  either invalid-shaped or edge-refused), so an empty `packages` array reads
  as the unlocated unknown result UPS returns, not as a positive not-found.
  Revisit once a live capture shows the real envelope.

## Rejected alternatives

- Calling the tracking API over plain HTTP, with or without the page's
  cookies, headers and OAuth token: the edge answers 403 either way. The
  token endpoint is open; the data endpoint is bot-gated.
- The legacy same-origin `trackingCal/track` call: 403 from non-browser
  clients, and its `api.ecom.fedex.com` route answers 404.
- The official developer API (`apis.fedex.com`): sanctioned and stable, but
  it needs per-deployment developer credentials, so it cannot serve the
  anonymous lookup this adapter provides. Reconsider if the browser path
  proves unreliable in production.
- Parsing the rendered page as the primary path: the notice text cannot
  distinguish an unknown number from a refused API call.
- Opening the blank tracker and submitting its normal form: one standalone
  server-browser attempt returned all 14 events, but repeated standalone and
  integrated fresh/cached checks returned 403. This did not establish a
  reliable replacement on 2026-09-22. The later retained-context path adds
  session reuse; it still does not guarantee that every fresh session works.

## Verification log

- 2026-09-20: inspected the public tracking bundle (OAuth token flow, the
  `/track/v2/shipments` request shape, the package model with
  `domainScanEventList`/`scanEventList` and its `HA` scan fields, the `DE`
  and `DY` status flags); verified the 403 boundary for direct POSTs, the
  legacy endpoint and two automated browser stacks, one on a residential IP.
- 2026-09-20: adapter added with offline tests and an env-gated live test.
- 2026-09-22: a captured HTTP 403 from the tracking API was incorrectly
  reported as a missing response because the page shell itself loaded with
  HTTP 200. Fixed the adapter's error handling and added regression tests
  for rejection ordering, throttling, recipient verification and identity.
- 2026-09-22: interactive Chrome confirmed 14 scans with the parser's existing
  fields and explicit offsets. Server browser checks remained unreliable,
  including the form experiment above; this is not a verified restoration
  of unattended tracking. Supply `FEDEX_LIVE_TRACKING_NUMBER` outside the
  repository when checking recovery.
- 2026-09-22: compared the same isolated server-browser form flow on two
  egress paths, the server's normal public IP and a temporary tunnel through
  the local Mac's public IP. Each path returned one correct 200 reply with 14 scans
  and one HTTP 403. Three further fresh sessions on the server IP returned
  403. A 403 reply was Akamai's HTML `Access Denied` page (`AkamaiGHost`),
  while a 200 reply was JSON from `API-GATEWAY`. The rejected requests had
  the tracking call's normal authorization/header set and Akamai cookies;
  cookie presence alone did not establish acceptance. This rules out a fixed
  ban of either IP and locates the rejection at the edge, before the tracking
  API. IP reputation may still influence Akamai's decision; the small,
  mixed-outcome sample cannot quantify that effect or identify the exact
  browser/session signal. No proxy or form-flow change was deployed.
- 2026-09-22: tested delayed retries separately from fresh-session success.
  One isolated form session returned all 14 scans on its initial lookup and
  on repeats after 10- and 30-second pauses; a fresh context then returned
  403. In a separate two-session check, both sessions initially received
  403. One remained rejected on its shorter retry; the other recovered about
  74 seconds after its first reply. The deployed `/scrape` path behaved
  differently: both the initial lookup and a retry after 15 seconds returned
  403, as did a second pair with 60 seconds of backoff. These replies had no
  `Retry-After` or explicit rate-limit headers. Rate-based denial remains
  possible, but neither a rate threshold nor dependable retry recovery was
  established. A blind retry would add latency without a demonstrated gain
  on the deployed path, so the existing universal fallback and scheduled
  direct cooldown remain in use.
- 2026-09-23: implemented retention of verified FedEx contexts in the browser
  service, including preference for their original pooled browser, expiry,
  failure disposal and request/response identity checks. Copying cookies into
  a new context returned 403 in the live comparison; keeping the original
  context returned all 14 scans again. Reopening the blank form for every
  lookup avoids the result-page form ignoring a submission. An isolated
  full-service run returned 403, then 14 scans on a fresh session, then the
  same 14 scans on its warm refresh (15.4 s cold, 9.8 s warm). A subsequent
  control-number lookup returned 403 and discarded that session. Reuse is
  useful but can still lose acceptance; it does not establish a rate limit
  or make blind retries reliable.
- 2026-09-23: deployed the retained-context build and verified that the running
  helper matches repository source. Production `/scrape` returned all 14 scans
  on the initial request (15.0 s) and its warm refresh (12.2 s), with a fresh
  matching API request each time. The subsequent control-number request
  returned 403 (8.9 s), which the service preserved and used to discard the
  session. Two subsequent live calls through `FedExTracker` also received
  403 (17.8 s and 9.7 s), correctly classified as `ChallengeError` and
  preserving fallback eligibility. No tracking state is exported to Redis
  by this path.
