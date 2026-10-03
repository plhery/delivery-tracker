-- One email when a parcel is delivered.
--
-- An account can ask for one short email per parcel, when it is delivered. The
-- choice lives with its notification preferences and is off until made; one
-- parcel can be left out. The server claims the delivered scans to announce in
-- delivery_emails, whose rows are also the record that a parcel was told: a
-- parcel is emailed at most once, and never when it was already delivered as
-- it joined the account.
--
-- Apply this before deploying the server that sends the email. The server
-- before it keeps working on this schema: it saves preferences with the four
-- arguments it knows, which keeps the email choice, and it names the package
-- columns it reads.

begin;

-- The account's choice: true on, false off or declined, NULL never made.
alter table public.notification_preferences
  add column email_on_delivery boolean,
  add column email_enabled_at timestamptz,
  add constraint notification_preferences_email_enabled_check check (
    email_on_delivery is not true or email_enabled_at is not null
  );

comment on column public.notification_preferences.email_on_delivery is
  'Whether the account gets one email when a parcel is delivered. NULL until the account chooses.';
comment on column public.notification_preferences.email_enabled_at is
  'When the email was last switched on. Scans stored before it are never emailed.';

-- The email choice is a fifth argument. NULL keeps what is stored, so a caller
-- that sends the four older arguments changes nothing about the email. The
-- four-argument function goes in the same transaction: PostgREST must find one
-- candidate for those arguments. Everything else is copied from
-- 20260913110000_exception_tracking_stage.sql.
drop function public.set_owned_notification_preferences(text[], time, time, text);

