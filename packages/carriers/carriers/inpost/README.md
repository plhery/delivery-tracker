# InPost

The Polish locker and courier network and its cross-border hubs (last mile in PL, IT, PT and
GB). Tracked through the keyless `inposteasy.com` hub API; no postcode or link needed.

## How it works

1. `direct`: one `GET https://inposteasy.com/api/tracking/{trackingNumber}`. No cookies,
   headers, account or browser state.
   - The echoed `trackingNumber` must match the request, otherwise `SchemaError`.
   - HTTP 404 with a structured `NOT_FOUND` problem body is not-found. Long-expired numbers
     answer the same way.
   - Any other non-200 is `UpstreamHttpError`.

## Notes

- The parcel-level `status` code sets the overall stage and each event's own code sets that
  event's stage; the two are independent in the payload.
- An unmapped `<PHASE>.<NNNN>` code gets no stage: the phase prefix does not decide it
  (`LMD.1002` is transit, `LMD.1004` ready for pickup, `LMD.9002` a failed attempt). The
  result is `unknown` with the raw wording kept, and the sync records it for review.
- Timestamps are kept exactly as sent with their offset. An offset-less value is dropped,
  not stamped with `Europe/Warsaw`, because four countries share this endpoint.
- An empty `statusTitle` falls back to the raw code so a sparse event still reads as
  something.
- At most 20 events are returned, newest first.
- `JJD`/`JD` + 16 digits and bare 24-digit numbers are low confidence: `JJD` collides with
  DHL and needs a domain hint or an explicit pick.
- Origin and destination country codes are dropped: they feed no product field.
- Recipient name, address, phone and signature fields are never read; a test asserts it.
- Not used: ShipX (`api-shipx-pl.easypack24.net`). It is keyless but its success shape was
  never confirmed. It might carry locker names and an estimate, so it stays the next lead.

## Limitations

- No event locations and no delivery estimate: the hub response has neither, so the locker
  name the portal shows never reaches the result.

## Testing

`npm run test:carriers:live -- packages/carriers/carriers/inpost`. The wrong-number check
needs no env vars; set `INPOST_DELIVERED_TRACKING_NUMBER` to also check a real delivered
parcel.
