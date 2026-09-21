# Posti

The dedicated adapter uses the anonymous consumer GraphQL flow behind
[Posti's public tracker](https://www.posti.fi/en/tracking). It covers Finnish
delivery of foreign-issued postal identifiers as well as explicit Posti
lookups. A foreign S10 suffix still identifies the issuer; it is not evidence
that Posti handles a shipment. Number-only detection is unchanged.

## Retrieval

1. A bare `POST https://auth-service.posti.fi/api/v1/anonymous_token` obtains
   an anonymous role token and an ID token.
2. `POST https://graphql.posti.fi/graphql` runs `SearchShipments` with
   `PUBLIC_SHIPMENTS`, the requested identifier, and English locale. The role
   token goes in `Authorization`, the ID token in `X-Posti-Token: Bearer …`.

No browser, login, cookie, API key, or page bootstrap is needed. Sessions are
cached until the earlier token expiry, with a 30-second margin. An HTTP 401/403
from the query, or GraphQL `Unauthorized`, refreshes the anonymous session
once. Bootstrap, lookup and refresh share one cancellable 15-second budget.
Throttling, parser failures and other GraphQL errors do not trigger retries.

The query, projection and limits are maintained in [adapter.ts](adapter.ts).
It selects tracking fields, measurements and the public pickup-point name;
recipient addresses, pickup credentials and payment fields are not requested.
Returned `displayId` must match exactly. Duplicate matches and multi-parcel
overviews are rejected. Only an error-free `totalHits: 0` with empty `hits`
means not found; partial or malformed responses remain failures.

## Status and time

[status.ts](status.ts) maps Posti's parcel-level enums independently from each
event's English label. Pickup availability is not delivery; transport back to
the sender is not a completed return. Explanatory `reasonDescription` text is
displayed but never used to classify an event. Notification/pre-advice rows
and unmapped labels do not prove movement. Unknown main codes remain unknown.

Only timestamps with explicit offsets are accepted. Missing or ambiguous
times stay unset. Measurements require known units and positive finite values.
The main status remains authoritative even when the corresponding scan is
absent; historical events never inherit the current parcel status.

## Sources and verification

- Prior protocol lead: [hatlabs/posti-cli](https://github.com/hatlabs/posti-cli/blob/12cdda2e34e011111bfedc2ef721d0dce3902d07/src/posti_cli/core/tracking.py),
  revision `12cdda2e34e011111bfedc2ef721d0dce3902d07` (MIT). Used for endpoint
  discovery; implementation and fixtures here were written independently.
- 2026-09-21: observed the current public browser flow, including the
  `SearchShipments` request and the anonymous-token exchange. Main status enums
  come from Posti's [public parcels bundle](https://cdn.posti.fi/omaposti/parcels/public/remoteEntry.js).
- 2026-09-21: fresh automated local HTTP retrieval succeeded for the existing
  public corpus example; a synthetic unknown identifier produced zero hits.
  Offline tests use only synthetic identifiers, places, dates and measurements.
  This verifies local retrieval, not deployed network compatibility.

Run the opt-in [live tests](adapter.live.test.ts) through
`npm run test:carriers:live -- packages/carriers/carriers/posti/adapter.live.test.ts`.
Additional authorized inputs can be supplied through `POSTI_TRACKING_NUMBER`.
