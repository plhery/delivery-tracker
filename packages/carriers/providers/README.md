# Universal providers

Providers supply fallback tracking and carrier discovery; they are not
selectable carriers. [universal.ts](universal.ts) owns their factories and
persisted names. Protocol details live in each provider README.

| Provider | Implementation | Steps |
| --- | --- | --- |
| [Ship24](ship24/README.md) | Signed anonymous JSON POST, local Chromium recovery | `direct`, `browser` |
| [ParcelsApp](parcelsapp/README.md) | Anonymous form POST with postcode; TRAWL capture recovery | `direct`, `trawl` |
| [17TRACK](seventeentrack/README.md) | TRAWL capture with the compatibility build | `trawl` |
| [Postal Ninja](postal-ninja/README.md) | Local Chromium widget submission; opt-in | `browser` |
| [UPU](upu/README.md) | Anonymous JSON GET; final postal fallback | `direct` |

The initial order is **Ship24 → ParcelsApp → 17TRACK → UPU**.
`TRACKING_ENABLE_POSTAL_NINJA=true` inserts Postal Ninja before 17TRACK.
UPU is eligible only for checksum-valid postal S10 numbers and always stays
last: success never gives it affinity or a place in shadow comparisons.
Checksum-valid China Post `C…CN` and `L…CN` references instead start with 17TRACK,
whose richer history was verified through the existing unattended adapter.
EMS and untested number families keep their existing routes. The router applies
this priority before saved fallback affinity, while respecting cooldowns.

[Provider tradeoffs and dated comparisons](COMPARISON.md) explain coverage,
latency, history, timestamps, browser dependencies and the China Post/EMS/UPU
alternatives. That evidence motivates the order; it is not a reliability SLA.

`UniversalTracker.fetch()` calls providers until one returns successfully and
aggregates failures in `UniversalTrackingError` if none do. Production
[tracking routing](../../../docs/tracking-routing.md) calls `fetchSource()`
with its own eligibility, affinity, cooldowns and budget. Keep that policy
there rather than copying it into provider docs. Persisted provider names also
drive displayed links and must remain compatible with saved parcel state.

The host forwards the parcel's stored delivery postcode into every provider's
track input. ParcelsApp submits it as `extra[zipcode]` in its direct request;
the other providers do not consume it. Input prompts remain notices, never
shipment scans. See the ParcelsApp README for the observed limits of postcode
validation and the remaining need for a known valid gated pair.

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
