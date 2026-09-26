# CTT Portugal

The Portuguese postal operator, for S10 numbers ending in `PT`. Tracked through the OutSystems
data actions on `appserver.ctt.pt` that back the public tracker. CTT Express (`ctt-express`)
is a separate carrier.

## How it works

1. `direct`: the whole OutSystems ceremony runs inside one step.
   1. Derive the tokens: `GET /CustomerArea/moduleservices/moduleversioninfo` for
      `moduleVersion`, then the module manifest and the `PublicArea_Detail` screen bundle for
      each data action's `apiVersion`. CTT rotates both on every frontend deploy, so they
      are never pinned.
   2. `POST …/PublicArea_Detail/DataActionGetObjectEventsByInputObjectCode` without a cookie.
      It answers `403 Invalid Login` and sets the `nr2Users` session cookie on that same
      response: the 403 is the bootstrap. The retry sends the cookie plus `X-CSRFToken` read
      from its `crf=` field. Only one retry; a second failure is `CttApiError`.
   3. If the reply says `hasModuleVersionChanged` or `hasApiVersionChanged`, re-derive the
      tokens once and replay.
   4. `Found:false` means either an unknown number or a backend outage. Only then is
      `DataActionCheckIPLocked` called to tell them apart: `NotFoundError` for a genuine
      miss, `CttMaintenanceError` (a `MaintenanceError`) for an announced outage.
   - Every request sends a browser `User-Agent`; Cloudflare answers error 1010 without one.

## Notes

- `Found:false` is never treated as not-found directly: that would hide outages behind the
  not-found cooldown. The maintenance check runs only on a negative, since a found parcel
  already proves the backend is up.
- `CttApiError` is an `IndeterminateError`: a broken ceremony proves nothing about the
  shipment.
- Only the integer `StateId` is mapped, never the localized Portuguese `State` text. It is
  also returned as `provider_code`. An unmapped `StateId` gets no stage and the sync records
  the raw wording.
- Timestamps carry offsets and are kept as sent. An offset-less value is dropped, not
  stamped `Europe/Lisbon`, because lanes are cross-border.
- Event `Local` mixes depot codes and point names. It is kept as a coarse location and never
  refined into an address.
- Sender and recipient names, contacts and addresses are on the record but never read; a
  test asserts it.
- At most 20 events are returned, newest first.
- The user-facing link is the legacy `objectSearch.jspx?objects=` page: CTT links it from
  its own site and it survives `appserver` host changes.

## Rejected approaches

- Scraping the rendered `objectSearch` page: it is a JavaScript app with no history in the
  HTML.
- Pinning the version tokens and refreshing on failure: CTT deploys often enough that the
  pinned value would be wrong more often than right.

## Limitations

- No delivery estimate.
- Non-`PT` S10 numbers and other CTT routes stay with the generic postal fallback.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/ctt`. The unknown-number check needs
no env vars; set `CTT_DELIVERED_TRACKING_NUMBER` to also check a real delivered parcel.
