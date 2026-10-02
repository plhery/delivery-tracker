-- Sharing a parcel, gifts, and alerts without an account.
--
-- A parcel link can be a gift, which hides where the parcel comes from until
-- it is delivered, and its sharing can be stopped. A signed-in person shares
-- one of their parcels through a link of their own. Anyone holding a link can
-- ask for browser notifications about that one parcel.
--
-- Apply this before deploying the server that serves sharing and alerts. The
-- server before it keeps working on this schema: it reads links through
-- public_parcel, which no longer answers a stopped link or an undelivered gift
-- to a caller without the owner key, because that server cannot hide a gift's
-- origin.

alter table public.parcel_links
  add column gift boolean not null default false,
  add column shared boolean not null default true,
  add column stopped_at timestamptz,
  add constraint parcel_links_stopped_check check (shared = (stopped_at is null));

comment on column public.parcel_links.gift is
  'Whether someone without the owner key sees the sender, the origin and the contents only once the parcel is delivered.';
comment on column public.parcel_links.shared is
  'False once sharing was stopped: the link tells its visitors so, and a lookup''s owner still reads it.';
comment on column public.parcel_links.stopped_at is
  'When sharing was stopped. A stopped link from an account is deleted 30 days later.';

-- An account shares a parcel through one live link. Two kept lookups whose
-- parcels were merged since could both point at it: the newest stays.
update public.parcel_links as link
set shared = false, stopped_at = now()
where link.created_by is not null
  and exists (
    select 1 from public.parcel_links as newer
    where newer.package_id = link.package_id
      and newer.created_by = link.created_by
      and (newer.created_at, newer.id) > (link.created_at, link.id)
  );

create unique index parcel_links_live_share_idx
  on public.parcel_links (package_id, created_by)
  where created_by is not null and shared;

-- Browser notifications for one link. An endpoint and its keys are the
-- browser's push credentials: the server alone reads them.
create table public.parcel_link_alerts (
  id uuid primary key default gen_random_uuid(),
  link_id text not null references public.parcel_links (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 4096),
  p256dh text not null,
  auth text not null,
  locale text not null check (locale in ('en', 'de', 'fr', 'it', 'es', 'pt', 'pl')),
  preset text not null check (preset in ('all', 'important', 'delivery')),
  owner boolean not null default false,
  failures smallint not null default 0 check (failures >= 0),
  created_at timestamptz not null default now(),
  unique (link_id, endpoint)
);

