\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values ('b8100000-0000-4000-8000-000000000001', 'outcomes-test@example.invalid');
insert into public.packages (id, user_id, tracking_number, carrier) values
  ('b8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000001', 'OUTCOMETEST1001', 'unknown');

-- A check completes as unchanged, with the scans it stored for the first time.
do $$
declare
  parcel uuid := 'b8100000-0000-4000-8000-000000000002';
  checks uuid[] := array['b8100000-0000-4000-8000-000000000011', 'b8100000-0000-4000-8000-000000000012',
    'b8100000-0000-4000-8000-000000000013', 'b8100000-0000-4000-8000-000000000014']::uuid[];
  health public.tracking_sync_health_24h;
begin
  assert not has_function_privilege('anon', 'public.complete_tracking_sync_attempt(uuid,jsonb,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.complete_tracking_sync_attempt(uuid,jsonb,jsonb)', 'execute');
  assert has_function_privilege('service_role', 'public.complete_tracking_sync_attempt(uuid,jsonb,jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.claim_delivery_emails(integer,integer,integer)', 'execute');
  assert not has_table_privilege('anon', 'public.tracking_sync_health_24h', 'select');
  assert not has_table_privilege('authenticated', 'public.tracking_sync_health_24h', 'select');
  assert has_table_privilege('service_role', 'public.tracking_sync_health_24h', 'select');
  assert (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.tracking_sync_health_24h'::regclass);

  insert into public.tracking_sync_attempts (id, package_id, trigger, configured_carrier)
  select id, parcel, 'scheduled', 'outcome-test' from unnest(checks) as id;
  assert public.complete_tracking_sync_attempt(checks[1],
    '{"outcome":"unchanged", "events_received":4, "events_normalized":4, "events_new":0}', '[]');
  assert public.complete_tracking_sync_attempt(checks[2],
    '{"outcome":"updated", "events_received":5, "events_normalized":5, "events_new":1}', '[]');
  -- The server running during the rollout sends no count.
  assert public.complete_tracking_sync_attempt(checks[3], '{"outcome":"updated", "events_normalized":5}', '[]');
  assert (select array_agg(outcome || ':' || coalesce(events_new::text, 'null') order by id)
    from public.tracking_sync_attempts where id = any(checks[1:3])) = array['unchanged:0', 'updated:1', 'updated:null'];

  begin
    perform public.complete_tracking_sync_attempt(checks[4], '{"outcome":"updated", "events_new":-1}', '[]');
    raise exception 'A negative count of new scans was stored' using errcode = 'P0002';
  exception when check_violation then null;
  end;
  begin
    perform public.complete_tracking_sync_attempt(checks[4], '{"outcome":"same"}', '[]');
    raise exception 'An unknown outcome was stored' using errcode = 'P0002';
  exception when check_violation then null;
  end;

  select * into strict health from public.tracking_sync_health_24h where configured_carrier = 'outcome-test';
  assert health.attempts = 4 and health.updated = 2 and health.unchanged = 1 and health.events_new = 1
    and health.errors = 0, format('The 24-hour health miscounted: %s', health);
end;
$$;

-- An earlier unchanged check saw the parcel on its way, so a delivery dated
-- only by its day is news.
insert into public.notification_preferences (user_id, timezone, email_on_delivery, email_enabled_at)
values ('b8100000-0000-4000-8000-000000000001', 'Europe/Zurich', true, now() - interval '10 days');
do $$
declare
  parcel uuid := 'b8100000-0000-4000-8000-000000000002';
  claim jsonb;
begin
  update public.packages set current_stage = 'delivered', created_at = now() - interval '30 hours',
    owned_since = now() - interval '30 hours' where id = parcel;
  update public.tracking_events set created_at = now() - interval '30 hours' where package_id = parcel;
  delete from public.tracking_sync_attempts where package_id = parcel;
  insert into public.tracking_sync_attempts (
    package_id, trigger, configured_carrier, outcome, current_step, selected_stage, started_at, completed_at
  ) values
    (parcel, 'scheduled', 'unknown', 'unchanged', 'complete', 'in_transit', now() - interval '20 hours', now() - interval '20 hours'),
    (parcel, 'scheduled', 'unknown', 'updated', 'complete', 'delivered', now() - interval '2 hours', now() - interval '2 hours');
  insert into public.tracking_events (package_id, provider_event_id, stage, description, occurred_at, created_at, raw_data)
  values (parcel, 'test:delivered', 'delivered', 'Test scan', now() - interval '6 hours', now() - interval '2 hours',
    jsonb_build_object('time', to_char((now() - interval '6 hours') at time zone 'UTC', 'YYYY-MM-DD')));
  claim := public.claim_delivery_emails(20, 20, 80);
  if claim#>>'{send,0,package_id}' is distinct from parcel::text or claim#>>'{send,0,delivered_time}' <> 'date' then
    raise exception 'A delivery after an unchanged check on its way was not claimed: %', claim;
  end if;
end;
$$;

-- A direct lookup that answered with the progress already saved verifies a fix.
do $$
declare
  case_id uuid;
begin
  perform public.record_tracking_support_observation('OUTCOMETEST2002', '{"reasons":["unknown_shape"]}', '{}',
    '2026-10-08T05:00:00Z', 'test:outcome-opened');
  select id into strict case_id from public.tracking_support_cases where tracking_number = 'OUTCOMETEST2002';
  update public.tracking_support_cases set fix_status = 'fixed', fix_reference = 'synthetic-fix',
    fixed_at = '2026-10-08T05:30:00Z' where id = case_id;
  perform public.record_tracking_support_observation('OUTCOMETEST2002', '{}',
    '{"outcome":"unchanged", "source_carrier":"chronopost", "support_lookup_number":"OUTCOMETEST2002", "support_direct_progress":true}',
    '2026-10-08T06:00:00Z', 'test:outcome-unchanged');
  assert (select fix_status = 'verified' and last_outcome = 'unchanged' and direct_verified_carrier = 'chronopost'
    and direct_verified_at = '2026-10-08T06:00:00Z'::timestamptz from public.tracking_support_cases where id = case_id),
    'An unchanged direct answer did not verify the fix';
end;
$$;

rollback;
select 'unchanged tracking check assertions passed' as result;
