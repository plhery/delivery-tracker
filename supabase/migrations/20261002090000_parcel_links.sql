-- One parcel without an account. A lookup stores a one-off parcel: a package
-- with no owner and one_off = true, refreshed by the same sync as every other
-- parcel. It is reached through a parcel link, whose unguessable id is the
-- capability in /p/<id>. The device that made the lookup also holds an owner
-- key; only its SHA-256 is stored. Clients never read these tables: the
-- application server does, with the service role.
--
-- Apply this before deploying the server that serves /api/public: its
-- scheduled sync filters on packages.one_off.

alter table public.packages
  add column one_off boolean not null default false;

-- Ownerless rows stay limited to one-off lookups and the unvalidated rows of
-- the pre-account deployment. An instance that finished that cutover made the
-- owner mandatory; one-off parcels need it optional again.
alter table public.packages
  drop constraint if exists packages_owner_required_check,
  add constraint packages_owner_required_check
    check (user_id is not null or one_off) not valid,
  alter column user_id drop not null;

comment on constraint packages_owner_required_check on public.packages is
  'Rejects new ownerless parcels other than one-off lookups, while legacy cutover rows remain unvalidated.';
comment on column public.packages.user_id is
  'Supabase Auth owner. NULL is a one-off parcel or a pre-auth cutover row; neither is visible through RLS.';
comment on column public.packages.one_off is
  'A parcel looked up without an account. It is reached only through its parcel links.';

create index packages_one_off_idx
  on public.packages (tracking_number, created_at desc)
  where one_off;

-- A one-off parcel's refresh has no account to belong to.
alter table public.sync_jobs
  drop constraint sync_jobs_target_check,
  add constraint sync_jobs_target_check check (
    (kind = 'package' and package_id is not null)
    or (kind = 'scheduled' and user_id is null and package_id is null)
  );

-- Twelve symbols from an alphabet without lookalikes (no 0, 1, I, O or l):
-- about 70 bits. Bytes past the last whole multiple of the alphabet are drawn
-- again, so no symbol is more likely than another.
create function private.new_parcel_link_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  symbols constant integer := char_length(alphabet);
  bytes bytea;
  drawn integer;
  link_id text := '';
begin
  while char_length(link_id) < 12 loop
    bytes := extensions.gen_random_bytes(16);
    for offset_in_bytes in 0..15 loop
      drawn := get_byte(bytes, offset_in_bytes);
      if drawn < 256 - 256 % symbols and char_length(link_id) < 12 then
        link_id := link_id || substr(alphabet, drawn % symbols + 1, 1);
      end if;
    end loop;
  end loop;
  return link_id;
end;
$$;

revoke all on function private.new_parcel_link_id() from public, anon, authenticated;
grant execute on function private.new_parcel_link_id() to service_role;

create table public.parcel_links (
  id text primary key default private.new_parcel_link_id()
    constraint parcel_links_id_format check (id ~ '^[2-9A-HJ-NP-Za-km-z]{12}$'),
  package_id uuid not null references public.packages (id) on delete cascade,
  owner_key_hash text
    constraint parcel_links_owner_key_hash_format check (owner_key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete cascade,
  show_number boolean not null default false,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  -- A lookup's link has a key and no account; a link from an account has no key.
  constraint parcel_links_origin_check check ((owner_key_hash is null) <> (created_by is null))
);

create index parcel_links_package_idx on public.parcel_links (package_id);
create index parcel_links_created_by_idx on public.parcel_links (created_by)
  where created_by is not null;

alter table public.parcel_links enable row level security;
revoke all on public.parcel_links from public, anon, authenticated;
grant select, insert, update, delete on public.parcel_links to service_role;

comment on table public.parcel_links is
  'Capability links to one parcel: an anonymous lookup, or a parcel shared from an account. Service role only.';
comment on column public.parcel_links.owner_key_hash is
  'SHA-256 of the key kept on the device that made the lookup. NULL for a link from an account.';
comment on column public.parcel_links.show_number is
  'Whether someone without the owner key sees the full tracking number.';

-- Durable counters behind the daily lookup limits. A bucket is a keyed hash of
-- the client address, never the address, or "global" for every lookup.
create table public.public_lookup_usage (
  bucket text not null
    constraint public_lookup_usage_bucket_format check (bucket = 'global' or bucket ~ '^[0-9a-f]{64}$'),
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket, day)
);

create index public_lookup_usage_day_idx on public.public_lookup_usage (day);

alter table public.public_lookup_usage enable row level security;
revoke all on public.public_lookup_usage from public, anon, authenticated;
grant select, insert, update, delete on public.public_lookup_usage to service_role;

comment on table public.public_lookup_usage is
  'Lookups without an account per day (UTC), by hashed client address and overall. Kept for seven days.';

-- Creating, forgetting and keeping a one-off parcel all take this lock before
-- any row lock, so a lookup that reuses a parcel cannot race its deletion.
create function private.lock_one_off_number(p_tracking_number text)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('one-off:' || p_tracking_number, 0));
$$;

