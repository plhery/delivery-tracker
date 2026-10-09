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
          +--------------------> SMTP (delivery email)
```

## Where things live

| Path | What |
| --- | --- |
| `app/` | App Router pages, route handlers, manifest, service worker, offline page |
| `proxy.ts` | Per-request CSP nonce and security headers; redirects pages from a host the site has left; tells a language address, a guide and a carrier's page its language |
| `src/` | React client (`components/`, `store/`, `auth/`, `i18n.tsx`) |
| `src/peek/` | The landing and the parcel page for visitors: the field, parcel link client, this device's parcels, keeping a parcel after sign-in; `landing/` holds the sections below the field |
| `src/server/` | API helpers, auth, sync worker, routing, push, email, observability |
| `universal-parcel-scraper` (npm dependency) | Every carrier: catalog, detection, adapters, universal providers ([README](https://github.com/plhery/universal-parcel-scraper/blob/main/README.md), [boundary](SCRAPER.md)) |
| `shared/` | Translations, tracking message map, analytics catalog and postcode examples, shared by web and iOS |
| `content/guides/` | The guides' text, one Markdown file per language ([README](../content/guides/README.md)); `src/guides/` draws them |
| `content/carriers/` | The carriers' pages, one Markdown file per language a carrier is written in ([README](../content/carriers/README.md)); `src/carriers/` draws them with the guides' parts |
| `contracts/` | OpenAPI contract (source of TypeScript and Swift types) and cross-platform fixtures |
| `supabase/` | Append-only migrations and SQL assertions for RLS |
| `ios/` | SwiftUI app, Share extension, widgets ([README](../ios/README.md)) |
| `ops/` | Sentry and Grafana dashboards |
| `scripts/` | Code generation, the service worker's build, validation and smoke tests |

Key server modules:

- `auth.ts` validates the bearer token and builds a PostgREST client carrying the
  user's JWT. `api.ts` adds logging, per-account rate limits and the checks on requests
  without sign-in.
- `publicParcels.ts` decides what a parcel link shows, to a gift's viewer too, hashes owner
  keys and keys the daily lookup counters. The routes under `/api/public` are the only ones
  without sign-in that write.
- `background.ts` runs the scheduler. `public.sync_jobs` is the durable, deduplicated
  queue, and workers claim jobs with leases, so deploys, crashes and replicas never lose
  or double-run work. This is the only code path with cross-account access. An idle
  worker asks for a job less often, down to every 10 s; a job its own process queues
  wakes it at once, so only a job another container queued or handed back can wait.
- `trackingSync.ts` runs one refresh through the adapter registry;
  `trackingRouting.ts` decides which source to ask ([ROUTING.md](ROUTING.md)), and
  `sharedLookups.ts` lets the copies of a number in one scheduled run share their lookups.
- `eventPlaces.ts` serves a parcel's timeline (see [Data lifecycle](#data-lifecycle))
  and uses the scraper's place resolver to put each scan on the map,
  when the API returns a parcel ([README](https://github.com/plhery/universal-parcel-scraper/blob/main/places/README.md)).
  Lines between recorded stops are solid; approximate areas have dotted markers.
  On the web the route is drawn as one stroke, from its first place to the parcel's, and
  the way still to go shows once the stroke has arrived.
  The opened map shows more as it closes in: rivers, lakes, built-up areas, main roads
  and towns, from tiles the site serves itself (`public/atlas`, built by
  [`build-detail.mjs`](../src/components/map/build-detail.mjs)). The iPhone app ships the
  same tiles in one file, so no map service is asked on either.
- `push.ts` sends Web Push, APNs alerts and Live Activity updates to the parcel owner's
  devices, and Web Push to the alerts of the parcel's links. Each batch of new scans
  announces its newest one, and only when it is the parcel's newest scan: history a carrier
  change backfills, or a scan reported late, is recorded as handled without an alert.
  So is what the parcel already showed when it joined the account: a scan from before
  that moment, stored by the check that runs as it is added or more than a day older than
  it. A first history that arrives later, from the hours before the add, is announced.
  A batch whose newest scan is more than a day old is stored and shown without an alert.
  A stored scan the carrier later restages, in place, into a delivery or a pickup
  readiness is announced again by the same rules, once, when it is from the last day and
  the parcel had shown that stage neither as its own nor in another scan.
  A handoff's relay copy that reaches the parcel after the scan it repeats is never the one
  announced, nor is an earlier carrier's scan that reaches it after a later one
  ([ROUTING.md](ROUTING.md#handoffs-two-carriers)). A scheduled run sends a
  parcel's notifications right after its check, without waiting for the parcels after it.
  Once it has checked a parcel it may merge with another carrier's leg in the same
  account, it holds the rest of its notifications until the merge.
- `email/` tells an account by email that a parcel was delivered or is ready for pickup,
  when the account asked for it. The database hands each parcel out once per stage (`claim_delivery_emails`),
  `deliveryEmails.ts` writes the email and sends it through any SMTP service, and
  `unsubscribe.ts` signs the link that switches it off.
- `observability.ts` and `trackingAudit.ts` link Sentry and logs to the private audit
  tables ([OBSERVABILITY.md](OBSERVABILITY.md)).

## Trust boundaries

- **Secrets**: the service-role key, VAPID private key, APNs `.p8` and SMTP password stay
  on the server. The Supabase URL and publishable key are public by design.
- **Ownership**: every private request needs a valid Supabase token. Reads go through
  PostgREST with that token, so RLS is the final check. Writes use owner-bound database
  functions that re-validate, enforce quotas and can't target another account.
- **Service role**: used only for scheduled carrier work, the record of when an account's
  apps last read its parcels, push delivery, the delivery email, account deletion, parcels
  followed without an account and what a parcel link shows. It never reaches the browser.
- **Parcel links**: a parcel followed without an account has no owner and is reached
  through `/p/<id>`. The id (12 symbols, about 70 bits) is the capability to read it.
  - The device that made the lookup also gets an owner key, once; the database keeps its
    SHA-256. With the key (`X-Parcel-Key`) the caller sees the full tracking number, may
    forget the parcel, and may keep it after signing in.
  - Anyone else with the link is a viewer: the number is masked to its last characters, and
    the answer is built from an allow-list. The name, postcode, private tracking link, routing state,
    recipient's name and internal ids never leave the server, for either role. A viewer's
    carrier link opens the carrier's page for typing a number in (the catalog's
    `trackingSearchUrl`), or is left out when the carrier has none.
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
  - A viewer's answer uses the same allow-list for both kinds of link. A public name can
    travel after `#n=…`. Gift names, messages and signatures are stored with the link,
    saved before sharing or copying, and sent only to its owner or after delivery. Gift
    links carry no words in their address. Old links retain the words already in their URL.
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
- **Reader feedback**: a parcel's page asks whether it is right, or who carries a parcel
  no carrier was found for. An answer comes from the parcel's account
  (`/api/packages/{id}/feedback`) or from anyone holding its link
  (`/api/public/parcels/{linkId}/feedback`), never from a gift's recipient, who is not
  asked and is refused like a missing link.
  - `parcel_feedback` is service-role only. A row has the tracking number, the reader's
    words and what the service held about the parcel, and no account, link, device or
    address. The words are read by a person and never opened or followed.
  - A link anyone holds cannot fill the table: a tracking number takes twenty answers a
    day, on top of the per-client limit of the route.
  - The question stands on every visit. The browser remembers that it answered, so the
    one asked on the way back from the carrier's site is not asked twice about the same
    scan nor more than once a day: beside a link's other notes, or under the parcel's id
    for an account. That memory never leaves the device.
