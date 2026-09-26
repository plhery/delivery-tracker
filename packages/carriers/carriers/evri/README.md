# Evri

Evri International, through the [GlobalEco tracker](https://globaleco.app/track/)
that the official Evri tracking page links for international parcels. Domestic
UK tracking is a separate Evri service with no direct adapter; it relies on the
universal providers. A not-found here says nothing about Evri UK.

## How it works

1. `direct`: one anonymous form POST to `https://globaleco.app/track` with
   `tracking_number`. No cookies, CSRF token, postcode or browser. 15-second
   default deadline (a smaller caller budget and cancellation are honoured),
   1 MB response cap, no retry.

## Notes

- Identity is the requested number in both the `Shipment Details #…` heading
  and the **System Tracking** field. The echoed search input is ignored: the
  portal can replace it with the partner's tracking number.
- Not-found is only the explicit **Parcel not found** heading on the normal
  search form, returned with HTTP 200. That form clears its input, so the POST
  itself scopes the answer; an input naming another number is rejected. A
  404/410 means the endpoint is gone and is a transport error.
- Changed markup, a missing history table or ambiguous identity are schema
  errors.
- Each event is classified by its exact English label. Unknown labels stay
  visible without a stage, and an unknown current label gives `unknown` status.
- Timestamps have no offset or documented zone, even for partner scans abroad.
  They are kept as offset-less `events[].local_time` and `last_update_local` in
  the portal's newest-first order; `events[].time` is omitted and `last_update`
  is null, so the host never reads them as UTC. Clocks aren't sorted across
  legs.
- Because of that, the host first checks universal providers for a dated
  timeline and uses this result as the fallback. It can establish initial
  progress but can't overwrite a richer summary, and it doesn't feed the
  timeline of confirmed instants. The host keeps these scans in a bounded
  `direct_local_history` archive across later universal refreshes. No ETA or
  delivered time is inferred.
- Exact duplicate scans are removed; at most 100 are returned.

## Limitations

- International only; domestic UK numbers need universal providers.
- Sender names, destination, comments, tracking aliases and outbound links are
  never read.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/evri`. The not-found
check needs no env vars; the positive check runs when `EVRI_TRACKING_NUMBER` is
set outside the repository.
