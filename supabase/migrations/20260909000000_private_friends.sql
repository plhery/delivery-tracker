-- Friends can read derived, consented summaries only. Parcel RLS is unchanged.
create table public.friend_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  nickname text not null check (char_length(btrim(nickname, U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) between 1 and 24 and nickname !~ U&'[[:cntrl:]\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]'),
  share_stats boolean not null default true,
  share_arrival boolean not null default false
);
create table public.friend_connections (
  user_low uuid not null references public.friend_profiles(user_id) on delete cascade,
  user_high uuid not null references public.friend_profiles(user_id) on delete cascade,
  primary key (user_low, user_high),
  check (user_low < user_high)
);
create index friend_connections_high_idx on public.friend_connections(user_high);
create table public.friend_invites (
  user_id uuid primary key references public.friend_profiles(user_id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null
);
alter table public.friend_profiles enable row level security;
alter table public.friend_connections enable row level security;
alter table public.friend_invites enable row level security;
revoke all on public.friend_profiles, public.friend_connections, public.friend_invites from public, anon, authenticated;
-- Service access is reserved for account export/operations, never browser use.
grant select, insert, update, delete on public.friend_profiles, public.friend_connections, public.friend_invites to service_role;

create or replace function private.friend_card(p_owner uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  with events as (
    select e.package_id, e.stage::text stage, e.occurred_at, e.id,
      case e.stage::text when 'registered' then 0 when 'accepted' then 1 when 'in_transit' then 2
        when 'customs' then 3 when 'out_for_delivery' then 4 when 'failed_attempt' then 5
        when 'ready_for_pickup' then 6 when 'delivered' then 7 when 'returned' then 8 else -1 end rank
    from public.tracking_events e join public.packages p on p.id = e.package_id
    where p.user_id = p_owner and e.stage::text <> 'pending'
  ), journeys as (
    select package_id,
      (array_agg(stage order by occurred_at desc, rank desc, id desc))[1] stage,
      (array_agg(stage order by occurred_at, rank, id) filter (where stage <> 'registered'))[1] first_stage,
      min(occurred_at) filter (where stage <> 'registered') started,
      min(occurred_at) filter (where stage = 'delivered') arrived
    from events group by package_id
  ), stats as (
    select count(*) filter (where stage = 'delivered')::integer delivered,
      avg(extract(epoch from (arrived - started))) filter (where stage = 'delivered' and first_stage in ('accepted','in_transit') and arrived > started and arrived <= now()) average_seconds,
      min(extract(epoch from (arrived - started))) filter (where stage = 'delivered' and first_stage in ('accepted','in_transit') and arrived > started and arrived <= now()) fastest_seconds,
      coalesce(bool_or(stage = 'delivered' and arrived >= date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' and arrived <= now()), false) this_week
    from journeys
  )
  select jsonb_build_object(
    'id', f.id, 'nickname', f.nickname,
    'stats', case when f.share_stats then jsonb_build_object(
      'deliveredCount', s.delivered,
      'averageDays', case when s.average_seconds is not null then greatest(1, ceil(s.average_seconds / 86400))::integer else null end,
      'stamps', to_jsonb(array_remove(array[
        case when s.delivered >= 1 then 'first' end,
        case when s.delivered >= 10 then 'ten' end,
        case when (select count(distinct carrier) from public.packages where user_id = p_owner) >= 3 then 'connected' end,
        case when s.fastest_seconds <= 172800 then 'express' end
      ], null))
    ) else null end,
    'arrivedThisWeek', case when f.share_arrival then s.this_week else null end
  ) from public.friend_profiles f cross join stats s where f.user_id = p_owner;
$$;
revoke all on function private.friend_card(uuid) from public, anon, authenticated;

create or replace function public.friends_snapshot()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); own public.friend_profiles;
begin
  if actor is null or not exists (select 1 from auth.users where id = actor and not is_anonymous) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  select * into own from public.friend_profiles where user_id = actor;
  return jsonb_build_object(
    'profile', case when own.user_id is not null then jsonb_build_object('nickname', own.nickname, 'shareStats', own.share_stats, 'shareArrival', own.share_arrival) else null end,
    'ownCard', case when own.user_id is not null then private.friend_card(actor) else null end,
    'friends', coalesce((select jsonb_agg(private.friend_card(friend_id) order by f.nickname, f.id)
      from public.friend_connections c
      cross join lateral (select case when c.user_low = actor then c.user_high else c.user_low end friend_id) other
      join public.friend_profiles f on f.user_id = friend_id
      where actor in (c.user_low, c.user_high)), '[]'::jsonb)
  );
end;
$$;

create or replace function public.friends_action(
  p_action text, p_nickname text default null, p_share_stats boolean default null,
  p_share_arrival boolean default null, p_code text default null, p_friend_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); owner uuid; code text; expiry timestamptz; target_name text;
begin
  if actor is null or not exists (select 1 from auth.users where id = actor and not is_anonymous) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if p_action = 'save_profile' then
    if p_nickname is null or char_length(btrim(p_nickname, U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) not between 1 and 24 or p_nickname ~ U&'[[:cntrl:]\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]'
       or p_share_stats is null or p_share_arrival is null then
      raise exception 'Invalid friend profile' using errcode = '22023';
    end if;
    insert into public.friend_profiles(user_id, nickname, share_stats, share_arrival)
      values(actor, btrim(p_nickname, U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), p_share_stats, p_share_arrival)
      on conflict(user_id) do update set nickname = excluded.nickname, share_stats = excluded.share_stats, share_arrival = excluded.share_arrival;
  elsif p_action = 'disable' then
    delete from public.friend_profiles where user_id = actor;
  elsif p_action = 'remove_friend' then
    select user_id into owner from public.friend_profiles where id = p_friend_id;
    delete from public.friend_connections where user_low = least(actor, owner) and user_high = greatest(actor, owner);
  elsif p_action = 'revoke_invite' then
    delete from public.friend_invites where user_id = actor;
  elsif p_action = 'create_invite' then
    perform 1 from public.friend_profiles where user_id = actor for update;
    if not found then raise exception 'Create your friend profile first' using errcode = '22023'; end if;
    code := replace(gen_random_uuid()::text, '-', '');
    expiry := now() + interval '7 days';
    insert into public.friend_invites(user_id, code_hash, expires_at)
      values(actor, encode(sha256(convert_to(code, 'UTF8')), 'hex'), expiry)
      on conflict(user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
    return jsonb_build_object('inviteCode', code, 'expiresAt', expiry);
  elsif p_action in ('preview_invite', 'accept_invite') then
    if p_code is null or p_code !~ '^[a-f0-9]{32}$' then
      raise exception 'Invitation unavailable' using errcode = 'P0002';
    end if;
    -- A preview discloses only the nickname and consumes nothing.
    select i.user_id, f.nickname into owner, target_name
      from public.friend_invites i join public.friend_profiles f on f.user_id = i.user_id
      where i.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') and i.expires_at > now();
    if owner is null or owner = actor then raise exception 'Invitation unavailable' using errcode = 'P0002'; end if;
    if p_action = 'preview_invite' then return jsonb_build_object('previewNickname', target_name); end if;
    -- Lock both profiles in a consistent order to bound concurrent friend counts.
    perform 1 from public.friend_profiles where user_id in (actor, owner) order by user_id for update;
    -- Recheck after locking profiles: rotation, removal, expiry, or another acceptance wins safely.
    perform 1 from public.friend_invites where user_id = owner
      and code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') and expires_at > now() for update;
    if not found then raise exception 'Invitation unavailable' using errcode = 'P0002'; end if;
    if not exists(select 1 from public.friend_profiles where user_id = actor) then
      raise exception 'Create your friend profile first' using errcode = '22023';
    end if;
    if (select count(*) from public.friend_connections where actor in (user_low, user_high)) >= 50
       or (select count(*) from public.friend_connections where owner in (user_low, user_high)) >= 50 then
      raise exception 'Your circle is full' using errcode = 'P0003';
    end if;
    insert into public.friend_connections(user_low, user_high) values(least(actor,owner), greatest(actor,owner)) on conflict do nothing;
    delete from public.friend_invites where user_id = owner;
  else
    raise exception 'Unknown Friends action' using errcode = '22023';
  end if;
  return jsonb_build_object('snapshot', public.friends_snapshot());
end;
$$;
revoke all on function public.friends_snapshot(), public.friends_action(text,text,boolean,boolean,text,uuid) from public, anon;
grant execute on function public.friends_snapshot(), public.friends_action(text,text,boolean,boolean,text,uuid) to authenticated;
notify pgrst, 'reload schema';
