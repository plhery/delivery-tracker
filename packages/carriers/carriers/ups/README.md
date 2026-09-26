# UPS

Global UPS tracking from the site's own `GetStatus` JSON, read through a browser because
Akamai blocks plain HTTP. Parcels handed to a national post for the last mile are still
reported from the UPS record.

## How it works

The adapter accepts only `1Z` numbers and rejects anything else before any request.

1. `trawl` (whenever a browser service is configured): loads
   `https://www.ups.com/track?loc=en_US&tracknum=…&requester=ST/trackdetails` with
   `captureResponses` on `POST https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US`
   and parses the reply the page itself received. If nothing readable was captured, it parses
   the rendered page instead: current status and delivery location, no history.
2. `direct` (only without a browser service): plain HTTP with an in-memory cookie jar.
   - Fetch the tracking page, check it set the `X-XSRF-TOKEN-ST` cookie, then POST
     `GetStatus` with that value as the `X-XSRF-TOKEN` header. Cache the session.
   - A cached session that gets rejected fetches the page once and retries; a second
     rejection drops it.
   - If the API call fails, the fetched page is parsed as a rendered page. Otherwise it fails
     with `ChallengeError('UPS challenged direct tracking; configure FLARESOLVERR_URL for
     browser fallback')`.

In practice Akamai holds `GetStatus` open until the timeout (20 s direct) for any session a
browser did not establish. A deployment without a browser service therefore gets only the
rendered status, after that wait.

## Notes

- Lookups are serialized per adapter instance: the jar and XSRF token are shared, and two
  concurrent refreshes produce a session that belongs to neither.
- HTTP 401/403/419/429, or a page with no token, raise `UPSSessionRejected` (a
  `ChallengeError`), which the refresh-once logic reacts to. Any other HTTP error, including
  404, is indeterminate: it proves nothing about the parcel and must not start a not-found
  cooldown.
- `direct` is disabled whenever a browser exists, with no cooldown probe: every probe costs
  the full direct timeout and hits the same block.
- Status comes from `progressBarType` first, then substring matches on the prose. UPS scans
  carry no stable code, so events get no stage; the sync classifies each scan's wording.
- UPS's `Exception` token does not say whether it is a failed attempt or a return; both
  surface as `exception`.
- The rendered-page parser reads only the active progress-bar milestone. Reading the whole
  bar classified label-created parcels as out for delivery.
- Scan times are built from the UTC pair UPS sends, or the local pair plus its explicit
  offset. A scan with neither keeps the raw text; no zone is guessed.
- The scheduled delivery date has no year. The adapter picks the year that puts it within
  the last week or in the future.
- The canary URL is a static PDF so the canary itself is not challenged.

## Rejected approaches

- Calling `GetStatus` without loading the page first: 401 without the page's cookies.
- Replaying the browser's cookies over plain HTTP: Akamai holds that call open too, from
  datacenter and residential IPs alike.
- Parsing the rendered page as the primary path: it has no history.

## Limitations

- No delivery window, weight or dimensions: the endpoint returns none.
- Without a browser service there is no history.
- Recipient name, address, signature and delivery photo are in the reply but never kept; a
  test asserts it.

## Testing

No dedicated live test. The wrong-number canary in
[`src/server/browserProtectedCarriers.live.test.ts`](../../../../src/server/browserProtectedCarriers.live.test.ts)
accepts either a clean no-result or the exact challenge error above:
`npm run test:carriers:live -- src/server/browserProtectedCarriers.live.test.ts`.