-- Deletes a one-off parcel that no link reaches any more. The caller holds the
-- lock on its number.
create function private.forget_orphaned_one_off(p_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.packages as package
  where package.id = p_package_id
    and package.one_off
    and package.user_id is null
    and not exists (
      select 1 from public.parcel_links as link where link.package_id = package.id
    );
  return found;
end;
$$;

revoke all on function private.lock_one_off_number(text) from public, anon, authenticated;
revoke all on function private.forget_orphaned_one_off(uuid) from public, anon, authenticated;

-- When a lookup's link is forgotten: 30 days after the parcel was delivered or
-- returned, or 90 days after its last news, counting a scan, an opening of the
-- link and the lookup itself. Scans dated in the future are a carrier's
-- forecast or a misread clock and do not count. A link from an account lasts
-- as long as the account keeps it.
create function public.parcel_link_forget_at(p_link public.parcel_links)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_link.created_by is not null then null
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

-- Counts one lookup for today (UTC) against the caller's bucket and against
-- every caller together, unless either allowance is used up. Both rows are
-- locked in the same order by every caller.
create function public.claim_public_lookup(p_bucket text, p_limit integer, p_global_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today constant date := (now() at time zone 'UTC')::date;
  used integer;
  used_overall integer;
begin
  if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$'
      or p_limit is null or p_limit < 0
      or p_global_limit is null or p_global_limit < 0 then
    raise exception 'Invalid lookup allowance' using errcode = '22023';
  end if;

  delete from public.public_lookup_usage where day < today - 7;

  insert into public.public_lookup_usage (bucket, day)
  values ('global', today), (p_bucket, today)
  on conflict do nothing;
  select count into used_overall from public.public_lookup_usage
  where bucket = 'global' and day = today for update;
  select count into used from public.public_lookup_usage
  where bucket = p_bucket and day = today for update;

  if used >= p_limit then
    return jsonb_build_object('allowed', false, 'scope', 'bucket', 'remaining', 0);
  end if;
  if used_overall >= p_global_limit then
    return jsonb_build_object('allowed', false, 'scope', 'global', 'remaining', p_limit - used);
  end if;

  update public.public_lookup_usage set count = count + 1
  where day = today and bucket in ('global', p_bucket);
  return jsonb_build_object('allowed', true, 'scope', null, 'remaining', p_limit - used - 1);
end;
$$;

-- Yesterday's lookups per client (UTC), for tuning the daily allowance.
create function public.public_lookup_usage_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'buckets', count(*),
    'p50', coalesce(percentile_disc(0.5) within group (order by usage.count), 0),
    'p90', coalesce(percentile_disc(0.9) within group (order by usage.count), 0),
    'max', coalesce(max(usage.count), 0)
  )
  from public.public_lookup_usage as usage
  where usage.day = (now() at time zone 'UTC')::date - 1
    and usage.bucket <> 'global'
    and usage.count > 0;
$$;

-- The link, the role its caller has, and the whole package row with its
-- events, or NULL when the link is unknown or past its forget date. The
-- application decides what a viewer may see. A parcel several lookups share
-- shows each of them its own start: the "Tracking added" row never predates
-- the link. p_touch records that the link was opened, at most every 5 minutes.
create function public.public_parcel(
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
begin
  select * into link from public.parcel_links where id = p_link_id;
  if not found then return null; end if;
  forget_at := public.parcel_link_forget_at(link);
  if forget_at <= now() then return null; end if;
  if p_touch and link.last_opened_at < now() - interval '5 minutes' then
    update public.parcel_links set last_opened_at = now() where id = link.id
    returning * into link;
    forget_at := public.parcel_link_forget_at(link);
  end if;
  select * into package from public.packages where id = link.package_id;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', link.id,
      'owner', coalesce(link.owner_key_hash = p_owner_key_hash, false),
      'shared', link.created_by is not null,
      'show_number', link.show_number,
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

-- A lookup without an account. The same number, filed under the same carrier
-- with the same inputs, is stored once: the newest such one-off parcel is
-- reused, including one whose carrier was corrected automatically since.
-- Every lookup gets its own link. The application has validated the carrier
-- and its inputs; the table constraints check them again.
create function public.create_one_off_parcel(
  p_tracking_number text,
  p_carrier text,
  p_tracking_url text,
  p_dpd_postcode text,
  p_owner_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_tracking text := upper(regexp_replace(coalesce(p_tracking_number, ''), '[[:space:].-]', '', 'g'));
  normalized_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  normalized_postcode text := nullif(btrim(coalesce(p_dpd_postcode, '')), '');
  target_id uuid;
  link_id text;
  created boolean := false;
begin
  if char_length(normalized_tracking) not between 4 and 40
      or (normalized_tracking !~ '^[A-Z0-9]+$' and normalized_tracking !~ '^\d{4}/\d{8}$')
      or normalized_tracking !~ '[0-9]'
      or p_carrier is null
      or p_owner_key_hash is null then
    raise exception 'Invalid one-off parcel' using errcode = '22023';
  end if;

  perform private.lock_one_off_number(normalized_tracking);
  select package.id into target_id
  from public.packages as package
  where package.one_off
    and package.user_id is null
    and package.tracking_number = normalized_tracking
    and (package.carrier = p_carrier or package.carrier_data->>'auto_changed_from' = p_carrier)
    and package.tracking_url is not distinct from normalized_url
    and package.dpd_postcode is not distinct from normalized_postcode
  order by package.created_at desc
  limit 1;

  if target_id is null then
    insert into public.packages (user_id, one_off, tracking_number, label, carrier, tracking_url, dpd_postcode)
    values (null, true, normalized_tracking, '', p_carrier, normalized_url, normalized_postcode)
    returning id into target_id;
    created := true;
  end if;

  insert into public.parcel_links (package_id, owner_key_hash)
  values (target_id, p_owner_key_hash)
  returning id into link_id;

  return public.public_parcel(link_id, p_owner_key_hash) || jsonb_build_object('created', created);
end;
$$;

-- Forgets a lookup on request. An unknown link and a wrong key look the same.
-- The parcel goes with its last link.
create function public.forget_parcel_link(p_link_id text, p_owner_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  orphaned boolean;
begin
  select link.package_id, package.tracking_number into target
  from public.parcel_links as link
  join public.packages as package on package.id = link.package_id
  where link.id = p_link_id and link.owner_key_hash = p_owner_key_hash;
  if not found then return jsonb_build_object('links', 0, 'packages', 0); end if;

  perform private.lock_one_off_number(target.tracking_number);
  delete from public.parcel_links where id = p_link_id and owner_key_hash = p_owner_key_hash;
  if not found then return jsonb_build_object('links', 0, 'packages', 0); end if;
  orphaned := private.forget_orphaned_one_off(target.package_id);
  return jsonb_build_object('links', 1, 'packages', orphaned::integer);
end;
$$;

-- Forgets the lookups past their forget date, a bounded batch per call, and
-- each parcel whose last link went. The date is checked again under the
-- number's lock, so a link opened or kept in the meantime stays.
create function public.forget_expired_parcel_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired record;
  links integer := 0;
  packages integer := 0;
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
  return jsonb_build_object('links', links, 'packages', packages);
end;
$$;

-- The one-off parcels a scheduled sync still follows: open ones with a link
-- opened since the given time, the least recently checked first.
create function public.followed_one_off_packages(p_opened_since timestamptz)
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
      where link.package_id = package.id and link.last_opened_at > p_opened_since
    )
  order by package.last_synced_at asc nulls first, package.created_at asc;
$$;

-- Keeps a parcel from a link in the signed-in account. The device that made
-- the lookup proves it with its key; anyone else may keep a parcel whose link
-- shows its number. Every other case answers like an unknown link.
--
-- The key holder of a one-off parcel nobody else follows takes the parcel
-- itself. Otherwise the account gets its own copy: the key holder's with the
-- inputs and routing state the lookup had, a viewer's with the number, carrier
-- and visible history only, never the postcode or private link someone else
-- entered. The key holder's link then belongs to the account and loses its key.
create function public.claim_parcel_link(
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
      or not (key_holder or link.show_number or link.created_by is not distinct from actor_id)
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
    perform private.forget_orphaned_one_off(source.id);
  end if;
  return jsonb_build_object('outcome', 'kept', 'package_id', kept_id);
end;
$$;

-- A link to a parcel follows it when its two legs are merged. Everything else
-- is copied from 20260912120000_carrier_handoff_links.sql.
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
  update public.parcel_links set package_id = p_delivery_id where package_id = p_original_id;
  delete from public.packages where id = p_original_id;
  return p_delivery_id;
end;
$$;

revoke all on function public.link_package_tracking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_package_tracking(uuid, uuid) to service_role;

revoke all on function public.parcel_link_forget_at(public.parcel_links) from public, anon, authenticated;
revoke all on function public.claim_public_lookup(text, integer, integer) from public, anon, authenticated;
revoke all on function public.public_lookup_usage_summary() from public, anon, authenticated;
revoke all on function public.public_parcel(text, text, boolean) from public, anon, authenticated;
revoke all on function public.create_one_off_parcel(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.forget_parcel_link(text, text) from public, anon, authenticated;
revoke all on function public.forget_expired_parcel_links() from public, anon, authenticated;
revoke all on function public.followed_one_off_packages(timestamptz) from public, anon, authenticated;
grant execute on function public.parcel_link_forget_at(public.parcel_links) to service_role;
grant execute on function public.claim_public_lookup(text, integer, integer) to service_role;
grant execute on function public.public_lookup_usage_summary() to service_role;
grant execute on function public.public_parcel(text, text, boolean) to service_role;
grant execute on function public.create_one_off_parcel(text, text, text, text, text) to service_role;
grant execute on function public.forget_parcel_link(text, text) to service_role;
grant execute on function public.forget_expired_parcel_links() to service_role;
grant execute on function public.followed_one_off_packages(timestamptz) to service_role;

revoke all on function public.claim_parcel_link(text, text, text) from public, anon, service_role;
grant execute on function public.claim_parcel_link(text, text, text) to authenticated;

comment on function public.claim_parcel_link(text, text, text) is
  'Quota-enforced keeping of a parcel link in the current permanent account.';

notify pgrst, 'reload schema';
