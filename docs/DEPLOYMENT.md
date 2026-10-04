# Deployment

The app is one long-running Next.js container: web, API and background worker. It needs
Supabase (Auth, PostgREST, Postgres 16+) and HTTPS. The official instance runs at
`https://peektracker.com`, behind Cloudflare.

## Requirements

- A Supabase stack and a tested backup/restore path.
- SMTP with an authenticated sending domain, if email sign-in or the delivery email is on.
- A host that can build the `Dockerfile` and keep the container running. Serverless
  won't work: the worker must stay alive.
- Optional: stable VAPID keys (Web Push), and an APNs key with an Apple team (iPhone
  notifications and Live Activities).

Never pass the service-role, VAPID private, SMTP, APNs or carrier credentials as build
arguments.

## 1. Database

Back up, then apply every `supabase/migrations/*.sql` in filename order, stopping at the
first error. CI applies the full history to a clean Postgres 16 and runs the RLS
assertions. To do the same locally, point `TEST_DATABASE_URL` at a disposable database and
run `scripts/test-migrations.sh`.

**Upgrades.** Migrations are append-only and written to be compatible with the running
version. Apply new ones **before** deploying the server that needs them. Deploy the
server before releasing iPhone builds that call new endpoints.

Relaxing a carrier input (making a postcode optional, say) follows the same order:
migration, then server, then app. Until an updated iPhone app first reaches
`/api/carriers` it uses its bundled catalog, so an older server can still reject what the
new app sends.

## 2. Auth and email

Follow [AUTHENTICATION.md](AUTHENTICATION.md). In short:

1. Set the Auth Site URL to the public origin and restrict redirect URLs.
2. Enable email OTP and point the magic-link and confirmation templates at
   `/auth-emails/magic-link.html`.
3. Configure Google (and optionally Apple). Turn off a frontend method whose provider isn't
   ready.
4. For email: SPF, DKIM, DMARC, CAPTCHA and Auth rate limits.
5. Leave session time-box and inactivity limits off, or set both to 30 days or more.

## 3. Build and run

Public Supabase values are build arguments:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example \
  -t delivery-tracker .
```

The build fails early unless API mode is on and at least one sign-in method is enabled.

`NEXT_PUBLIC_IOS_APP_URL` is an optional build argument: the https address of the iPhone
app's page. The landing shows "Get the iPhone app" only when it is set.

`IMAGE_COMMIT` is an optional build argument too: the full commit the image is built from.
It names the Sentry release, unless the platform sets `IMAGE_COMMIT` at runtime.

At runtime, set the server Supabase values and `SUPABASE_SERVICE_ROLE_KEY`. Push is
optional:

- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (the canonical origin
  when unset).
- APNs: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (the whole `.p8`) and
  `APNS_BUNDLE_ID`. The same key sends alerts and Live Activity pushes.

Partial VAPID or APNs configuration is rejected at startup. [`.env.example`](../.env.example)
lists everything. Copy it to `.env`, set the Supabase values and
`NEXT_PUBLIC_USE_API=true`, remove the optional services you don't use, and start the
container:

```bash
docker run -d --name delivery-tracker --restart unless-stopped \
  --env-file .env -p 3000:3000 delivery-tracker
