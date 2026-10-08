\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('95000000-0000-0000-0000-000000000001', 'india-post-copies@example.invalid');
insert into auth.sessions (id, user_id)
values ('95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage, carrier_data)
select ('95000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '95000000-0000-0000-0000-000000000001', number, 'india-post', 'in_transit', data::jsonb
from (values
  (2, 'EE000000001IN', '{"tracking_provider":"17TRACK","last_update":"2026-10-06T10:15:00.000Z","routing":{"last_event_at":"2026-10-06T10:15:00.000Z","keep":true}}'),
  (3, 'EE000000002IN', '{"routing":{"last_event_at":"2026-09-01T07:00:00.000Z"}}'),
  (4, 'EE000000003IN', '{"routing":{"last_event_at":"2026-09-05T07:00:00.000Z"}}')
) as parcels(id, number, data);

-- 17TRACK's copies carry India Post's clock with +05:30 and a UTC instant 30 minutes later.
insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('95000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('95000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, 'in_transit', description, location,
  occurred::timestamptz, created::timestamptz, provider_event_id, raw::jsonb
from (values
  -- India Post's rows, India-labelled or moved to the destination's clock, then their copies.
  (10, 2, 'Inducted', 'EXAMPLE OFFICE 999001', '2026-09-12T12:56:09Z', '2026-09-12T13:00Z', 'india-post:inducted',
    '{"time":"2026-09-12T12:56:09Z","provider_code":"ItemInducted"}'),
  (11, 2, 'Item inducted', null, '2026-09-12T13:26:09Z', '2026-10-07T17:10Z', 'unknown:inducted',
    '{"time":"2026-09-12T13:26:09.000Z","provider_time_iso":"2026-09-12T18:26:09+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (12, 2, 'Item Received', 'EXAMPLE EXCHANGE 999002', '2026-10-06T05:18:00Z', '2026-10-06T06:40Z', 'india-post:moved',
    '{"time":"2026-10-06T07:18:00+02:00","provider_code":"ItemReceived"}'),
  (13, 2, 'Item received at office of exchange (Inb)', null, '2026-10-06T02:18:00Z', '2026-10-07T17:10Z', 'unknown:moved',
    '{"time":"2026-10-06T02:18:00.000Z","provider_time_iso":"2026-10-06T07:18:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (14, 2, 'Item Received', 'EXAMPLE EXCHANGE 999002', '2026-10-06T09:45:00Z', '2026-10-06T16:00Z', 'india-post:labelled',
    '{"time":"2026-10-06T09:45:00Z","provider_code":"ItemReceived"}'),
  (15, 2, 'Item received at office of exchange (Inb)', null, '2026-10-06T10:15:00Z', '2026-10-07T17:10Z', 'unknown:labelled',
    '{"time":"2026-10-06T10:15:00.000Z","provider_time_iso":"2026-10-06T15:15:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  -- A copy stored before India Post's row: the copy's row takes the scan.
  (30, 3, 'Item booked', null, '2026-09-01T07:00:00Z', '2026-09-01T08:00Z', 'unknown:first',
    '{"time":"2026-09-01T07:00:00.000Z","provider_time_iso":"2026-09-01T12:00:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (31, 3, 'Item Booked', 'EXAMPLE OFFICE 999001', '2026-09-01T06:30:00Z', '2026-09-02T00:00Z', 'india-post:booked',
    '{"time":"2026-09-01T06:30:00Z","provider_code":"ItemBooked"}'),
  -- Left alone: a take-off on the airport's clock, a copy whose readings agree, another
  -- operator, an observed time, an India Post row observed without a time, and two India
  -- Post rows on the copy's clock.
  (20, 2, 'Aircraft Departure', null, '2026-10-03T03:25:00Z', '2026-10-07T17:10Z', 'unknown:take-off',
    '{"time":"2026-10-03T03:25:00.000Z","provider_time_iso":"2026-10-03T08:25:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (21, 2, 'Item Dispatch', 'EXAMPLE OFFICE 999001', '2026-09-28T08:34:50Z', '2026-09-28T09:00Z', 'india-post:dispatched',
    '{"time":"2026-09-28T08:34:50Z","provider_code":"ItemDispatched"}'),
  (22, 2, 'Dispatched', null, '2026-09-28T08:34:50Z', '2026-10-07T17:10Z', 'unknown:agreeing',
    '{"time":"2026-09-28T08:34:50.000Z","provider_time_iso":"2026-09-28T14:04:50+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (23, 2, 'Dispatched', null, '2026-09-28T09:04:50Z', '2026-10-07T17:10Z', 'unknown:other-operator',
    '{"time":"2026-09-28T09:04:50.000Z","provider_time_iso":"2026-09-28T14:04:50+05:30","reporting_carrier":"Example Post","time_provenance":"provider_inferred"}'),
  (24, 2, 'Dispatched', null, '2026-09-28T09:04:50Z', '2026-10-07T17:10Z', 'unknown:observed',
    '{"time":"2026-09-28T09:04:50.000Z","provider_time_iso":"2026-09-28T14:04:50+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred","observed_without_provider_timestamp":true}'),
  (25, 2, 'Bag closed', null, '2026-09-29T06:30:00Z', '2026-10-07T17:10Z', 'unknown:observed-twin',
    '{"time":"2026-09-29T06:30:00.000Z","provider_time_iso":"2026-09-29T11:30:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (26, 2, 'Bag closed', 'EXAMPLE OFFICE 999001', '2026-09-29T06:00:00Z', '2026-09-29T07:00Z', 'india-post:observed',
    '{"time":"2026-09-29T06:00:00Z","observed_without_provider_timestamp":true}'),
  (40, 4, 'Item received', null, '2026-09-05T07:00:00Z', '2026-09-06T00:00Z', 'unknown:ambiguous',
    '{"time":"2026-09-05T07:00:00.000Z","provider_time_iso":"2026-09-05T12:00:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  (41, 4, 'Item Received', 'EXAMPLE OFFICE 999001', '2026-09-05T06:30:00Z', '2026-09-05T07:00Z', 'india-post:ambiguous-a',
    '{"time":"2026-09-05T06:30:00Z","provider_code":"ItemReceived"}'),
  (42, 4, 'Bag Opened', 'EXAMPLE OFFICE 999001', '2026-09-05T06:30:00Z', '2026-09-05T07:00Z', 'india-post:ambiguous-b',
    '{"time":"2026-09-05T06:30:00Z","provider_code":"BagOpened"}')
) as scans(id, package, description, location, occurred, created, provider_event_id, raw);

create temporary table untouched_india_post_scans as select * from public.tracking_events
where id::text like '95000000-%' and right(id::text, 12)::integer in (10, 12, 14, 20, 21, 22, 23, 24, 25, 26, 40, 41, 42);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-india-post-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('95000000-0000-0000-0000-000000000007', '95000000-0000-0000-0000-000000000001', repeat('94', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment, subscribed_at)
values ('95000000-0000-0000-0000-000000000008', '95000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000009', repeat('93', 32), 'development', '2000-01-01');
insert into public.parcel_links (id, package_id, created_by)
values ('CDEFGHJKMNPQ', '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001');
insert into public.parcel_link_alerts (id, link_id, endpoint, p256dh, auth, locale, preset)
values ('95000000-0000-0000-0000-000000000050', 'CDEFGHJKMNPQ', 'https://fcm.googleapis.com/fcm/send/synthetic-link-india-post-fixture', 'test', 'test', 'en', 'all');

-- India Post's rows were announced first, then their copies; the late row's own receipt is on the copy stored first.
insert into public.push_deliveries (subscription_id, event_id, sent_at) values
  ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000010', '2026-09-12T13:00Z'),
  ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000011', '2026-10-07T17:10Z'),
  ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000013', '2026-10-07T17:10Z'),
  ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000031', '2026-09-02T00:00Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at)
values ('95000000-0000-0000-0000-000000000007', '95000000-0000-0000-0000-000000000015', '2026-10-07T17:10Z');
insert into public.live_activity_event_deliveries (device_id, event_id, package_id, delivery_kind, event_created_at, sent_at)
values ('95000000-0000-0000-0000-000000000008', '95000000-0000-0000-0000-000000000015',
  '95000000-0000-0000-0000-000000000002', 'update', '2026-10-07T17:10Z', '2026-10-07T17:10Z');
insert into public.parcel_link_alert_deliveries (alert_id, event_id)
values ('95000000-0000-0000-0000-000000000050', '95000000-0000-0000-0000-000000000011');
insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('d', 64), 'unknown', 'item received at office of exchange (inb)', 'wording', 'in_transit', '95000000-0000-0000-0000-000000000013');
insert into public.delivery_emails (user_id, package_id, event_id, status, sent_at)
values ('95000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000002',
  '95000000-0000-0000-0000-000000000015', 'sent', '2026-10-07T17:10Z');

\ir ../migrations/20261008020000_seventeentrack_india_post_copies.sql
create temporary table merged_india_post_events as select * from public.tracking_events;
create temporary table merged_india_post_packages as select * from public.packages;
\ir ../migrations/20261008020000_seventeentrack_india_post_copies.sql

do $$
begin
  if exists (select * from public.tracking_events except select * from merged_india_post_events)
    or exists (select * from merged_india_post_events except select * from public.tracking_events)
    or exists (select * from public.packages except select * from merged_india_post_packages) then
    raise exception 'India Post copy merge is not idempotent';
  end if;
  if exists (select * from untouched_india_post_scans except select * from public.tracking_events) then
    raise exception 'India Post copy merge changed a scan without evidence';
  end if;
  if exists (select 1 from public.tracking_events where id in ('95000000-0000-0000-0000-000000000011',
      '95000000-0000-0000-0000-000000000013', '95000000-0000-0000-0000-000000000015', '95000000-0000-0000-0000-000000000031')) then
    raise exception 'India Post copy merge kept a second row';
  end if;
  if not exists (select 1 from public.tracking_events where id = '95000000-0000-0000-0000-000000000030'
      and occurred_at = '2026-09-01T06:30Z'::timestamptz and created_at = '2026-09-01T08:00Z'::timestamptz
      and provider_event_id = 'india-post:booked' and description = 'Item Booked' and location = 'EXAMPLE OFFICE 999001'
      and raw_data = '{"time":"2026-09-01T06:30:00Z","provider_code":"ItemBooked"}'::jsonb) then
    raise exception 'India Post copy merge did not give the first row India Post''s scan';
  end if;

  if not exists (select 1 from public.packages where id = '95000000-0000-0000-0000-000000000002'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-06T09:45:00.000Z'
      and carrier_data->'routing'->>'keep' = 'true' and carrier_data->>'last_update' = '2026-10-06T10:15:00.000Z')
    or not exists (select 1 from public.packages where id = '95000000-0000-0000-0000-000000000003'
      and carrier_data->'routing'->>'last_event_at' = '2026-09-01T06:30:00.000Z')
    or not exists (select 1 from public.packages where id = '95000000-0000-0000-0000-000000000004'
      and carrier_data->'routing'->>'last_event_at' = '2026-09-05T07:00:00.000Z') then
    raise exception 'India Post copy merge did not repair only the watermarks the copies set';
  end if;

  if (select sent_at from public.push_deliveries where event_id = '95000000-0000-0000-0000-000000000010') <> '2026-09-12T13:00Z'::timestamptz
    or not exists (select 1 from public.push_deliveries where event_id = '95000000-0000-0000-0000-000000000012')
    or not exists (select 1 from public.push_deliveries where event_id = '95000000-0000-0000-0000-000000000030'
      and sent_at = '2026-09-02T00:00Z'::timestamptz)
    or not exists (select 1 from public.native_push_deliveries where event_id = '95000000-0000-0000-0000-000000000014')
    or not exists (select 1 from public.live_activity_event_deliveries where event_id = '95000000-0000-0000-0000-000000000014'
      and event_created_at = '2026-10-06T16:00Z'::timestamptz)
    or not exists (select 1 from public.parcel_link_alert_deliveries where event_id = '95000000-0000-0000-0000-000000000010')
    or (select sample_event_id from public.tracking_status_observations where observation_key = repeat('d', 64)) <> '95000000-0000-0000-0000-000000000012'::uuid
    or not exists (select 1 from public.delivery_emails where event_id = '95000000-0000-0000-0000-000000000014' and status = 'sent') then
    raise exception 'India Post copy merge lost a receipt or reference';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id in ('95000000-0000-0000-0000-000000000010',
      '95000000-0000-0000-0000-000000000012', '95000000-0000-0000-0000-000000000030')) then
    raise exception 'India Post copy merge queued an announced scan again';
  end if;
end;
$$;
rollback;
