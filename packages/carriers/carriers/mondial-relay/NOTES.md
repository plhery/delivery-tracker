# Mondial Relay notes

## Decisions

- 2026-08-30: read the page token from `#tracking` and send it as
  `RequestVerificationToken` to `/api/tracking`, which is exactly what the
  official tracking bundle does. Nothing is pinned: the token is fetched per
  lookup.
- 2026-09-10: go straight to the browser. Cloudflare blocks every non-browser
  client with an HTTP 403 WAF block, verified from several networks, so a direct
  attempt only burned time and reported a transport fallback on every sync. The
  adapter therefore declares a single step, `trawl`.
- 2026-09-10: support the 26-digit label barcode. Both modulo-11 check digits
  and the parcel sequence are validated; the first 12 digits are used as the
  public alias for links and lookups, and a reply must echo that alias or the
  embedded 8-digit shipment number.
- Never read the barcode's routing suffix as a postcode. It is a routing field
  that happens to look like one, and a wrong postcode silently returns another
  parcel's answer or nothing.
- Keep the postcode out of the tracking link. The link carries
  `numeroExpedition` only, so a shared link is not a shared credential.
- Decode the captured response body rather than the rendered HTML for the token:
  the Vue app replaces the `#tracking` root as soon as it boots.
- Serialize lookups through the adapter instance so the page token and the API
  call stay on the same solved browser identity.
- 2026-09-12: `MondialRelayTrackingError` was replaced by
  `NotFoundError('Mondial Relay')` — same message, same 404 — and
  `MondialRelaySessionRejected` by `ChallengeError`; neither carried data and
  nothing used `instanceof` on them.
- 2026-09-12: a well-shaped shipment number with no usable recipient postcode is
  now an `InputRequiredError` rather than a `TypeError`. A number that is not
  shaped like a Mondial Relay number at all stays a `SchemaError`. Both keep the
  original message, which names both halves of the credential.
- 2026-09-12: the local TRAWL body decoder was deleted in favour of
  `trawlBody()` in `core/transport`, which implements the same four shapes
  (string, byte array, serialized Node `Buffer`, index-keyed object). The 2 MB
  cap is passed explicitly so the decode bound is unchanged.

## Rejected alternatives

- Trying a direct HTTP request first and falling back: dropped 2026-09-10, see
  above. It never succeeded once.
- Deriving the postcode from the 26-digit barcode: the digits that look like one
  are routing information, not the recipient's postcode.
- Mapping the milestone numbers first: they say how far the progress bar has
  moved, not what happened. They are only consulted when no wording on the
  shipment classified.
- Retaining the Point Relais address so the app could show where to collect:
  it is a third party's full postal address next to a recipient's parcel, which
  PRIVACY.md excludes. The shop name alone is allowed, but this reply does not
  separate it from the address block.
- Stamping UTC on the offset-less timestamps: the backend is Paris, and the
  offsets in the output would have been wrong by an hour for half the year.

## Verification log

- 2026-08-30: tracking bundle inspected; the token flow above is the official
  one. SHA-256 of the bundle recorded in `adapter.ts`.
- 2026-09-10: Cloudflare WAF block on direct access confirmed from several
  networks; the direct path was removed the same day.
- 2026-09-10: interactive check of the public tracking page; the browser session
  keeps the page token and the API call together.
- 2026-09-12: moved to `packages/carriers/carriers/mondial-relay/`. Two behavior
  notes: the shared TRAWL client requires the service to return page HTML (the
  old local code tolerated a body-only reply), and, as for every migrated
  adapter, `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies it as `transport` instead of `schema` until
  routing uses `carrierErrorKind()`.
- 2026-09-12: `src/server/browserProtectedCarriers.live.test.ts` still expects
  `name: 'MondialRelayTrackingError'` and `name: 'RangeError'`. That file is
  owned by the grouped live suite; both expectations now need to be
  `NotFoundError` and `ChallengeError`.
