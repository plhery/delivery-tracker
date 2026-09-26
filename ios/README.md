# iPhone app

A native SwiftUI app (not a web view) for iOS 18+, with a Share extension, Home Screen
widgets and Live Activities. It uses Liquid Glass on iOS 26 and materials on older
versions. It talks to the same authenticated `/api` as the web app.

## Run the demo

Open `SwissDeliveryTracker.xcodeproj` in Xcode 26, pick the `SwissDeliveryTracker` scheme
and an iPhone simulator, and run. The checked-in configuration starts in demo mode: no
account, network or Apple team needed. Refresh advances the fictional parcels, and Account
resets them.

## Connect to a server

Copy `Configuration/Local.xcconfig.example` to `Configuration/Local.xcconfig` (gitignored)
and set the API origin, Supabase URL and publishable key. Never put a service-role key,
APNs key, OAuth secret or SMTP credential in the app.

- Add `swissdeliverytracker://auth-callback` to the Supabase redirect allow list.
- Supabase is used only for sign-in. All parcel changes go through the API.
- Building from a temporary checkout? Copy `Local.xcconfig` into its `ios/Configuration/`
  first. Before installing an account build, check it with
  `node scripts/validate-ios-install.mjs /path/to/SwissDeliveryTracker.app`.
  `scripts/refresh-ios-app.sh` runs this for you and refuses unconfigured builds.
- The carrier catalog refreshes from `/api/carriers` (ETag-cached) at launch and on
  foreground, with the generated catalog bundled as offline fallback. New carriers don't
  need an app release.

## Signing for a device

1. Select your team for the app, `ShareExtension` and `DeliveryWidget` targets.
2. Register the three bundle ids (`com.plhery.SwissDeliveryTracker` and its extensions),
   or change them to your own.
3. Create the App Group, set `SDT_APP_GROUP_IDENTIFIER` in `Shared.xcconfig`, and enable
   it on all three targets.
4. Enable Push Notifications on the app id.
5. Create an APNs key and set `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` and
   `APNS_BUNDLE_ID` on the server. The bundle id must match the installed app.

`scripts/refresh-ios-app.sh` can also install with a free Personal Team. Apple doesn't
allow App Groups or push there, so the widget can't read parcels and Live Activities don't
update while the app is closed. Sign in with Apple also needs a paid team
([AUTHENTICATION.md](../docs/AUTHENTICATION.md)).

## Notifications, widgets, Live Activities

- The app asks for notification permission only after the user taps Enable (from a small
  prompt above the tab bar, or from Account). The device token goes to the API and isn't
  stored locally. Debug builds use the APNs sandbox and Release builds use production.
- **Live Activities** have their own setting and don't need alert permission. The server
  starts one at `out_for_delivery`, updates it, and ends it with the outcome, for up to two
  parcels. Sign-out, account deletion or turning the setting off ends them and removes the
  registration.
- **The widget** shows the next parcel and up to two out-for-delivery parcels. Tapping one
  opens it.

## Resources and tests

After changing the API contract, carriers or copy:

```bash
npm run contract:generate   # Swift models and catalog from contracts/openapi.json
npm run ios:resources       # translations, message map, analytics catalog
```

Build from `ios/`:

```bash
xcodebuild -project SwissDeliveryTracker.xcodeproj -scheme SwissDeliveryTracker \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Use a real simulator destination and `test` instead of `build` to run the unit tests. APNs
itself needs a signed build on a device.

Analytics (optional) follows [ANALYTICS.md](../docs/ANALYTICS.md). Simulator and demo
builds never send events.
