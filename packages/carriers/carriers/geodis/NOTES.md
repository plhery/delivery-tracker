# GEODIS notes

## Decisions

- The anonymous recipient endpoint is called directly rather than driving the
  SPA: the signature is a pure function of the request, so one bounded `POST`
  with no session replaces a browser. One `direct` step.
- The signing material (`appKey;appId;timestamp;language;apiPath;body`) is
  reproduced verbatim and covered by a fixed-timestamp test, so a change in the
  scheme fails a unit test instead of silently returning nothing.
- `PUBLIC_SPA_APP_KEY` stays in the source with a comment: it is a public client
  identifier shipped in the recipient SPA, not an account credential, and it can
  rotate when that frontend is deployed.
- Ordering of the wording rules is the design, not an accident. "En cours de
  livraison" and "va être livré" both contain the participle, so the
  out-for-delivery and future-delivery groups are matched first, and the
  delivered rules are anchored (sentence start, "a été livré", or a parcel noun
  before the participle) rather than a bare substring.
- Explicit booleans win over wording: `etatLivre` / `etatRetire` force
  `delivered`, `finDeVie` forces `exception` when nothing said delivered. The
  estimate is dropped once any of them is set.
- Times stay display strings. The endpoint sends a calendar day per group and a
  wall clock per scan with no offset; building an instant would guess a zone, so
  the UTC-based number is only a sort key.
- 2026-09-12: an `ok: false` whose `codeErreur` is not a recognizable "envoi non
  trouvé" now raises `IndeterminateError` instead of a bare `Error`. A technical
  rejection is not evidence that a shipment is absent, and the runner must not
  let it look like one.
- 2026-09-12: unmapped wording no longer defaults to `in_transit`. The scan is
  returned with no stage so the sync classifies it and records it for review.

## Rejected alternatives

- Retaining `expediteur.nom`: `PRIVACY.md` allows a sender name when it is a
  business, but this endpoint returns the consignor of a freight movement next to
  its address, and the adapter has no way to tell the two apart. Dropped
  wholesale; no `sender_name` capability is declared.
- Keeping `listInformationsComplementaires`: it is free text written for the
  recipient and regularly contains access instructions. Never retained.
- Following `listImagesBordereauxLivr`: proof-of-delivery documents are exactly
  what `PRIVACY.md` forbids.
- Mapping `finDeVie` to `returned`: it means "end of life for this shipment
  record", which covers returns, write-offs and closures alike. `exception` is
  the honest stage.

## Verification log

- 2026-09-12: moved from `src/server/geodis.ts` into this folder. Parse failures
  now raise `SchemaError`; `GeodisTrackingError` now extends `NotFoundError` and
  keeps its name because the grouped live suite matches on it.
- 2026-09-12: signature vector `geodisServiceHeader('1G123GEODIS0',
  1735689600123)` is pinned in the offline test; a change in the SPA's scheme
  breaks it immediately.
