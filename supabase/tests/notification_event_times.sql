\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('97000000-0000-0000-0000-000000000001', 'notification-times@example.invalid');

insert into auth.sessions(id, user_id) values ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001');
set local role service_role;
insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
values ('97000000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000001', '1Z999AA10123456784', 'ups', 'out_for_delivery');

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, subscribed_at)
values ('97000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/notification-times', 'test-key', 'test-auth', '2000-01-01');
insert into public.native_push_devices (user_id, token, environment, subscribed_at)
values ('97000000-0000-0000-0000-000000000001', repeat('97', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (session_id, user_id, installation_id, token, environment, subscribed_at)
values ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000003',
  repeat('98', 32), 'development', '2000-01-01');

insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
select '97000000-0000-0000-0000-000000000002', 'out_for_delivery', source.name,
  '2026-09-07T12:32:00Z', source.name, source.raw_data
from (values
  ('timed', '{"time":"2026-09-07T12:32:00Z"}'::jsonb),
  ('local-time', '{"time":"07.09.2026 14:32"}'::jsonb),
  ('date-only', '{"time":"2026-09-07"}'::jsonb),
  ('observed', '{"time":"2026-09-07T12:32:00Z","observed_without_provider_timestamp":true}'::jsonb),
  ('missing-time', '{}'::jsonb)
) as source(name, raw_data);

do $$
declare
  queue text;
  total integer;
  precise integer;
  mismatches integer;
begin
  foreach queue in array array[
    'pending_push_notifications', 'pending_native_push_notifications', 'pending_live_activity_events'
  ] loop
    execute format('select count(*), count(*) filter (where event_has_time),
      count(*) filter (where event_has_time is distinct from (description in (''timed'', ''local-time''))) from public.%I
      where package_id = %L', queue, '97000000-0000-0000-0000-000000000002')
      into total, precise, mismatches;
    if total <> 5 or precise <> 2 or mismatches <> 0 then
      raise exception '% lost event precision: % total, % precise', queue, total, precise;
    end if;
    if has_table_privilege('authenticated', 'public.' || queue, 'SELECT')
        or has_table_privilege('anon', 'public.' || queue, 'SELECT') then
      raise exception '% exposes private notification data', queue;
    end if;
  end loop;
end;
$$;

-- Updating the device language must not drop queued events or restart its cursor.
update public.push_subscriptions set locale = 'fr'
where user_id = '97000000-0000-0000-0000-000000000001';
do $$
begin
  if (select count(*) from public.pending_push_notifications
      where package_id = '97000000-0000-0000-0000-000000000002' and locale = 'fr') <> 5 then
    raise exception 'Browser queue lost localized events';
  end if;
  if (select subscribed_at from public.push_subscriptions
      where user_id = '97000000-0000-0000-0000-000000000001') <> '2000-01-01'::timestamptz then
    raise exception 'Locale update restarted the subscription cursor';
  end if;
  begin
    update public.push_subscriptions set locale = 'es'
    where user_id = '97000000-0000-0000-0000-000000000001';
    raise exception 'Invalid locale was accepted';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
select 'notification event time assertions passed' as result;
