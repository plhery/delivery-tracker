# Universal providers

Providers supply fallback tracking and carrier discovery; they are not
selectable carriers. [universal.ts](universal.ts) owns their factories and
persisted names. Protocol details live in each provider README.

| Provider | Implementation | Steps |
| --- | --- | --- |
| [Ship24](ship24/README.md) | Signed anonymous JSON POST, local Chromium recovery | `direct`, `browser` |
| [ParcelsApp](parcelsapp/README.md) | TRAWL API capture or identity-bound rendered result | `trawl` |
| [17TRACK](seventeentrack/README.md) | TRAWL capture with the compatibility build | `trawl` |
| [Postal Ninja](postal-ninja/README.md) | Local Chromium widget submission; opt-in | `browser` |

The initial order is **Ship24 → ParcelsApp → 17TRACK**.
`TRACKING_ENABLE_POSTAL_NINJA=true` inserts Postal Ninja before 17TRACK.
Its browser widget has dated success evidence; its direct signed protocol
remains unverified. Ship24's initial preference comes from the September 10
production samples, not a comprehensive reliability benchmark.

`UniversalTracker.fetch()` calls providers until one returns successfully and
aggregates failures in `UniversalTrackingError` if none do. Production
[tracking routing](../../../docs/tracking-routing.md) calls `fetchSource()`
with its own eligibility, affinity, cooldowns and budget. Keep that policy
there rather than copying it into provider docs. Persisted provider names also
drive displayed links and must remain compatible with saved parcel state.

## Shared implementation

- [shared/result.ts](shared/result.ts): input normalization, event construction,
  notice filtering, wording classification and history projection.
- [shared/hints.ts](shared/hints.ts): reported carrier names to catalog ids;
  hints do not themselves confirm a new carrier.
- [shared/capture.ts](shared/capture.ts): TRAWL response decoding and capture errors.
- [core/runner](../core/runner/index.ts): step execution and telemetry;
  [core/errors](../core/errors/index.ts): shared failure categories.

`TrackingCaptureError`, `SeventeenTrackLookupError` and
`SeventeenTrackVerificationError` additionally carry diagnostic reason/code
fields. Follow the host's [observability policy](../../../docs/OBSERVABILITY.md).
Browser build and session-cache configuration belongs in
[ops/trawl](../../../ops/trawl/README.md).

## Adding or changing a provider

Keep its adapter, parser tests, fixtures and one README together. Register the
factory in `universal.ts`; update the default order only with evidence for the
intended environment. Record protocol sources, non-obvious choices and dated
verification in that README. Run the package checks and routing tests; assess
compatibility with persisted provider names before renaming one.
