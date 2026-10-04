# iPhone app

Peek on the iPhone is a native SwiftUI app (not a web view) for iOS 18+, with a Share
extension, Home Screen widgets and Live Activities. It uses Liquid Glass on iOS 26 and
materials on older versions. It talks to the same `/api` as the web app: signed in, or without an account through the
public parcel links, whose owner keys it keeps in the keychain.

## Run the demo

Open `PeekDeliveryTracker.xcodeproj` in Xcode 26, pick the `PeekDeliveryTracker` scheme
and an iPhone simulator, and press Run. That's it: the checked-in configuration starts in
demo mode, so you need no account, no network and no Apple team. Refresh moves the
made-up parcels along, and Account resets them.

One thing that may look odd: the bundle ids, the app group and the URL scheme still say
`SwissDeliveryTracker`, the app's first name. That's on purpose. To iOS those names *are*
the app, so changing them would sign everyone out and break the links already out there.

## Connect to a server

Copy `Configuration/Local.xcconfig.example` to `Configuration/Local.xcconfig` (gitignored)
and set the API origin, Supabase URL and publishable key. Never put a service-role key,
APNs key, OAuth secret or SMTP credential in the app.

- Add `swissdeliverytracker://auth-callback` to the Supabase redirect allow list.
- Supabase is used only for sign-in. All parcel changes go through the API.
- Building from a temporary checkout? Copy `Local.xcconfig` into its `ios/Configuration/`
  first. Before installing an account build, check it with
  `node scripts/validate-ios-install.mjs /path/to/PeekDeliveryTracker.app`.
  `scripts/refresh-ios-app.sh` runs this for you and refuses unconfigured builds.
- The carrier catalog refreshes from `/api/carriers` (ETag-cached) at launch and on
  foreground, with the generated catalog bundled as offline fallback. New carriers don't
  need an app release.

## Links that open in the app

Parcel links (`/p/…`) and invitations (`/i/…`, `/invite`) open in the app when it is
installed. Two things make that work, both set in `Configuration/Shared.xcconfig`:

- **Associated Domains** (`SDT_ASSOCIATED_DOMAIN`, `SDT_ASSOCIATED_DOMAIN_LEGACY`) tell iOS
  which hosts hand their links to the app. Each host must serve
  `/.well-known/apple-app-site-association` naming this app
  ([DEPLOYMENT.md](../docs/DEPLOYMENT.md)).
- **Accepted hosts**: the app opens a link only from the host of `SDT_API_BASE_URL` or from
  `SDT_LINK_HOSTS`, the hosts the site answered on before. It never calls those hosts and
  never shares a link on them.

Elsewhere, `swissdeliverytracker://p/<id>` and `swissdeliverytracker://invite#<key>` open
the same screens.

A parcel's detail shares the parcel through such a link, built on the host of
`SDT_API_BASE_URL`. The name, a gift's note and who it is from travel after the link's `#`:
they stay on the device and never reach the API. In the demo the link is made up and leads
nowhere.

## Signing for a device

1. Select your team for the app, `ShareExtension` and `DeliveryWidget` targets.
2. Register the three bundle ids (`com.plhery.SwissDeliveryTracker` and its extensions),
   or change them to your own.
3. Create the App Group, set `SDT_APP_GROUP_IDENTIFIER` in `Shared.xcconfig`, and enable
   it on all three targets.
4. Enable Push Notifications, Associated Domains and App Attest on the app id.
5. Create an APNs key and set `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` and
   `APNS_BUNDLE_ID` on the server. The bundle id must match the installed app.

`scripts/refresh-ios-app.sh` can also install with a free Personal Team. Apple doesn't
allow App Groups, push or Associated Domains there, so the widget can't read parcels, Live
Activities don't update while the app is closed, and links open in the browser first: the
invitation page then offers "Open in the iOS app". Sign in with Apple also needs a paid
team ([AUTHENTICATION.md](../docs/AUTHENTICATION.md)). App Attest also needs a
paid team. The Personal Team project disables it and uses Turnstile for anonymous
lookups instead. No paid Cloudflare account is needed.

New anonymous lookups verify silently with App Attest when the server enables it.
Otherwise a small Turnstile sheet appears when needed; its proof lasts fifteen
minutes in memory. Cancelling keeps the form intact. Saved parcels and local
carrier detection do not need a check. Debug uses development App Attest keys,
Release uses production keys; only a separate development server accepts the
former. Server settings are in [DEPLOYMENT.md](../docs/DEPLOYMENT.md).

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
- **The delivery email** belongs to the account, not the device. Settings › Delivery updates
  has its switch, which saves the moment it is flipped. While it is on, the bell of a parcel
  still on its way opens that parcel's alerts, where notifications and the email are switched
  for it alone. A delivered parcel offers the email once to an account that has never chosen.
  None of this shows unless the server says it can email the account, and never in the demo.

## Resources and tests

After changing the API contract, carriers or copy:

```bash
npm run contract:generate   # Swift models and catalog from contracts/openapi.json
npm run ios:resources       # translations, message map, analytics catalog, map data
```

Build from `ios/`:

```bash
xcodebuild -project PeekDeliveryTracker.xcodeproj -scheme PeekDeliveryTracker \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

To run the unit tests, swap `build` for `test` and name a real simulator, for example
`-destination 'platform=iOS Simulator,name=iPhone 17 Pro'`. Push itself can only be tried
with a signed build on a real phone.

Analytics (optional) follows [ANALYTICS.md](../docs/ANALYTICS.md). Simulator and demo
builds never send events.
