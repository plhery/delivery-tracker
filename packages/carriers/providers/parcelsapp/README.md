# ParcelsApp

## Identity and scope

ParcelsApp (parcelsapp.com) is a universal tracking aggregator, not a carrier:
it has no last mile of its own and cannot be selected for a parcel. It is the
second provider of the discovery chain (`providers/README.md`). The provider
name persisted in routing state is `ParcelsApp`.

## Portals

| Portal | URL | Shown to a human |
| --- | --- | --- |
| Public tracking page | `https://parcelsapp.com/en/tracking/{number}` | status, aggregated history, a result table repeating the tracking number, destination prompts for ambiguous numbers |

The page is also the link the app shows for a parcel whose history came from
ParcelsApp.

## What we retrieve

From the page's own API (`/api/v2/parcels`), or from the rendered page when no
API body could be read:

| Field | Source |
| --- | --- |
| `events[].time` | `states[].date` (API, always with an offset) or the `dd LLL yyyy HH:mm` pair rendered in the page, read as UTC |
| `events[].description`, `events[].stage` | `states[].status` or the rendered event title |
| `status`, `current_stage`, `last_status_text`, `last_update` | derived from the projected events |

Rows that ask for input (`require_fields`, a postal-code form, a destination
country selector) and rows the page renders without a time are notices, not
scans: they are skipped instead of failing the shipment. Sender, destination and
estimate fields are not retained.

## Tracking numbers

Any number the chain is given: uppercased with spaces, dots and dashes removed,
it must match `^(?=.*\d)[A-Z0-9]{4,40}$`. The API reply does not repeat the
number, so a result is accepted only when the page's own result table shows
exactly one `Tracking number` row and it equals the requested number.

## How the adapter works

One tier, `trawl`, run by `runSteps` with the per-provider budget (30 s inside
the chain):

1. The private browser service (`FLARESOLVERR_URL`) loads the tracking page with
   `skipHttp`, up to tier 3, and captures responses for
   `https://parcelsapp.com/api/v2/parcels` with a 15 s settle window.
2. Captured bodies are parsed newest first; polling replies and unrelated
   shipments are skipped.
3. When no body was readable, the rendered history in the returned HTML is
   parsed instead.

A captured API response with status 429 or any other error status is reported
with its status and `Retry-After`. Without a configured browser service the
lookup fails immediately; it never falls back to a plain HTTP request, which
returns the application shell rather than established history.

## Status reference

The wording vocabulary is shared by the four universal providers and lives in
`../shared/result.ts`; see `../ship24/README.md` for the full table. ParcelsApp
declares no machine-readable stage of its own, so every stage comes from the
wording rules and the language classifier.

| Stage | Wording (raw) | Confirmed by |
| --- | --- | --- |
| delivered | `Delivered`, `Delivered by mailbox, PIN: …` (details dropped) | live 2026-09-08 |
| accepted | `Prise en charge de votre colis sur notre site logistique de …` | live 2026-09-08 |
| registered | `Electronic information submitted by shipper`, `Colis en préparation chez l'expéditeur` | live 2026-09-08 |
| in_transit | `In transit`, `Arrived`, `Departed`, `Sorted` | live 2026-09-08 |
| pending | `Additional information provided` and any other unmapped wording | live 2026-09-08 |
| not observed | `customs`, `failed_attempt`, `ready_for_pickup`, `returned`, `out_for_delivery` | reported as unmapped |

## Limitations and privacy

- An aggregator reports what the underlying carriers give it; a dedicated
  carrier adapter is always preferred when one exists.
- Ambiguous numbers make the page ask for a destination country. That prompt is
  a notice: it never becomes a shipment event and never invents progress.
- Delivery wording can contain an access code or a signature. Any event whose
  stage is not `delivered` and that carries such details is dropped, and a
  delivered event's description is replaced by `Delivered`.
- The provider reports no courier name we can use, so ParcelsApp never produces
  a `discovered_carrier`.

## Implementation decisions

- **Keep the browser capture (2026-09-10).** The current bundle constructs
  protected request fields (including `se`) for its own API call. Both inspected
  anonymous crawlers drive Chromium and capture `/api/v2/parcels`; the PHP
  client found in the same review requires an API key. A raw HTML GET loads the
  application rather than established shipment history, so no browser-free
  replacement was verified.
- **Bind the result to the rendered number.** The API reply omits the tracking
  number. Identity is taken from the page's own result table (exactly one
  `Tracking number` row, equal to the requested number), never from the input
  field or from the URL that was requested.
- **Rendered history is a real fallback.** When the capture yields no readable
  body, the page's event list carries the same history and is parsed instead;
  the surrounding marketing copy is excluded by the `.tracking-info .parcel
  .events > .event` selector.
- **Notices are not events (2026-09-11).** Rows asking for a postal code or a
  destination country, and rows rendered with a date but no time, are skipped
  instead of failing the whole history or manufacturing a timestamp.
- **Rendered times are UTC (2026-09-08).** Verified against the live JSON: the
  English web app prints the UTC values of its API. The machine's local timezone
  is never used.

## Rejected alternatives

Prior browser implementations inspected during the September 10 review:
[thefuga/parcelsapp-crawler](https://github.com/thefuga/parcelsapp-crawler/blob/e3085dc9a3144829d0689a4f12705f61a87258ec/main.go)
and [dustindog101/parcelsapp-cli](https://github.com/dustindog101/parcelsapp-cli/blob/b0c57c2/parcels.py).
These are protocol leads, not current availability evidence.

- **A plain HTTP GET of the tracking page.** Returns the application shell.
- **The API-key client** (`locky42/parcels-app-provider`, revision `708726c`):
  requires a provisioned key; this adapter stays on the anonymous public path.
- **Trusting the requested URL as identity.** A page can render another
  shipment or an empty result for the same URL, so only the rendered result
  table is accepted.


## Verification log

- 2026-09-08: the English web app renders the UTC values of its own API, so the
  rendered `dd LLL yyyy HH:mm` pair is read as UTC rather than in the machine's
  local timezone.
- 2026-09-10: a raw HTML GET returns the application shell, not established
  history; the current bundle builds protected request fields. TRAWL capture is
  retained.
- 2026-09-11: a not-yet-scanned Colissimo label rendered a notice row with a
  date and an empty time; those rows are skipped.
- 2026-09-12: moved into `packages/carriers/providers/parcelsapp` unchanged, now
  reporting one `trawl` step per lookup.
