begin;

-- Revoking a Supabase session now removes its push-to-start and update tokens.
-- Some deployments have not enabled the optional ActivityKit channel yet.
alter table if exists public.live_activity_devices
  add column if not exists session_id uuid references auth.sessions(id) on delete cascade,
  add column if not exists revocation_hash text check (revocation_hash ~ '^[0-9a-f]{64}$');

-- Existing registrations cannot be safely attributed to a login. The next app
-- activation registers them again with the verified current session.
do $$ begin
  if to_regclass('public.live_activity_devices') is not null then
    update public.live_activity_devices set disabled_at = now() where disabled_at is null and session_id is null;
  end if;
end; $$;

-- A brief tombstone also fences a registration POST arriving after its revoke.
create table if not exists public.live_activity_revocations (
  installation_id uuid not null,
  revocation_hash text not null check (revocation_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (installation_id, revocation_hash)
);
create index if not exists live_activity_revocations_created_idx on public.live_activity_revocations(created_at);
alter table public.live_activity_revocations enable row level security;
revoke all on public.live_activity_revocations from public, anon, authenticated;
grant all on public.live_activity_revocations to service_role;

create or replace function public.guard_live_activity_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Allow operational error/disabled-state updates without rebinding old rows.
  if new.disabled_at is not null then return new; end if;
  if new.session_id is null or not exists (
    select 1 from auth.sessions where id = new.session_id and user_id = new.user_id
  ) then raise exception 'A current owned session is required' using errcode = '23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.installation_id::text, 0));
  if exists (select 1 from public.live_activity_revocations
    where installation_id = new.installation_id and revocation_hash = new.revocation_hash) then
    raise exception 'Live Activity registration was revoked' using errcode = '23514';
  end if;
  return new;
end;
$$;
do $$ begin
  if to_regclass('public.live_activity_devices') is not null then
    drop trigger if exists live_activity_registration_guard on public.live_activity_devices;
    create trigger live_activity_registration_guard before insert or update on public.live_activity_devices
    for each row execute function public.guard_live_activity_registration();
  end if;
end; $$;

create or replace function public.revoke_live_activity_device(p_installation_id uuid, p_revocation_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_revocation_hash is null or p_revocation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid revocation proof' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));
  delete from public.live_activity_revocations where created_at < now() - interval '1 day';
  insert into public.live_activity_revocations(installation_id, revocation_hash)
    values (p_installation_id, p_revocation_hash) on conflict do nothing;
  if to_regclass('public.live_activity_devices') is not null then
    delete from public.live_activity_devices
      where installation_id = p_installation_id and revocation_hash = p_revocation_hash;
  end if;
end;
$$;
revoke all on function public.guard_live_activity_registration() from public, anon, authenticated;
revoke all on function public.revoke_live_activity_device(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_live_activity_device(uuid, text) to service_role;

-- Re-signing into the same account is a new binding as well.
do $upgrade$ begin
  if to_regclass('public.live_activity_devices') is not null then
    execute $definition$
create or replace function public.clear_live_activity_state_on_rebind()
returns trigger language plpgsql set search_path = '' as $body$
begin
  if new.user_id is distinct from old.user_id or new.session_id is distinct from old.session_id then
    delete from public.live_activity_update_tokens where device_id = new.id;
    delete from public.live_activity_event_deliveries where device_id = new.id;
  end if;
  return new;
end;
$body$;

$definition$;
    execute $definition$
create or replace function public.preserve_live_activity_subscription_epoch()
returns trigger language plpgsql set search_path = '' as $body$
begin
  if new.user_id = old.user_id and new.session_id is not distinct from old.session_id and old.disabled_at is null then
    new.subscribed_at := old.subscribed_at;
  else
    new.subscribed_at := now();
  end if;
  return new;
end;
$body$;
$definition$;
  end if;
end; $upgrade$;

notify pgrst, 'reload schema';
commit;
