\set ON_ERROR_STOP on
begin;

insert into public.packages (id, user_id, tracking_number, carrier)
values ('96000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'GUARDTRACKING1234', 'ups');

do $$
declare
  parcel_id uuid := '96000000-0000-0000-0000-000000000001';
  original_generation uuid;
  new_generation uuid;
  stale_events jsonb := '[{"provider_event_id":"old:delivered","stage":"delivered","description":"Old carrier result","occurred_at":"2026-09-06T12:00:00Z"}]';
begin
  if has_function_privilege('authenticated', 'public.apply_tracking_sync(uuid,uuid,jsonb,jsonb,text[])', 'execute')
      or has_function_privilege('anon', 'public.apply_tracking_sync(uuid,uuid,jsonb,jsonb,text[])', 'execute') then
    raise exception 'users can call service-only tracking persistence';
  end if;
  select tracking_generation into original_generation from public.packages where id = parcel_id;
  if not public.apply_tracking_sync(parcel_id, original_generation, '{"sync_status":"syncing"}') then
    raise exception 'current generation could not start a check';
  end if;

  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  perform public.change_owned_package_carrier(parcel_id, 'dhl');
  -- Returning to the original carrier must not resurrect the original token.
  perform public.change_owned_package_carrier(parcel_id, 'ups');
  select tracking_generation into new_generation from public.packages where id = parcel_id;
  if original_generation = new_generation then raise exception 'carrier reset reused a generation'; end if;
  if public.apply_tracking_sync(parcel_id, original_generation,
      '{"current_stage":"delivered","sync_status":"ok"}', stale_events, array['Carrier changed; waiting for tracking'])
      or public.apply_tracking_sync(parcel_id, original_generation,
      '{"sync_status":"error","sync_error":"Old failure"}') then
    raise exception 'stale tracking writes were accepted';
  end if;
  if not exists (select 1 from public.packages where id = parcel_id and sync_status = 'pending' and current_stage = 'pending')
      or (select count(*) from public.tracking_events where package_id = parcel_id) <> 1
      or not exists (select 1 from public.tracking_events where package_id = parcel_id and provider_event_id = 'app:pending') then
    raise exception 'stale check changed reset state or history';
  end if;

  -- Repeated same-carrier resets are protected too, without changing the RPC.
  perform public.change_owned_package_carrier(parcel_id, 'ups');
  if public.apply_tracking_sync(parcel_id, new_generation, '{"sync_status":"waiting"}') then
    raise exception 'same-carrier reset did not invalidate a check';
  end if;
  select tracking_generation into new_generation from public.packages where id = parcel_id;
  if not public.apply_tracking_sync(parcel_id, new_generation,
      '{"current_stage":"in_transit","sync_status":"ok","sync_error":null}',
      '[{"provider_event_id":"new:transit","stage":"in_transit","description":"Corrected carrier","occurred_at":"2026-09-06T10:00:00Z"}]') then
    raise exception 'new generation result was rejected';
  end if;
  if exists (select 1 from public.tracking_events where package_id = parcel_id and stage = 'delivered') then
    raise exception 'old delivered event poisoned the new timeline';
  end if;

  -- A failed status write must roll back event insertion in the same transaction.
  begin
    perform public.apply_tracking_sync(parcel_id, new_generation,
      '{"current_stage":"invalid-stage"}', stale_events);
    raise exception 'invalid stage was accepted';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.tracking_events where package_id = parcel_id and stage = 'delivered') then
    raise exception 'failed transaction left partial tracking events';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  parcel public.packages;
begin
  select * into parcel from public.packages where id = '96000000-0000-0000-0000-000000000001';
  if not public.apply_tracking_sync(parcel.id, parcel.tracking_generation, '{"sync_status":"ok"}') then
    raise exception 'service role cannot persist a valid result';
  end if;
  delete from public.packages where id = parcel.id;
  if public.apply_tracking_sync(parcel.id, parcel.tracking_generation, '{"sync_status":"error"}') then
    raise exception 'deleted parcel accepted a late check';
  end if;
end;
$$;
rollback;
select 'tracking generation assertions passed' as result;
