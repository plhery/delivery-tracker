# Deployment

The app is one long-running Next.js container: web, API and background worker. It needs
Supabase (Auth, PostgREST, Postgres 16+) and HTTPS. The official instance runs at
`https://delivery.plhery.com`, behind Cloudflare.

## Requirements

- A Supabase stack and a tested backup/restore path.
- SMTP with an authenticated sending domain, if email sign-in is on.
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

For example, `20260926170000_optional_dpd_postcode.sql` lets DPD parcels be saved without
a postcode. A server that accepts them before this migration is applied answers those
requests with 502 errors. Older servers still require the postcode, so applying it early
is safe. Release the iPhone build that marks the postcode optional after that server. Until
an updated app first reaches `/api/carriers` it uses its bundled catalog, where the postcode
is optional, and an older server rejects DPD parcels sent without one. After that, the app
follows the server's catalog and shows the postcode as optional only when the server does.

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

At runtime, set the server Supabase values and `SUPABASE_SERVICE_ROLE_KEY`. Push is
optional:

- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- APNs: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (the whole `.p8`) and
  `APNS_BUNDLE_ID`. The same key sends alerts and Live Activity pushes.

Partial VAPID or APNs configuration is rejected at startup. [`.env.example`](../.env.example)
lists everything.

- Expose port `3000` behind HTTPS.
- `GET /health` returns `{"ok": true}` when the database answers within 2.5 s and the
  worker has polled or renewed a job in the last 120 s. Otherwise it returns 503.
  `GET /health/live` checks the process only.
- Set `TRUST_PROXY_HEADERS=true` only if a trusted proxy overwrites `CF-Connecting-IP`,
  `X-Real-IP` and `X-Forwarded-For`.
- Set the platform's stop grace period to **30 s** (Coolify: *Stop Grace Period*).
- Don't set `NEXT_DEPLOYMENT_ID`: it changes every asset URL on each deploy, so returning
  browsers re-download everything.

After deploying, run `scripts/smoke-url.sh https://your-hostname` from outside the origin.

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

- **Sentry**: set `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, an immutable release, and
  keep tracing at 0 unless you mean it. See [OBSERVABILITY.md](OBSERVABILITY.md) for alerts,
  logs and audit queries.
- **Logs** are one-line JSON. Alert on `sync_claim_failed`, `sync_job_failed` and
  `sync_job_finish_failed`. They contain tracking numbers, so restrict access.
- **API limits** per account: 12 sync requests per 5 min, 240 reads per minute, 60 other
  writes per minute. Keep an edge rate limiter too, since unauthenticated OTP traffic needs
  it.
- **Quotas** (enforced in the database): 50 active and 500 total parcels per account.
  Scheduled sync processes at most five due parcels per account per run. Treat changes to
  these limits as security-sensitive.
- **Queue**: `public.sync_jobs`, deduplicated. Finished jobs are kept for 30 days.
- **Backups**: back up Postgres independently and regularly test restoring Auth, parcels,
  events and push tables together.
- **Secrets**: rotate anything exposed. New VAPID keys invalidate all browser subscriptions.
  Revoke an exposed APNs key in the Apple Developer portal before replacing it.

## Migrating from a pre-account deployment

Early private deployments stored parcels without an owner (`user_id IS NULL`). Those rows
are invisible to everyone until claimed. New deployments can skip this section.

Keep any edge authentication (Cloudflare Access) in place until this is done. Sign in once
as the intended owner, then, with the service role:

```sql
-- Preflight: owner id, ownerless counts, duplicate numbers
select id, email, created_at from auth.users order by created_at;
select count(*) from public.packages where user_id is null;
select tracking_number, count(*) from public.packages
where user_id is null or user_id = 'OWNER_UUID'::uuid
group by tracking_number having count(*) > 1;

-- Resolve duplicates, then claim (one way)
begin;
update public.packages set user_id = 'OWNER_UUID'::uuid where user_id is null;
delete from public.push_subscriptions where user_id is null;  -- users opt in again
alter table public.packages validate constraint packages_owner_required_check;
alter table public.packages alter column user_id set not null;
alter table public.push_subscriptions validate constraint push_subscriptions_owner_required_check;
alter table public.push_subscriptions alter column user_id set not null;
commit;
```

Then check isolation with a second disposable account and try the main flows (add,
refresh, archive, push opt-in, export, sign-out, delete). Only after that, remove the edge
authentication. If something goes wrong, turn edge authentication back on. Never set
`user_id` back to null.
