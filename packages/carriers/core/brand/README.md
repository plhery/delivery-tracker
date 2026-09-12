# Brand assets

One carrier identity, rendered twice. The web draws an SVG and the iPhone draws
a SwiftUI `Canvas`; both read the same data, and parity tests check their
palettes and drawings.

## What is data

| File | Owns |
|---|---|
| `carriers/<id>/carrier.json` → `brand` | the carrier's `color`, its `family`, an explicit `palette`, and which `decal` its truck wears |
| `core/brand/palette.json` | `DEFAULT_CARRIER_COLOR`, `FALLBACK_BRAND_COLOR`, the nine properties and the `mix()` amounts that derive each one from `brand.color` |
| `core/brand/truck.json` | the truck: body, cab, windshield, wheels and the decal variants |

`carrier.schema.json` validates the `brand` block. Only `brand.color` reaches
the published contract: changing it regenerates the web and bundled iOS catalogs.
`palette`, `family` and `decal` are brand-only keys.

### Families

Several carrier ids can share one identity — the three GLS country folders are
one brand. Each member declares `brand.family: "gls"`; exactly one of them
(`gls-ch`) declares the `palette` and `decal` the family wears. The generator
rejects a family that declares either twice, and keys its output by carrier id,
so no client has to know the rule.

### Palettes

A palette is nine colors: `surface-light`, `surface-dark`, `ink-light`,
`ink-dark`, `brand-light`, `brand-dark`, `truck`, `edge`, `accent`. Every
property is optional; whatever a carrier does not declare is mixed out of
`brand.color` with the amounts in `palette.json`. Several carriers declare overrides for a second brand color or a dark decoration
on a yellow truck. A new carrier needs only its color; see [SOURCES.md](SOURCES.md)
for the color references and custom decorations.

## Generation

`npm run contract:generate` runs `scripts/generate-brand.mjs`, which writes
`packages/carriers/generated/brand.ts`: `CARRIER_PALETTES`, `CARRIER_DECALS`,
`CARRIER_FAMILIES`, `DEFAULT_CARRIER_COLOR` and `CARRIER_TRUCK`, all keyed by
carrier id. `npm run ios:resources` renders the same payload, plus the mix
amounts, into `ios/SwissDeliveryTracker/Resources/Brand.json`.

`npm run test:contract` and `npm run ios:resources -- --check` fail when either
artifact is stale.

## How the parity tests work

**Web.** `src/lib/carrierBrand.ts` turns a carrier into the nine CSS custom
properties and `src/components/CarrierMark.tsx` renders `CARRIER_TRUCK`
attribute by attribute. `src/components/CarrierMark.test.tsx` compares the
rendered markup for a DHL, UPS, GLS and plain carrier against
`carrierMark.fixture.json`, captured from the hand-written SVG this data
replaced: any change to `truck.json` that would move a pixel fails there.

**iPhone.** `CarrierBrandAssets` loads `Brand.json` once. `CarrierVisualIdentity`
resolves families, palettes and mix amounts from it; `CarrierFleetMark` draws
its decal segments, polygons and circles. Adding an identity no longer requires
copying a palette or decoration into a Swift switch. The base truck remains
in `CarrierTruckGeometry`, checked against the shared geometry by
`ios/SwissDeliveryTrackerTests/BrandParityTests.swift`. Those tests also check
all carrier identities and ensure the decoded decorations produce visible
paths within the truck body.

Where the two renderers cannot share one primitive, `truck.json` carries both
spellings of the same shape and the parity test checks the relation between
them:

- an outline has a `d` (what the SVG draws) and `points` (the straight-line path
  the canvas fills). They describe the same outline, except for the UPS shield,
  whose curved `d` the canvas approximates with five points;
- a stroked decal has a `d` and `segments`. The default stripe is one segment
  `2` units wide, stroked by both clients.

A paint is either a `#rrggbb` literal or the name of one of the nine properties:
the web resolves the latter to `var(--carrier-<name>)`, the iPhone to the
matching `CarrierVisualIdentity` color.