```

The public Supabase values must be the same at build time and at runtime.

**Links that open in the iPhone app.** `/.well-known/apple-app-site-association` lets iOS
open parcel links and invitations (`/p/…`, `/i/…`, `/invite`) in the app. It names the app
that receives the APNs pushes, or the apps in `APPLE_APP_IDS` (`<team id>.<bundle id>`,
comma-separated) when set. Without either it answers 404. Apple's servers fetch it without
credentials and don't follow redirects, so keep it reachable through any edge protection.

- Expose port `3000` behind HTTPS.
- `GET /health` returns `{"ok": true}` when the database answers within 2.5 s and the
  worker has polled or renewed a job in the last 120 s. Otherwise it returns 503.
  `GET /health/live` checks the process only.
- Set `TRUST_PROXY_HEADERS=true` only if a trusted proxy overwrites `CF-Connecting-IP`,
  `X-Real-IP` and `X-Forwarded-For`. Without it, every visitor without an account shares
  one client allowance. With Cloudflare, keep IP geolocation enabled and overwrite
  `CF-IPCountry` too: new parcel lookups use it as a weak country hint for fallback.
- Optional: `PUBLIC_LOOKUPS_PER_DAY` (default 15) and `PUBLIC_LOOKUPS_GLOBAL_PER_DAY`
  (default 3000) set how many parcels can be looked up without an account per UTC day, per
  client and overall. `0` turns lookups off. An IPv6 /48 may make ten clients' lookups.
- Optional: `PUBLIC_DETECTIONS_PER_DAY` (default 60) and
  `PUBLIC_DETECTIONS_GLOBAL_PER_DAY` (default 10000) set how many numbers carriers are
  asked about before a lookup, without an account, per UTC day, per client and overall.
  Past them, and with `0`, a carrier is detected from the number's shape only.
- Set the platform's stop grace period to **30 s** (Coolify: *Stop Grace Period*).
- Don't set `NEXT_DEPLOYMENT_ID`: it changes every asset URL on each deploy, so returning
  browsers re-download everything.

After deploying, run `scripts/smoke-url.sh https://your-hostname` from outside the origin.

## Deploying from CI

The CI workflow builds the image while the tests run. To let it publish and deploy, set
in the repository:

- the public build values as variables (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the `NEXT_PUBLIC_AUTH_*` switches). With
  them, a commit on `main` is published as `ghcr.io/<owner>/<repository>:<commit>`.
  `CONTAINER_IMAGE_REPOSITORY` can keep an existing `<owner>/<package>` path when the
  repository is renamed;
- `DEPLOY_ENABLED=true` and `DEPLOY_URL` (the public origin) as variables;
- `DEPLOY_SSH_TARGET` (`user@host`), `DEPLOY_SSH_KEY` and `DEPLOY_SSH_KNOWN_HOSTS` as
  secrets.

[Suite selection](../scripts/ci-changes.mjs) compares each target with the nearest
successful `main` ancestor of that workflow, or with the pull request base. This includes
changes from canceled and replaced runs. Without a trusted baseline, every suite runs.
Documentation skips application tests. SQL changes run migration tests; native changes
run iPhone tests; web changes run web checks, unit tests, browser journeys and the image
build. Dependencies and shared client data run both web and iPhone tests. Scraper updates
keep browser journeys because the package supplies browser code too.

For web changes, once all selected checks have passed, the workflow runs `deploy <commit>`
over SSH on the target and then the smoke test on `DEPLOY_URL`. Intentionally skipped
migration tests allow deployment; failures and canceled checks block it. Restrict the key
on the host to a command that accepts only that request and starts the published image.
Runs on `main` go one at a time; of the pushes that arrive during a run, only the newest
is tested and deployed next. Documentation, native-only and SQL-only changes do not
deploy the web image. The iPhone app is tested in its own workflow and does not hold a
deploy back.

## Delivery email

Optional. With mail settings, an account can ask for one email when a parcel is delivered,
sent to the address it signs in with. Without them, nothing in the app mentions email.

Set `SMTP_HOST`, `EMAIL_FROM` and `CANONICAL_ORIGIN`; [`.env.example`](../.env.example)
lists the rest. Any SMTP service works. The connection is always encrypted: TLS from the
start on port 465 or with `SMTP_SECURE=true`, STARTTLS otherwise. A partial or malformed
set stops the server at startup.

- **Sending domain**: the domain of `EMAIL_FROM` needs SPF, DKIM and DMARC.
- **Unsubscribe header**: every email carries `List-Unsubscribe` and
  `List-Unsubscribe-Post`, which give mail apps their own "Unsubscribe". The provider's
  DKIM signature must cover both headers, or mail apps ignore them. They need an HTTPS
  `CANONICAL_ORIGIN`; over HTTP they are left out.
- **Tracking**: switch the provider's open and click tracking off. The email loads nothing
  when it is read and its links go straight to the site.
- **Privacy notice**: the mail provider receives each recipient's address and the email.
  Name it in your own privacy notice.
- **Allowances**: `DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY` (default 20) and
  `DELIVERY_EMAILS_PER_DAY` (default 80) cap the emails of any 24 hours. An email beyond
  one is skipped, not sent later. Keep the second under the provider's allowance, which
  sign-in codes sent through the same service share.
