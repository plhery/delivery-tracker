-- Repair Dutch, Belgian and French DHL Express facility clocks read as UTC.
-- A direct scan must still hash its own offset-less strings. A ParcelsApp copy
-- must also match the bound DHL history's clock, wording and whole location.
-- Explicit offsets, other providers, unknown zones and taken-over rows stand.
-- Keep the first row and its receipts if the corrected identity already exists.
do $$
declare
  receipt record;
begin
  lock table public.packages, public.tracking_events in share row exclusive mode;

  create temporary table dhl_clock_repairs as
  with zones(country, zone) as (values
    ('NETHERLANDS', 'Europe/Amsterdam'), ('NETHERLANDS, THE', 'Europe/Amsterdam'),
    ('BELGIUM', 'Europe/Brussels'), ('FRANCE', 'Europe/Paris')
  ), eligible as materialized (
    select event.*, split_part(event.provider_event_id, ':', 1) as source, zones.zone,
      (event.raw_data->>'time')::timestamp as wall
    from public.tracking_events event
    join public.packages parcel on parcel.id = event.package_id
    join zones on zones.country = substring(upper(btrim(event.location)) from ' - ([A-Z ,]+)$')
    where coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true'
      and (
        (event.provider_event_id like 'dhl-express:%'
          and event.raw_data->>'time' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        or (event.provider_event_id like 'unknown:%' and parcel.carrier = 'dhl-express'
          and parcel.carrier_data->>'tracking_provider' = 'ParcelsApp'
          and event.raw_data->>'time' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$'
          and parcel.carrier_data->'direct_local_history'->>'carrier' = 'dhl-express'
          and (parcel.carrier_data->'direct_local_history'->>'number' = parcel.tracking_number
            or (parcel.carrier_data->>'active_tracking_carrier' = 'dhl-express'
              and parcel.carrier_data->'direct_local_history'->>'number' = parcel.carrier_data->>'active_tracking_number'))
          and exists (
            select 1 from jsonb_array_elements(case
              when jsonb_typeof(parcel.carrier_data->'direct_local_history'->'events') = 'array'
                then parcel.carrier_data->'direct_local_history'->'events' else '[]'::jsonb end) scan
            where left(coalesce(scan->>'local_time', scan->>'time'), 19) = left(event.raw_data->>'time', 19)
              and scan->>'description' = event.description and scan->>'location' = event.location
          ))
      )
      and event.provider_event_id = split_part(event.provider_event_id, ':', 1) || ':' || encode(sha256(convert_to(
        '[' || to_json(split_part(event.provider_event_id, ':', 1))::text || ','
        || to_json(event.raw_data->>'time')::text || ',' || to_json(btrim(coalesce(event.location, '')))::text || ','
        || to_json(btrim(event.description))::text || ']', 'UTF8')), 'hex')
  ), clocks as (
    select eligible.*, wall at time zone zone as corrected_at,
      (extract(epoch from ((wall at time zone 'UTC') - (wall at time zone zone))) / 60)::integer as offset_minutes
    from eligible where occurred_at = wall at time zone 'UTC'
  ), strings as (
    select clocks.*, to_char(wall, 'YYYY-MM-DD"T"HH24:MI:SS')
      || case when offset_minutes < 0 then '-' else '+' end
      || lpad((abs(offset_minutes) / 60)::text, 2, '0') || ':'
      || lpad((abs(offset_minutes) % 60)::text, 2, '0') as scan_time
    from clocks
  ), keyed as (
    select strings.*, source || ':' || encode(sha256(convert_to(
      '[' || to_json(source)::text || ',' || to_json(scan_time)::text || ','
      || to_json(btrim(coalesce(location, '')))::text || ',' || to_json(btrim(description))::text || ']', 'UTF8')), 'hex') as identity
    from strings
  )
  select keyed.id as old_id, keyed.package_id, keyed.occurred_at as old_at, keyed.corrected_at,
    keyed.scan_time, keyed.identity,
    case when copy.created_at < keyed.created_at then copy.id else keyed.id end as kept_id,
    case when copy.created_at < keyed.created_at then keyed.id else copy.id end as copy_id,
    coalesce(copy.raw_data, keyed.raw_data || jsonb_build_object('time', keyed.scan_time)
      || case when keyed.raw_data ? 'instant' then jsonb_build_object('instant', keyed.scan_time) else '{}'::jsonb end) as raw_data
  from keyed
  left join public.tracking_events copy on copy.package_id = keyed.package_id and copy.provider_event_id = keyed.identity;

  create temporary table dhl_parcel_clocks as
  select parcel.id, max(repair.old_at) as old_latest,
    (select max(case when moved.old_id is not null then moved.corrected_at else event.occurred_at end)
      from public.tracking_events event left join dhl_clock_repairs moved on moved.old_id = event.id
      where event.package_id = parcel.id and event.provider_event_id not like 'app:%'
        and coalesce(event.raw_data->>'observed_without_provider_timestamp', 'false') <> 'true') as corrected_latest,
    (select moved.scan_time from dhl_clock_repairs moved
      where moved.package_id = parcel.id and moved.old_at = (parcel.carrier_data->>'last_update')::timestamptz
      order by moved.old_id limit 1) as summary_time
  from public.packages parcel join dhl_clock_repairs repair on repair.package_id = parcel.id
  group by parcel.id;

  for receipt in select * from (values
    ('push_deliveries', 'subscription_id'), ('native_push_deliveries', 'device_id'),
    ('parcel_link_alert_deliveries', 'alert_id')
  ) as receipts(table_name, owner_column) loop
    execute format(
      'insert into public.%I as kept (%I, event_id, sent_at)
       select r.%I, scan.kept_id, min(r.sent_at)
       from public.%I r join dhl_clock_repairs scan on scan.copy_id = r.event_id
       group by r.%I, scan.kept_id
       on conflict (%I, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at)',
      receipt.table_name, receipt.owner_column, receipt.owner_column,
      receipt.table_name, receipt.owner_column, receipt.owner_column
    );
  end loop;

  insert into public.live_activity_event_deliveries as kept (
    device_id, event_id, package_id, delivery_kind, event_created_at, sent_at
  )
  select distinct on (r.device_id, scan.kept_id)
    r.device_id, scan.kept_id, r.package_id, r.delivery_kind, event.created_at, r.sent_at
  from public.live_activity_event_deliveries r
  join dhl_clock_repairs scan on scan.copy_id = r.event_id
  join public.tracking_events event on event.id = scan.kept_id
  order by r.device_id, scan.kept_id, r.sent_at
  on conflict (device_id, event_id) do update set sent_at = least(kept.sent_at, excluded.sent_at);

  update public.tracking_status_observations observation set sample_event_id = scan.kept_id
  from dhl_clock_repairs scan where observation.sample_event_id = scan.copy_id;
  update public.delivery_emails email set event_id = scan.kept_id
  from dhl_clock_repairs scan where email.event_id = scan.copy_id
    and not exists (select 1 from public.delivery_emails told where told.event_id = scan.kept_id);

  delete from public.tracking_events event using dhl_clock_repairs scan where event.id = scan.copy_id;
  update public.tracking_events kept
  set occurred_at = scan.corrected_at, provider_event_id = scan.identity, raw_data = scan.raw_data
  from dhl_clock_repairs scan where kept.id = scan.kept_id;

  -- The summary's matching clock and the watermark (possibly capped by the
  -- check time) take the correction too, so fresh scans can pass the next sync.
  update public.packages parcel
  set carrier_data = parcel.carrier_data
    || case when clocks.summary_time is not null then jsonb_build_object('last_update', clocks.summary_time) else '{}'::jsonb end
    || case when (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz > clocks.corrected_latest
        and (parcel.carrier_data->'routing'->>'last_event_at')::timestamptz <= clocks.old_latest
      then jsonb_build_object('routing', (parcel.carrier_data->'routing') || jsonb_build_object(
        'last_event_at', to_char(clocks.corrected_latest at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      else '{}'::jsonb end
  from dhl_parcel_clocks clocks where parcel.id = clocks.id;

  drop table dhl_parcel_clocks;
  drop table dhl_clock_repairs;
end;
$$;
