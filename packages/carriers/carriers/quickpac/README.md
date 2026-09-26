# Quickpac

Swiss parcel service for private addresses. Its `44…` numbers are tracked
through Planzer's API and public page, so `tracking.adapter` is `planzer` and
there is no adapter here. See [planzer](../planzer/README.md) for how it works.

- The `quickpac` id is kept for detection, display and stored parcels; merging
  it into `planzer` would be a data migration with no user-visible gain.
- Not used: Quickpac's own legacy endpoint — it no longer serves these numbers.
- `statuses.json` repeats Planzer's vocabulary; keep the two in step.
- Before the Planzer API knows a new parcel, ParcelsApp may already show
  Quickpac's pre-advice "Shipment recorded by sender (data delivered)"; the
  shared wording rules read it as `registered`, not a delivery.