- **Unsubscribe links** are signed with a key derived from `SUPABASE_SERVICE_ROLE_KEY` and
  never expire. Rotating that key invalidates the links of emails already sent; the switch
  in the app still works.
- **Apple relay addresses** (`@privaterelay.appleid.com`) are skipped until the sender is
  registered with Apple's email relay and `EMAIL_APPLE_RELAY=true`.

## Moving to another host

One container can answer on several hosts. To move the site, serve the new host next to
the old one, then set:

```dotenv
CANONICAL_ORIGIN=https://peek.example.com
LEGACY_HOSTS=delivery.example.com
```

`LEGACY_HOSTS` is a comma-separated list of hostnames. Unset, nothing is redirected. A
malformed value stops the server at startup.

- A page opened on a legacy host answers `308` to the same path and query on the canonical
  origin, so shared parcel links and invitations keep working.
- Everything a client fetches on its own stays where it is: `/api`, `/health`, assets, the
  service workers, the manifest, `/.well-known`, `/auth-emails` and `/og.png`. Installed
  iPhone apps and open sessions keep calling the old host with their token, which a
  redirect to another host would drop.
- `/robots.txt` and `/sitemap.xml` answer on every host too, and name the canonical origin:
  a crawler of the old host is let in, follows the redirects, and finds the new addresses.
- A browser that already has the old host's service worker gets the app from it, without
  asking the server. A tab then continues at the same address on the canonical origin. An
  installed web app stays on the old host and keeps working there, with its session and
  its notifications.
- Sessions belong to an origin: people sign in again on the new one, and turn notifications
  on again there.

Keep both hosts in the Auth redirect allow list ([AUTHENTICATION.md](AUTHENTICATION.md))
and in the iPhone app's link hosts ([iPhone app](../ios/README.md)) for as long as the old
host answers. Point `UMAMI_APP_ORIGIN` and the smoke test at the new host.

## Shutdown and crash recovery

On SIGTERM/SIGINT the process turns unready at once and stops taking new work. It aborts
active tracking and hands its job back to the queue, closing audit rows as `interrupted`
without using up a retry. Next.js then drains HTTP requests. Time limits: 6.5 s for the
handoff, 500 ms for Sentry, 25 s overall.

If a process is killed or the host dies, its job's **90 s lease** (renewed every 15 s)
expires and another worker picks it up. A job gets three crash attempts; orderly deploys
don't count. All writes are fenced by lease ownership and the database clock, so
overlapping containers can safely share the queue.

Open browsers keep their build. Assets are content-hashed and precached. The app switches
to a new build by itself, in the background or after a few idle seconds, and never while
something is open or being typed. It comes back to the same tab, parcel and scroll
position.

`npm run test:deployment` (run in CI after the build) interrupts a job on the built server,
checks the handoff, restarts and finishes the job.

## Operating

### Browser verification

Create a Cloudflare Turnstile **Managed** widget for the public hostnames, with
pre-clearance off. Set `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and
`TURNSTILE_HOSTNAMES` (comma-separated) at runtime. All three are required
together; leave them unset to disable verification. Test keys are refused in
production. Keep the secret out of build arguments and browser configuration.

The lookup form starts verification when used and shows a checkbox only when
needed. A successful check grants a short-lived proof; existing lookup budgets
still apply. Only parcel creation and detection that contacts a carrier need
verification. Saved parcels and shared links remain readable during a
verification outage. Keep the origin behind the trusted proxy and avoid
Cloudflare challenge pages on JSON APIs and native app traffic.
Set `TURNSTILE_ALLOW_NATIVE_USER_AGENT=true` to keep existing anonymous iPhone
lookups working without verification. This exempts the app's
`PeekDeliveryTracker/... CFNetwork/... Darwin/...` user-agent; Safari still
requires verification. The header can be forged, so this compatibility setting
leaves a bypass for scrapers. Updated apps opt into verification even while this
setting is enabled. Turn it off once older installations have been replaced.
All lookup budgets still apply. The default is
`false`, which requires verification from every anonymous caller.

Native builds signed with a free Personal Team use the hosted Turnstile check
and keep its proof in memory. Apple App Attest needs paid Developer membership.
For paid builds, enable App Attest on the app identifier and set
`APP_ATTEST_APP_ID` to the App ID prefix and bundle identifier separated by a
period. Leave it unset for the free fallback. Production accepts production
attestations only. A separate development server can set
`APP_ATTEST_ALLOW_DEVELOPMENT=true`; production refuses that setting.

App Attest registers the installation's public key, then signs each anonymous
lookup or provider detection with a fresh challenge and the exact request body.
The server rejects replayed challenges and counters. Set `NATIVE_LOOKUPS_PER_DAY`
and `NATIVE_DETECTIONS_PER_DAY` for installation budgets; `0` disables that work.
Network and global budgets still apply. Apple outages and unsupported devices
use Turnstile. Signed-in requests use account budgets.

Accounts have separate persistent daily budgets for parcel additions and
carrier detections. Set `ACCOUNT_LOOKUPS_PER_DAY` and
`ACCOUNT_DETECTIONS_PER_DAY` to tune them; `0` disables that work. Cached and
local carrier detection does not spend the detection budget.

See [OBSERVABILITY.md](OBSERVABILITY.md) for verification monitoring.

### Service operation

- **Sentry**: set `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, an immutable release, and
  keep tracing at 0 unless you mean it. See [OBSERVABILITY.md](OBSERVABILITY.md) for alerts,
  logs and audit queries.
