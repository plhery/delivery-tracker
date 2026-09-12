# Poste Italiane notes

## Decisions

- 2026-09-11: use the keyless DoveQuando REST endpoint that backs the public
  tracker rather than the rendered page. One POST, no session.
- 2026-09-11: let the envelope, not the HTTP status, decide the outcome. The
  endpoint answers 200 for unknown numbers; `esitoRicerca` "1"/"2" and the
  esito-less empty-movements shape are the two documented unknown answers.
- 2026-09-11: accept that unknown and expired are indistinguishable to an
  anonymous caller, and report both as a clean not-found.
- 2026-09-11: `esitoRicerca` "3" with no movements is `pending` / `registered`,
  not unknown — the parcel exists, it has simply not been scanned.
- 2026-09-11: envelope `stato` "5" wins over the movement wording, because a
  delivered parcel sometimes carries a truncated last line.
- 2026-09-11: drop `luogo`. Nothing in the payload distinguishes a depot from a
  recipient address, and guessing would leak one.
- 2026-09-11: reduce `dataPrevistaConsegna` to a calendar day. It is prose in
  Italian ("Consegna prevista entro Venerdì 2 Gennaio 2026"), so a timestamp
  would be invented precision.
- 2026-09-11: added the ASCII-apostrophe delivered variant after seeing it live;
  both apostrophes are now accepted wherever Italian uses one.
- 2026-09-12: keep the local epoch-millis time helper instead of
  `core/time`'s `epochMillisTime`. The core helper suppresses milliseconds
  (`2026-01-04T00:00:00Z`) while this adapter has always emitted them
  (`2026-01-04T00:00:00.000Z`), and those strings are persisted.
- 2026-09-12: `normalizePosteItalianeTrackingNumber` keeps throwing `TypeError`;
  it validates an argument, not a provider response.

## Rejected alternatives

- Scraping `poste.it/cerca`: a JavaScript app, so the HTML carries no history.
- Mapping the Italian wording with a regular-expression catch-all: the
  vocabulary is open, and a wrong terminal stage is worse than an `unknown` the
  sync can classify and record.
- Stamping `Europe/Rome` on the movement times: `dataOra` is already epoch
  milliseconds, so there is nothing to stamp.

## Open items

- The moved test no longer asserts how the host's sync classifies an unmapped
  wording; that path is covered by `src/server/trackingSync.test.ts`.
- `SchemaError` carries no HTTP-like `status`, so the host's current
  `routingFailure()` classifies these as `transport` rather than `schema` until
  routing switches to `carrierErrorKind()`.

## Verification log

- 2026-09-10: unknown-code and expired-parcel shapes confirmed live; deep link
  confirmed in a browser session.
- 2026-08-24: success vocabulary confirmed against a real parcel by the
  prior-art client.
- 2026-09-11: ASCII-apostrophe delivered wording observed live.
- 2026-09-12: moved to `packages/carriers/carriers/poste-italiane/`; behavior
  unchanged apart from the error class names.
