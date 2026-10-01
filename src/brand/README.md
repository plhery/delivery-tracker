# Carrier visual identity

`identities.json` owns the app's carrier families, explicit palettes and decals.
Catalog colours come from Universal Parcel Scraper. `palette.json` defines fallback
colours and palette mixing; `truck.json` defines the shared truck geometry.

`scripts/generate-brand.mjs` writes `src/generated/brand.ts`. The iOS resource generator
uses the same data for `Brand.json`. Web and native parity tests check their rendering
inputs. Run `npm run contract:generate` and `npm run ios:resources` after editing them.

Several carrier IDs can share a family. Exactly one family member declares each explicit
palette or decal; other members only name the family. See [sources](SOURCES.md).