create function public.set_owned_notification_preferences(
  p_enabled_stages text[],
  p_quiet_hours_start time default null,
  p_quiet_hours_end time default null,
  p_timezone text default 'Europe/Zurich',
  p_email_on_delivery boolean default null
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  saved public.notification_preferences;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if p_enabled_stages is null
      or cardinality(p_enabled_stages) not between 1 and 10
      or not p_enabled_stages <@ array[
        'registered', 'accepted', 'in_transit', 'customs', 'exception',
        'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered',
        'returned'
      ]::text[]
      or cardinality(p_enabled_stages) <> cardinality(array(
        select distinct stage from unnest(p_enabled_stages) as stage
      )) then
    raise exception 'Invalid notification stages' using errcode = '22023';
  end if;
  if (p_quiet_hours_start is null) <> (p_quiet_hours_end is null)
      or p_quiet_hours_start = p_quiet_hours_end then
    raise exception 'Invalid quiet hours' using errcode = '22023';
  end if;
  if p_timezone is null
      or char_length(p_timezone) not between 1 and 64
      or not exists (
        select 1 from pg_catalog.pg_timezone_names where name = p_timezone
      ) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;

  insert into public.notification_preferences as stored (
    user_id,
    enabled_stages,
    quiet_hours_start,
    quiet_hours_end,
    timezone,
    email_on_delivery,
    email_enabled_at,
    updated_at
  ) values (
    actor_id,
    p_enabled_stages,
    p_quiet_hours_start,
    p_quiet_hours_end,
    p_timezone,
    p_email_on_delivery,
    case when p_email_on_delivery then now() end,
    now()
  )
  on conflict (user_id) do update set
    enabled_stages = excluded.enabled_stages,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    timezone = excluded.timezone,
    email_on_delivery = coalesce(excluded.email_on_delivery, stored.email_on_delivery),
    -- Switching the email on starts it from now: nothing stored before is announced.
    email_enabled_at = case
      when excluded.email_on_delivery and stored.email_on_delivery is not true then now()
      else stored.email_enabled_at
    end,
    updated_at = excluded.updated_at
  returning * into saved;

  return saved;
end;
$$;

revoke all on function public.set_owned_notification_preferences(text[], time, time, text, boolean)
  from public, anon;
grant execute on function public.set_owned_notification_preferences(text[], time, time, text, boolean)
  to authenticated;

-- Switches an account's delivery email from the link its emails carry. The
-- application has checked the link's token; nobody is signed in. An account
-- that never saved preferences gets its row, with the defaults. Answers the
-- stored choice, or NULL when the account does not exist.
create function public.set_delivery_email(p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved boolean;
begin
  if p_user_id is null or p_enabled is null then
    raise exception 'Invalid delivery email setting' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users where id = p_user_id and not is_anonymous
  ) then
    return null;
  end if;

  insert into public.notification_preferences as stored (user_id, email_on_delivery, email_enabled_at)
  values (p_user_id, p_enabled, case when p_enabled then now() end)
  on conflict (user_id) do update set
    email_on_delivery = excluded.email_on_delivery,
    email_enabled_at = case
      when excluded.email_on_delivery and stored.email_on_delivery is not true then now()
      else stored.email_enabled_at
    end,
    updated_at = now()
  returning stored.email_on_delivery into saved;
  return saved;
end;
$$;

revoke all on function public.set_delivery_email(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_delivery_email(uuid, boolean) to service_role;

-- One parcel can be left out of the email, as it can be muted for notifications.
alter table public.packages
  add column email_muted boolean not null default false,
  add column owned_since timestamptz;

comment on column public.packages.email_muted is
  'True when the parcel owner wants no delivery email for this parcel.';
comment on column public.packages.owned_since is
  'When the parcel joined its account: added to it, or kept from a lookup. NULL for a parcel added before this was recorded; created_at then says it.';

-- created_at cannot say when a parcel joined its account: a lookup kept after
-- signing in keeps its row, and merging two legs gives the survivor the older
-- leg's date. Rows from before this migration keep NULL.
create function public.mark_package_owned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    new.owned_since := now();
  end if;
  return new;
end;
$$;

create trigger packages_mark_owned
before insert or update of user_id on public.packages
for each row execute function public.mark_package_owned();

revoke all on function public.mark_package_owned() from public, anon, authenticated;

create function public.set_owned_package_email_muted(
  p_package_id uuid,
  p_muted boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  changed uuid;
begin
  if auth.uid() is null or p_muted is null then
    raise exception 'Invalid email setting' using errcode = '22023';
  end if;

  update public.packages
  set email_muted = p_muted
  where id = p_package_id
    and user_id = auth.uid()
  returning id into changed;

  return changed is not null;
end;
$$;

revoke all on function public.set_owned_package_email_muted(uuid, boolean) from public, anon;
grant execute on function public.set_owned_package_email_muted(uuid, boolean) to authenticated;

comment on function public.set_owned_package_email_muted(uuid, boolean) is
  'Changes only the current account owner delivery email setting for one package.';

-- The parcels claimed for a delivery email, one row each. A row is kept when
-- its parcel or its scan goes, so the delivery it told is not told again, and
-- it goes with the account.
create table public.delivery_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  package_id uuid unique references public.packages (id) on delete set null,
  event_id uuid unique references public.tracking_events (id) on delete set null,
  status text not null default 'claimed'
    constraint delivery_emails_status_check check (status in ('claimed', 'sent', 'failed', 'skipped')),
  reason text
    constraint delivery_emails_reason_check check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  attempts smallint not null default 0
    constraint delivery_emails_attempts_check check (attempts between 0 and 3),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint delivery_emails_sent_check check ((status = 'sent') = (sent_at is not null))
);

create index delivery_emails_user_idx on public.delivery_emails (user_id, claimed_at);

alter table public.delivery_emails enable row level security;
revoke all on public.delivery_emails from public, anon, authenticated;
grant select, insert, update, delete on public.delivery_emails to service_role;

comment on table public.delivery_emails is
  'One row per parcel claimed for a delivery email: sent, failed, or passed over with a reason. A parcel with a row is never emailed again. Service role only.';
comment on column public.delivery_emails.event_id is
  'The delivered scan the email tells.';
comment on column public.delivery_emails.status is
  'claimed while the server sends it, then sent, failed (claimed again later, up to three attempts) or skipped.';
comment on column public.delivery_emails.reason is
  'Why an email failed or was skipped, as a short code.';
comment on column public.delivery_emails.attempts is
  'How many times the email was claimed for sending.';
comment on column public.delivery_emails.claimed_at is
  'When the email was last claimed. A failed one is claimed again some time after.';

-- Picks the delivered scans to announce and records each claim in the same
-- statement, so two servers never send the same one. A scan is announced when:
--
-- - its parcel belongs to an account whose email is on, is not left out of the
--   email, is not archived and is delivered;
-- - it was stored after the email was switched on and in the last 24 hours;
-- - it is the parcel's newest scan, give or take the hour of clock skew the
--   notifications allow;
-- - the delivery came after the parcel joined the account. A scan with a clock
--   time must be later than that moment. One that carries only a day, or no
--   time at all, counts when an earlier check of the parcel, since it joined,
--   answered without a delivery: the first answer cannot tell a delivery of
--   today from one of this morning;
-- - neither the parcel nor one of its scans has a row yet, other than a failed
--   one with attempts left: the second attempt waits a quarter of an hour, the
--   third an hour, so a mail server that is down for a while loses nothing. A
--   merge moves the scans of one leg to the other.
--
-- At most p_limit scans are handled per call, the oldest first. One beyond the
-- account's allowance, or everyone's, of emails in 24 hours is recorded as
-- skipped and never sent later. Answers what must be sent now, with what each
-- delivered scan knows of its time (timed, date or none) as the notification
-- queues read it, and how many were skipped for either allowance.
create function public.claim_delivery_emails(
  p_limit integer,
  p_per_account integer,
  p_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_limit is null or p_limit < 1
      or p_per_account is null or p_per_account < 0
      or p_per_day is null or p_per_day < 0 then
    raise exception 'Invalid delivery email allowance' using errcode = '22023';
  end if;

  -- One claim at a time: both allowances count what the other servers claimed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delivery-emails', 0));

  with scan as (
    select
      package.id as package_id,
      package.user_id,
      event.id as event_id,
      event.occurred_at,
      event.created_at as stored_at,
      preference.timezone,
      coalesce(package.owned_since, package.created_at) as joined_at,
      case
        when event.raw_data -> 'observed_without_provider_timestamp' = 'true'::jsonb then 'none'
        when event.raw_data ->> 'time' ~ '[T ][0-9]{2}:[0-9]{2}' then 'timed'
        when event.raw_data ->> 'time' ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[./][0-9]{2}[./][0-9]{4})' then 'date'
        else 'none'
      end as delivered_time
    from public.notification_preferences as preference
    join public.packages as package on package.user_id = preference.user_id
    join public.tracking_events as event on event.package_id = package.id
    where preference.email_on_delivery
      and not package.email_muted
      and package.archived_at is null
      and package.current_stage = 'delivered'
      and event.stage = 'delivered'
      and (event.provider_event_id is null or event.provider_event_id not like 'app:%')
      and event.created_at > preference.email_enabled_at
      and event.created_at > now() - interval '24 hours'
  ),
  candidate as (
    select distinct on (scan.package_id) scan.*, previous.id as previous_id
    from scan
    left join public.delivery_emails as previous on previous.package_id = scan.package_id
    where scan.stored_at > scan.joined_at
      and case
        when scan.delivered_time = 'timed' then scan.occurred_at > scan.joined_at
        -- A day is stored as its first moment, so it may read up to a day early.
        else scan.occurred_at > scan.joined_at - interval '1 day' and exists (
          select 1 from public.tracking_sync_attempts as earlier
          where earlier.package_id = scan.package_id
            and earlier.outcome = 'updated'
            and earlier.selected_stage is distinct from 'delivered'
            and earlier.started_at >= scan.joined_at
            and earlier.completed_at < scan.stored_at
        )
      end
      and coalesce(scan.occurred_at >= (
        select max(other.occurred_at)
        from public.tracking_events as other
        where other.package_id = scan.package_id
          and (other.provider_event_id is null or other.provider_event_id not like 'app:%')
          and other.occurred_at <= now()
      ) - interval '1 hour', true)
      and (previous.id is null or (
        previous.status = 'failed'
        and previous.attempts < 3
        and previous.claimed_at <= now() - case when previous.attempts < 2 then interval '15 minutes' else interval '1 hour' end
      ))
      and not exists (
        select 1
        from public.delivery_emails as told
        join public.tracking_events as told_scan on told_scan.id = told.event_id
        where told_scan.package_id = scan.package_id
          and told.package_id is distinct from scan.package_id
      )
    order by scan.package_id, scan.occurred_at desc, scan.stored_at desc, scan.event_id
  ),
  batch as (
    select limited.*,
      row_number() over (partition by limited.user_id order by limited.stored_at, limited.event_id) as account_position
    from (
      select * from candidate order by candidate.stored_at, candidate.event_id limit least(p_limit, 100)
    ) as limited
  ),
  used as (
    select email.user_id, count(*) as emails
    from public.delivery_emails as email
    where email.status in ('claimed', 'sent')
      and coalesce(email.sent_at, email.claimed_at) > now() - interval '24 hours'
    group by email.user_id
  ),
  judged as (
    select batch.*, batch.account_position + coalesce(used.emails, 0) <= p_per_account as account_allows
    from batch
    left join used on used.user_id = batch.user_id
  ),
  decided as (
    select judged.*,
      case
        when not judged.account_allows then 'account_cap'
        when (select coalesce(sum(used.emails), 0) from used)
          + count(*) filter (where judged.account_allows) over (order by judged.stored_at, judged.event_id)
          > p_per_day then 'service_cap'
      end as skipped
    from judged
  ),
  inserted as (
    insert into public.delivery_emails (user_id, package_id, event_id, status, reason, attempts)
    select decided.user_id, decided.package_id, decided.event_id,
      case when decided.skipped is null then 'claimed' else 'skipped' end,
      decided.skipped,
      case when decided.skipped is null then 1 else 0 end
    from decided
    where decided.previous_id is null
    on conflict do nothing
    returning id, package_id, status
  ),
  retried as (
    update public.delivery_emails as email
    set status = case when decided.skipped is null then 'claimed' else 'skipped' end,
      reason = decided.skipped,
      attempts = email.attempts + case when decided.skipped is null then 1 else 0 end,
      event_id = decided.event_id,
      claimed_at = now()
    from decided
    where email.id = decided.previous_id
      and email.status = 'failed'
      and email.attempts < 3
    returning email.id, email.package_id, email.status
  )
  select jsonb_build_object(
    'send', coalesce(jsonb_agg(jsonb_build_object(
      'id', written.id,
      'package_id', decided.package_id,
      'user_id', decided.user_id,
      'event_id', decided.event_id,
      'timezone', decided.timezone,
      'delivered_time', decided.delivered_time
    ) order by decided.stored_at, decided.event_id) filter (where written.status = 'claimed'), '[]'::jsonb),
    'account_cap', count(*) filter (where written.status = 'skipped' and decided.skipped = 'account_cap'),
    'service_cap', count(*) filter (where written.status = 'skipped' and decided.skipped = 'service_cap')
  )
  into claimed
  from (select * from inserted union all select * from retried) as written
  join decided on decided.package_id = written.package_id;

  return claimed;
end;
$$;

-- Ends a claim: sent, failed (it is claimed again while the scan is fresh and
-- attempts are left) or skipped, with a short reason. Only a claimed row ends.
create function public.finish_delivery_email(
  p_id uuid,
  p_status text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped')
      or (p_reason is not null and p_reason !~ '^[a-z_]{1,40}$') then
    raise exception 'Invalid delivery email outcome' using errcode = '22023';
  end if;

  update public.delivery_emails
  set status = p_status,
    reason = p_reason,
    sent_at = case when p_status = 'sent' then now() end
  where id = p_id and status = 'claimed';
  return found;
end;
$$;

revoke all on function public.claim_delivery_emails(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_delivery_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_delivery_emails(integer, integer, integer) to service_role;
grant execute on function public.finish_delivery_email(uuid, text, text) to service_role;

-- The delivery emails the signed-in account was sent, for its data export.
create function public.owned_delivery_emails()
returns table (package_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select email.package_id, email.sent_at
  from public.delivery_emails as email
  where email.user_id = auth.uid() and email.status = 'sent'
  order by email.sent_at desc, email.id;
$$;

revoke all on function public.owned_delivery_emails() from public, anon;
grant execute on function public.owned_delivery_emails() to authenticated;

-- Merging two legs keeps the email off when it was off for either, and the
-- merged parcel counts as told when either leg was: the original's row moves to
-- it unless it has its own. Everything else is copied from
-- 20261002120000_parcel_sharing.sql.
create or replace function public.link_package_tracking(p_original_id uuid, p_delivery_id uuid)
returns uuid
language plpgsql
set search_path = pg_catalog
as $$
declare
  original public.packages;
  delivery public.packages;
  combined_label text;
begin
  if p_original_id = p_delivery_id then
    raise exception 'Choose two different parcels' using errcode = '22023';
  end if;
  perform id from public.sync_jobs where package_id in (p_original_id, p_delivery_id) order by id for update;
  perform id from public.packages where id in (p_original_id, p_delivery_id) order by id for update;
  select * into original from public.packages where id = p_original_id;
  select * into delivery from public.packages where id = p_delivery_id;
  if original.id is null and delivery.carrier_data->>'original_package_id' = p_original_id::text then
    return p_delivery_id; -- Safe retry after a completed link.
  end if;
  if original.id is null or delivery.id is null then
    raise exception 'Parcel not found' using errcode = '22023';
  end if;
  if original.user_id is distinct from delivery.user_id or original.user_id is null then
    raise exception 'Parcels must belong to the same account' using errcode = '22023';
  end if;
  if original.carrier_data ? 'original_package_id'
    or (original.carrier_data ? 'original_carrier' and original.carrier_data->>'original_carrier' <> original.carrier)
    or delivery.carrier_data ? 'original_carrier' then
    raise exception 'Parcel already has linked tracking' using errcode = '22023';
  end if;
  combined_label := concat_ws(' / ', nullif(btrim(original.label), ''), nullif(btrim(delivery.label), ''));
  if char_length(combined_label) > 80 then
    raise exception 'Combined parcel name exceeds 80 characters' using errcode = '22023';
  end if;

  -- Keep the delivery carrier's copy of an event if both trackers supplied it.
  delete from public.tracking_events earlier
  using public.tracking_events later
  where earlier.package_id = p_original_id and later.package_id = p_delivery_id
    and earlier.provider_event_id = later.provider_event_id;
  update public.tracking_events set package_id = p_delivery_id where package_id = p_original_id;

  update public.packages set
    label = combined_label,
    created_at = least(original.created_at, delivery.created_at),
    notifications_muted = original.notifications_muted or delivery.notifications_muted,
    email_muted = original.email_muted or delivery.email_muted,
    tracking_generation = gen_random_uuid(),
    carrier_data = coalesce(delivery.carrier_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'original_package_id', original.id,
      'original_carrier', original.carrier,
      'original_tracking_number', original.tracking_number,
      'original_tracking_url', original.tracking_url,
      'active_tracking_carrier', delivery.carrier,
      'active_tracking_number', delivery.tracking_number,
      'sender_name', coalesce(original.carrier_data->>'sender_name', delivery.carrier_data->>'sender_name')
    ))
  where id = p_delivery_id;
  update public.sync_jobs set package_id = p_delivery_id where package_id = p_original_id;
  update public.tracking_sync_attempts set package_id = p_delivery_id where package_id = p_original_id;
  update public.delivery_emails set package_id = p_delivery_id
  where package_id = p_original_id
    and not exists (select 1 from public.delivery_emails where package_id = p_delivery_id);
  delete from public.parcel_link_alerts as alert
  using public.parcel_links as stopping
  where alert.link_id = stopping.id
    and stopping.package_id = p_original_id and stopping.created_by is not null and stopping.shared
    and exists (
      select 1 from public.parcel_links as kept
      where kept.package_id = p_delivery_id and kept.created_by = stopping.created_by and kept.shared
    );
  update public.parcel_links as stopping set shared = false, stopped_at = now()
  where stopping.package_id = p_original_id and stopping.created_by is not null and stopping.shared
    and exists (
      select 1 from public.parcel_links as kept
      where kept.package_id = p_delivery_id and kept.created_by = stopping.created_by and kept.shared
    );
  update public.parcel_links set package_id = p_delivery_id where package_id = p_original_id;
  delete from public.packages where id = p_original_id;
  return p_delivery_id;
end;
$$;

revoke all on function public.link_package_tracking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_package_tracking(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
