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
| `src/peek/` | The landing and the parcel page for visitors: the field, parcel link client, this device's parcels, keeping a parcel after sign-in; `landing/` holds the sections below the field |
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
  user's JWT. `api.ts` adds logging, per-account rate limits and the checks on requests
  without sign-in.
- `publicParcels.ts` decides what a parcel link shows, to a gift's viewer too, hashes owner
  keys and keys the daily lookup counters. The routes under `/api/public` are the only ones
  without sign-in that write.
- `background.ts` runs the scheduler. `public.sync_jobs` is the durable, deduplicated
  queue, and workers claim jobs with leases, so deploys, crashes and replicas never lose
  or double-run work. This is the only code path with cross-account access.
- `trackingSync.ts` runs one refresh through the adapter registry;
  `trackingRouting.ts` decides which source to ask ([ROUTING.md](ROUTING.md)).
- `eventPlaces.ts` uses the scraper's place resolver to put each scan on the map,
  when the API returns a parcel ([README](https://github.com/plhery/universal-parcel-scraper/blob/main/places/README.md)).
- `push.ts` sends Web Push, APNs alerts and Live Activity updates to the parcel owner's
  devices, and Web Push to the alerts of the parcel's links. Each batch of new scans
  announces its newest one, and only when it is the parcel's newest scan: history a carrier
  change backfills, or a scan reported late, is recorded as handled without an alert.
- `observability.ts` and `trackingAudit.ts` link Sentry and logs to the private audit
  tables ([OBSERVABILITY.md](OBSERVABILITY.md)).

## Trust boundaries

- **Secrets**: the service-role key, VAPID private key and APNs `.p8` stay on the server.
  The Supabase URL and publishable key are public by design.
- **Ownership**: every private request needs a valid Supabase token. Reads go through
  PostgREST with that token, so RLS is the final check. Writes use owner-bound database
  functions that re-validate, enforce quotas and can't target another account.
- **Service role**: used only for scheduled carrier work, push delivery, account
  deletion, parcels followed without an account and what a parcel link shows. It never
  reaches the browser.
- **Parcel links**: a parcel followed without an account has no owner and is reached
  through `/p/<id>`. The id (12 symbols, about 70 bits) is the capability to read it.
  - The device that made the lookup also gets an owner key, once; the database keeps its
    SHA-256. With the key (`X-Parcel-Key`) the caller sees the full tracking number, may
    forget the parcel, and may keep it after signing in.
  - Anyone else with the link is a viewer: the number is masked to its last characters, and
    the answer is built from an allow-list. The name, postcode, private tracking link, routing state,
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
    "Forget it now" deletes the link on the server and the device's copy; keeping a parcel
    in an account drops the device's copy too.
  - Beside each link the browser notes what its sharer sends along (whether the name
    travels, a gift's note and who it is from, whether viewers read the whole number) and
    the alert it turned on. The notes go when the device forgets the parcel.
  - A link's preview (the page's title, description and image) is written on the server
    from what a viewer sees: the status, the carrier and the estimate, never the number, a
    name or a place. Reading it does not count as opening the link, and a link that leads
    nowhere gets Peek's own preview.
  - A build without an API (`NEXT_PUBLIC_USE_API=false`) answers lookups in the browser with
    fictional parcels from the demo stories, so nothing leaves the device.
  - Lookups are limited per client and overall, per minute in memory and per day in the
    database. The daily counter is keyed by a hash of the client address and the date,
    made with a server secret; an IPv6 client counts as its /64, and its /48 has a counter
    too.
  - Detecting the carrier before a lookup asks carriers only when the number's shape fits
    several. That is counted per day as well, per client and overall; past the allowance
    the lookup goes on without the answer.
- **Shared links**: a signed-in person shares one of their parcels through a link of their
  own, at most one live link per parcel. The database functions behind
  `/api/packages/{id}/share` run under the user's token and refuse another account's parcel
  like a missing one. A lookup's owner changes its link with the owner key.
  - A viewer's answer is the same allow-list for both kinds of link. The server never sends
    a viewer the parcel's label: a name, a gift note and who a gift is from travel after `#`
    in the link (`#n=…&g=…&f=…`) and stay in the browser. The share sheet adds them to the
    link it copies or shares; the page of a gift on its way renders none of them and does
    not save the name to the device.
  - An account's link is made when its owner shares or copies it, not when the share sheet
    opens.
  - **Gifts**: until the parcel is delivered, a gift's viewer gets no sender, weight, size,
    pickup point or carrier status line, a masked number whatever the link shows otherwise,
    no scan from before the carrier had the parcel, and the scans of the origin country
    reduced to "Left the sender" and that country (`giftEvents` in `publicParcels.ts`). The
    owner sees everything. A gift cannot be kept by a viewer before it is delivered; the
    database refuses it, not only the page.
  - The page's metadata and preview image are built from the viewer's answer
    (`viewerParcel`), never from the stored row.
  - **Stopping** makes the link answer "not shared" to everyone but a lookup's owner and
    ends its viewers' alerts. Sharing an account's parcel again makes a new link.
  - **Alerts**: anyone holding a link can subscribe their browser to that parcel. The
    endpoint must belong to a known push service and the key be a valid one, as for an
    account. Endpoints and keys are service-role only and are never returned or logged. A
    link takes ten alerts from viewers. Notifications carry no name and no number, and a
    gift's no place. An alert ends with the journey, when the push service says the
    subscription is gone, or after three failed sends in a row; a failed send is not
    repeated, so an endpoint anyone can add costs a bounded number of requests.
    The browser is asked for the permission, and subscribes, only on "Turn on". It reuses
    the subscription an account or another parcel already made, so turning one alert off
    leaves the subscription in place. The calendar file is made in the browser.
- **Private data**: tracking numbers, labels, carrier history, push endpoints and capability
  URLs (Planzer, Dachser) never go into analytics. They do appear in operator logs and
  Sentry; see [OBSERVABILITY.md](OBSERVABILITY.md).
- **Carrier responses are untrusted**. Adapters use fixed timeouts, a shared bounded
  response reader, and host validation wherever they accept a URL.
- **Push**: browser endpoints must belong to known push services, and delivery never
  follows redirects. APNs tokens are opaque hex values, sent only to Apple's fixed hosts.
- **Service worker**: caches only the public app shell and static assets. APIs, health,
  Auth, invitation pages and parcel link pages are network-only.
- **Other sites**: without sign-in a request counts against its sender's address, so a
  write is refused when a browser says a page of another site sent it (`Sec-Fetch-Site`,
  or `Origin` in a browser without it), and its body must be declared as JSON. Apps and
  scripts send neither header and count against their own address.
- **Proxies**: forwarded client IPs are trusted only with `TRUST_PROXY_HEADERS=true`.
  Cloudflare may sit in front for TLS and abuse protection, but it isn't part of identity.
- **Hosts**: a redirect between hosts goes only to the configured canonical origin, never
  to anything a request names ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Addresses

| Address | What it shows |
| --- | --- |
| `/` | The landing to a visitor, with the parcels of their device right under the field; the deliveries to someone signed in |
| `/p/<id>` | One parcel, to anyone with the link |
| `/sample` | A made-up parcel on a parcel page, told by the browser: nothing is asked of the server or kept on the device |
| `/i/<key>`, `/invite` | A friend invitation ([FRIENDS.md](FRIENDS.md)) |
| `/demo` | The demo deliveries, kept on the device, to anyone; leaving the demo returns to `/` |

Sessions belong to one origin, so every address lives on the same host. With the iPhone
app installed, `/p/…` and `/i/…` open in the app.

The server draws the landing at `/` for everyone, because a sign-in lives in the browser's
storage. A script that runs before the first paint
([`entryHintConfig.ts`](../src/lib/entryHintConfig.ts)) marks a browser that holds a
sign-in, or has the demo open, so it shows the splash instead until its own screen is
ready. The map and the sample parcels of the landing load when their sections come near;
a visitor with parcels on the device gets the map at once, for the routes on their cards.

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
- **A link from an account** lasts until its parcel or account is deleted. Once its
  sharing is stopped it is deleted 30 days later, by the same maintenance pass.
- **An alert for a link** is deleted when the parcel is delivered or returned, when its
  browser unsubscribes, when its link goes and, for viewers, when sharing stops.
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
