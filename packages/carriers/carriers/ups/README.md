# UPS

## Identity and scope

`ups` — United Parcel Service, a global integrator. Tracked automatically; no
postcode or capability URL is needed. Parcels UPS hands to a national post for
the last mile are still reported from the UPS record, because that is the only
record this adapter reads.

## Portals

- Public tracker: `https://www.ups.com/track?tracknum={trackingNumber}`
  (the adapter builds it with `loc=en_US` and `requester=ST/trackdetails`, the
  same query the site's own detail view uses).
- The page itself calls `https://webapis.ups.com/track/api/Track/GetStatus`,
  which is what the adapter reads once it holds a session. That call needs the
  page's cookies and the `X-XSRF-TOKEN-ST` value they carry.
- Canary: `https://www.ups.com/assets/resources/webcontent/en_US/terms_service.pdf`,
  a static asset, so the canary is not itself subject to the challenge.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status | yes | `progressBarType` first, then the status prose |
| history | yes | the `shipmentProgressActivities` scans, newest first |
| location | yes | the scan's `location`: city and country, never an address |
| eta | yes | `scheduledDeliveryDateDetail`, as a calendar day |
| provider_code | no | UPS activities carry no stable per-scan code |
| weight, dimensions | no | not in the response this endpoint returns |
| recipient, signature, delivery photo | no | present in the response, never retained |

Declared capabilities: `history`, `location`, `eta`. The offline test asserts
each of them against the fixture.

## Tracking numbers

- `^1Z[A-Z0-9]{16}$`, high confidence — the printed `1Z…` number. The adapter
  re-checks this shape itself and refuses anything else before any request.
- `^[KJV]\d{10}$`, low confidence — UPS also issues these, but so do others, so
  they stay a suggestion and never select UPS on their own.

`numbers.json` carries open-source examples plus one synthetic `1Z` number.

## How the adapter works

Two steps.

`direct` is plain HTTP with a cookie jar held in memory for the process:

1. A cached session, if one exists, calls `GetStatus` straight away. If UPS
   rejects it, the tracking page is fetched once to refresh the cookies and the
   call is retried; a second rejection drops the session.
2. Otherwise a fresh session fetches the tracking page, checks that it received
   an `X-XSRF-TOKEN-ST` cookie, calls `GetStatus`, and is then cached.

`trawl` runs when the direct step is challenged and a browser service is
configured. It loads the tracking page in a real browser, seeds a new HTTP
session with the browser's cookies and user agent, and calls `GetStatus` on
them. If that session is still refused, the page the browser rendered is parsed
instead — status and delivery location only, no history.

With no browser service configured, a challenged lookup still tries to parse
whatever direct page it managed to fetch, and otherwise fails with
`ChallengeError('UPS challenged direct tracking; configure FLARESOLVERR_URL for
browser fallback')`. Lookups are serialized per adapter instance so two of them
can never refresh the shared session at once.

Errors: `UPSSessionRejected` (a `ChallengeError`) for HTTP 401/403/419/429 and
for a page with no token, `IndeterminateError` for any other rejected status or
a non-200 API envelope, `SchemaError` when the reply is not about the requested
parcel, `TransportError` when the browser service cannot produce a usable page.

## Status reference

| Stage | Wording or code (raw) | Confirmed by |
|---|---|---|
| pending | `ManifestUpload`; Label Created, Manifest Upload, Shipment Ready for UPS | prior-art |
| accepted | `FirstUPSPossession`; First UPS Possession | prior-art |
| in_transit | `InTransit`; On the Way, In Transit, We Have Your Package, Departed, Arrived, Processing at UPS Facility | fixture, prior-art |
| out_for_delivery | `OutForDelivery`; Out For Delivery | fixture |
| delivered | `Delivered`; Delivered, Left at | fixture, prior-art |
| failed_attempt | `Exception`; Delivery Attempted, We Missed You, Not Delivered, Exception, Action Required | prior-art |
| returned | Return to Sender, Returned | prior-art |
| registered | not observed; reported as unmapped | — |
| ready_for_pickup | not observed; reported as unmapped | — |
| customs | not observed; reported as unmapped | — |

The map produces the result-level status only. UPS scans carry no stable code,
so the adapter attaches no stage to an event: the sync classifies each scan's
wording and records it for review. `failed_attempt` and `returned` both surface
as the result status `exception`; UPS's own `Exception` token does not say
which, so nothing here decides it.

## Limitations and privacy

- No delivery window, weight or dimensions: this endpoint returns none.
- Timestamps are assembled from the UTC pair UPS sends beside each scan, or
  from the local pair plus its explicit offset. A scan with neither keeps the
  provider's own text rather than being stamped with a guessed zone.
- The response carries the recipient name, the destination address and links to
  the signature and the delivery photo. None of them is retained; the offline
  test feeds a fixture containing them and asserts the result JSON contains none
  of their values.
- The rendered-page fallback reads the delivery-location block into the event
  location. On a public lookup UPS renders that as a city and country.
- Session cookies and the XSRF token live in memory for the process and are
  never logged or persisted.

## Implementation decisions

- Read the page's own `GetStatus` endpoint rather than the rendered HTML: it
  returns the whole scan history as JSON, where the page carries only the
  current status.
- Keep the cookie jar in memory and reuse it across lookups. Establishing a UPS
  session is the expensive part; the structured call afterwards is cheap.
- One refresh, then drop. A rejected cached session is given exactly one page
  fetch to recover; a second rejection means the session is dead, not slow.
- Serialize lookups through the adapter instance. The jar and the XSRF token are
  shared state, and two lookups refreshing them at once produce a session that
  belongs to neither.
- 2026-09-12: `UPSSessionRejected` stays a distinct class because the adapter
  itself reacts to it — refresh once, then drop the session — and it now extends
  `ChallengeError`, so routing treats a rejected session as a verification
  problem rather than a schema problem.
- 2026-09-12: the "configure FLARESOLVERR_URL" failure became a `ChallengeError`
  with the same message. It is what it always was: UPS asking for a browser we
  do not have.
- 2026-09-12: the two tiers became `runSteps` with the ids `direct` and `trawl`,
  the ids the existing dashboards already use. The cached session, its one
  refresh and a fresh session are all inside `direct`: they are the same plain
  HTTP transport, not separate tiers.
- 2026-09-12: the rendered-page parse stays inside the `trawl` step, as before,
  plus the no-browser-service case where the direct page is all there is.

## Rejected alternatives

- Calling `GetStatus` without first loading the tracking page: it answers 401
  without the cookies the page sets.
- Treating an HTTP 404 from the page or the API as a not-found: neither proves
  the shipment is absent, and it would put a day-long cooldown on a lookup that
  a browser can still answer. They stay indeterminate.
- Parsing the rendered page as the primary path: it has no history, so every
  sync would see one event and never a timeline.
- Pinning a browser user agent: the browser step seeds the session with the user
  agent the service actually used, because the cookies were issued to it.


## Verification log

- 2026-09-10: interactive check of the public tracking page; the direct
  anonymous flow is subject to an Akamai challenge, which is what the browser
  step exists for.
- 2026-09-10: the live wrong-number canary accepts either a privacy-safe
  no-result or the exact recognized browser-challenge error, nothing else.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts`, the tiers moved onto `runSteps`, and the error classes moved onto
  the shared taxonomy.