- **Logs** are one-line JSON. Alert on `sync_job_failed` and `sync_job_finish_failed`, and
  on `sync_claim_failed` once it repeats for two minutes (its `failing_for_ms`). They
  contain tracking numbers, so restrict access.
- **API limits** per account: 12 sync requests per 5 min, 240 reads per minute, 60 other
  writes per minute. Keep an edge rate limiter too, since unauthenticated OTP traffic needs
  it.
- **Limits without an account**, per client address: 6 lookups and 20 carrier detections
  per minute, 120 link reads per minute, and the daily allowances above. The limits per
  minute are kept in memory and start again with each deploy; the daily ones are in the
  database. A write is refused when a browser says a page of another site sent it.
- **Quotas** (enforced in the database): 50 active and 500 total parcels per account.
  Scheduled sync processes at most five due parcels per account per run, and ten followed
  without an account. Treat changes to these limits as security-sensitive.
- **Queue**: `public.sync_jobs`, deduplicated. Finished jobs are kept for 30 days.
- **Backups**: back up Postgres independently and regularly test restoring Auth, parcels,
  events and push tables together.
- **Secrets**: rotate anything exposed. New VAPID keys invalidate all browser subscriptions.
  Revoke an exposed APNs key in the Apple Developer portal before replacing it. A new
  service-role key invalidates the unsubscribe links of delivery emails already sent.

## Migrating from a pre-account deployment

Early private deployments stored parcels without an owner (`user_id IS NULL`). Those rows
are invisible to everyone until claimed. New deployments can skip this section. Parcels
looked up without an account have no owner either; they are marked `one_off` and stay as
they are.

Keep any edge authentication (Cloudflare Access) in place until this is done. Sign in once
as the intended owner, then, with the service role:

```sql
-- Preflight: owner id, ownerless counts, duplicate numbers
select id, email, created_at from auth.users order by created_at;
select count(*) from public.packages where user_id is null and not one_off;
select tracking_number, count(*) from public.packages
where (user_id is null and not one_off) or user_id = 'OWNER_UUID'::uuid
group by tracking_number having count(*) > 1;

-- Resolve duplicates, then claim (one way)
begin;
update public.packages set user_id = 'OWNER_UUID'::uuid where user_id is null and not one_off;
delete from public.push_subscriptions where user_id is null;  -- users opt in again
alter table public.packages validate constraint packages_owner_required_check;
alter table public.push_subscriptions validate constraint push_subscriptions_owner_required_check;
alter table public.push_subscriptions alter column user_id set not null;
commit;
```

Then check isolation with a second disposable account and try the main flows (add,
refresh, archive, push opt-in, export, sign-out, delete). Only after that, remove the edge
authentication. If something goes wrong, turn edge authentication back on. Never set
`user_id` back to null.

`packages.user_id` stays nullable: a parcel looked up without an account has no owner. The
validated constraint is what rejects any other ownerless row.
