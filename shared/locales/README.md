# Shared translations

`en.json`, `de.json`, `fr.json`, `it.json`, `es.json`, `pt.json`, and `pl.json` are the source of truth for web and iOS copy, including onboarding, parcel forms, settings, and Passport. Add or edit a key in all seven files; preserve `{{variable}}` placeholders.

The web imports these catalogs directly with typed message keys. Run `npm run ios:resources` after editing them to update the bundled iOS `Localization.json`. Do not edit the generated resource or put translated strings in Swift views. `node scripts/generate-ios-resources.mjs --check` checks locale parity, interpolation variables, native references, and generated output.

`shared/tracking-messages.json` maps exact app- and adapter-generated descriptions to shared message keys and interpolation values. Web and iOS use the same map; unrecognized carrier notes retain their original text. Add new synthesized descriptions here instead of classifying arbitrary carrier wording in the UI. Resource generation validates these keys and variables and copies the map to the native bundle.

Typed carrier failures use stable `carrier:<kind>` values in `sync_error`. The shared map selects localized guidance; unknown codes and legacy diagnostic strings use generic copy. Routing retains a safe failure code through deferred attempts, while full error diagnostics remain in the server audit. Only show an input-editing action when the configured carrier exposes editable requirements.

Spanish uses European Spanish and Portuguese uses European Portuguese. Keep the tone informal and concise, and use postage-stamp terms (sellos, selos, znaczki) for Passport collectibles. Polish integer counts use `.one`, `.few`, and `.many` forms; web and iOS select them from `count`, including callers using an existing `.many` key.
