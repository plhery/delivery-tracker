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
          +--------------------> universal-parcel-scraper
          +--------------------> Web Push + APNs
```

## Where things live

| Path | What |
| --- | --- |
| `app/` | App Router pages, route handlers, manifest, service worker, offline page |
| `proxy.ts` | Per-request CSP nonce and security headers; redirects pages from a host the site has left |
| `src/` | React client (`components/`, `store/`, `auth/`, `i18n.tsx`) |
| `src/peek/` | The front door and the parcel page for visitors: parcel link client, this device's parcels, keeping a parcel after sign-in |
| `src/server/` | API helpers, auth, sync worker, routing, push, observability |
| `universal-parcel-scraper` (npm dependency) | Every carrier: catalog, detection, adapters, universal providers ([README](https://github.com/plhery/universal-parcel-scraper/blob/main/README.md)) |
| `shared/` | Translations, tracking message map and analytics catalog, shared by web and iOS |
| `contracts/` | OpenAPI contract (source of TypeScript and Swift types) and cross-platform fixtures |
| `supabase/` | Append-only migrations and SQL assertions for RLS |
| `ios/` | SwiftUI app, Share extension, widgets, Live Activities ([README](../ios/README.md)) |
| `ops/` | Sentry and Grafana dashboards |
| `scripts/` | Code generation, validation and smoke tests |

Key server modules:

- `auth.ts` validates the bearer token and builds a PostgREST client carrying the
  user's JWT. `api.ts` adds logging and per-account rate limits.
- `publicParcels.ts` decides what a parcel link shows, hashes owner keys and keys the daily
  lookup counters. The routes under `/api/public` are the only ones without sign-in that
  write.
- `background.ts` runs the scheduler. `public.sync_jobs` is the durable, deduplicated
  queue, and workers claim jobs with leases, so deploys, crashes and replicas never lose
  or double-run work. This is the only code path with cross-account access.
- `trackingSync.ts` runs one refresh through the adapter registry;
  `trackingRouting.ts` decides which source to ask ([ROUTING.md](ROUTING.md)).
- `eventPlaces.ts` uses the scraper's place resolver to put each scan on the map,
  when the API returns a parcel ([README](https://github.com/plhery/universal-parcel-scraper/blob/main/places/README.md)).
- `push.ts` sends Web Push, APNs alerts and Live Activity updates, only to the parcel
  owner's devices. Each batch of new scans announces its newest one, and only when it is
  the parcel's newest scan: history a carrier change backfills, or a scan reported late,
  is recorded as handled without an alert.
- `observability.ts` and `trackingAudit.ts` link Sentry and logs to the private audit
  tables ([OBSERVABILITY.md](OBSERVABILITY.md)).

## Trust boundaries

- **Secrets**: the service-role key, VAPID private key and APNs `.p8` stay on the server.
  The Supabase URL and publishable key are public by design.
- **Ownership**: every private request needs a valid Supabase token. Reads go through
  PostgREST with that token, so RLS is the final check. Writes use owner-bound database
  functions that re-validate, enforce quotas and can't target another account.
- **Service role**: used only for scheduled carrier work, push delivery, account
  deletion and parcels followed without an account. It never reaches the browser.
- **Parcel links**: a parcel followed without an account has no owner and is reached
  through `/p/<id>`. The id (12 symbols, about 70 bits) is the capability to read it.
  - The device that made the lookup also gets an owner key, once; the database keeps its
    SHA-256. With the key (`X-Parcel-Key`) the caller sees the full tracking number, may
    forget the parcel, and may keep it after signing in.
  - Anyone else with the link is a viewer: the number is masked to its ends, and the answer
    is built from an allow-list. The name, postcode, private tracking link, routing state,
    recipient's name and internal ids never leave the server, for either role.
  - `parcel_links` and the lookup counters are service-role only. An unknown, forgotten,
    expired or malformed link and a wrong key all get the same answer.
  - Keeping a parcel runs under the user's own token: the database checks the key, the
    quotas and the duplicate, and gives a viewer's copy none of what the sharer entered.
  - Link ids and keys stay out of request logs, metric labels, analytics and error reports.
    The pages send `Referrer-Policy: no-referrer` and are never cached by the service worker.
  - The browser keeps the links it looked up or opened in `localStorage`, with their owner
    key, the name given on the device and the last answer. The name is never sent to the
    public routes; it becomes the parcel's label only when the parcel is kept in an account.
  - A build without an API (`NEXT_PUBLIC_USE_API=false`) answers lookups in the browser with
    fictional parcels from the demo stories, so nothing leaves the device.
  - Lookups are limited per client and overall, per minute in memory and per day in the
    database. The daily counter is keyed by a hash of the client address and the date,
    made with a server secret; an IPv6 client counts as its /64.
- **Private data**: tracking numbers, labels, carrier history, push endpoints and capability
  URLs (Planzer, Dachser) never go into analytics. They do appear in operator logs and
  Sentry; see [OBSERVABILITY.md](OBSERVABILITY.md).
- **Carrier responses are untrusted**. Adapters use fixed timeouts, a shared bounded
  response reader, and host validation wherever they accept a URL.
- **Push**: browser endpoints must belong to known push services, and delivery never
  follows redirects. APNs tokens are opaque hex values, sent only to Apple's fixed hosts.
- **Service worker**: caches only the public app shell and static assets. APIs, health,
  Auth, invitation pages and parcel link pages are network-only.
- **Proxies**: forwarded client IPs are trusted only with `TRUST_PROXY_HEADERS=true`.
  Cloudflare may sit in front for TLS and abuse protection, but it isn't part of identity.
- **Hosts**: a redirect between hosts goes only to the configured canonical origin, never
  to anything a request names ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Addresses

| Address | What it shows |
| --- | --- |
| `/` | The front door to a visitor, the deliveries to someone signed in |
| `/p/<id>` | One parcel, to anyone with the link |
| `/i/<key>`, `/invite` | A friend invitation ([FRIENDS.md](FRIENDS.md)) |
| `/demo` | The demo deliveries, kept on the device, to anyone; leaving the demo returns to `/` |

Sessions belong to one origin, so every address lives on the same host. With the iPhone
app installed, `/p/…` and `/i/…` open in the app.

## Data lifecycle

- **Adding a parcel** writes it through the user's RLS client and queues a job with the
  service role. Clients poll the small job resource, then reload the parcel list once.
- **Archiving** keeps the parcel and its history.
- **A lookup without an account** stores the number once per carrier and inputs, with one
  link per lookup. A link is forgotten 30 days after the parcel is delivered or returned,
  after 90 days without news (a scan, or the link being opened), or when its owner asks.
  The parcel goes with its last link. The scheduled sync's maintenance pass does the
  forgetting.
- **Keeping a looked-up parcel** after signing in moves it into the account when nobody
  else follows it, and copies it otherwise. Its link then belongs to the account and has
  no forget date.
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
