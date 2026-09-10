\set ON_ERROR_STOP on
begin;

do $$
declare first jsonb; second jsonb; token uuid; old_token uuid;
begin
  if has_table_privilege('authenticated', 'public.tracking_provider_health', 'select')
    or has_function_privilege('anon', 'public.acquire_tracking_provider(text)', 'execute')
    or has_function_privilege('authenticated', 'public.finish_tracking_provider(text,uuid,text,bigint,integer)', 'execute') then
    raise exception 'Provider health is not service-only';
  end if;
  first := public.acquire_tracking_provider('17TRACK');
  token := (first->>'token')::uuid;
  if token is null then raise exception 'First request not admitted'; end if;
  second := public.acquire_tracking_provider('17TRACK');
  if second->>'token' is not null then raise exception 'Concurrent request admitted'; end if;
  perform public.finish_tracking_provider('17TRACK', token, 'rate_limited', 7200000, 400);
  if (select next_allowed_at from public.tracking_provider_health where provider = '17TRACK') < now() + interval '2 hours' then
    raise exception 'Retry-After not respected';
  end if;
  if public.acquire_tracking_provider('17TRACK')->>'token' is not null then raise exception 'Cooldown bypassed'; end if;
  old_token := token;
  update public.tracking_provider_health set next_allowed_at = now() - interval '1 second' where provider = '17TRACK';
  token := (public.acquire_tracking_provider('17TRACK')->>'token')::uuid;
  perform public.finish_tracking_provider('17TRACK', old_token, null, 0, 1);
  if (select lease_token from public.tracking_provider_health where provider = '17TRACK') <> token then raise exception 'Stale worker released new lease'; end if;
  perform public.finish_tracking_provider('17TRACK', token, null, 0, 200);
  if not exists (select 1 from public.tracking_provider_health where provider = '17TRACK' and failures = 0 and successes = 1 and last_success_at is not null) then raise exception 'Recovery not recorded'; end if;
  token := (public.acquire_tracking_provider('Ship24')->>'token')::uuid;
  perform public.finish_tracking_provider('Ship24', token, 'not_found', 86400000, 200);
  if (select next_allowed_at from public.tracking_provider_health where provider = 'Ship24') > now() + interval '10 seconds' then raise exception 'Parcel not-found disabled whole provider'; end if;
end;
$$;

insert into public.packages(id, user_id, tracking_number, carrier, current_stage, sync_status, last_synced_at, carrier_data)
values ('96000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
  'ROUTING1234', 'ups', 'in_transit', 'ok', now(), '{"last_update":"2026-09-10T10:00:00Z"}');
insert into public.tracking_events(package_id, stage, description, occurred_at, provider_event_id)
values ('96000000-0000-0000-0000-000000000005', 'in_transit', 'Confirmed history', now(), 'confirmed:1');
do $$
declare old_generation uuid; parcel_id uuid := '96000000-0000-0000-0000-000000000005';
begin
  select tracking_generation into old_generation from public.packages where packages.id = parcel_id;
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  perform public.change_owned_package_carrier(parcel_id, 'fedex');
  if not exists (select 1 from public.packages where packages.id = parcel_id and carrier = 'fedex'
    and current_stage = 'in_transit' and carrier_data->'routing'->>'confirmed_carrier' = 'ups'
    and carrier_data->'routing'->>'confirmed_number' = 'ROUTING1234'
    and tracking_generation <> old_generation and last_synced_at is null) then
    raise exception 'Carrier edit lost history/routing or did not invalidate worker';
  end if;
  if not exists (select 1 from public.tracking_events where package_id = parcel_id and provider_event_id = 'confirmed:1') then
    raise exception 'Carrier edit deleted confirmed history';
  end if;
  if public.apply_tracking_sync(parcel_id, old_generation, '{"current_stage":"delivered"}') then raise exception 'Old worker overwrote new selection'; end if;
end;
$$;
do $$
declare
  parcel_id uuid := '96000000-0000-0000-0000-000000000005';
  generation uuid;
  correction jsonb := '{"carrier":"ups","tracking_url":null,"dpd_postcode":null,"sync_status":"ok","carrier_data":{"auto_changed_from":"fedex","auto_changed_to":"ups","routing":{"confirmed_carrier":"ups","configured_carrier":"ups","confirmed_number":"ROUTING1234"}}}';
begin
  select tracking_generation into generation from public.packages where id = parcel_id;
  if not public.apply_tracking_sync(parcel_id, generation, '{"sync_status":"syncing"}') then raise exception 'Normal sync rejected'; end if;
  if (select tracking_generation from public.packages where id = parcel_id) <> generation then raise exception 'Normal sync renewed generation'; end if;
  begin
    perform public.apply_tracking_sync(parcel_id, generation, jsonb_set(correction, '{carrier_data,routing,confirmed_number}', '"WRONG"'));
    raise exception 'Unconfirmed correction accepted';
  exception when invalid_parameter_value then null;
  end;
  if not public.apply_tracking_sync(parcel_id, generation, correction,
    '[{"provider_event_id":"correction:1","stage":"in_transit","description":"Verified UPS history","occurred_at":"2026-09-10T11:00:00Z"}]') then raise exception 'Verified correction rejected'; end if;
  if not exists (select 1 from public.packages where id = parcel_id and carrier = 'ups'
    and tracking_generation <> generation and tracking_url is null and dpd_postcode is null
    and carrier_data->>'auto_changed_from' = 'fedex'
    and (carrier_data->>'auto_changed_at')::timestamptz = now()) then raise exception 'Correction not atomic or fenced'; end if;
  if not exists (select 1 from public.tracking_events where package_id = parcel_id and provider_event_id = 'correction:1') then raise exception 'Missing correction evidence'; end if;
  if public.apply_tracking_sync(parcel_id, generation, '{"sync_status":"error"}') then raise exception 'Old worker overwrote correction'; end if;
  perform public.change_owned_package_carrier(parcel_id, 'dhl');
  if exists (select 1 from public.packages where id = parcel_id and carrier_data ?| array['auto_changed_from','auto_changed_to','auto_changed_at']) then raise exception 'Manual edit retained notice'; end if;
  if not exists (select 1 from public.tracking_events where package_id = parcel_id and provider_event_id = 'correction:1') then raise exception 'Manual edit lost history'; end if;
  if has_function_privilege('authenticated','public.apply_tracking_sync(uuid,uuid,jsonb,jsonb,text[])','execute') then raise exception 'Correction callable by client'; end if;
end;
$$;
rollback;
