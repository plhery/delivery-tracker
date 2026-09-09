# Shared translations

`en.json`, `de.json`, `fr.json`, `it.json`, `es.json`, `pt.json`, and `pl.json` are the source of truth for web and iOS copy, including onboarding, parcel forms, settings, and Passport. Add or edit a key in all seven files; preserve `{{variable}}` placeholders.

The web imports these catalogs directly with typed message keys. Run `npm run ios:resources` after editing them to update the bundled iOS `Localization.json`. Do not edit the generated resource or put translated strings in Swift views. `node scripts/generate-ios-resources.mjs --check` checks locale parity, interpolation variables, native references, and generated output.

Carrier scan descriptions are original carrier data and are not translated. App-created tracking events use shared message keys.

Spanish uses European Spanish and Portuguese uses European Portuguese. Keep the tone informal and concise, and use postage-stamp terms (sellos, selos, znaczki) for Passport collectibles. Polish integer counts use `.one`, `.few`, and `.many` forms; web and iOS select them from `count`, including callers using an existing `.many` key.
