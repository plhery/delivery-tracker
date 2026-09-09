<p align="center">
  <img src="public/icons/icon-192.png" width="96" alt="Delivery Tracker logo">
</p>

<h1 align="center">Delivery Tracker</h1>

<p align="center">
  A new home for your packages.
</p>

<p align="center">
  <a href="https://github.com/plhery/swiss-delivery-tracker/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/plhery/swiss-delivery-tracker/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://delivery.plhery.com"><img alt="Public instance" src="https://img.shields.io/badge/try%20it-delivery.plhery.com-ffcf00"></a>
</p>

<p align="center">
  <strong><a href="https://delivery.plhery.com">Open the public instance →</a></strong>
</p>

![The web app’s compact deliveries feed, with a carrier-colored Next up card, a customs notice, and recent arrivals](docs/screenshot.jpg)

Delivery Tracker gives your packages a home on iPhone and the web. Small carrier
trucks and familiar brand colors make each delivery easy to recognize. A stamped
**Next up** card highlights the next arrival or pickup, compact notices surface
tracking issues, and past deliveries stay together with the latest first.

<p align="center">
  <img src="docs/screenshot-ios.png" width="240" alt="Native iPhone deliveries screen with compact notices, a stamped Next up card, and a quiet archive row">
  <img src="docs/screenshot-detail.jpg" width="240" alt="Mobile web parcel detail showing its carrier, tracking number, and tracking history">
  <img src="docs/screenshot-passport.jpg" width="240" alt="Mobile web Passport with collectible stamps and delivery statistics">
</p>

<p align="center"><sub>Native iPhone deliveries · Mobile web tracking history · Delivery Passport. All screenshots use fictional demo parcels.</sub></p>

## What it does

- Gives the parcel name priority, with a readable ETA when one is available.
- Keeps search and filters tucked away until needed, with swipe-to-archive on cards.
- Shows the tracking number, carrier website, and a clear timeline when you open a parcel.
- Collects twelve Passport stamps and shows statistics from your delivery history.
- Lets friends exchange invitations and choose which delivery statistics to share.
- Tracks supported carriers automatically and links out gracefully for the rest.
- Checks active deliveries every 10 minutes from 08:00 to 22:00, and hourly overnight.
- Understands tracking numbers, carrier URLs and text pasted from shipping emails, with
  one-tap paste on web and barcode scanning on iPhone.
- Keeps delivery history in sync across your devices.
- Sends optional browser and native iPhone notifications without putting tracking numbers in them.
- Shows up to two delivery-day Live Activities only while parcels are out for delivery,
  then keeps the final outcome visible briefly before dismissing it.
- Includes a native SwiftUI iPhone app and Share extension, plus an installable PWA.
- Uses Supabase Auth and Postgres row-level security to isolate every account.

## Carrier coverage

The shared carrier picker includes Swiss Post, Swiss Post
Cargo, Quickpac, Planzer, DPD Switzerland, GLS Switzerland, UPS, Cainiao /
AliExpress, SunYou, Hermes Einrichtungs-Service, PostNL, PostLogistics and
Dachser, plus DPD France, Mondial Relay, Relais Colis, La Poste / Colissimo,
Chronopost, GLS France, Colis Privé, GEODIS, Colisweb, C Chez Vous, Heppner,
Ciblex, Paack and DHL / Deutsche Post (German parcels and tracked mail).
Asendia and FedEx use carrier links; ShipUp stays
available as a manual record. Tracking credentials stay private to your account.

The full [carrier list and caveats](docs/CARRIERS.md) are documented separately.

## Native iPhone app

The native SwiftUI target lives in [`ios/`](ios/README.md). It mirrors the web
app’s compact delivery cards, carrier colors, tracking timeline, Passport, and
Friends. It includes authentication, carrier parsing, search/filter/sort,
notification preferences, archive, guarded direct parcel deletion, account
export/deletion, an offline snapshot, demo mode, and four languages. Native sheets,
swipe actions, and sharing complement the cards, with a restrained Liquid Glass
treatment on iOS 26 and a material fallback on iOS 18–25.

Open `ios/SwissDeliveryTracker.xcodeproj` in Xcode to run the self-contained
demo. See the [native setup guide](ios/README.md) to connect it to this service,
configure Supabase Auth, the App Group, signing, and APNs.

## Try it locally

The local app starts in demo mode with 16 fictional parcels: six on the way,
five recent arrivals, and five archived deliveries. Vinyl, film rolls, a moon
lamp, and parcels from six countries give you plenty to explore, including
tracking histories and Passport stamps. The iPhone app uses the same examples.
No account or database is needed:

```bash
git clone https://github.com/plhery/swiss-delivery-tracker.git
cd swiss-delivery-tracker
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Refreshing advances the
sample deliveries through their journey. Use **Settings → Account & data →
Reset demo data** to start fresh. Existing demos receive the new examples once,
preserving your edits and custom parcels.

## Self-host it

You will need a Supabase project or self-hosted stack, a public HTTPS hostname,
and Docker.

1. Apply the SQL files in `supabase/migrations/` in filename order.
2. Configure Google OAuth, Apple sign-in, or email OTP with custom SMTP following the
   [authentication guide](docs/AUTHENTICATION.md).
3. Copy `.env.example` to `.env` and replace its example runtime values.
4. Build the Next.js application with the same public Supabase URL and
   publishable key:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-public-key \
  --build-arg NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true \
  --build-arg NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED=false \
  -t swiss-delivery-tracker .

docker run --rm --env-file .env -p 3000:3000 swiss-delivery-tracker
```

The Supabase URL and publishable key are intentionally browser-visible. Keep
the service-role key, OAuth secret, SMTP password and VAPID private key on the
server. The [deployment runbook](docs/DEPLOYMENT.md) covers migrations, legacy
data, HTTPS, Auth and production verification in detail.

## Project guide

- [Authentication](docs/AUTHENTICATION.md)
- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Carriers](docs/CARRIERS.md)
- [Privacy](PRIVACY.md) and [security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

The web application is a full-stack Next.js and TypeScript service, and the
iPhone app is SwiftUI. Next.js route handlers expose the shared API while a
durable in-process worker handles carrier sync, Web Push, and APNs. CI tests
the application, production container, database migrations, native app, and
cross-account RLS isolation.

Licensed under [Apache 2.0](LICENSE).
