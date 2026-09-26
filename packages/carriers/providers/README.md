# Universal providers

Aggregators used for fallback tracking and carrier discovery when no dedicated adapter
answers. They are not carriers a user can select. [universal.ts](universal.ts) owns the
factories, the order and the persisted names.

| Provider | Retrieval | Steps | Strength |
| --- | --- | --- | --- |
| [Ship24](ship24/README.md) | Signed anonymous JSON POST, local Chromium recovery | `direct`, `browser` | Fast, broad, carrier hints |
| [ParcelsApp](parcelsapp/README.md) | Anonymous form POST with postcode, TRAWL recovery | `direct`, `retry`, `trawl` | Fuller histories, destination legs |
| [17TRACK](seventeentrack/README.md) | TRAWL capture (compatibility build) | `trawl` | Per-leg multi-operator histories |
| [Postal Ninja](postal-ninja/README.md) | TRAWL widget, then results page. Local Chromium is compact-only | `trawl` or `browser` | Alternative full histories (opt-in) |
| [UPU](upu/README.md) | Anonymous JSON GET | `direct` | Cheap last-resort postal history |

Default order: **Ship24 → ParcelsApp → 17TRACK → UPU**.
`TRACKING_ENABLE_POSTAL_NINJA=true` adds Postal Ninja before 17TRACK. UPU needs a
checksum-valid S10 number and always stays last. Checksum-valid China Post `C…CN` and
`L…CN` numbers start with 17TRACK. Affinity, cooldowns and budgets are in
[docs/ROUTING.md](../../../docs/ROUTING.md). [COMPARISON.md](COMPARISON.md) explains the
order, and [COVERAGE.md](COVERAGE.md) compares results carrier by carrier.

## Shared behaviour

- `UniversalTracker.fetch()` tries providers in order until one succeeds, otherwise it
  throws `UniversalTrackingError` with every failure. Production routing calls
  `fetchSource()` per provider under its own policy.
- Numbers are uppercased with spaces, dots and dashes removed, and must match
  `^(?=.*\d)[A-Z0-9]{4,40}$`. Every result must be bound to the requested number.
- The parcel's stored postcode is passed to every provider, but only ParcelsApp uses it.
  Routing also passes the zone of the parcel's carrier. It is used only for scans with no
  trustworthy zone of their own.
- UI notices (postcode or country prompts, sign-in requests, "no information") never
  become events. A result made only of input prompts raises `input_required`.
- Privacy: a non-delivered event that mentions a PIN, access code, door number or
  signature is dropped, and a delivered event's text becomes `Delivered`. Recipient
  fields are never read.
- One wording-to-stage vocabulary serves all providers. Unmatched wording stays
  `pending` and never inherits the shipment's stage.
- Reported carrier names are hints. Routing may try that carrier's adapter, but only that
  adapter confirming the shipment adopts the carrier.
- Persisted names (`Ship24`, `ParcelsApp`, `17TRACK`, `Postal Ninja`, `UPU`) are stored
  in routing state and drive displayed links. Don't rename them.

## Shared implementation

- [shared/result.ts](shared/result.ts): input normalization, event construction, notice
  and privacy filters, wording classification, history projection.
- [shared/hints.ts](shared/hints.ts): reported carrier names to catalog ids, and whether
  a name is new to the catalog.
- [shared/capture.ts](shared/capture.ts): TRAWL response decoding and capture errors.
- [core/runner](../core/runner/index.ts) runs steps and records telemetry.
  [core/errors](../core/errors/index.ts) holds the shared failure categories.

`TrackingCaptureError` and the `SeventeenTrack*Error` classes carry diagnostic
`reason`/code fields. Follow [docs/OBSERVABILITY.md](../../../docs/OBSERVABILITY.md).
TRAWL build and session-cache settings live in [ops/trawl](../../../ops/trawl/README.md).

## Adding or changing a provider

- Keep the adapter, parser tests, synthetic fixtures and one README in its folder.
- Add the name to `UniversalSource` in `shared/result.ts` and register the factory in
  `universal.ts`. Add the name to the `tracking_provider_health` provider check
  constraint with a Supabase migration.
- Change the default order only with evidence, and record it in
  [COMPARISON.md](COMPARISON.md).
- Run the package checks and routing tests.
