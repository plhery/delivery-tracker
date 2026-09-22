# USPS

## Identity and scope

`usps` — the United States Postal Service. Tracked automatically through
the server-rendered tracking page; no postcode or capability URL is needed.

## Portals

- Public tracker: `https://tools.usps.com/go/TrackConfirmAction?tLabels={trackingNumber}`
  (redirects to the `/tracking/` application, which renders the verdict, the
  status and the history into its own HTML — there is no tracking XHR to
  capture).
- Canary: `https://www.usps.com/`, the portal front door, so the canary is
  not itself subject to the tracking edge.
- The portal shows status, history with city/state/ZIP locations, the
  delivery estimate, Informed Delivery upsells and delivery instructions.

## What we retrieve

| Field | Source |
|---|---|
| `status`, `current_stage` | status area and banner wording first, then the newest staged scan |
| `last_status_text` | `.current-tracking-status-wrapper` text, replaced by "Delivered" once delivered |
| `last_update` | newest scan's date, clock time and state, read in the facility state zone as UTC |
| `expected_delivery` | an "Expected Delivery …" line, as a calendar day, dropped once delivered |
| `events[].time`, `.location`, `.description`, `.stage` | history rows: US date, clock time, city/state location, longest remaining cell |

Declared capabilities: `history`, `location`, `eta`. A delivered line may
name who signed; the description is replaced by "Delivered" and nothing
else personal is retained — the page exposes no recipient block. The
offline test asserts the signatory placeholder never reaches a result.

## Tracking numbers

- `^\d{20}$`, low confidence — the printed 20-digit label.
- `^\d{22}$`, low confidence — the 22-digit variant, shared with Austrian Post.
- Checksum-valid UPU S10 labels (`^[A-Z]{2}\d{9}[A-Z]{2}$`), including
  incoming mail with foreign country suffixes.

The adapter validates these formats before any request, using the shared S10
checksum validator for postal labels. The suffix identifies the issuing country,
not the destination: incoming international mail can retain its original number
when USPS handles US delivery. The full number, including its original suffix,
is sent unchanged to USPS and must match the returned page.

Accepting a foreign number does not make every foreign postal item a USPS
shipment. Automatic carrier detection is unchanged; callers select USPS or
provide delivery-partner/destination evidence through the existing handoff route.
Longer label barcodes remain outside the accepted formats.

## How the adapter works

One step, `trawl`: the private browser service loads the tracking page and
lets its browser run the interstitial check. Only a resolved tracking page is parsed.
There is no direct step — the edge answers plain HTTP with 403 — and no
capture step, because the page carries its data as HTML. The browser's
session is never replayed over plain HTTP.

Identity is bound to the `#trackingNum` echo: a page without the tracking
shell reads as a challenge, a page echoing another number as a schema
failure, and the "Tracking Not Available" banner as the unlocated unknown
result.

History rows are read by content pattern (a US date, a clock time, a
city/state location, the longest remaining cell) rather than class names, so
a reskin that keeps the words keeps working. Scans whose state maps to no
zone keep the provider's own text rather than a guessed timestamp.

Errors: `ChallengeError` when no browser service is configured or the page
 carries no tracking shell, `SchemaError` when the reply is not about the
 requested parcel.

## Status reference

| Stage | Wording (raw) | Confirmed by |
|---|---|---|
| registered | Pre-Shipment, Shipping Label Created, USPS Awaiting Item | prior-art |
| accepted | Accepted, Picked Up | prior-art |
| in_transit | In Transit, Arrived, Departed, Processing | prior-art |
| customs | Customs, Clearance | prior-art |
| out_for_delivery | Out for Delivery | prior-art |
| ready_for_pickup | Available for Pickup, Arrived at Post Office | prior-art |
| delivered | Delivered | prior-art |
| failed_attempt | Notice Left, Delivery Attempted, No Access | prior-art |
| exception | Alert, Exception, Damaged | prior-art |
| returned | Return to Sender | prior-art |

`failed_attempt` and `returned` both surface as the result status
`exception`. `statuses.json` holds the full list.

## Limitations and privacy

- No recipient names, signatures or delivery photos: the public page shows
  city/state/ZIP locations only, and a delivered description is replaced by
  "Delivered".
- Facility times are wall-clock in the event's own state; multi-zone states
  resolve to their majority zone, and anything unresolvable keeps the
  provider's text instead of a fabricated UTC instant.
- History row markup is the documented assumption: rows are matched by
  content, but a success render from a live parcel has not been observed
  yet — confirm the selectors against one before trusting edge cases.
- Live access remains unreliable: a browser can receive HTTP 200 containing
  only a JavaScript challenge. That is a `ChallengeError`, not an empty shipment
  or successful tracking result; the host can continue through universal providers.

## Implementation decisions

- Read the rendered DOM instead of an API: the inspected page shell has no
  tracking XHR, and the browser can execute the interstitial that plain HTTP cannot.
- One step, like Mondial Relay and FedEx: with the direct path proven
  refused, a direct tier would only burn the budget on each sync.
- Bind strictly to `#trackingNum`: the shell echoes the queried label, so
  anything else is another parcel or a challenge, never a result.

## Rejected alternatives

- Calling the tracking page over plain HTTP, with or without cookies: the
  edge answers 403 before any content.
- The official developer API (`api.usps.com`): versioned and stable, but
  the tracking scope needs a vetted business account, so it cannot serve
  the anonymous lookup this adapter provides. Reconsider if the browser
  path proves unreliable in production.

## Verification log

- 2026-09-20: inspected the live page shell (challenge flow, verdict
  banner, status area, number echo) in headless Chrome on a residential
  connection; example labels render "Tracking Not Available" (expired).
- 2026-09-20: adapter added with offline tests and an env-gated live test.
  Live verification with a real shipment is still open (supply
  `USPS_LIVE_TRACKING_NUMBER` outside the repository).
- 2026-09-22: fixed the US-only suffix restriction. Synthetic regression tests
  cover foreign and US S10 labels, invalid check digits, an incoming parcel
  through the browser transport, and rejection of a different returned identifier.
  A fresh automated lookup with a public incoming reference passed input validation
  but returned a challenge shell. A separate fresh browser still had no tracking
  shell or history after a 40-second wait; local Chromium returned Access Denied.
  This verifies the input fix, not successful live USPS history retrieval.
