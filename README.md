<p align="center">
  <img src="public/icons/icon-192.png" width="80" alt="Delivery Tracker logo">
</p>

<h1 align="center">Delivery Tracker</h1>

<p align="center">
  <strong>A new home for your packages.</strong><br>
  Follow every journey, catch the next arrival, and collect a few stamps along the way.<br>
  Open source · Native iPhone app · Installable web app
</p>

<p align="center">
  <a href="https://github.com/plhery/delivery-tracker/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/plhery/delivery-tracker/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://delivery.plhery.com"><img alt="Open Delivery Tracker" src="https://img.shields.io/badge/open%20app-delivery.plhery.com-ffcf00"></a>
</p>

<p align="center">
  <a href="https://delivery.plhery.com"><strong>Try it live →</strong></a> ·
  <a href="#quick-start">Run locally</a> ·
  <a href="#iphone-app">iPhone app</a> ·
  <a href="#self-hosting">Self-host</a>
</p>

<p align="center">
  <img src="docs/screenshot.jpg" width="780" alt="Web deliveries dashboard with a yellow Next up card, carrier-colored parcels, tracking notices, and recent arrivals">
</p>

## All your deliveries, one place

Carrier colors and little delivery trucks make parcels easy to spot. **Next up**
puts the nearest arrival or pickup first, while tracking notices and a readable
timeline keep the rest of the journey clear.

| | What you get |
| --- | --- |
| 📦 **Less copying, more tracking** | Paste a tracking number, carrier link, or shipping email text. Scan barcodes and share links into the app on iPhone. |
| 🚚 **A clear view of what's coming** | Delivery estimates, tracking history, search, filters, and an archive for past parcels. |
| 🔔 **Updates on your terms** | Optional web and iPhone notifications, quiet hours, and per-parcel mute. Home Screen widgets and delivery-day Live Activities on iPhone. |
| 🛂 **A Passport for your parcels** | Twelve collectible stamps, journey statistics, and countries from your parcels' tracking history. |
| 👋 **A little something to share** | Invite friends and choose which Passport stats, stamps, and recent-arrival signals to share. Parcel details stay private. |
| 🌍 **At home on your devices** | Synced delivery history, light and dark appearances, and English, German, French, and Italian. |

<p align="center">
  <img src="docs/screenshot-ios.png" width="230" alt="Native iPhone deliveries screen">
  <img src="docs/screenshot-detail.jpg" width="230" alt="Mobile web parcel detail and tracking timeline">
  <img src="docs/screenshot-passport.jpg" width="230" alt="Mobile web Passport with collectible stamps and delivery statistics">
</p>

<p align="center"><sub>iPhone · Tracking timeline · Passport<br>All screenshots show fictional demo parcels.</sub></p>

## Quick start

Explore the app with fictional parcels and tracking histories. **No account,
database, or environment file required.** Use Node.js 24 and npm 10 or newer;
`nvm use` selects the version in [`.nvmrc`](.nvmrc).