- **Delivery email**: sent only to the address an account signs in with, once the Auth
  server has confirmed it. `delivery_emails` is service-role only.
  - Addresses stay out of logs, metric labels and error reports.
  - The email has no tracking pixel, no rewritten link and no remote content: its picture
    travels inside it.
  - Every email carries a token that names its account, signed with a key derived from the
    service-role key. With it, and without a sign-in, `POST /api/email/unsubscribe` switches
    that account's delivery email off or back on, and nothing else. A token this server did
    not make and an account that is gone get the same answer.
  - Opening an address from an email changes nothing, because mail scanners open them too:
    `/email/off` asks first, and reads the token after `#`. Only a mail app's own
    "Unsubscribe" posts straight to the route. Both addresses name the email's language
    (`lang`), which the page speaks over the browser's own choice.
  - Tokens stay out of request logs and error reports.
- **Private data**: tracking numbers, labels, carrier history, push endpoints and capability
  URLs (Planzer, Dachser) never go into analytics. They do appear in operator logs and
  Sentry; see [OBSERVABILITY.md](OBSERVABILITY.md).
- **Pictures**: the invitation card, a parcel link's preview image and the delivery
  email's card are drawn on the server with the fonts it ships, and ask nothing of the web.
  The renderer would fetch a font for a character they lack and a drawing for an emoji, so
  every line is checked against them first (`src/server/pictureFont.ts`). A line they
  cannot write is left out, and a parcel link whose status they cannot write gets Peek's
  own picture.
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
| `/home` | The landing to anyone. Someone signed in reaches it from the foot of their deliveries or from Settings, and it leads back to `/` |
| `/de`, `/fr`, `/it`, `/es`, `/pt`, `/pl` | The landing in that language to anyone, whatever the browser prefers. English is at `/`, where `/en` leads |
| `/p/<id>` | One parcel, to anyone with the link |
| `/sample` | A made-up parcel on a parcel page, told by the browser: nothing is asked of the server or kept on the device. Its "Home page" link leads back to the landing |
| `/i/<key>`, `/invite` | A friend invitation ([FRIENDS.md](FRIENDS.md)) |
| `/demo` | The demo deliveries, kept on the device, to anyone; leaving the demo returns to `/` |
| `/guides`, `/guides/<slug>`; `/<language>/guides`, `/<language>/guides/<slug>` | The guides, articles for readers who arrive from a search engine, and their list, in the address's language whatever the browser prefers. English has no prefix. Any other address below a language's guides is sent to the 404 page by the proxy ([`proxy.ts`](../proxy.ts)), so the server writes that page whole. The landing's foot lists them |
| `/carriers`, `/carriers/<slug>`; `/<language>/carriers`, `/<language>/carriers/<slug>` | A page per carrier for readers who searched for its tracking, in the languages it is written in, and their list in every language. Above its text, a box takes a number to the landing in the page's language without putting it in the address. Any other address below a language's carriers, a carrier's in a language it is not written in too, is sent to the 404 page as a guide's is. The guides' foot and the landing's list of guides lead to them |
| `/email/off?lang=<language>#t=<token>` | The way out of the delivery email, from the link an email carries, in the email's language. It asks first, then switches the email off (or back on) for the account the token names, without a sign-in. The token stays after the `#` and travels only in the body of that request |

