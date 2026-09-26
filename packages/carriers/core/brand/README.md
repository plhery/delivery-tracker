# Brand

Carrier colours and truck marks. The web draws an SVG, the iPhone a SwiftUI `Canvas`; both read the
same data, and a parity test on each side fails when a drawing drifts.

| File | Owns |
| --- | --- |
| `carriers/<id>/carrier.json` → `brand` | `color`, and optionally `family`, `palette` and `decal` |
| [`palette.json`](palette.json) | default and fallback colours, the nine palette properties, and the `mix()` amounts that derive each from `brand.color` |
| [`truck.json`](truck.json) | truck geometry and the decal variants |

Only `brand.color` is part of the published contract; changing it regenerates the web and iOS
catalogs. `palette`, `family` and `decal` are brand-only. [`carrier.schema.json`](../catalog/carrier.schema.json) validates the block.

## Adding or changing a carrier

- A new carrier needs only `brand.color`. Take it from the carrier's logo SVG or website palette and
  record the source in [SOURCES.md](SOURCES.md).
- The nine palette properties are `surface-light`, `surface-dark`, `ink-light`, `ink-dark`,
  `brand-light`, `brand-dark`, `truck`, `edge`, `accent`. Anything not declared is mixed from
  `brand.color`. Override only for a second brand colour or for readability.
- Yellow trucks declare a dark `accent` and `brand-light` so labels and marks stay readable
  (see `swiss-post`, `la-poste`).
- Neutral gray is reserved for `unknown`; a test enforces it.
- Families: ids that share one identity (the GLS country folders) each declare `brand.family: "gls"`,
  and exactly one member (`gls-ch`) declares the `palette` and `decal`. The generator rejects a family
  that declares either twice and keys its output by carrier id, so clients never resolve families.
- Decals are small, simplified marks built from polygons, line segments and circles, never logo files
  or wordmarks (the iPhone draws the truck at 27 × 18 points). Add one under `decals.<name>` in
  `truck.json`, set `brand.decal`, and add the name to the outline test in `brand.test.ts`, which
  checks that `d` matches the points and that every shape stays inside the truck body.

## Shapes and paints

The two renderers need different primitives, so `truck.json` spells each shape both ways and the
tests check they match:

- a polygon has a `d` (drawn by the SVG) and `points` (filled by the canvas). Curves are flattened to
  short edges so both draw the same outline; reference aspect ratios are preserved.
- a stroked line has a `d` and `segments`. The default stripe is one segment 2 units wide.
- a paint is a `#rrggbb` literal or one of the nine property names, which the web resolves to
  `var(--carrier-<name>)` and the iPhone to the matching `CarrierVisualIdentity` colour.

## Generation

- `npm run contract:generate` runs [`generate-brand.mjs`](../../scripts/generate-brand.mjs) and writes
  `packages/carriers/generated/brand.ts` (palettes, decals, families, default colour, truck).
- `npm run ios:resources` writes the same payload plus the mix amounts to
  `ios/SwissDeliveryTracker/Resources/Brand.json`.
- `npm run test:contract` and `npm run ios:resources -- --check` fail when either output is stale.

## Parity tests

- Web: `src/lib/carrierBrand.ts` builds the nine CSS custom properties and
  `src/components/CarrierMark.tsx` renders `CARRIER_TRUCK`. `CarrierMark.test.tsx` compares DHL, UPS,
  GLS and a plain carrier against `carrierMark.fixture.json`, so any `truck.json` change that moves a
  pixel fails.
- iPhone: `CarrierBrandAssets` loads `Brand.json`, `CarrierVisualIdentity` resolves families and
  palettes, `CarrierFleetMark` draws decals, and `CarrierTruckGeometry` holds the base truck.
  `ios/SwissDeliveryTrackerTests/BrandParityTests.swift` checks the geometry against the shared data,
  every carrier identity, and that each decal draws visible paths inside the truck body.