create table public.parcel_link_alert_deliveries (
  alert_id uuid not null references public.parcel_link_alerts (id) on delete cascade,
  event_id uuid not null references public.tracking_events (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (alert_id, event_id)
);

create index parcel_link_alert_deliveries_event_idx on public.parcel_link_alert_deliveries (event_id);

alter table public.parcel_link_alerts enable row level security;
alter table public.parcel_link_alert_deliveries enable row level security;
revoke all on public.parcel_link_alerts, public.parcel_link_alert_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.parcel_link_alerts, public.parcel_link_alert_deliveries to service_role;

comment on table public.parcel_link_alerts is
  'Browser push subscriptions for one parcel link, kept until the parcel is delivered, the browser unsubscribes or the link goes. Service role only.';
comment on column public.parcel_link_alerts.owner is
  'Turned on with the lookup''s owner key: it outlasts a stop of the sharing.';
comment on column public.parcel_link_alerts.failures is
  'Sends in a row the push service did not take. The alert is removed after a few.';
comment on table public.parcel_link_alert_deliveries is
  'The scans an alert has been told about, or passed over, so each is handled once.';

-- The scans no alert has handled yet, one row per alert and scan. The server
-- decides which of them an alert's preset announces. account_endpoint marks an
-- alert on a browser the parcel's owner already gets account notifications on.
create view public.pending_parcel_link_alerts
with (security_invoker = true) as
select
  alert.id as alert_id,
  alert.link_id,
  alert.endpoint,
  alert.p256dh,
  alert.auth,
  alert.locale,
  alert.preset,
  alert.owner,
  alert.failures,
  link.gift,
  event.id as event_id,
  event.package_id,
  event.stage,
  event.location,
  event.occurred_at,
  event.created_at as event_created_at,
  package.current_stage as package_stage,
  package.expected_delivery,
  (
    package.expected_delivery is not null
    and package.expected_delivery_changed_at is not null
    and package.expected_delivery_changed_at >= event.created_at
  ) as expected_delivery_changed,
  (
    event.raw_data -> 'observed_without_provider_timestamp' is distinct from 'true'::jsonb
    and coalesce(event.raw_data ->> 'time' ~ '[T ][0-9]{2}:[0-9]{2}', false)
  ) as event_has_time,
  exists (
    select 1 from public.push_subscriptions as own
    where own.user_id = package.user_id
      and own.endpoint = alert.endpoint
      and own.disabled_at is null
  ) as account_endpoint
from public.parcel_link_alerts as alert
join public.parcel_links as link on link.id = alert.link_id
join public.packages as package on package.id = link.package_id
join public.tracking_events as event
  on event.package_id = package.id
 and event.created_at > alert.created_at
 and (event.provider_event_id is null or event.provider_event_id not like 'app:%')
 and event.stage <> 'pending'
left join public.parcel_link_alert_deliveries as delivery
  on delivery.alert_id = alert.id
 and delivery.event_id = event.id
where delivery.event_id is null
  and (link.shared or alert.owner);

revoke all on public.pending_parcel_link_alerts from public, anon, authenticated;
grant select on public.pending_parcel_link_alerts to service_role;

-- A stopped link from an account is forgotten 30 days after it was stopped.
-- Everything else is as before: a lookup's link 30 days after delivery or 90
-- days after its last news, and a live link from an account never.
create or replace function public.parcel_link_forget_at(p_link public.parcel_links)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_link.created_by is not null then p_link.stopped_at + interval '30 days'
    when package.current_stage in ('delivered', 'returned') then greatest((
      select max(event.occurred_at)
      from public.tracking_events as event
      where event.package_id = package.id
        and event.stage = package.current_stage
        and event.occurred_at <= now()
    ), p_link.created_at) + interval '30 days'
    else greatest((
      select max(event.occurred_at)
      from public.tracking_events as event
      where event.package_id = package.id
        and event.occurred_at <= now()
    ), p_link.last_opened_at, p_link.created_at) + interval '90 days'
  end
  from public.packages as package
  where package.id = p_link.package_id;
$$;

-- The link, the role its caller has, and the whole package row with its
-- events. NULL when the link is unknown or past its forget date, and only
-- {"stopped": true} when its sharing was stopped and the caller does not hold
-- the owner key. The application decides what a viewer may see, a gift's
-- viewer included. In the link, "shared" says the link belongs to an account
-- and "stopped" that its sharing was stopped. p_touch records that the link
-- was opened, at most every 5 minutes.
create function public.parcel_link_view(
  p_link_id text,
  p_owner_key_hash text default null,
  p_touch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.parcel_links;
  package public.packages;
  forget_at timestamptz;
  is_owner boolean;
begin
  select * into link from public.parcel_links where id = p_link_id;
  if not found then return null; end if;
  forget_at := public.parcel_link_forget_at(link);
  if forget_at <= now() then return null; end if;
  is_owner := coalesce(link.owner_key_hash = p_owner_key_hash, false);
  if not link.shared and not is_owner then
    return jsonb_build_object('stopped', true);
  end if;
  if p_touch and link.last_opened_at < now() - interval '5 minutes' then
    update public.parcel_links set last_opened_at = now() where id = link.id
    returning * into link;
    forget_at := public.parcel_link_forget_at(link);
  end if;
  select * into package from public.packages where id = link.package_id;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', link.id,
      'owner', is_owner,
      'shared', link.created_by is not null,
      'show_number', link.show_number,
      'gift', link.gift,
      'stopped', not link.shared,
      'created_at', link.created_at,
      'forget_at', forget_at
    ),
    'package', to_jsonb(package) || jsonb_build_object('tracking_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'package_id', event.package_id,
        'stage', event.stage,
        'description', event.description,
        'location', event.location,
        'occurred_at', case when event.provider_event_id like 'app:%'
          then greatest(event.occurred_at, link.created_at) else event.occurred_at end,
        'point', event.raw_data->'point'
      ) order by event.occurred_at desc)
      from public.tracking_events as event
      where event.package_id = package.id
    ), '[]'::jsonb))
  );
