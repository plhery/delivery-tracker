# Relais Colis

French pickup-point network: parcels go to a neighbourhood shop, and unclaimed
ones go back to the seller. Tracked through the public recipient form on
`https://www.relaiscolis.com/colis/suivre`.

## How it works

1. `direct`: two requests over a cookie jar created for this lookup only.
   - `GET /colis/suivre` for the session cookie and the Symfony CSRF token in
     `#track_package__token`. No token is a `SchemaError`.
   - `POST /colis/suivre` with `track_package[trackingNumber]`,
     `track_package[searchPackage]` and `track_package[_token]`, sent with
     `redirect: 'manual'`.

Not-found: a 3xx or 404 on the POST, or an error block with no `.follow-step`.
A 3xx means the form bounced the number, not that the parcel moved, so it is
never followed. An empty 200 is `IndeterminateError`. The page echoes the
searched number in its form field; it must match before any step is read.

## Notes

- One jar per lookup, so concurrent lookups never share or invalidate each
  other's token and no `singleFlight()` gate is needed. Hoisting the session to
  the tracker instance would need one.
- `.follow-address`, `.follow-address-box`, `[data-recipient]`,
  `[data-delivery-address]` and `script`/`style`/`noscript` are removed before
  any text is read. Removing first fails safe if a selector changes later.
- The provider's French sentence is kept verbatim as the description; the map
  only sets the stage. The sentence is what a human sees and carries no
  personal data.
- Pickup and out-for-delivery phrases are matched before delivery ones, because
  "relais" appears in several stages.
- Event times (`dd/MM/yyyy à HH:mm` or `14h20`) are Paris wall-clock values.
- `RelaisColisTrackingError` stays a named `NotFoundError` subclass because the
  live canary matches on its name.

## Rejected approaches

- Hoisting the session to the tracker instance: saves one cheap GET but needs a
  single-flight gate and token-expiry handling.
- Keeping the pickup point's name: it shares a container with its address, and
  that container is removed first.
- Rewriting step sentences in our own words: loses the distinction between
  "waiting in your relais" and "on its way to your relais".

## Limitations

- History only: no location (the only place is the pickup point) and no
  delivery estimate.
- Recipient name, address, phone and pickup-point details are never read.

## Testing

`npm run test:carriers:live -- src/server/frenchDirectCarriers.live.test.ts`
(no env vars) checks a wrong number maps to a clean not-found.
