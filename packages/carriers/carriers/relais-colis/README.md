# Relais Colis

Tracks French pickup-point parcels through the public recipient form.

## Retrieval

Each lookup opens the form in its own cookie session, then posts its CSRF token
and the requested number. The successful page identifies the parcel in its
"Votre colis" banner and clears the search field. Each stage can contain several
scan boxes; every box becomes an event in the displayed order.

Only the matching form's explicit no-history message proves absence. Redirects,
endpoint errors and invalid sessions remain inconclusive. Both requests share
one lookup budget and caller cancellation.

## Normalization

Scan sentences supply the status. Paris wall clocks become timestamps; date-only
or invalid clocks remain unresolved history. Unfamiliar current wording cannot
borrow an older delivery state. Planned or ongoing returns are not terminal. Address and recipient containers are discarded
before extracting scan fields.

## Limitations

The adapter returns history without pickup-point details or a delivery estimate.

## Live test

Supply `RELAIS_COLIS_TRACKING_NUMBER` and optionally `RELAIS_COLIS_UNKNOWN_NUMBER`
outside the repository, then run:

```sh
npm run test:carriers:live -- packages/carriers/carriers/relais-colis/adapter.live.test.ts
```
