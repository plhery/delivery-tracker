# CTT Portugal

## Identity and scope

`ctt` — CTT Correios de Portugal, the Portuguese universal postal operator.
Last mile in `PT`. Tracked automatically; no postcode or capability URL is
needed. CTT Express is a separate carrier (`ctt-express`) and is not served by
this adapter.

## Portals

- Public tracker: `https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects={trackingNumber}`.
  This legacy `objectSearch` page is the address users recognise and the one CTT
  links from its own site; it is stable across `appserver` host changes.
- The page is an OutSystems Reactive app backed by `appserver.ctt.pt`, which is
  where the adapter reads from.
- Canary: `https://www.ctt.pt/`.

## What we retrieve

| Field | Kept | Notes |
|---|---|---|
| status / stage | yes | from the event `StateId` |
| history | yes | newest first, at most 20 events |
| location | yes | event `Local`: depot codes and point names, coarse only |
| provider_code | yes | the raw `StateId` as a string |
| eta | no | the endpoint exposes none |
| sender / recipient identity | no | present on the record, never retained |

Declared capabilities: `history`, `location`, `provider_code`. The offline test
asserts each of them against the fixture.

## Tracking numbers

One rule: `^[A-Z]{2}\d{9}PT$` with a valid S10 check digit, high confidence.
Anything else stays with the generic postal fallback — those routes were never
sampled here. `numbers.json` carries one publicly reported sample,
`RL402552798PT`.

## How the adapter works

Single step, `direct`. CTT's tracker needs some ceremony, all of it inside that
one step:

1. `GET /CustomerArea/moduleservices/moduleversioninfo` for the module version
   token, then the module manifest and the screen bundle to derive the
   `apiVersion` of each data action. CTT rotates both on every frontend deploy,
   so neither is ever pinned.
2. `POST .../PublicArea_Detail/DataActionGetObjectEventsByInputObjectCode`
   without a cookie. The endpoint answers `403 Invalid Login` *and* sets the
   `nr2Users` session cookie on that same response: the 403 is the bootstrap,
   not an error. The retry carries the cookie plus the `X-CSRFToken` read out of
   its `crf=` field.
3. A browser `User-Agent` is mandatory; Cloudflare answers error 1010 without one.
4. `hasModuleVersionChanged` / `hasApiVersionChanged` in the reply trigger one
   re-derivation of the tokens, then the call is replayed once.
5. `Found:false` is both "unknown number" and "backend outage". The sibling
   `DataActionCheckIPLocked` call decides which, and runs only on a negative —
   a found parcel already proves the backend is healthy.

Errors: `NotFoundError('CTT')` for a genuine miss, `CttMaintenanceError`
(a `MaintenanceError`) for an announced outage, `CttApiError` (an
`IndeterminateError`) when the ceremony breaks down, `SchemaError` for a
payload that does not bind to the requested shipment.

## Status reference

| Stage | Code (raw) | Wording seen | Confirmed by |
|---|---|---|---|
| registered | `1` | — | prior-art |
| in_transit | `2` | Aceite | live |
| in_transit | `8`, `10`, `11` | Em trânsito | prior-art |
| out_for_delivery | `7` | — | prior-art |
| ready_for_pickup | `14` | — | prior-art |
| delivered | `12` | Entregue | live |
| failed_attempt | `13` | — | prior-art |
| returned | `5` | — | prior-art |
| pending | — | not observed; reported as unmapped | — |
| accepted | — | not observed; reported as unmapped | — |
| customs | — | not observed; reported as unmapped | — |

The vocabulary is explicitly still being observed. An unmapped `StateId` yields
no stage at all: the event keeps its raw wording and its `provider_code`, the
result reports `unknown`, and the sync classifies and records the wording for
review.

## Limitations and privacy

- No delivery estimate: CTT's public record has none.
- Timestamps carry explicit offsets, so they are kept as sent; an offset-less
  value is dropped rather than stamped with a zone on a cross-border lane.
- The record carries sender and recipient names, contacts and address blocks.
  None of them is retained; the offline test feeds a fixture containing them and
  asserts the result JSON contains none of their values.
- Event `Local` mixes depot codes and point names. It is kept as an operational
  location and never refined into an address.

## Implementation decisions

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


## Verification log

- 2026-09-10: live check. The cookie-less POST answers `403` while setting
  `nr2Users`; the retry with cookie plus `X-CSRFToken` succeeds. Version tokens
  derived from `moduleversioninfo`, the module manifest and the screen bundle.
- 2026-09-10: a delivered parcel returned an identity-bound history whose every
  label mapped (`2` accepted → `12` delivered).
- 2026-09-10: an unknown but validly shaped number answers `Found:false`; the
  sibling `DataActionCheckIPLocked` reported no maintenance, so the lookup ends
  as a clean not-found.
- 2026-09-12: adapter moved into this folder; the status map moved to
  `status.ts` and the error classes moved onto the shared taxonomy.
