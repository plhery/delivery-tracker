\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('97000000-0000-0000-0000-000000000001', 'exception-stage@example.invalid');
insert into auth.sessions (id, user_id)
values ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001');
set local role service_role;

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status)
values ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
  'EXCEPTIONSTAGE1', 'swiss-post', 'exception', 'ok');

insert into public.tracking_events (
  id, package_id, stage, description, occurred_at, provider_event_id, raw_data
) values ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002',
  'exception', 'Address problem, delivery on hold', '2026-09-13T09:00:00Z',
  'swiss-post:exception-1',
  '{"description":"Address problem, delivery on hold","time":"2026-09-13T09:00:00Z"}');

-- Subscribed before the update arrived, so the queue considers the event new.
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/exception-stage', 'test-key', 'test-auth',
  now() - interval '1 day');

insert into public.live_activity_devices (
  id, session_id, user_id, installation_id, token, environment, subscribed_at
) values ('97000000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000007',
  repeat('93', 32), 'development', now() - interval '1 day');
insert into public.live_activity_update_tokens (
  id, device_id, package_id, activity_id, token, environment, started_at
) values ('97000000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000005',
  '97000000-0000-0000-0000-000000000002', 'exception-test', repeat('92', 32),
  'development', now() - interval '1 day');

do $$
declare
  queue text;
begin
  if not exists (
    select 1 from public.tracking_events
    where package_id = '97000000-0000-0000-0000-000000000002' and stage = 'exception'
  ) then
    raise exception 'tracking_events did not keep the exception stage';
  end if;

  -- The stage is a problem report, not a terminal state: the parcel stays in
  -- the active set that the scheduler keeps refreshing.
  if not exists (
    select 1 from public.packages
    where id = '97000000-0000-0000-0000-000000000002'
      and current_stage = 'exception'
      and current_stage not in ('delivered', 'returned')
  ) then
    raise exception 'packages did not keep the exception stage';
  end if;

  -- Selectable, and on by default for accounts that never saved preferences.
  insert into public.notification_preferences (user_id, enabled_stages)
  values ('97000000-0000-0000-0000-000000000001', array['exception', 'delivered']::text[]);
  if not (
    select 'exception' = any(enabled_stages) from public.notification_preferences
    where user_id = '97000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'notification_preferences rejected the exception stage';
  end if;
  delete from public.notification_preferences
  where user_id = '97000000-0000-0000-0000-000000000001';

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_preferences'
      and column_name = 'enabled_stages' and column_default like '%exception%'
  ) then
    raise exception 'notification_preferences default does not include the exception stage';
  end if;

  -- The two stage-filtered queues carry the same default inline.
  foreach queue in array array[
    'pending_push_notifications', 'pending_native_push_notifications'
  ] loop
    if to_regclass('public.' || queue) is null then continue; end if;
    if pg_get_viewdef(to_regclass('public.' || queue), true) not like '%exception%' then
      raise exception '% does not queue exception updates for accounts without preferences', queue;
    end if;
  end loop;

  -- An exception update reaches a subscriber who never chose stages.
  if not exists (
    select 1 from public.pending_push_notifications
    where event_id = '97000000-0000-0000-0000-000000000003'
      and subscription_id = '97000000-0000-0000-0000-000000000004'
      and stage = 'exception'
  ) then
    raise exception 'An exception update was not queued for a default subscriber';
  end if;

  -- A running Live Activity learns about the problem and is then ended,
  -- exactly as it is for a failed delivery attempt.
  if not exists (
    select 1 from public.pending_live_activity_events
    where event_id = '97000000-0000-0000-0000-000000000003'
      and update_token_id = '97000000-0000-0000-0000-000000000006'
      and stage = 'exception'
  ) then
    raise exception 'An exception update was not queued to end a Live Activity';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.tracking_events (package_id, stage, description, provider_event_id)
    values ('97000000-0000-0000-0000-000000000002', 'exceptions', 'Typo stage', 'swiss-post:typo');
    raise exception 'tracking_events accepted an unknown stage';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
select 'exception stage assertions passed' as result;