```bash
git clone https://github.com/plhery/delivery-tracker.git
cd delivery-tracker
nvm use
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000) and choose **Explore the demo**.
Refreshing advances the sample deliveries. Your demo changes stay on this
device; **Reset demo data** in settings restores the original parcels.

To connect a local checkout to real accounts, configure [`.env.example`](.env.example)
as `.env.local`, set `NEXT_PUBLIC_USE_API=true`, and follow the
[authentication](docs/AUTHENTICATION.md) and [deployment](docs/DEPLOYMENT.md) guides.

## Carrier coverage

Built-in integrations cover Swiss Post, Planzer, Quickpac, DPD, GLS, DHL /
Deutsche Post, UPS, La Poste / Colissimo, Chronopost, Mondial Relay, Amazon
Shipping France, India Post, and more. Regional services have their own adapters
and input requirements.

- **Automatic tracking:** supported carriers refresh in the background. The
  scheduler runs every 10 minutes from 08:00–22:00 in `Europe/Zurich`, and hourly
  overnight, processing eligible parcels in batches.
- **Unknown carriers:** a private TRAWL browser service enables fallback lookups
  through 17TRACK and ParcelsApp.
- **Carrier links:** Asendia and FedEx open their tracking sites; ShipUp can be
  kept as a manual record.

Some carriers need a delivery postcode or the complete shared tracking URL.
Integrations are best effort: carrier sites can change or block automated
requests. See [carrier support and requirements](docs/CARRIERS.md) for details.

## iPhone app

A native **SwiftUI app for iOS 18+**, with a Share extension, barcode scanner,
offline snapshot, Home Screen widgets, and Lock Screen / Dynamic Island Live
Activities. It uses the same API and carrier catalog as the web app.

To try the demo, open [`ios/SwissDeliveryTracker.xcodeproj`](ios/SwissDeliveryTracker.xcodeproj)
in **Xcode 26**, select the `SwissDeliveryTracker` scheme and an iPhone simulator,
then run. No signing credentials are needed for the simulator demo.

The [iPhone setup guide](ios/README.md) covers connecting your server, device
installation, App Groups, signing, APNs, and Live Activities.

## Self-hosting

You need **Supabase Auth + Postgres**, **Docker**, and a public **HTTPS** origin.
Run the app as a continuously running service: its background tracking worker
needs to stay alive between requests.

1. Apply `supabase/migrations/*.sql` in filename order. For an existing deployment,
   follow the migration and rollout notes in the [deployment guide](docs/DEPLOYMENT.md).
2. Configure your sign-in providers using the [authentication guide](docs/AUTHENTICATION.md).
   The example below uses email OTP, which requires custom SMTP.
3. Copy [`.env.example`](.env.example) to `.env`, configure the Supabase runtime
   values, and set `NEXT_PUBLIC_USE_API=true`. Remove optional push and monitoring
   placeholders unless you configure those services.
4. Build and run with matching public Supabase values:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-public-key \
  --build-arg NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED=true \
  -t delivery-tracker .

docker run -d --name delivery-tracker --restart unless-stopped \
  --env-file .env -p 3000:3000 delivery-tracker
```

Put port `3000` behind HTTPS and use `/health` for readiness checks. Public
Supabase values and sign-in flags are baked into the web bundle at build time.
The service-role key and private push credentials belong only on the server.

See the [deployment runbook](docs/DEPLOYMENT.md) for backups, migrations,
notifications, production checks, and recovery.

## Development

**Next.js + React + TypeScript** power the web app and shared API. **SwiftUI**
powers iPhone. **Supabase Auth and Postgres row-level security** isolate accounts;
a durable database queue drives carrier sync, Web Push, and APNs.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local web demo |
| `npm run lint` / `npm run typecheck` | Check code style and TypeScript |
| `npm test` | Run the fixture-based unit and integration tests |
| `npm run test:e2e` | Run Playwright browser journeys |
| `npm run build` / `npm start` | Build and serve the production application |
| `npm run test:contract` | Check generated API types against the OpenAPI contract |

CI also checks the production container, database migrations and account
isolation, PWA behavior, and native app. See [Contributing](CONTRIBUTING.md)
for browser installation and the full validation workflow.

## Documentation

| Guide | What's inside |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Components, shared API, background jobs, and security boundaries |
| [Authentication](docs/AUTHENTICATION.md) | Sign-in providers, SMTP, and session setup |
| [Deployment](docs/DEPLOYMENT.md) | Hosting, migrations, health checks, and operations |
| [Carriers](docs/CARRIERS.md) | Integrations, required inputs, limitations, and live tests |
| [iPhone](ios/README.md) | Native builds, signing, sharing, widgets, and notifications |
| [Friends](docs/FRIENDS.md) | Invitations, sharing choices, and privacy |
| [Observability](docs/OBSERVABILITY.md) · [Analytics](docs/ANALYTICS.md) | Tracking diagnostics and optional usage analytics |

---

Licensed under [Apache 2.0](LICENSE). Read the [privacy policy](PRIVACY.md),
[report a security issue](SECURITY.md), or [contribute](CONTRIBUTING.md).
