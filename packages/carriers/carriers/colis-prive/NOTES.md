# Colis Privé notes

## Decisions

- The recipient detail page is parsed directly: it is the only public surface,
  there is no JSON feed behind it, and it needs no session or token. One
  `direct` step.
- `.divDesti` is removed from the parsed document before any text is read,
  rather than filtered out afterwards. A removal cannot be forgotten by a later
  selector; a filter can.
- The response must echo the credential's 12-character shipment part. A page for
  another parcel is a schema error, never a result.
- The raw `DD/MM/YYYY` string stays the event time. The page has no clock, so
  building an instant would invent a time of day; `dateKey()` only produces a
  sort key and rejects impossible dates such as 31/02.
- `ColisPriveTrackingError` survives the move as a named subclass of
  `NotFoundError`: the host's sync tests and the grouped live suite construct it
  and match on its name, and `error_type` is a Sentry label.
- The exception and return wording groups are checked before the delivery group.
  "Nous avons tenté de livrer" contains "livrer"; ordering is what keeps a failed
  attempt from being reported as a delivery.
- 2026-09-12: wording that matches no rule no longer defaults to `in_transit`.
  The row is still returned, with no stage, so the sync classifies it and the
  wording is recorded for review.

## Rejected alternatives

- Reading the recipient block for a "delivered to" hint: it is a name and a
  street address, which `PRIVACY.md` forbids retaining under any justification.
- Treating the 3xx bounce to the search page as a transport failure: it is the
  provider's way of saying it does not know the shipment, and it is stable, so
  it maps to not-found.
- Splitting the shipment number and the postcode into `input.number` and
  `input.postcode`: the combined 17-character value is what is stored on the
  parcel today and what the detection rules describe. Changing it is a data
  migration, not an adapter change.

## Verification log

- 2026-09-12: moved from `src/server/colisPrive.ts` into this folder. Parse
  failures now raise `SchemaError` from `core/errors` (messages unchanged);
  `ColisPriveTrackingError` now extends `NotFoundError`.
- 2026-09-12: the opt-in live coverage stays in the grouped French suite, which
  checks that a validly shaped unknown credential produces the not-found error.
