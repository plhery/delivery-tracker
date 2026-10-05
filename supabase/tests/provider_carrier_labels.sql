\set ON_ERROR_STOP on
begin;

do $$
begin
  if not exists (select 1 from public.packages where id = '19100000-0000-0000-0000-000000000001'
      and carrier = 'dhl-express' and current_stage = 'delivered'
      and carrier_data->>'tracking_provider' = 'Ship24'
      and carrier_data#>>'{routing,configured_carrier}' = 'dhl-express'
      and carrier_data#>>'{routing,confirmed_carrier}' is null) then
    raise exception 'Completed provider identity was not repaired';
  end if;
  if (select count(*) from public.tracking_events
      where package_id = '19100000-0000-0000-0000-000000000001'
        and provider_event_id = 'unknown:provider-fixture') <> 1 then
    raise exception 'Carrier repair altered shipment history';
  end if;
  if not exists (select 1 from public.packages where id = '19100000-0000-0000-0000-000000000002' and carrier = 'ups')
      or (select count(*) from public.packages
        where id in ('19100000-0000-0000-0000-000000000003', '19100000-0000-0000-0000-000000000004',
          '19100000-0000-0000-0000-000000000005') and carrier = 'unknown') <> 3 then
    raise exception 'Carrier repair adopted conflicting or unbound evidence';
  end if;
end;
$$;

do $$
declare
  parcel public.packages;
  selected public.packages;
  correction jsonb;
  scans jsonb := jsonb_build_array(jsonb_build_object('provider_event_id', 'unknown:provider-result',
    'stage', 'in_transit', 'description', 'In transit', 'occurred_at', now()));
begin
  insert into public.packages(user_id, tracking_number, carrier)
  values ('10000000-0000-0000-0000-000000000001', '1234567891', 'unknown') returning * into parcel;
  correction := jsonb_build_object('carrier', 'dhl-express', 'tracking_url', null, 'dpd_postcode', null,
    'current_stage', 'in_transit', 'sync_status', 'ok', 'carrier_data', jsonb_build_object(
      'tracking_provider', 'Ship24', 'discovered_carrier', 'dhl-express', 'reported_carriers', jsonb_build_array('DHL Express'),
      'routing', jsonb_build_object('version', 1, 'configured_carrier', 'dhl-express', 'discovered_carrier', 'dhl-express',
        'preferred_number', parcel.tracking_number, 'preferred_provider', 'Ship24', 'last_event_at', now())));
  begin
    perform public.apply_tracking_sync(parcel.id, parcel.tracking_generation, correction);
    raise exception 'Provider identity without dated movement was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.apply_tracking_sync(parcel.id, parcel.tracking_generation,
      jsonb_set(correction, '{carrier_data,routing,preferred_number}', '"OTHER1234"'), scans);
    raise exception 'Provider identity for another number was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.apply_tracking_sync(parcel.id, parcel.tracking_generation,
      jsonb_set(correction, '{carrier_data,reported_carriers}', '["DHL Express","Swiss Post"]'), scans);
    raise exception 'Conflicting provider identity was accepted';
  exception when sqlstate '22023' then null;
  end;
  insert into public.packages(user_id, tracking_number, carrier)
  values ('10000000-0000-0000-0000-000000000001', '1234567880', 'ups') returning * into selected;
  begin
    perform public.apply_tracking_sync(selected.id, selected.tracking_generation,
      jsonb_set(correction, '{carrier_data,routing,preferred_number}', to_jsonb(selected.tracking_number)), scans);
    raise exception 'Provider identity replaced a selected carrier';
  exception when sqlstate '22023' then null;
  end;
  if not public.apply_tracking_sync(parcel.id, parcel.tracking_generation, correction, scans) then
    raise exception 'Provider carrier was not saved';
  end if;
  if not exists (select 1 from public.packages where id = parcel.id and carrier = 'dhl-express'
      and carrier_data->>'tracking_provider' = 'Ship24'
      and carrier_data#>>'{routing,confirmed_carrier}' is null
      and not (carrier_data ? 'auto_changed_from') and tracking_generation <> parcel.tracking_generation) then
    raise exception 'Provider identity lost its source or claimed direct confirmation';
  end if;
  if public.apply_tracking_sync(parcel.id, parcel.tracking_generation, '{"sync_status":"error"}') then
    raise exception 'Old sync overwrote provider identity';
  end if;
  if has_function_privilege('authenticated', 'public.apply_tracking_sync(uuid,uuid,jsonb,jsonb,text[])', 'execute')
      or has_function_privilege('anon', 'public.apply_tracking_sync(uuid,uuid,jsonb,jsonb,text[])', 'execute') then
    raise exception 'Provider identity is callable by a client';
  end if;
end;
$$;
rollback;

-- Remove the upgrade fixtures before the shared ownership assertions.
delete from public.packages where id in (
  select ('19100000-0000-0000-0000-' || lpad(sample.id::text, 12, '0'))::uuid
  from generate_series(1, 5) as sample(id)
);
