# GLS France

GLS France last-mile parcels (door, ParcelShop, locker), tracked through the
public consignee endpoint behind `moncolis.gls-france.com`. Independent of the
GROUP service used by [gls-ch](../gls-ch/README.md) and [gls-de](../gls-de/README.md).

## How it works

`direct`: one `GET https://public.infra-prod.prod.cloud.fr.gls-group.com/consignee-ws/api/v1/command/public/codes/{number}`
with the portal's `Origin` and `Referer`. No session or token; 12 s timeout,
750 kB cap. An unknown valid-shaped number returns HTTP 404 with a "no command
found" body, which is a definite not-found.

The parser:

1. requires the number to be echoed in `trackid`, `numeroalphaColis` or
   `numeroGp` (whichever matches the shape asked for); a mismatch is a schema error;
2. reads up to 500 events, dedupes on (time, location, code), sorts newest
   first and keeps 100;
3. takes the parcel status from `statutColis`, falling back to the newest event.

## Notes

- GLS France sends codes, never wording. The map in `status.ts` is the only
  status source, and the English descriptions are ours. Unmapped codes produce
  an event with no stage for the sync to classify.
- `DEL` is read like the official frontend: a rescheduled delay (`in_transit`),
  and a failed attempt only when the same event's `typeEvenement` is `LIV`.
  `statutColis: DEL` is checked against the newest event the same way.
- Timestamps come in three shapes on the same fields: ISO with or without
  offset, SQL-style wall clock, bare day. An explicit offset is honoured;
  everything else is read in `Europe/Paris`. Empty values arrive as year `0001`
  and are dropped. No single `core/time` policy covers this, so parsing is local.
- Locations are GLS facility codes (`FR0012`), not resolved to cities.
- The estimate is the day part of `dateTheoriqueLivraison`.
- Not used: scraping `moncolis.gls-france.com` — the endpoint returns the same
  data as JSON.
- The parser reads an allowlist of fields. Address, signature, contact and
  instruction blocks are never copied; a test asserts none reach the result.

## Limitations

- The endpoint is undocumented and may change or start challenging requests.
- The adapter accepts 8 alphanumerics or 11 digits. Detection also suggests
  12-digit numbers (low confidence), but the adapter rejects them.
- No sender, pickup-point name, weight or dimensions in the response, so those
  capabilities are not declared.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/gls-fr` (no env vars;
checks the 404 for a valid-shaped wrong number).
