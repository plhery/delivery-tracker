# Relais Colis notes

## Decisions

- **One cookie jar per lookup, no single-flight gate.** The CSRF token is bound
  to the session that issued it, and this adapter creates a fresh `CookieJar`
  inside `fetch()`. Two concurrent lookups therefore never share or invalidate
  one another's token, so `singleFlight()` from `core/runner` would only add
  latency. It becomes necessary the day the session is hoisted to the adapter
  instance.
- **Remove the address blocks before reading anything.** `.follow-address`,
  `.follow-address-box`, `[data-recipient]` and `[data-delivery-address]` are
  stripped from the document, together with `script`/`style`/`noscript`, before
  a single string is read. Filtering after extraction would depend on every
  future selector being right; removing first fails safe.
- **Keep the provider's sentence as the description.** Relais Colis writes one
  readable French sentence per step and no code. That sentence is the status a
  human sees and carries no personal data, so it is retained verbatim and the
  map only decides the stage — the opposite choice from Ciblex, where the labels
  are inconsistent shouty fragments.
- **Pickup before delivery in the map.** The network's vocabulary reuses
  "relais" across several stages ("disponible dans votre relais", "livraison
  dans votre relais"), so the pickup and out-for-delivery rules are tested
  before the delivery ones.
- **A redirect is the wrong-number answer.** The POST is sent with
  `redirect: 'manual'`; a 3xx means the form bounced the number rather than that
  the parcel moved, so it maps to not-found instead of being followed.
- **`RelaisColisTrackingError` survives as a subclass.** It now extends
  `NotFoundError` (kind `not_found`, status 404, same message) but keeps its
  name, because the grouped live canary in
  `src/server/frenchDirectCarriers.live.test.ts` matches on it.

## Rejected alternatives

- **Hoisting the session to the tracker instance.** It would save one GET per
  lookup but needs a single-flight gate and an invalidation path for expired
  tokens; the current cost is one cheap HTML request.
- **Retaining the pickup point's name.** PRIVACY.md allows it, but on this page
  the pickup block also carries its address and opening details in the same
  container, and the container is what gets removed. Extracting only the name
  would mean reading inside a block we deliberately delete first.
- **Translating the step sentences into our own wording.** It would lose the
  nuance the network uses to distinguish "waiting in your relais" from "on its
  way to your relais", which recipients rely on.

## Verification log

- 2026-09-12: moved from `src/server/relaisColis.ts` into this folder with its
  offline tests. The live canary stays in the grouped
  `src/server/frenchDirectCarriers.live.test.ts` and was not modified.
- 2026-09-12: `RelaisColisTrackingError` re-based on `NotFoundError` with its
  name preserved; identifier, history and CSRF errors → `SchemaError`; the empty
  body → `IndeterminateError`. Tracking-number format errors stay `TypeError`.
- 2026-09-12: constructor takes an options object (`timeoutMs`, `fetcher`); the
  fetcher, when supplied, is what the cookie jar wraps.