end;
$$;

-- The reader of the server before sharing. That server shows a viewer every
-- scan as it is, so it is refused what it cannot show safely: a stopped link,
-- and a gift before delivery.
create or replace function public.public_parcel(
  p_link_id text,
  p_owner_key_hash text default null,
  p_touch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer jsonb := public.parcel_link_view(p_link_id, p_owner_key_hash, p_touch);
begin
  if answer is null or answer ? 'stopped' then return null; end if;
  if answer#>'{link,owner}' <> 'true'
      and answer#>'{link,gift}' = 'true'
      and answer#>>'{package,current_stage}' <> 'delivered' then
    return null;
  end if;
  return answer;
end;
$$;

-- Changes what a lookup's link shows, for the holder of its owner key. An
-- unknown link and a wrong key look the same. Stopping the sharing ends the
-- alerts of everyone but the owner.
create function public.update_parcel_link(
  p_link_id text,
  p_owner_key_hash text,
  p_show_number boolean default null,
  p_gift boolean default null,
  p_shared boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.parcel_links;
  was_shared boolean;
begin
  select * into link from public.parcel_links
  where id = p_link_id and owner_key_hash = p_owner_key_hash
  for update;
  if not found or public.parcel_link_forget_at(link) <= now() then return null; end if;
  was_shared := link.shared;

  update public.parcel_links
  set show_number = coalesce(p_show_number, show_number),
    gift = coalesce(p_gift, gift),
    shared = coalesce(p_shared, shared),
    stopped_at = case when coalesce(p_shared, shared) then null else coalesce(stopped_at, now()) end
  where id = link.id
  returning * into link;
  if was_shared and not link.shared then
    delete from public.parcel_link_alerts where link_id = link.id and not owner;
  end if;

  return public.parcel_link_view(link.id, p_owner_key_hash) || jsonb_build_object(
    'transition', case
      when was_shared and not link.shared then 'stopped'
      when link.shared and not was_shared then 'started'
    end
  );
end;
$$;

-- Turns on an alert for a link, or updates the one its browser already has.
-- Answers added, updated, full (ten alerts from viewers, or ten from the
-- owner), finished (the journey is over: nothing is stored), stopped, or NULL
-- for an unknown link. The application has validated the endpoint and keys.
create function public.add_parcel_link_alert(
  p_link_id text,
  p_owner_key_hash text,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_locale text,
  p_preset text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.parcel_links;
  is_owner boolean;
begin
  -- One alert at a time per link, so the count below holds.
  select * into link from public.parcel_links where id = p_link_id for update;
  if not found or public.parcel_link_forget_at(link) <= now() then return null; end if;
  is_owner := coalesce(link.owner_key_hash = p_owner_key_hash, false);
  if not link.shared and not is_owner then return 'stopped'; end if;
  if exists (
    select 1 from public.packages
    where id = link.package_id and current_stage in ('delivered', 'returned')
  ) then
    return 'finished';
  end if;

  update public.parcel_link_alerts
  set p256dh = p_p256dh, auth = p_auth, locale = p_locale, preset = p_preset,
    owner = owner or is_owner, failures = 0
  where link_id = link.id and endpoint = p_endpoint;
  if found then return 'updated'; end if;

  if (
    select count(*) from public.parcel_link_alerts where link_id = link.id and owner = is_owner
  ) >= 10 then
    return 'full';
  end if;
  insert into public.parcel_link_alerts (link_id, endpoint, p256dh, auth, locale, preset, owner)
  values (link.id, p_endpoint, p_p256dh, p_auth, p_locale, p_preset, is_owner);
  return 'added';
end;
$$;

-- Turns an alert off. Knowing the endpoint is the right to do so: only the
-- browser that subscribed and the server know it.
create function public.remove_parcel_link_alert(p_link_id text, p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.parcel_link_alerts where link_id = p_link_id and endpoint = p_endpoint;
  return found;
end;
$$;

-- The live link the signed-in account shares one of its parcels through, or
-- NULL when it shares none. Another account's parcel looks like no parcel.
create function public.owned_package_share(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.packages where id = p_package_id and user_id = actor_id) then
    raise exception 'Package not found' using errcode = 'P0002';
  end if;
  return (
    select jsonb_build_object(
      'id', link.id, 'show_number', link.show_number, 'gift', link.gift, 'created_at', link.created_at
    )
    from public.parcel_links as link
    where link.package_id = p_package_id and link.created_by = actor_id and link.shared
  );
end;
$$;

-- Shares one of the account's parcels: makes its link when none is live, else
-- changes what the live one shows. A link kept from a lookup is such a link.
create function public.share_owned_package(
  p_package_id uuid,
  p_show_number boolean default null,
  p_gift boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  link public.parcel_links;
  created boolean := false;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  -- The account lock of create_owned_package: one change to its links at a time.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if not exists (select 1 from public.packages where id = p_package_id and user_id = actor_id) then
    raise exception 'Package not found' using errcode = 'P0002';
  end if;

  update public.parcel_links
  set show_number = coalesce(p_show_number, show_number), gift = coalesce(p_gift, gift)
  where package_id = p_package_id and created_by = actor_id and shared
  returning * into link;
  if not found then
    insert into public.parcel_links (package_id, created_by, show_number, gift)
    values (p_package_id, actor_id, coalesce(p_show_number, false), coalesce(p_gift, false))
    returning * into link;
    created := true;
  end if;
  return jsonb_build_object(
    'id', link.id, 'show_number', link.show_number, 'gift', link.gift, 'created_at', link.created_at,
    'created', created
  );
end;
$$;

-- Stops sharing one of the account's parcels. The link stays for 30 days to
-- tell its visitors so; its alerts end now. Sharing again makes a new link.
create function public.stop_owned_package_share(p_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  stopped_link text;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if not exists (select 1 from public.packages where id = p_package_id and user_id = actor_id) then
    raise exception 'Package not found' using errcode = 'P0002';
  end if;

  update public.parcel_links
  set shared = false, stopped_at = now()
  where package_id = p_package_id and created_by = actor_id and shared
  returning id into stopped_link;
  if stopped_link is null then return false; end if;
  delete from public.parcel_link_alerts where link_id = stopped_link;
  return true;
end;
$$;

-- The one-off parcels a scheduled sync still follows: open ones with a link
-- opened since the given time or with an alert on, the least recently checked
-- first.
create or replace function public.followed_one_off_packages(p_opened_since timestamptz)
returns setof public.packages
language sql
stable
security definer
set search_path = ''
as $$
  select package.*
  from public.packages as package
  where package.one_off
    and package.user_id is null
    and package.archived_at is null
    and (
      package.current_stage not in ('delivered', 'returned')
      or package.last_status_text = 'TO_BE_DELIVERED'
    )
    and exists (
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
  order by package.last_synced_at asc nulls first, package.created_at asc;
$$;

-- Forgets the lookups past their forget date, a bounded batch per call, and
-- each parcel whose last link went; then the stopped links from accounts that
-- have told their visitors for 30 days, and the alerts of journeys that are
-- over. The date is checked again under the number's lock, so a link opened or
-- kept in the meantime stays.
create or replace function public.forget_expired_parcel_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired record;
  links integer := 0;
  packages integer := 0;
  stopped integer := 0;
  alerts integer := 0;
begin
  for expired in
    select link.id, link.package_id, package.tracking_number
    from public.parcel_links as link
    join public.packages as package on package.id = link.package_id
    where link.created_by is null
      -- No forget date is earlier than 30 days after the lookup, and an
      -- undelivered parcel's is 90 days after its link was last opened.
      and link.created_at <= now() - interval '30 days'
      and (
        package.current_stage in ('delivered', 'returned')
        or link.last_opened_at <= now() - interval '90 days'
      )
      and public.parcel_link_forget_at(link) <= now()
    order by package.tracking_number, link.id
    limit 500
  loop
    perform private.lock_one_off_number(expired.tracking_number);
    delete from public.parcel_links as link
    where link.id = expired.id
      and link.created_by is null
      and public.parcel_link_forget_at(link) <= now();
    if found then
      links := links + 1;
      if private.forget_orphaned_one_off(expired.package_id) then
        packages := packages + 1;
      end if;
    end if;
  end loop;

  delete from public.parcel_links as link
  where link.created_by is not null
    and not link.shared
    and public.parcel_link_forget_at(link) <= now();
  get diagnostics stopped = row_count;

  -- An alert ends with the journey. One with a scan still to announce waits
  -- for the server to send it.
  delete from public.parcel_link_alerts as alert
  using public.parcel_links as link, public.packages as package
  where link.id = alert.link_id
    and package.id = link.package_id
    and package.current_stage in ('delivered', 'returned')
    and not exists (
      select 1 from public.pending_parcel_link_alerts as pending where pending.alert_id = alert.id
    );
  get diagnostics alerts = row_count;

  return jsonb_build_object('links', links, 'packages', packages, 'stopped', stopped, 'alerts', alerts);
end;
$$;

-- Keeps a parcel from a link in the signed-in account. The device that made
-- the lookup proves it with its key; anyone else may keep a parcel whose link
-- shows its number, is still shared and is not a gift on its way. Every other
-- case answers like an unknown link.
--
-- The key holder of a one-off parcel nobody else follows takes the parcel
-- itself. Otherwise the account gets its own copy: the key holder's with the
-- inputs and routing state the lookup had, a viewer's with the number, carrier
-- and visible history only, never the postcode or private link someone else
-- entered. The key holder's link then belongs to the account and loses its key.
create or replace function public.claim_parcel_link(
  p_link_id text,
  p_owner_key_hash text default null,
  p_label text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_label text := btrim(coalesce(p_label, ''));
  link public.parcel_links;
  source public.packages;
  key_holder boolean;
  owned_id uuid;
  active_count integer;
  total_count integer;
  kept_id uuid;
begin
  if actor_id is null or exists (
    select 1 from auth.users where id = actor_id and is_anonymous
  ) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if char_length(normalized_label) > 80 then
    raise exception 'Parcel names can be at most 80 characters' using errcode = '22023';
  end if;

  -- The account lock of create_owned_package: quota checks run one at a time.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  select package.* into source
  from public.parcel_links as candidate
  join public.packages as package on package.id = candidate.package_id
  where candidate.id = p_link_id;
  if not found then
    raise exception 'Parcel unavailable' using errcode = 'P0002';
  end if;
  perform private.lock_one_off_number(source.tracking_number);
  select * into link from public.parcel_links where id = p_link_id for update;
  key_holder := found and coalesce(link.owner_key_hash = p_owner_key_hash, false);
  if not found
      or link.package_id <> source.id
      or not (
        key_holder
        or link.created_by is not distinct from actor_id
        -- A viewer keeps what the link shows: not a stopped link, not a gift before it arrives.
        or (
          link.show_number
          and link.shared
          and not (link.gift and source.current_stage <> 'delivered')
        )
      )
      or public.parcel_link_forget_at(link) <= now() then
    raise exception 'Parcel unavailable' using errcode = 'P0002';
  end if;

  select package.id into owned_id
  from public.packages as package
  where package.user_id = actor_id and package.tracking_number = source.tracking_number;
  if owned_id is not null then
    if key_holder then
      delete from public.parcel_links where id = link.id;
      perform private.forget_orphaned_one_off(source.id);
    end if;
    return jsonb_build_object('outcome', 'already', 'package_id', owned_id);
  end if;

  select count(*) filter (where archived_at is null), count(*)
  into active_count, total_count
  from public.packages
  where user_id = actor_id;
  if active_count >= 50 or total_count >= 500 then
    return jsonb_build_object('outcome', 'quota', 'package_id', null);
  end if;

  if key_holder and source.one_off and source.user_id is null and not exists (
    select 1 from public.parcel_links as other
    where other.package_id = source.id and other.id <> link.id
  ) then
    update public.packages
    set user_id = actor_id, one_off = false, label = normalized_label
    where id = source.id;
    -- A refresh already queued now answers to the account's job status.
    update public.sync_jobs set user_id = actor_id
    where package_id = source.id and user_id is null;
    update public.parcel_links
    set created_by = actor_id, owner_key_hash = null
    where id = link.id;
    return jsonb_build_object('outcome', 'kept', 'package_id', source.id);
  end if;

  insert into public.packages (
    user_id, tracking_number, label, carrier, tracking_url, dpd_postcode,
    current_stage, expected_delivery, last_status_text,
    last_synced_at, sync_status, sync_error, carrier_data
  ) values (
    actor_id,
    source.tracking_number,
    normalized_label,
    -- Dachser cannot be filed without its private link.
    case when not key_holder and source.carrier = 'dachser' then 'unknown' else source.carrier end,
    case when key_holder then source.tracking_url end,
    case when key_holder then source.dpd_postcode end,
    source.current_stage,
    source.expected_delivery,
    source.last_status_text,
    case when key_holder then source.last_synced_at end,
    -- A check of the source still running says nothing about the copy.
    case when key_holder and source.sync_status <> 'syncing' then source.sync_status else 'pending' end,
    case when key_holder then source.sync_error end,
    case when key_holder then source.carrier_data else '{}'::jsonb end
  )
  returning id into kept_id;

  insert into public.tracking_events (
    package_id, provider_event_id, stage, description, location, occurred_at, raw_data
  )
  select kept_id, event.provider_event_id, event.stage, event.description,
    event.location, event.occurred_at, event.raw_data
  from public.tracking_events as event
  where event.package_id = source.id
  -- The copy already has its own "Tracking added" row.
  on conflict (package_id, provider_event_id) do nothing;

  if key_holder then
    update public.parcel_links
    set package_id = kept_id, created_by = actor_id, owner_key_hash = null
    where id = link.id;
    -- The copied scans are not news to the link's alerts.
    update public.parcel_link_alerts set created_at = now() where link_id = link.id;
    perform private.forget_orphaned_one_off(source.id);
  end if;
  return jsonb_build_object('outcome', 'kept', 'package_id', kept_id);
end;
$$;

-- A link to a parcel follows it when its two legs are merged. An account
-- shares the merged parcel through one live link: when it shared both legs,
-- the delivery leg's link stays and the other one is stopped. Everything else
-- is copied from 20261002090000_parcel_links.sql.
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

revoke all on function public.parcel_link_view(text, text, boolean) from public, anon, authenticated;
revoke all on function public.update_parcel_link(text, text, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.add_parcel_link_alert(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_parcel_link_alert(text, text) from public, anon, authenticated;
grant execute on function public.parcel_link_view(text, text, boolean) to service_role;
grant execute on function public.update_parcel_link(text, text, boolean, boolean, boolean) to service_role;
grant execute on function public.add_parcel_link_alert(text, text, text, text, text, text, text) to service_role;
grant execute on function public.remove_parcel_link_alert(text, text) to service_role;

revoke all on function public.owned_package_share(uuid) from public, anon, service_role;
revoke all on function public.share_owned_package(uuid, boolean, boolean) from public, anon, service_role;
revoke all on function public.stop_owned_package_share(uuid) from public, anon, service_role;
grant execute on function public.owned_package_share(uuid) to authenticated;
grant execute on function public.share_owned_package(uuid, boolean, boolean) to authenticated;
grant execute on function public.stop_owned_package_share(uuid) to authenticated;

comment on function public.share_owned_package(uuid, boolean, boolean) is
  'Shares one of the current permanent account''s parcels through its one live link.';
comment on function public.stop_owned_package_share(uuid) is
  'Stops the current permanent account''s sharing of one of its parcels.';

notify pgrst, 'reload schema';
