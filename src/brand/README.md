# Visual identity

## The mark

`mark.json` holds the app's mark: two eyes on a yellow tile, one drawing for every size.
`PeekMark` draws it on the web; `PeekMarkArtwork.swift` holds the same shapes for the iPhone
app, its widget and its Share extension, so edit both together. `npm run icons` draws the
icon files in `public/icons`, the iOS app icon and the link previews: `public/og.png` from
`public/og.svg`, and one `public/og-<language>.png` per other language, with the words of
`shared/locales`. It also writes their versions to `src/lib/peekPictures.json`. Run it
after editing the mark, the preview or its words.

`public/og.svg` is drawn by hand: it holds its own copy of the mark, of Pip and of the
five trucks it shows, so redraw them there when they change. Every page shares this
picture unless it draws its own, as a shared parcel, the sample and an invitation do.

The eyes belong to the mark alone: the name beside it is set in plain type, and Pip, the
parcel with a face, is a separate drawing.

## Carriers

`identities.json` owns the app's carrier families, explicit palettes and decals.
Catalog colours come from Universal Parcel Scraper. `palette.json` defines fallback
colours and palette mixing; `truck.json` defines the shared truck geometry.

`truck.json` spells every outline twice: `d` for the web's SVG, and `points` or `segments`,
the same outline in straight lines, for the iPhone app's canvas.

`scripts/generate-brand.mjs` writes `src/generated/brand.ts`, which leaves `points` and
`segments` out so the browser does not download them. The iOS resource generator writes
the whole data to `Brand.json`. Web and native parity tests check their rendering
inputs. Run `npm run contract:generate` and `npm run ios:resources` after editing them.

Several carrier IDs can share a family. Exactly one family member declares each explicit
palette or decal; other members only name the family. See [sources](SOURCES.md).
