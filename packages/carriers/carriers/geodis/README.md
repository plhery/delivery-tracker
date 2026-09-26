# GEODIS

French express and distribution network. Covers the anonymous recipient lookup ("Espace
destinataire") for French last-mile `1G…` shipments. Freight and account portals are out of
scope.

## How it works

1. `direct`: one bounded signed
   `POST https://espace-client.geodis.com/services/api/destinataire/recherche-envoi-anonyme`
   with the exact body `{"noSuivi":"…"}`. No session; the signature replaces a browser.
   - `X-GEODIS-Service` is `appId;timestamp;language;sha256(appKey;appId;timestamp;language;apiPath;body)`,
     as the recipient SPA computes it. A fixed-timestamp unit test covers the scheme.
   - `ok: false` with a "envoi non trouvé" `codeErreur` is not-found. Any other `ok: false`
     is `IndeterminateError`: a technical rejection does not prove the shipment is absent.
   - `contenu.noSuivi` must equal the requested number.
   - Events come from `listJoursSuivis[].suivis[]`, de-duplicated on time, location and
     description, newest first, capped at 100.

## Notes

- `PUBLIC_SPA_APP_KEY` is a public client identifier shipped in the recipient SPA, not an
  account secret. It can rotate when GEODIS deploys the frontend; requests then fail loudly.
- `GeodisTrackingError` is a plain `NotFoundError` kept as a named class because
  `src/server/frenchDirectCarriers.live.test.ts` matches on its name.
- Status is wording-only (no codes). Rule order matters: "en cours de livraison" and "va être
  livré" contain the participle, so out-for-delivery and future-delivery rules run first, and
  delivered rules are anchored (sentence start, "a été livré", or a parcel noun before it).
- Unmapped wording keeps its text and gets no stage, so the sync classifies it.
- The active timeline step's label is the current status text, falling back to the newest
  scan. Terminal booleans override the wording: `etatLivre` / `etatRetire` force `delivered`,
  `finDeVie` forces `exception`. `finDeVie` is not `returned` — it also covers write-offs and
  closures. The estimate is dropped once any of them is set.
- Times are display strings (`DD/MM/YYYY HH:mm:ss`) kept verbatim: the endpoint sends no
  offset, so no instant is invented. A UTC-based number is used only as a sort key.
- Only status, timeline, `libelleCentre` (location) and the planned date are read. Sender and
  recipient blocks, `listInformationsComplementaires` (free-text access instructions) and
  delivery documents are never retained; a test asserts it. `expediteur.nom` is dropped because
  it does not distinguish businesses from private senders.

## Testing

`npm run test:carriers:live -- src/server/frenchDirectCarriers.live.test.ts` (no env vars). It
asserts a validly shaped unknown `1G…` number returns not-found.
