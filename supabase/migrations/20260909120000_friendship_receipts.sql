-- An acceptance creates one private receipt for the sender. Removing the
-- friendship (or either profile/account) removes the receipt and queued pushes.
create table public.friendship_updates (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.friend_profiles(user_id) on delete cascade,
  friend_user_id uuid not null references public.friend_profiles(user_id) on delete cascade,
  user_low uuid not null,
  user_high uuid not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique(recipient_id, friend_user_id),
  foreign key (user_low, user_high) references public.friend_connections(user_low, user_high) on delete cascade,
  check (user_low = least(recipient_id, friend_user_id) and user_high = greatest(recipient_id, friend_user_id))
);
create table public.friendship_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.friendship_updates(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  device_id uuid references public.native_push_devices(id) on delete cascade,
  sent_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  check ((subscription_id is null) <> (device_id is null)),
  unique(update_id, subscription_id),
  unique(update_id, device_id)
);
alter table public.friendship_updates enable row level security;
alter table public.friendship_push_deliveries enable row level security;
revoke all on public.friendship_updates, public.friendship_push_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.friendship_updates, public.friendship_push_deliveries to service_role;
create index friendship_updates_unseen_idx on public.friendship_updates(recipient_id) where seen_at is null;
create index friendship_push_pending_idx on public.friendship_push_deliveries(next_attempt_at) where sent_at is null;

create function private.queue_friendship_push() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.friendship_push_deliveries(update_id, subscription_id)
    select new.id, id from public.push_subscriptions
    where user_id = new.recipient_id and disabled_at is null and subscribed_at <= new.created_at;
  insert into public.friendship_push_deliveries(update_id, device_id)
    select new.id, id from public.native_push_devices
    where user_id = new.recipient_id and disabled_at is null and subscribed_at <= new.created_at;
  return new;
end $$;
revoke all on function private.queue_friendship_push() from public, anon, authenticated;
create trigger friendship_push_after_accept after insert on public.friendship_updates
  for each row execute function private.queue_friendship_push();

create function public.friends_activity() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists(select 1 from auth.users where id = actor and not is_anonymous) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  return jsonb_build_object('updates', coalesce((select jsonb_agg(jsonb_build_object(
      'friendId', f.id, 'nickname', f.nickname) order by u.created_at desc, u.id)
    from public.friendship_updates u join public.friend_profiles f on f.user_id = u.friend_user_id
    where u.recipient_id = actor and u.seen_at is null), '[]'::jsonb));
end $$;
revoke all on function public.friends_activity() from public, anon;
grant execute on function public.friends_activity() to authenticated;

-- Leases prevent multiple app replicas from sending the same receipt together.
-- Eligibility is checked again here: a device may have signed out, changed
-- accounts, or been disabled since the friendship was created.
create function public.claim_friendship_push(p_web boolean, p_native boolean, p_limit integer default 20)
returns setof jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare delivery record; lease uuid;
begin
  delete from public.friendship_push_deliveries d using public.friendship_updates u
    where d.update_id = u.id and u.created_at < now() - interval '7 days';
  for delivery in
    select d.id, d.subscription_id, d.device_id, f.id friend_id, f.nickname,
      coalesce(s.locale, n.locale, 'en') locale, s.endpoint, s.p256dh, s.auth, n.token, n.environment
    from public.friendship_push_deliveries d
    join public.friendship_updates u on u.id = d.update_id
    join public.friend_profiles f on f.user_id = u.friend_user_id
    left join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = u.recipient_id
      and s.disabled_at is null and s.subscribed_at <= u.created_at
    left join public.native_push_devices n on n.id = d.device_id and n.user_id = u.recipient_id
      and n.disabled_at is null and n.subscribed_at <= u.created_at
    left join public.notification_preferences p on p.user_id = u.recipient_id
    where d.sent_at is null and d.attempts < 8 and d.next_attempt_at <= now()
      and (d.locked_until is null or d.locked_until < now()) and u.seen_at is null
      and ((p_web and s.id is not null) or (p_native and n.id is not null))
      and (p.quiet_hours_start is null or p.quiet_hours_end is null or case
        when p.quiet_hours_start < p.quiet_hours_end then
          (now() at time zone p.timezone)::time < p.quiet_hours_start or (now() at time zone p.timezone)::time >= p.quiet_hours_end
        else (now() at time zone p.timezone)::time < p.quiet_hours_start and (now() at time zone p.timezone)::time >= p.quiet_hours_end end)
    order by u.created_at, d.id limit greatest(1, least(p_limit, 50)) for update of d skip locked
  loop
    lease := gen_random_uuid();
    update public.friendship_push_deliveries set lease_token = lease, locked_until = now() + interval '5 minutes', attempts = attempts + 1 where id = delivery.id;
    return next to_jsonb(delivery) || jsonb_build_object('lease_token', lease);
  end loop;
end $$;
create function public.finish_friendship_push(p_id uuid, p_lease uuid, p_success boolean)
returns void language sql security definer set search_path = pg_catalog as $$
  update public.friendship_push_deliveries set
    sent_at = case when p_success then now() else null end,
    next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7)))::integer),
    locked_until = null, lease_token = null
    where id = p_id and lease_token = p_lease and sent_at is null;
$$;
revoke all on function public.claim_friendship_push(boolean,boolean,integer), public.finish_friendship_push(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_friendship_push(boolean,boolean,integer), public.finish_friendship_push(uuid,uuid,boolean) to service_role;

create or replace function public.friends_action(
  p_action text, p_nickname text default null, p_share_stats boolean default null,
  p_share_arrival boolean default null, p_code text default null, p_friend_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); owner uuid; code text; expiry timestamptz; target_name text; inserted_count integer;
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
  elsif p_action = 'acknowledge_friend' then
    update public.friendship_updates u set seen_at = now() from public.friend_profiles f
      where u.recipient_id = actor and u.friend_user_id = f.user_id and f.id = p_friend_id and u.seen_at is null;
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
    get diagnostics inserted_count = row_count;
    if inserted_count > 0 then
      insert into public.friendship_updates(recipient_id, friend_user_id, user_low, user_high)
        values(owner, actor, least(actor, owner), greatest(actor, owner));
    end if;
    delete from public.friend_invites where user_id = owner;
    return jsonb_build_object('snapshot', public.friends_snapshot(), 'acceptedFriend', private.friend_card(owner));
  else
    raise exception 'Unknown Friends action' using errcode = '22023';
  end if;
  return jsonb_build_object('snapshot', public.friends_snapshot());
end;
$$;

notify pgrst, 'reload schema';
