-- Identify unknown parcels from provider evidence; selected carriers still need direct confirmation.
create or replace function public.apply_tracking_sync(
  p_package_id uuid,
  p_tracking_generation uuid,
  p_values jsonb,
  p_events jsonb default '[]'::jsonb,
  p_delete_descriptions text[] default '{}'::text[]
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  values_row public.packages;
  current_row public.packages;
  provider_identification boolean;
begin
  select * into current_row from public.packages
  where id = p_package_id and tracking_generation = p_tracking_generation
  for update;
  if not found then return false; end if;

  if jsonb_typeof(p_values) is distinct from 'object'
      or jsonb_typeof(p_events) is distinct from 'array'
      or (p_values - array[
        'current_stage', 'expected_delivery', 'last_status_text', 'last_synced_at',
        'sync_status', 'sync_error', 'carrier_data', 'carrier', 'tracking_url', 'dpd_postcode'
      ]) <> '{}'::jsonb then
    raise exception 'Invalid tracking sync payload' using errcode = '22023';
  end if;
  if p_values ?| array['carrier', 'tracking_url', 'dpd_postcode'] then
    if not (p_values ?& array['carrier', 'tracking_url', 'dpd_postcode', 'carrier_data'])
      or p_values->>'carrier' is null
      or p_values->>'carrier' = current_row.carrier
      or p_values#>>'{carrier_data,routing,configured_carrier}' is distinct from p_values->>'carrier'
      or current_row.carrier_data->>'original_carrier' is not null
      or p_values#>>'{carrier_data,original_carrier}' is not null then
      raise exception 'Invalid automatic carrier correction' using errcode = '22023';
    end if;
    -- Only the trusted sync writer supplies provider identity and number-bound movement.
    provider_identification := current_row.carrier = 'unknown'
      and p_values->>'tracking_url' is null and p_values->>'dpd_postcode' is null
      and p_values#>>'{carrier_data,discovered_carrier}' = p_values->>'carrier'
      and p_values#>>'{carrier_data,routing,discovered_carrier}' = p_values->>'carrier'
      and p_values#>>'{carrier_data,routing,preferred_number}' = current_row.tracking_number
      and p_values#>>'{carrier_data,routing,confirmed_carrier}' is null
      and current_row.carrier_data#>>'{routing,confirmed_carrier}' is null
      and p_values#>>'{carrier_data,tracking_provider}' in ('Ship24', 'ParcelsApp', '17TRACK', 'Postal Ninja')
      and jsonb_typeof(p_values#>'{carrier_data,reported_carriers}') = 'array'
      and jsonb_array_length(p_values#>'{carrier_data,reported_carriers}') = 1
      and jsonb_typeof(p_values#>'{carrier_data,reported_carriers,0}') = 'string'
      and exists (
        select 1 from jsonb_to_recordset(p_events) as event(stage text, occurred_at timestamptz)
        where event.stage not in ('pending', 'registered')
          and event.occurred_at is not null and event.occurred_at <= now() + interval '1 hour'
        union all
        select 1 from public.tracking_events event
        where event.package_id = p_package_id and event.stage not in ('pending', 'registered')
          and event.occurred_at = (p_values#>>'{carrier_data,routing,last_event_at}')::timestamptz
      );
    if not coalesce(provider_identification, false) then
      if p_values#>>'{carrier_data,routing,confirmed_carrier}' is distinct from p_values->>'carrier'
        or p_values#>>'{carrier_data,routing,confirmed_number}' is distinct from current_row.tracking_number
        or p_values#>>'{carrier_data,auto_changed_from}' is distinct from current_row.carrier
        or p_values#>>'{carrier_data,auto_changed_to}' is distinct from p_values->>'carrier' then
        raise exception 'Invalid automatic carrier correction' using errcode = '22023';
      end if;
      p_values := jsonb_set(p_values, '{carrier_data,auto_changed_at}', to_jsonb(now()));
    else
      p_values := jsonb_set(p_values, '{carrier_data}',
        (p_values->'carrier_data') - array['auto_changed_from', 'auto_changed_to', 'auto_changed_at']);
    end if;
  end if;
  values_row := jsonb_populate_record(null::public.packages, p_values);

  insert into public.tracking_events (
    package_id, provider_event_id, stage, description, location, occurred_at, raw_data
  )
  select p_package_id, event.provider_event_id, event.stage,
    event.description, event.location, event.occurred_at, coalesce(event.raw_data, '{}'::jsonb)
  from jsonb_to_recordset(p_events) as event(
    provider_event_id text, stage text, description text,
    location text, occurred_at timestamptz, raw_data jsonb
  )
  on conflict (package_id, provider_event_id) do update set
    stage = excluded.stage,
    description = excluded.description,
    location = excluded.location,
    occurred_at = excluded.occurred_at,
    raw_data = excluded.raw_data;

  delete from public.tracking_events
  where package_id = p_package_id and description = any(p_delete_descriptions);

  update public.packages set
    current_stage = case when p_values ? 'current_stage' then values_row.current_stage else current_stage end,
    expected_delivery = case when p_values ? 'expected_delivery' then values_row.expected_delivery else expected_delivery end,
    last_status_text = case when p_values ? 'last_status_text' then values_row.last_status_text else last_status_text end,
    last_synced_at = case when p_values ? 'last_synced_at' then values_row.last_synced_at else last_synced_at end,
    sync_status = case when p_values ? 'sync_status' then values_row.sync_status else sync_status end,
    sync_error = case when p_values ? 'sync_error' then values_row.sync_error else sync_error end,
    carrier_data = case when p_values ? 'carrier_data' then values_row.carrier_data else carrier_data end
  where id = p_package_id;
  -- Keep ordinary status writes from firing the input-generation trigger.
  if p_values ? 'carrier' then
    update public.packages set carrier = values_row.carrier,
      tracking_url = values_row.tracking_url, dpd_postcode = values_row.dpd_postcode
    where id = p_package_id;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.apply_tracking_sync(uuid, uuid, jsonb, jsonb, text[])
  to service_role;

-- Completed parcels no longer poll. Repair only retained, unambiguous Express evidence.
update public.packages parcel
set carrier = 'dhl-express', tracking_url = null, dpd_postcode = null,
    carrier_data = jsonb_set(parcel.carrier_data, '{routing,configured_carrier}', '"dhl-express"'::jsonb)
where parcel.carrier = 'unknown'
  and case when parcel.tracking_number ~ '^[0-9]{10}$'
    then left(parcel.tracking_number, 9)::bigint % 7 = right(parcel.tracking_number, 1)::integer else false end
  and parcel.current_stage not in ('pending', 'registered')
  and parcel.carrier_data->>'discovered_carrier' = 'dhl-express'
  and parcel.carrier_data->'reported_carriers' = '["DHL Express"]'::jsonb
  and parcel.carrier_data->>'tracking_provider' in ('Ship24', 'ParcelsApp', '17TRACK', 'Postal Ninja')
  and parcel.carrier_data#>>'{routing,preferred_number}' = parcel.tracking_number
  and parcel.carrier_data#>>'{routing,confirmed_carrier}' is null
  and parcel.carrier_data->>'original_carrier' is null
  and exists (
    select 1 from public.tracking_events event
    where event.package_id = parcel.id and event.stage not in ('pending', 'registered')
      and event.occurred_at is not null and event.occurred_at <= now() + interval '1 hour'
  );
