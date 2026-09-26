# Planzer

Planzer, a Swiss transport group. Two kinds of shipment: ordinary deliveries,
tracked by shipment number through Planzer's keyless tracking API, and shared
shipments (`999.90.########`), which are not in the API and need the full shared
link with its `accessKey`. The same adapter serves
[quickpac](../quickpac/README.md), whose `44…` numbers use this API.

## How it works

`direct`, one bounded request. The factory picks the route: a parcel with a
tracking URL goes to the shared page, everything else to the API. The URL
decides the route; it is not a fallback tier.

1. API: `GET https://api.tracking.app.planzer.ch/api/v1/shipments/{shipment}/Pak`,
   10 s timeout. One replay after a transport failure or HTTP 502/503/504, or
   after a 429 with a `Retry-After` of at most 60 s. An unknown number is an
   HTTP 404.
2. Shared link: `GET https://trackandtrace.planzergroup.com/shared/sendungen/{number}?accessKey=…`,
   15 s timeout. The page has no status code; its five route steps are read from
   the markup (tooltip label names the stage, `text-primary` marks reached
   steps, `<time datetime>` gives the timestamp). A short page is not-found only
   when it shows Planzer's "no shipments found" notice; otherwise it is a
   schema error (maintenance, partial render).

## Notes

- The shared URL is a capability URL. It must be `https://` on
  `trackandtrace.planzergroup.com`, with no credentials, port or fragment, a
  path whose number matches the tracked number, and exactly one well-formed
  `accessKey`. The key is never logged or stored in fixtures or docs.
- A `reference.shipment` composite (printed on some labels) is looked up by the
  shipment half without leading zeros.
- API responses can include transport positions of other shipments in the same
  delivery. Only the position whose `positionNumber` equals the requested
  number is read — showing another would be a privacy failure.
- An unfamiliar API milestone label is a `SchemaError`, not an unmapped event.
  The vocabulary is small and stable, so new wording is likely a schema change,
  and guessing risks a false delivery.
- Each milestone is classified on its own, not from the shipment status.
  Inheriting would stamp `delivered` on earlier events and make re-syncs
  duplicate history.
- `Shipped` means delivered: it is Planzer's mistranslation of `Zugestellt`
  (the same event reads `Livré` / `Consegnato`). It is classified as received
  and stored as `Delivered` via `PLANZER_WORDING`. Event identities hash the
  stored wording, so any new entry there needs a migration for saved rows, like
  `supabase/migrations/*_relabel_planzer_delivered_events.sql`.
- Shared-page step labels are in the recipient's language, so each stage is
  matched by substring and the stored description is our own neutral wording.
  This keeps history stable whatever language the page was fetched in.
- Neither route publishes scan locations. Timestamps have no offset; the host
  applies `Europe/Zurich`. Consignee and signature blocks are never read.

## Rejected approaches

- Shared page as a second tier after the API — the API never knows shared
  shipments, so it would add a guaranteed failure per lookup.
- Mapping `Shipped` to a dispatch stage — the other-language fields on the same
  event say delivered.
- Rewriting `Shipped` at display time — the views only see text, and other
  carriers use `Shipped` for dispatch.
- Storing the German labels — every history would switch to German to fix one label.
- Adding `Expédié` / `Versandt` / `Spedito` as aliases — those mean dispatched;
  only equivalents of Planzer's own labels are mapped.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/planzer`. Unknown-number
checks need no env vars. Set `QUICKPAC_DELIVERED_TRACKING_NUMBER` to a real
delivered Quickpac parcel to also check the four milestones and the `Shipped`
relabel.
