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
   frontend's checksum configuration (see `http.ts` and `NOTES.md`); no account,
   cookie, browser fingerprint or issued token is used. Results are labelled
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