Sessions belong to one origin, so every address lives on the same host. With the iPhone
app installed, `/p/…` and `/i/…` open in the app.

The server draws the landing at `/` for everyone, because a sign-in lives in the browser's
storage. A script that runs before the first paint
([`entryHintConfig.ts`](../src/lib/entryHintConfig.ts)) marks a browser that holds a
sign-in, or has the demo open, so it shows the splash instead until its own screen is
ready. At `/home` and at a language's address the landing shows at once, and the script
only keeps "Sign in" out of sight for a browser that holds a sign-in. The map and the
sample parcels of the landing load when their sections come near; a visitor with parcels
on the device gets the map at once, for the routes on their cards.

`/` answers in the reader's language: the one they chose (the `sdt.locale` cookie), else
the browser's. A crawler sends neither and reads English, so every other language has an
address of its own, one page per language under `app/`, written in that language from the
first byte: `<html lang>`, the words, the title and the link preview.

- The proxy hands the page the address's language in place of the cookie the browser sent
  ([`proxy.ts`](../proxy.ts)), at a language address, at a guide's and at a carrier's page. No other address
  reads anything a client could not already choose, and the browser's own cookie is not
  written.
- In the browser the address's language wins over a saved choice, and a visit saves
  nothing. The language menu there saves the choice and moves the address with it, without
  a page load: to `/` for English, or to `/home` where `/` is the reader's deliveries, the
  demo or the sign-in step. Leaving the address for a parcel keeps the language on screen.
- A language address counts as the landing's own, like `/home`: someone signed in sees the
  landing there.
