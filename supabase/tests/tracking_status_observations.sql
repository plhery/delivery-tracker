\set ON_ERROR_STOP on
begin;

-- Shape, exposure and privileges of the review table.
do $$
declare
  missing text;
begin
  select string_agg(expected.column_name, ', ') into missing
  from (values
    ('id'), ('observation_key'), ('carrier'), ('provider_code'),
    ('description_normalized'), ('language_guess'), ('stage_source'),
    ('chosen_stage'), ('count'), ('first_seen'), ('last_seen'),
    ('sample_event_id'), ('reviewed_at'), ('resolution')
  ) as expected (column_name)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tracking_status_observations'
      and column_name = expected.column_name
  );
  if missing is not null then
    raise exception 'observation columns are missing: %', missing;
  end if;

  -- The table must never grow a tracking number, package or account reference.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tracking_status_observations'
      and (column_name like '%tracking_number%'
        or column_name = 'package_id'
        or column_name = 'user_id')
  ) then
    raise exception 'observations must not identify a parcel or account';
  end if;

  if not (
    select relrowsecurity from pg_class
    where oid = 'public.tracking_status_observations'::regclass
  ) then
    raise exception 'row level security is disabled on the observation table';
  end if;

  if has_table_privilege('anon', 'public.tracking_status_observations', 'select')
    or has_table_privilege('anon', 'public.tracking_status_observations', 'insert')
    or has_table_privilege('authenticated', 'public.tracking_status_observations', 'select')
    or has_table_privilege('authenticated', 'public.tracking_status_observations', 'update')
    or has_table_privilege('authenticated', 'public.tracking_status_observations', 'delete') then
    raise exception 'browser roles can read or write status observations';
  end if;
  if not has_table_privilege('service_role', 'public.tracking_status_observations', 'select') then
    raise exception 'the worker role cannot read status observations';
  end if;

  if has_function_privilege('anon', 'public.record_tracking_status_observations(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.record_tracking_status_observations(jsonb)', 'execute') then
    raise exception 'browser roles can record status observations';
  end if;
  if not has_function_privilege('service_role', 'public.record_tracking_status_observations(jsonb)', 'execute') then
    raise exception 'the worker role cannot record status observations';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'tracking_status_observations'
      and indexdef like '%(carrier, reviewed_at)%'
  ) then
    raise exception 'the carrier review index is missing';
  end if;
end;
$$;

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status)
values ('97000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'OBSERVATION1', 'ctt', 'in_transit', 'ok');

insert into public.tracking_events (
  id, package_id, provider_event_id, stage, description, occurred_at, raw_data
) values (
  '97000000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000001',
  'ctt:sample-event',
  'in_transit',
  'Objeto em nova fase',
  '2026-09-12T10:00:00Z',
  '{"stage_source":"none"}'::jsonb
);

set local role service_role;

do $$
declare
  ctt_key text := encode(sha256('ctt|99|objeto em nova fase'::bytea), 'hex');
  inpost_key text := encode(sha256('inpost||przesylka w nowym stanie'::bytea), 'hex');
  observed public.tracking_status_observations;
  earlier timestamptz;
  payload jsonb;
begin
  payload := jsonb_build_array(
    jsonb_build_object(
      'observation_key', ctt_key,
      'carrier', 'ctt',
      'provider_code', '99',
      'description_normalized', 'objeto em nova fase',
      'language_guess', null,
      'stage_source', 'none',
      'chosen_stage', 'in_transit',
      'package_id', '97000000-0000-0000-0000-000000000001',
      'provider_event_id', 'ctt:sample-event'
    ),
    -- A wording repeated inside one batch collapses instead of aborting it.
    jsonb_build_object(
      'observation_key', ctt_key,
      'carrier', 'ctt',
      'provider_code', '99',
      'description_normalized', 'objeto em nova fase',
      'stage_source', 'none',
      'chosen_stage', 'in_transit'
    ),
    jsonb_build_object(
      'observation_key', inpost_key,
      'carrier', 'inpost',
      'provider_code', '',
      'description_normalized', 'przesylka w nowym stanie',
      'stage_source', 'wording:in_transit',
      'chosen_stage', 'in_transit'
    ),
    -- An incomplete row is dropped instead of failing the batch.
    jsonb_build_object('carrier', 'ctt', 'description_normalized', 'no key')
  );

  perform public.record_tracking_status_observations(payload);

  if (select count(*) from public.tracking_status_observations) <> 2 then
    raise exception 'the batch did not record exactly the two complete observations';
  end if;
  select * into observed from public.tracking_status_observations as observation
  where observation.observation_key = ctt_key;
  if observed.id is null then
    raise exception 'the observation was not recorded under its key';
  end if;
  if observed.count <> 1
    or observed.carrier <> 'ctt'
    or observed.provider_code <> '99'
    or observed.stage_source <> 'none'
    or observed.chosen_stage <> 'in_transit'
    or observed.reviewed_at is not null
    or observed.resolution is not null then
    raise exception 'the first observation was stored incorrectly';
  end if;
  if observed.sample_event_id <> '97000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'the sample event was not resolved';
  end if;
  if (select provider_code from public.tracking_status_observations as observation
      where observation.observation_key = inpost_key) is not null then
    raise exception 'an empty provider code must be stored as null';
  end if;

  -- Age the row so the second sighting proves which timestamps move.
  earlier := now() - interval '1 day';
  update public.tracking_status_observations as observation
  set first_seen = earlier, last_seen = earlier
  where observation.observation_key = ctt_key;

  perform public.record_tracking_status_observations(jsonb_build_array(jsonb_build_object(
    'observation_key', ctt_key,
    'carrier', 'ctt',
    'provider_code', '99',
    'description_normalized', 'objeto em nova fase',
    'stage_source', 'wording:in_transit',
    'chosen_stage', 'customs'
  )));

  if (select count(*) from public.tracking_status_observations) <> 2 then
    raise exception 'a repeated wording inserted a second row';
  end if;
  select * into observed from public.tracking_status_observations as observation
  where observation.observation_key = ctt_key;
  if observed.count <> 2 then
    raise exception 'a repeated wording did not increment its count';
  end if;
  if observed.first_seen <> earlier or observed.last_seen <= earlier then
    raise exception 'the repeated wording did not keep first_seen and move last_seen';
  end if;
  if observed.stage_source <> 'wording:in_transit' or observed.chosen_stage <> 'customs' then
    raise exception 'the repeated wording kept a stale decision';
  end if;
  -- A later sighting without a resolvable event keeps the earlier sample.
  if observed.sample_event_id <> '97000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'the stored sample event was dropped';
  end if;

  begin
    update public.tracking_status_observations as observation
    set reviewed_at = now(), resolution = 'renamed'
    where observation.observation_key = ctt_key;
    raise exception 'an unknown resolution was accepted';
  exception when check_violation then null;
  end;
  update public.tracking_status_observations as observation
  set reviewed_at = now(), resolution = 'mapped'
  where observation.observation_key = ctt_key;

  -- Deleting the parcel history must clear the join key, never the observation.
  delete from public.tracking_events where id = '97000000-0000-0000-0000-000000000002';
  select * into observed from public.tracking_status_observations as observation
  where observation.observation_key = ctt_key;
  if observed.id is null or observed.sample_event_id is not null then
    raise exception 'a deleted event did not clear only the sample reference';
  end if;
end;
$$;

rollback;
select 'tracking status observation assertions passed' as result;
