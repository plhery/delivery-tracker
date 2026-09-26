# Architecture

A Next.js app (web, PWA and API) plus a native SwiftUI iPhone app. Supabase Auth
identifies users, Postgres row-level security (RLS) isolates their parcels, and a
background worker in the same Node process refreshes carriers.

```text
Browser/PWA + iPhone app <---- email OTP / OAuth ----> Supabase Auth
          |
          | Bearer access token
          v
Next.js route handlers --- user token ---> PostgREST + Postgres RLS
          |
          +--- service role ---> background sync writes
          +--------------------> carrier adapters (packages/carriers)
          +--------------------> Web Push + APNs
```

## Where things live

| Path | What |
| --- | --- |
| `app/` | App Router pages, route handlers, manifest, service worker, offline page |
| `proxy.ts` | Per-request CSP nonce and security headers |
| `src/` | React client (`components/`, `store/`, `auth/`, `i18n.tsx`) |
| `src/server/` | API helpers, auth, sync worker, routing, push, observability |
| `packages/carriers/` | Every carrier: catalog, detection, adapters, universal providers ([README](../packages/carriers/README.md)) |
| `shared/` | Translations, tracking message map and analytics catalog, shared by web and iOS |
| `contracts/` | OpenAPI contract (source of TypeScript and Swift types) and cross-platform fixtures |
| `supabase/` | Append-only migrations and SQL assertions for RLS |
| `ios/` | SwiftUI app, Share extension, widgets, Live Activities ([README](../ios/README.md)) |
| `ops/` | TRAWL browser service, Sentry and Grafana dashboards |
| `scripts/` | Code generation, validation and smoke tests |

Key server modules:

- `auth.ts` validates the bearer token and builds a PostgREST client carrying the
  user's JWT. `api.ts` adds logging and per-account rate limits.
- `background.ts` runs the scheduler. `public.sync_jobs` is the durable, deduplicated
  queue, and workers claim jobs with leases, so deploys, crashes and replicas never lose
  or double-run work. This is the only code path with cross-account access.
- `trackingSync.ts` runs one refresh through the adapter registry;
  `trackingRouting.ts` decides which source to ask ([ROUTING.md](ROUTING.md)).
- `push.ts` sends Web Push, APNs alerts and Live Activity updates, only to the parcel
  owner's devices.
- `observability.ts` and `trackingAudit.ts` link Sentry and logs to the private audit
  tables ([OBSERVABILITY.md](OBSERVABILITY.md)).

## Trust boundaries

- **Secrets**: the service-role key, VAPID private key and APNs `.p8` stay on the server.
  The Supabase URL and publishable key are public by design.
- **Ownership**: every private request needs a valid Supabase token. Reads go through
  PostgREST with that token, so RLS is the final check. Writes use owner-bound database
  functions that re-validate, enforce quotas and can't target another account.
- **Service role**: used only for scheduled carrier work, push delivery and account
  deletion. It never reaches the browser.
- **Private data**: tracking numbers, labels, carrier history, push endpoints and capability
  URLs (Planzer, Dachser) never go into analytics. They do appear in operator logs and
  Sentry; see [OBSERVABILITY.md](OBSERVABILITY.md).
- **Carrier responses are untrusted**. Adapters use fixed timeouts, a shared bounded
  response reader, and host validation wherever they accept a URL.
- **Push**: browser endpoints must belong to known push services, and delivery never
  follows redirects. APNs tokens are opaque hex values, sent only to Apple's fixed hosts.
- **Service worker**: caches only the public app shell and static assets. APIs, health and
  Auth are network-only.
- **Proxies**: forwarded client IPs are trusted only with `TRUST_PROXY_HEADERS=true`.
  Cloudflare may sit in front for TLS and abuse protection, but it isn't part of identity.

## Data lifecycle

- **Adding a parcel** writes it through the user's RLS client and queues a job with the
  service role. Clients poll the small job resource, then reload the parcel list once.
- **Archiving** keeps the parcel and its history.
- **Deleting an account** removes the Auth user. Foreign-key cascades remove parcels,
  jobs, events, push registrations, Live Activity tokens and audit rows. Other audit rows
  expire after 90 days.
- **Share target**: the PWA receives shared text via `POST`. The service worker keeps it
  in a one-time cache entry, so tracking text never appears in a URL or HTTP log.

## Notifications and Live Activities

- Web Push, APNs and Live Activities use the same status sentences. Delivered alerts show
  the carrier's event time in the recipient's timezone when the carrier gave a clock time.
- Estimates appear only while a parcel is on its way. They are hidden after delivery, a
  failed attempt, pickup readiness or a return, and whenever they are in the past.
- An `exception` means the carrier reported a problem that is neither a missed delivery
  nor a return. The parcel keeps its place and keeps refreshing.
- A Live Activity starts only at `out_for_delivery`. It ends on delivery, failed attempt,
  problem, pickup, return, archive, sign-out or opt-out. At most two run at once. Live
  Activity pushes go first, so a successful one replaces the matching banner; if it fails,
  the banner is sent.

## Copy and languages

App copy is available in English, German, French, Italian, Spanish, Portuguese and Polish
([shared/locales](../shared/locales/README.md)). Carrier scan text and parcel names are
shown as-is; known app-generated timeline messages are translated
([LOCALIZATION.md](LOCALIZATION.md)). Errors map to localized guidance and never show raw
diagnostics. Status labels don't imply a carrier delay when only our check failed.

Push registrations store the device language. The web updates it when the user changes
language, and the Share extension reads it from the app group.

## Contracts

`contracts/openapi.json` generates the TypeScript and Swift API types and the iPhone's
offline carrier catalog. `/api/carriers` serves the catalog with ETag so installed apps pick
up new carriers without a release; native carrier ids are plain strings, so unknown values
decode safely. `contracts/fixtures/delivery-api.json` is decoded by both TypeScript and
Swift tests to catch payload drift.
