# Colisweb

Appointed last-mile deliveries in France for retailers (furniture, appliances) in a booked
time slot. A shipment is a delivery with a slot and three milestones, not a parcel journey.
Tracked through the public recipient search.

## How it works

1. `direct`: one bounded `POST https://www.colisweb.com/api/search` with `{"value":"…"}` —
   the same request the tracking page makes, no session or token. `redirect: 'error'`.
   - 400, 404 or 422 is not-found.
   - An empty HTTP 500 is `IndeterminateError` (502), not not-found — see Notes.
   - Other non-2xx is not-found if the body says "not found", "introuvable" or "inconnu",
     otherwise `UpstreamHttpError`.
   - `parse()` requires `searchValue` to echo the requested number.

## Notes

- A validly shaped unknown number answers an empty HTTP 500. Colisweb's UI shows its
  "not found" card for it, but a broken backend returns the same bytes. Mapping it to 404
  would stop retries and tell the user something we don't know.
- Numbers are 8–32 digits. No detection rule: the shape collides with too many carriers, so
  Colisweb is reached by pasting a `colisweb.com` link or picking the carrier.
- Events are the three milestone timestamps (`deliveryConfirmationDate`, `pickedUpDate`,
  `deliveredDate`), newest first. When no milestone carries the current step's stage, one
  time-less entry is prepended so the stage stays visible.
- Steps are compared with case and separators removed: the same step appears as `pickedUp`,
  `picked_up` and `PICKED_UP` across Colisweb's surfaces. The endpoint sends no wording; the
  French descriptions are ours.
- `package_return_failed` maps to `returned`, not `failed_attempt`: the failure is about the
  return leg.
- An unlisted step gives no `current_stage` and a stage-less event, so the sync classifies it.
- Timestamps carry their own offset and are kept verbatim.
- The estimate is the day of `startsAt`, dropped once delivered or in exception. `endsAt`,
  the retailer name and the recipient block are never retained; a test asserts it.

## Limitations

- No scan locations, weight or dimensions.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/colisweb` (no env vars). It asserts
that an unknown number returns the indeterminate empty-500 result.
