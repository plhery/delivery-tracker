-- Durable thresholds: one scheduled check is one sample, independent of retry count.
create table public.tracking_health_samples (
  attempt_id uuid not null,
  kind text not null check (kind in ('refresh', 'provider', 'direct')),
  subject text not null check (length(subject) between 1 and 100),
  package_id uuid,
  healthy boolean not null,
  details jsonb not null default '{}',
  observed_at timestamptz not null default clock_timestamp(),
  primary key (attempt_id, kind, subject)
);
create index tracking_health_samples_window on public.tracking_health_samples(kind, subject, observed_at desc);
create table public.tracking_health_incidents (
  kind text not null,
  subject text not null,
  active boolean not null default false,
  last_notified_at timestamptz,
  pending jsonb,
  lease_until timestamptz,
  primary key (kind, subject)
);
alter table public.tracking_health_samples enable row level security;
alter table public.tracking_health_incidents enable row level security;
revoke all on public.tracking_health_samples, public.tracking_health_incidents from public, anon, authenticated;
grant all on public.tracking_health_samples, public.tracking_health_incidents to service_role;

create function public.record_tracking_health(p_attempt_id uuid, p_package_id uuid, p_samples jsonb)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  s jsonb; k text; subject_name text; state public.tracking_health_incidents;
  total bigint; failures bigint; consecutive boolean; recovered boolean; breached boolean;
  window_start timestamptz; evidence jsonb; pending_id uuid; notifications jsonb := '[]';
begin
  if jsonb_typeof(p_samples) <> 'array' or jsonb_array_length(p_samples) > 40 then
    raise exception 'Invalid health samples';
  end if;
  -- Retention is bounded even when a provider is no longer used.
  delete from public.tracking_health_samples where observed_at < now() - interval '24 hours';
  for s in select value from jsonb_array_elements(p_samples) order by value->>'kind', value->>'subject' loop
    k := s->>'kind'; subject_name := s->>'subject';
    if k not in ('refresh', 'provider', 'direct') or length(subject_name) not between 1 and 100
      or jsonb_typeof(s->'healthy') <> 'boolean' then raise exception 'Invalid health sample'; end if;
    insert into public.tracking_health_incidents(kind, subject) values(k, subject_name) on conflict do nothing;
    select * into state from public.tracking_health_incidents where kind=k and subject=subject_name for update;
    insert into public.tracking_health_samples(attempt_id,kind,subject,package_id,healthy,details)
      values(p_attempt_id,k,subject_name,case when k='refresh' then p_package_id end,
        (s->>'healthy')::boolean, coalesce(s->'details','{}')) on conflict do nothing;
    window_start := now() - case when k='refresh' then interval '1 hour' else interval '24 hours' end;
    select count(*), count(*) filter(where not healthy) into total,failures
      from public.tracking_health_samples where kind=k and subject=subject_name and observed_at >= window_start;
    consecutive := false;
    if k='refresh' then
      -- Three failed scheduled checks of the SAME parcel; manual refreshes never enter this table.
      select exists(select 1 from (
        select healthy,package_id,row_number() over(partition by package_id order by observed_at desc,attempt_id) as n
        from public.tracking_health_samples where kind=k and subject=subject_name
      ) recent where n<=3 group by package_id having count(*)=3 and bool_and(not healthy)) into consecutive;
    end if;
    breached := case when k='refresh' then consecutive or (failures>=5 and failures::numeric/nullif(total,0)>0.2)
      else total>=10 and failures::numeric/nullif(total,0)>0.5 end;
    select count(*)=3 and bool_and(healthy) into recovered from (
      select healthy from public.tracking_health_samples where kind=k and subject=subject_name
      order by observed_at desc,attempt_id limit 3
    ) recent;
    if k='refresh' then recovered := recovered and not breached; end if;
    select details into evidence from public.tracking_health_samples
      where kind=k and subject=subject_name and not healthy order by observed_at desc,attempt_id limit 1;
    if state.pending is null and (
      (state.active and recovered) or
      (breached and not recovered and (state.last_notified_at is null or state.last_notified_at < now()-interval '6 hours'))
    ) then
      pending_id := gen_random_uuid();
      state.pending := jsonb_build_object('id',pending_id,'kind',k,'subject',subject_name,
        'state',case when state.active and recovered then 'recovered' else 'open' end,
        'attempts',total,'failures',failures,'window_hours',case when k='refresh' then 1 else 24 end,
        'consecutive_failures',consecutive,'evidence',coalesce(evidence,'{}'));
      update public.tracking_health_incidents set pending=state.pending,lease_until=null
        where kind=k and subject=subject_name;
      state.lease_until := null;
    end if;
    -- A notification is retried after a failed Sentry flush or worker crash.
    if state.pending is not null and (state.lease_until is null or state.lease_until < now()) then
      notifications := notifications || jsonb_build_array(state.pending);
      update public.tracking_health_incidents set lease_until=now()+interval '2 minutes' where kind=k and subject=subject_name;
    end if;
  end loop;
  return notifications;
end;
$$;
create function public.ack_tracking_health(p_ids uuid[])
returns void language sql set search_path = pg_catalog as $$
  update public.tracking_health_incidents set active=(pending->>'state'='open'),
    last_notified_at=now(),pending=null,lease_until=null where (pending->>'id')::uuid=any(p_ids);
$$;
revoke all on function public.record_tracking_health(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ack_tracking_health(uuid[]) from public,anon,authenticated;
grant execute on function public.record_tracking_health(uuid,uuid,jsonb) to service_role;
grant execute on function public.ack_tracking_health(uuid[]) to service_role;
notify pgrst, 'reload schema';
