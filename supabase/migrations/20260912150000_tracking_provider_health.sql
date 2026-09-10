-- Shared admission/cooldown state. No parcel identifiers or private payloads.
create table public.tracking_provider_health (
  provider text primary key check (provider in ('17TRACK', 'ParcelsApp', 'Ship24', 'Postal Ninja')),
  failures integer not null default 0,
  successes bigint not null default 0,
  attempts bigint not null default 0,
  last_failure_kind text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_duration_ms integer,
  next_allowed_at timestamptz not null default '-infinity',
  lease_token uuid,
  lease_until timestamptz
);
alter table public.tracking_provider_health enable row level security;
revoke all on public.tracking_provider_health from public, anon, authenticated;
grant select, insert, update on public.tracking_provider_health to service_role;

create function public.acquire_tracking_provider(p_provider text)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare row public.tracking_provider_health; token uuid := gen_random_uuid();
begin
  insert into public.tracking_provider_health(provider) values(p_provider) on conflict do nothing;
  select * into row from public.tracking_provider_health where provider = p_provider for update;
  if row.next_allowed_at > now() or row.lease_until > now() then
    return jsonb_build_object('token', null, 'retry_at', greatest(row.next_allowed_at, coalesce(row.lease_until, now())));
  end if;
  update public.tracking_provider_health set lease_token = token, lease_until = now() + interval '90 seconds',
    last_attempt_at = now(), attempts = attempts + 1 where provider = p_provider;
  return jsonb_build_object('token', token, 'retry_at', now() + interval '90 seconds');
end;
$$;

create function public.finish_tracking_provider(p_provider text, p_token uuid, p_kind text, p_retry_ms bigint, p_duration_ms integer)
returns void language plpgsql set search_path = pg_catalog as $$
declare row public.tracking_provider_health; delay_ms bigint;
begin
  if p_kind is not null and p_kind not in ('rate_limited', 'not_found', 'verification', 'schema', 'transport') then
    raise exception 'Invalid failure category';
  end if;
  select * into row from public.tracking_provider_health where provider = p_provider and lease_token = p_token for update;
  if not found then return; end if; -- A stale worker cannot release a newer lease.
  -- Not-found belongs to this parcel. It does not open the provider's circuit.
  delay_ms := case when p_kind is null or p_kind = 'not_found' then 5000
    when p_kind = 'rate_limited' then greatest(900000, least(604800000, p_retry_ms))
    when p_kind = 'verification' then 3600000
    else least(3600000, 60000 * power(2, least(row.failures, 6)))::bigint end;
  update public.tracking_provider_health set
    failures = case when p_kind is null then 0 when p_kind = 'not_found' then failures else least(20, failures + 1) end,
    successes = successes + case when p_kind is null then 1 else 0 end,
    last_failure_kind = p_kind,
    last_success_at = case when p_kind is null then now() else last_success_at end,
    last_duration_ms = greatest(0, p_duration_ms),
    next_allowed_at = now() + delay_ms * interval '1 millisecond', lease_token = null, lease_until = null
  where provider = p_provider;
end;
$$;
revoke all on function public.acquire_tracking_provider(text) from public, anon, authenticated;
revoke all on function public.finish_tracking_provider(text, uuid, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.acquire_tracking_provider(text) to service_role;
grant execute on function public.finish_tracking_provider(text, uuid, text, bigint, integer) to service_role;
notify pgrst, 'reload schema';
