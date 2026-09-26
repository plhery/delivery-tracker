# La Poste / Colissimo

La Poste's unified tracking feed. It serves Colissimo, tracked mail,
[Chronopost](../chronopost/README.md) and [Delivengo](../delivengo/README.md),
so those two folders point `tracking.adapter` here.

## How it works

1. `direct`: one keyless GET of
   `https://www.laposte.fr/ssu/sun/back/suivi-unifie/{number}?lang=fr`, the feed
   the public tracker calls, with the tracker page as `Referer`.
2. `retry`: the same request, up to three times, only after an HTTP 403 and only
   while the original 15-second deadline has time left. Each attempt gets the
   remaining time, so retries never extend the lookup.

The feed answers with an array; only the entry whose `shipment.idShip` equals
the requested number is read. `returnCode` 104 is the only positive not-found;
any other non-zero code is inconclusive, so the router can fall back to a
universal provider.

## Notes

- The 403 is usually La Poste's "Site indisponible - Incident en cours" page.
  Despite the wording it is a one-request edge hiccup, not maintenance: the next
  lookup succeeds, and it is most likely on the first request after a quiet
  period. Treating it as maintenance and skipping retries sent roughly ten
  times more lookups to the router, each benching the adapter for an hour. A real
  incident still fails all four attempts within seconds.
- Only 403 is retried. A 429 or a malformed payload won't be fixed by an
  instant repeat.
- The retries are three separate runner steps with the id `retry`, not a loop,
  so each rejection keeps its own diagnostics and the `attempts` label on
  `carrier_lookup_total` shows which retry served the lookup. `steps` lists
  tiers (`direct`, `retry`), not attempts.
- The deadline check lives in the `recovers` predicate. An exhausted lookup
  still throws the provider's `UpstreamHttpError` (403), not a
  `BudgetExceededError`.
- Status precedence: incident wording, then event `code`, then `group`, then
  wording. La Poste keeps a failed delivery inside its original group
  ("Incident : livraison impossible" arrives with code `DR1`, meaning
  registered).
- `AG1` means ready for pickup whatever its group or sentence. `DO1` is customs
  entry. Pickup and customs are set as `current_stage` because the status
  vocabulary has no value for them.
- Timestamps already carry their Paris offset and are passed through verbatim.
  `isoTime` only validates them; impossible dates are dropped.
- `contextData.partner` names the foreign carrier after export; it becomes
  `delivery_carrier` and `delivery_tracking_number`.

## Rejected approaches

- Scraping the public tracker page: it calls this keyless feed itself.
- Chronopost's SOAP service: exposes more consignment metadata than tracking
  needs and isn't meant for automated use. The unified feed answers the same
  numbers.
- Retrying a 403 with backoff: the hiccup is brief, so waiting only spends the
  user's deadline.
- Treating every non-zero `returnCode` as not-found: that reports parcels
  missing during a provider outage.

## Limitations

- `location` is the event's country; the feed has no city.
- The delivery estimate is dropped once the shipment is final.
- Recipient blocks and addresses on the shipment and its events are never read;
  events are built from an allowlist of wording, time, country and codes.

## Testing

`npm run test:carriers:live -- src/server/frenchDirectCarriers.live.test.ts`
(no env vars) checks a wrong number gets a clean not-found or the recognized 403.
