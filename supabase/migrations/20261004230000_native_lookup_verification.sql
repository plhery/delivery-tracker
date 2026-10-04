create table private.native_attest_keys (
  key_id text primary key check (length(key_id) = 44),
  public_key text not null check (length(public_key) <= 1024),
  app_id text not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  last_seen_at timestamptz not null default now()
);
create table private.native_used_challenges (
  hash text primary key check (length(hash) = 64),
  expires_at timestamptz not null
);
create table private.native_tracking_usage (
  key_id text not null references private.native_attest_keys(key_id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('lookup', 'detection')),
  count integer not null check (count > 0),
  primary key (key_id, day, kind)
);
alter table private.native_attest_keys enable row level security;
alter table private.native_used_challenges enable row level security;
alter table private.native_tracking_usage enable row level security;
revoke all on private.native_attest_keys, private.native_used_challenges, private.native_tracking_usage from public, anon, authenticated;

create function public.register_native_attest_key(p_key_id text, p_public_key text, p_app_id text, p_challenge text, p_expires timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '2 minutes' then return false; end if;
  delete from private.native_used_challenges where expires_at <= now();
  delete from private.native_attest_keys where last_seen_at < now() - interval '90 days';
  insert into private.native_used_challenges values (p_challenge, p_expires) on conflict do nothing;
  if not found then return false; end if;
  -- Re-registration must never reset an existing key's assertion counter.
  insert into private.native_attest_keys(key_id, public_key, app_id) values (p_key_id, p_public_key, p_app_id) on conflict do nothing;
  return exists(select 1 from private.native_attest_keys where key_id = p_key_id and public_key = p_public_key and app_id = p_app_id);
end;
$$;

create function public.get_native_attest_key(p_key_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('public_key', public_key, 'app_id', app_id, 'sign_count', sign_count)
  from private.native_attest_keys where key_id = p_key_id and last_seen_at >= now() - interval '90 days';
$$;

create function public.accept_native_assertion(p_key_id text, p_counter bigint, p_challenge text, p_expires timestamptz, p_kind text, p_limit integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  previous bigint;
  claimed integer;
  today constant date := (now() at time zone 'UTC')::date;
begin
  if p_counter is null or p_counter <= 0 or p_limit is null or p_limit < 0 or p_kind is null or p_kind not in ('lookup','detection')
    or p_expires is null or p_expires <= now() or p_expires > now() + interval '2 minutes' then return 'rejected'; end if;
  select sign_count into previous from private.native_attest_keys where key_id = p_key_id and last_seen_at >= now() - interval '90 days' for update;
  if previous is null or p_counter <= previous then return 'rejected'; end if;
  delete from private.native_used_challenges where expires_at <= now();
  insert into private.native_used_challenges values (p_challenge, p_expires) on conflict do nothing;
  if not found then return 'rejected'; end if;
  update private.native_attest_keys set sign_count = p_counter, last_seen_at = now() where key_id = p_key_id;
  delete from private.native_tracking_usage where day < today - 7;
  if p_limit = 0 then return 'limited'; end if;
  insert into private.native_tracking_usage as usage values (p_key_id, today, p_kind, 1)
  on conflict (key_id, day, kind) do update set count = usage.count + 1 where usage.count < p_limit returning count into claimed;
  return case when claimed is null then 'limited' else 'accepted' end;
end;
$$;
revoke all on function public.register_native_attest_key(text,text,text,text,timestamptz), public.get_native_attest_key(text), public.accept_native_assertion(text,bigint,text,timestamptz,text,integer) from public, anon, authenticated;
grant execute on function public.register_native_attest_key(text,text,text,text,timestamptz), public.get_native_attest_key(text), public.accept_native_assertion(text,bigint,text,timestamptz,text,integer) to service_role;
notify pgrst, 'reload schema';
