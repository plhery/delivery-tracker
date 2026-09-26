# Shared translations

`en`, `de`, `fr`, `it`, `es`, `pt` and `pl` JSON files are the source of all web and iOS
copy.

- Add or change a key in **all seven** files, keeping `{{variable}}` placeholders.
- The web imports them directly with typed keys. For iOS, run `npm run ios:resources`,
  which regenerates `Localization.json`. Don't edit the generated file or put strings in
  Swift views.
- `node scripts/generate-ios-resources.mjs --check` verifies key parity, placeholders,
  native references and generated output.

**Tone.** Informal and concise. Spanish and Portuguese are the European variants. Passport
collectibles are postage stamps (sellos, selos, znaczki). Polish counts use `.one`, `.few`
and `.many`, picked from `count`.

## Tracking messages

[`../tracking-messages.json`](../tracking-messages.json) maps the exact descriptions our
adapters and app generate to message keys and values. Web and iOS share it, and unknown
carrier text stays as written. Add new synthesized descriptions here rather than
classifying carrier wording in the UI. See [LOCALIZATION.md](../../docs/LOCALIZATION.md).

## Carrier errors

Typed carrier failures are stored as `carrier:<kind>` in `sync_error`, and the map picks
localized guidance for each. Unknown codes get generic copy. Full diagnostics stay in the
server audit. Only offer "edit input" when the carrier actually has editable inputs.