- Every page links the installed app's manifest in its language: `/manifest.webmanifest` in
  English, `/de/manifest.webmanifest` in German. A browser fetches a manifest without
  cookies, so its address carries the language, and the page moves the link when the reader
  picks another. Each names the same app (`id` `/`), so installing it from any language
  gives one app.

For search engines, `/robots.txt` lets everything be fetched and `/sitemap.xml` lists the
pages meant to be found: the landing, the guides' list and every guide in each language,
the carriers' list in each language and every carrier's page in each of its languages, and
the privacy notice. A guide or a carrier's page is dated by the day its facts were last
checked. Each
landing's HTML carries its title, description and canonical address, the address of every
other language (`hreflang`, with `/` for a reader of none of them), and a schema.org
description of the site and the app
([`landingStructuredData.ts`](../src/server/landingStructuredData.ts)). A guide carries
the same, with English for a reader of none, and describes itself as a schema.org article
([`guidePages.tsx`](../src/server/guidePages.tsx)). A carrier's page names only the
languages it is written in, and adds its questions as a schema.org FAQ
([`carrierPages.tsx`](../src/server/carrierPages.tsx)). `/home` names `/` as its canonical
address. Parcel links, invitations and `/email/off` answer `noindex` in a
header; the demo, the sample and the offline page say it in the page, and let their links
be followed. These addresses are written on `CANONICAL_ORIGIN` when it is set
([DEPLOYMENT.md](DEPLOYMENT.md)).

The landing comes without the code of the screens behind it. The account's screens (the
deliveries, signing in, an invitation, the demo) are fetched when one of them is about to
show ([`accountCode.ts`](../src/accountCode.ts)); the parcel page and the list of the
device's parcels once the landing is live ([`parcelCode.ts`](../src/peek/parcelCode.ts)).
The sign-in SDK comes with the page to a browser that holds a sign-in or returns from one,
and to anyone else once the page is idle or a sign-in starts
([`AuthContext.tsx`](../src/auth/AuthContext.tsx)). A browser the script marked asks for
what it will open on as its page loads, and comes alive with it. An address that opens on
such a screen (`/demo`, `/invite`, `/p/<id>`, `/sample`) brings the code along. Every page
of the app loads all the stylesheets, in one order ([`cascade.ts`](../src/cascade.ts)). A
guide is drawn by the server alone, with the site's base styles and its own
[`guides.css`](../src/guides/guides.css): the only script it adds to the page's own is its
usage count. A carrier's page is drawn the same way, and adds one more: its tracking box,
which notes the number in the tab's session storage for the landing to look up
([`carrierHandoff.ts`](../src/lib/carrierHandoff.ts)). Without it, the box opens the landing
alone.

## Data lifecycle

- **Adding a parcel** writes it through the user's RLS client and queues a job with the
  service role. Clients poll the small job resource, then reload the parcel list once.
