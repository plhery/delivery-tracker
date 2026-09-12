# CTT Portugal notes

## Decisions

- 2026-09-11: use `appserver.ctt.pt` (the OutSystems data actions behind the
  public tracker) rather than scraping the rendered page. It returns the same
  data as JSON, keyless.
- 2026-09-11: never pin `moduleVersion` / `apiVersion`. CTT rotates them on
  every frontend deploy, so both are derived at runtime from the keyless version
  endpoints plus the screen bundle, and re-derived once when the reply says they
  changed.
- 2026-09-11: treat the cookie-less `403 Invalid Login` as the session
  bootstrap, because the same response sets `nr2Users`. Only one retry: a second
  failure is a real failure (`CttApiError`), not a loop.
- 2026-09-11: `StateId`, the stable integer, is the mapping key — never the
  Portuguese `State` prose, which is display text.
- 2026-09-11: run the maintenance sibling (`DataActionCheckIPLocked`) only on
  `Found:false`. A found parcel already proves the backend is healthy, so the
  extra request is spent exactly where it disambiguates.
- 2026-09-11: keep the legacy `objectSearch` page as the user-facing link even
  though the adapter talks to `appserver`; it is the address CTT itself links.
- 2026-09-12: `CttMaintenanceError` stays a distinct class (it extends
  `MaintenanceError`) because the difference between "unknown parcel" and
  "CTT is down" is the whole point of the sibling call, and `CttApiError`
  extends `IndeterminateError` because a broken ceremony proves nothing about
  the shipment.
- 2026-09-12: `normalizeCttTrackingNumber` keeps throwing `TypeError`. It
  validates an argument, not a provider response; provider-response problems are
  `SchemaError`.

## Rejected alternatives

- Scraping the rendered `objectSearch` HTML: the page is a JavaScript app, so
  the HTML carries no history.
- Pinning the version tokens and refreshing on failure: CTT deploys often
  enough that the pinned value would be wrong more often than right.
- Mapping the Portuguese `State` text: it is prose, it is localized, and the
  integer next to it is stable.
- Treating `Found:false` as not-found directly: it hides backend outages behind
  a day-long not-found cooldown.
- Stamping `Europe/Lisbon` on offset-less timestamps: the lane is cross-border,
  so an offset-less value is dropped instead.

## Open items

- The moved test no longer asserts how the host's sync classifies an unmapped
  wording; that path is covered by `src/server/trackingSync.test.ts`.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` (which looks for `TypeError` / `RangeError`) now classifies
  these as `transport` instead of `schema` — a 15-minute cooldown instead of an
  hour. Harmless, but it disappears once routing classifies with
  `carrierErrorKind()`.

## Verification log

- 2026-09-10: live session flow, version-token derivation, delivered parcel and
  unknown-number path all confirmed (see README).
- 2026-09-12: moved to `packages/carriers/carriers/ctt/`; behavior unchanged
  apart from the error class names listed above.
