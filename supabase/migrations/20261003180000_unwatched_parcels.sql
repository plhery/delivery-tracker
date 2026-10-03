-- Hourly checks for the parcels nobody is waiting for.
--
-- A parcel keeps the full schedule while a notification can reach someone
-- about it, or for an hour after it was looked at. A scheduled sync asks which
-- open parcels are neither, and checks those hourly. Everything it needs is
-- stored already, except when an account last read its parcels.
--
-- Apply this before deploying the server that uses it. The server before it
-- keeps working on this schema: it calls neither function.

begin;

create table public.account_activity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_opened_at timestamptz not null default now()
);

alter table public.account_activity enable row level security;
revoke all on public.account_activity from public, anon, authenticated;
grant select, insert, update, delete on public.account_activity to service_role;

comment on table public.account_activity is
  'When each account last read its parcels: they keep the full schedule for an hour after it. Service role only.';
comment on column public.account_activity.last_opened_at is
  'Moves at most every five minutes.';

-- Records that the current account read its parcels, at most every 5 minutes.
create function public.record_account_opened()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.account_activity as activity (user_id)
  select auth.uid() where auth.uid() is not null
  on conflict (user_id) do update set last_opened_at = now()
  where activity.last_opened_at < now() - interval '5 minutes';
$$;

revoke all on function public.record_account_opened() from public, anon, service_role;
grant execute on function public.record_account_opened() to authenticated;

comment on function public.record_account_opened() is
  'Records that the current account read its parcels, which keeps them on the full schedule for an hour.';

-- The open parcels nobody is waiting for: no notification can reach anyone
-- about them, and neither their account nor the holder of one of their links
-- looked at them since the given time. A scheduled sync checks these hourly.
create function public.unwatched_package_ids(p_opened_since timestamptz)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select package.id
  from public.packages as package
  where package.archived_at is null
    and (
      package.current_stage not in ('delivered', 'returned')
      or package.last_status_text = 'TO_BE_DELIVERED'
    )
    -- A link, opened lately or with an alert on.
    and not exists (
      select 1 from public.parcel_links as link
      where link.package_id = package.id
        and (
          link.last_opened_at > p_opened_since
          or exists (
            select 1 from public.parcel_link_alerts as alert
            where alert.link_id = link.id and (link.shared or alert.owner)
          )
        )
    )
    -- The account's apps, open lately.
    and not exists (
      select 1 from public.account_activity as activity
      where activity.user_id = package.user_id
        and activity.last_opened_at > p_opened_since
    )
    -- The account's notifications, which a parcel can be muted for.
    and (
      package.notifications_muted
      or not (
        exists (
          select 1 from public.push_subscriptions as subscription
          where subscription.user_id = package.user_id and subscription.disabled_at is null
        )
        or exists (
          select 1 from public.native_push_devices as device
          where device.user_id = package.user_id and device.disabled_at is null
        )
      )
    )
    and not exists (
      select 1 from public.live_activity_devices as device
      where device.user_id = package.user_id and device.disabled_at is null
    )
    -- The email on delivery, which a parcel can be left out of.
    and (
      package.email_muted
      or not exists (
        select 1 from public.notification_preferences as preference
        where preference.user_id = package.user_id and preference.email_on_delivery
      )
    );
$$;

revoke all on function public.unwatched_package_ids(timestamptz) from public, anon, authenticated;
grant execute on function public.unwatched_package_ids(timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
