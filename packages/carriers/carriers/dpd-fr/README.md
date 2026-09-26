# DPD France

DPD France (formerly Exapaq), French last mile only. Tracked by parsing the
server-rendered recipient trace page. DPD Switzerland is a different protocol
in [`dpd`](../dpd/README.md).

## How it works

1. `direct`: one GET of `https://trace.dpd.fr/fr/trace/{number}` with a
   browser-like `User-Agent`, 20 s timeout. A 403 with
   `cf-mitigated: challenge` or a "Just a moment" page is a Cloudflare challenge.
2. `trawl`: the browser service's `scrape` API (`skipHttp`, `maxTier: 3`), only
   after a challenge. The step is disabled when `FLARESOLVERR_URL` is unset;
   the `direct` challenge then says "configure FLARESOLVERR_URL" itself, so
   telemetry shows one step and the operator still gets the hint.

Both tiers return HTML for the same parser. "Numéro de colis inconnu" (or "pas
en mesure de retrouver") with no parcel number on the page is not-found. Other
non-2xx statuses are indeterminate.

## Notes

- `direct` is kept although Cloudflare usually challenges it: when it passes it
  saves a browser session. (Mondial Relay dropped its direct tier because it
  never passed.)
- One page can show an outbound parcel (`#infos1`, `tr.tabTraceColisAller`) and
  its return (`#infos2`, `tr.tabTraceColisRetour`). The requested number picks
  the leg; the other leg's rows are never read. A page without the requested
  number is a `SchemaError`.
- No status codes, only French prose, compared lowercase without accents or
  punctuation (DPD varies them between rows).
- Rule order matters: returns, then incidents, then delivery. "votre colis sera
  retourné à l'expéditeur" would otherwise match a delivery rule, and "nous
  avons reçu une réclamation" would look like movement.
- "retard" maps to `failed_attempt`; "réclamation" and "enquête est ouverte" to
  `exception`.
- Unrecognized wording keeps the row with no `stage`; the result status comes
  from the newest recognized row.
- Rows print naive `dd/MM/yyyy` + `HH:mm` in two cells, read in Europe/Paris.
  The planned delivery date is a calendar day, dropped once delivered or in
  exception.

## Rejected approaches

- A JSON feed behind the page: there is none; the timeline exists only as
  markup.

## Limitations

- DPD France's site terms restrict unapproved automated access. Treat this as
  experimental; a contracted API is the long-term fix.
- Customer reference, delivery address and proof-of-delivery blocks are never
  read: the parser visits only timeline rows and labelled detail rows.

## Testing

`npm run test:carriers:live -- src/server/browserProtectedCarriers.live.test.ts`
runs without a browser service, so it accepts either a clean not-found or the
challenge error.
