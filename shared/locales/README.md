# Shared translations

`en.json`, `de.json`, `fr.json`, and `it.json` are the source of truth for web and iOS copy, including onboarding, parcel forms, settings, and Passport. Add or edit a key in all four files; preserve `{{variable}}` placeholders.

The web imports these catalogs directly with typed message keys. Run `npm run ios:resources` after editing them to update the bundled iOS `Localization.json`. Do not edit the generated resource or put translated strings in Swift views. `node scripts/generate-ios-resources.mjs --check` checks locale parity, interpolation variables, native references, and generated output.

Carrier scan descriptions are original carrier data and are not translated. App-created tracking events use shared message keys.