- **A parcel's timeline** opens with a row Peek stores itself (an `app:` source): "Tracking
  added", or a new carrier still to answer. It is served only while no carrier scan is as
  old as it or older, a link placing it when the link was made, so a parcel added
  mid-journey or after its delivery shows the carrier's scans alone. The row never sets
  the stage, an alert or an email. An earlier carrier's relay copy of a scan is served
  under that scan ([handoffs](ROUTING.md#handoffs-two-carriers)).
  `src/server/eventPlaces.ts` applies this to every parcel and link the API serves; the
  account export keeps every stored row.
- **A pickup point** is named by most carriers only while the parcel waits there. A
  delivered parcel keeps the point it was collected from once the carrier stops naming it,
  so the apps and its links still say where: its last movement before the delivery made
  it ready for pickup (notices and problem reports are not movements), or, with no scan
  that moved it, its saved stage was ready for pickup. One taken back out for delivery,
  sent on or returned keeps none. The point stays only while the same carrier delivers:
  the one that named it, or the handoff partner that did, even through a universal
  provider. A partner reached since, or a carrier the owner or a correction chose instead,
  never shows it. A point the carrier names later replaces it
  ([`collectedPickupPoint.ts`](../src/server/collectedPickupPoint.ts)).
- **Archiving** keeps the parcel and its history, still checked daily for a while
  ([ROUTING.md](ROUTING.md)).
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
- **An answer about a parcel** (whether its page is right, or who carries a parcel no
  carrier was found for) is stored with the tracking number and what the service held
  about the parcel, and with no account, link or device. It outlives its parcel and is
  deleted 90 days after it was given, by the same maintenance pass.
- **A delivery email** leaves one row per parcel and stage in `delivery_emails`: sent,
  failed or skipped, with a reason code and none of its content. The row outlives its
  parcel, so nothing is told twice.
- **Deleting an account** removes the Auth user. Foreign-key cascades remove parcels,
  jobs, events, push registrations, Live Activity tokens, delivery email rows and audit
  rows. Other audit rows expire after 90 days.
- **Share target**: the PWA receives shared text via `POST`. The service worker keeps it
  in a one-time cache entry, so tracking text never appears in a URL or HTTP log. It then
  opens the app's add sheet, with the text or with why none came (too long, empty,
  unreadable): the worker cannot know the reader's language, so it names the reason in
  the address and the app says it.

## Notifications and Live Activities

- Web Push, APNs and Live Activities use the same status sentences. Delivered alerts show
  the carrier's event time in the recipient's timezone when the carrier gave a clock time.
- Estimates appear only while a parcel is on its way. They are hidden after delivery, a
  failed attempt, pickup readiness or a return, and whenever they are in the past.
- An `exception` means the carrier reported a problem that is neither a missed delivery
  nor a return. The parcel keeps its place and keeps refreshing.
- An archived parcel is never announced to its owner. Its new scans are recorded as
  handled without a browser or phone notification, or an alert the owner turned on for a
  lookup, so bringing it back does not announce them either. No Live Activity starts for
  it, and the delivery email leaves it out. Someone it was shared with still gets their
  link's alerts.
- A Live Activity starts only at `out_for_delivery`. It ends on delivery, failed attempt,
  problem, pickup, return, archive, sign-out or opt-out. At most two run at once. Live
  Activity pushes go first, so a successful one replaces the matching banner; if it fails,
  the banner is sent.
- The delivery email is apart from notifications: off until the account switches it on,
  and switched off per parcel. A visitor who signs in from the email row of a parcel
  link's notifications gets it switched on once that parcel is in the account. A parcel
  is told once when it is ready for pickup and once when it is delivered, so one picked
  up from a pickup point gets both: the second says it was picked up, when its last
  movement before the delivery made it ready for pickup, as
  the apps' pickup point does. Each goes after the notifications of the check that stored
  the scan, on deployments without push too.
  - A parcel is never emailed for what it already showed when it joined the account. A
    scan with a clock time must be later than that moment. One with only a day, or no
    time, counts when an earlier check of the parcel, since it joined, answered with
    another stage. Keeping a looked-up parcel is joining; merging two legs is not.
  - Nor is a scan stored before the email was switched on or more than 24 hours ago, or
    one that is not the parcel's newest.
  - A send that fails is tried again a quarter of an hour later, then an hour later,
    while the parcel still shows that stage.

## Copy and languages

App copy is available in English, German, French, Italian, Spanish, Portuguese and Polish
([shared/locales](../shared/locales/README.md)). Carrier scan text and parcel names are
shown as-is; known app-generated timeline messages are translated
([LOCALIZATION.md](LOCALIZATION.md)). Errors map to localized guidance and never show raw
diagnostics. Status labels don't imply a carrier delay when only our check failed.

Push registrations store the device language, and so does each of a browser's alerts for
a parcel link. The apps send it again on every start and change of language: the iPhone
with its device token, the web for the account's subscription and for the link alerts
whenever the language differs from the one it last sent, which it notes on the device.
The Share extension reads it from the app group. The delivery email is written in the
language the account's apps last stored with its sign-in.

## Contracts

`contracts/openapi.json` generates the TypeScript and Swift API types and the iPhone's
offline carrier catalog. `/api/carriers` serves the catalog with ETag so installed apps pick
up new carriers without a release; native carrier ids are plain strings, so unknown values
decode safely. `contracts/fixtures/delivery-api.json` is decoded by both TypeScript and
Swift tests to catch payload drift.
