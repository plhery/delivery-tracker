# India Post

India Post (Department of Posts, including Speed Post) S10 items ending in `IN`, tracked through
[MySpeedPost](https://myspeedpost.com/track), a third-party tracker that answers without an account.
India Post's own site is interactive, rate-limited and does not answer anonymous programmatic
requests reliably.

## How it works

1. `direct`: one stateful Livewire conversation with MySpeedPost. A per-lookup cookie jar
   (`fetch-cookie` + `tough-cookie`) carries the page's session cookie to every call and keeps
   concurrent lookups from sharing a component snapshot.
   1. `GET /track?n={number}&sync=true`; read the `track-consignment` component's `wire:snapshot` and
      the CSRF token.
   2. If the component is already `Completed`, its `tracking-request` attribute holds MySpeedPost's
      cached history. If `synced_at` is under 30 minutes old, return it. Otherwise dispatch
      `refresh_consignment` (the page's Refresh button) and poll; if the refresh fails, return the
      cached history.
   3. Otherwise `POST /livewire/update`: `__dispatch(set_consignment_number)` + `submit` for a `New`
      component, `fetchStatus` for one already `Processing`.
   4. Poll `fetchStatus` (up to 10 × 750 ms) until `Completed`, then parse the returned HTML fragment.

Outcomes:

- `consignment_not_found` dispatch: not found.
- Cloudflare interstitial (HTTP 401/403/419/429, `cf-mitigated: challenge`, or `Just a moment`,
  `cf-chl-`, `_cf_chl_opt` in the body): `IndiaPostChallengeError`, retryable, never not-found.
- Still `Processing` after the poll budget: `IndeterminateError`. The backend answered but proved
  nothing, so no not-found cooldown.

## Notes

- Stale caches are refreshed because MySpeedPost serves its last sync until someone presses Refresh;
  `sync=true` does not renew it. A cached "Item Booked" can hide days of later scans.
- Cloudflare's passive loader `/cdn-cgi/challenge-platform/scripts/jsd/main.js` appears on ordinary
  200 pages. Treating `challenge-platform` as a challenge marker once made every lookup fail.
- Identity is bound twice: the snapshot's `consignment_number` and the fragment's
  `#consignment_search` value must both match.
- `event` is either prose (older syncs) or a bare code (`ITEM_BOOK`, `BAG_DISPATCH`,
  `CUSTOM_RECEIVE`…). Known codes are spelled out, with `ITEM_BOOK` → "Item Booked" to match the old
  prose so stored rows don't duplicate. Other codes become title case.
- There is no stable status code. `event_type`, `event` and `remarks` are joined into one normalized
  key and matched by substring, most specific first. Unrecognized rows keep an `in_transit` stage with
  an `unknown` status, so no scan is dropped and no terminal stage is invented.
- `CUSTOM_RECEIVE` is customs. `CUSTOM_RETURN` and "released by export Customs" mean customs handed
  the item back: in transit, not returned to sender.
- `tracked_at` without an offset is read as `Asia/Kolkata`. `synced_at` is returned as
  `source_synced_at`.
- IDs and pincodes arrive as numbers or strings, hence `cleanScalar`. A pincode is kept only when it
  is exactly six digits.

## Limitations

- No ETA.
- Only booking, dispatch, customs and delivery wording has been seen live. Failure, return and pickup
  rules come from prior art ([njs-tracker-scraper](https://github.com/bivu-m/njs-tracker-scraper));
  new wording lands on `in_transit` until added.
- Recipient remark, address and contact number are never read; the offline test asserts it.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/india-post` with `INDIA_POST_TRACKING_NUMBER`
set to a real consignment. The synthetic not-found case runs without it.
