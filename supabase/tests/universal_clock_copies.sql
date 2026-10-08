\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('94000000-0000-0000-0000-000000000001', 'universal-clock-copies@example.invalid');
insert into auth.sessions (id, user_id)
values ('94000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage, carrier_data)
select ('94000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '94000000-0000-0000-0000-000000000001', number, 'paack', 'in_transit', data::jsonb
from (values
  (2, 'EXAMPLE0000000001', '{"routing":{"last_event_at":"2026-10-01T21:07:41.000Z"}}'),
  (3, 'EXAMPLE0000000002', '{"tracking_provider":"ParcelsApp","last_update":"2026-10-02T08:33:34.000Z","routing":{"last_event_at":"2026-10-02T08:33:34.000Z","keep":true}}'),
  (4, 'EXAMPLE0000000003', '{"routing":{"last_event_at":"2026-09-05T09:00:27.000Z"}}')
) as parcels(id, number, data);

-- A universal provider words the carrier's scans its own way, on a clock off by whole hours.
insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('94000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('94000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, stage, description, location,
  occurred::timestamptz, created::timestamptz, provider_event_id, raw::jsonb
from (values
  -- A copy stored before the carrier's row, two hours early: the copy's row takes the scan.
  (10, 2, 'pending', 'Order details received', 'FR', '2026-10-01T08:50:30Z', '2026-10-01T09:00Z', 'unknown:received',
    '{"time":"2026-10-01T08:50:30.000Z","stage_source":"none"}'),
  (11, 2, 'registered', 'Shipment registered', null, '2026-10-01T10:50:30Z', '2026-10-02T07:00Z', 'paack:registered',
    '{"time":"2026-10-01T10:50:30.000Z","stage_source":"carrier_map"}'),
  -- The carrier's row stored first: its copy goes.
  (12, 2, 'accepted', 'Shipment accepted', null, '2026-10-01T16:38:19Z', '2026-10-01T17:00Z', 'paack:accepted',
    '{"time":"2026-10-01T16:38:19.000Z","stage_source":"carrier_map"}'),
  (13, 2, 'pending', 'In the distribution centre', 'FR', '2026-10-01T14:38:19Z', '2026-10-01T18:00Z', 'unknown:centre',
    '{"time":"2026-10-01T14:38:19.000Z","stage_source":"none"}'),
  -- A copy two hours late in the same stage, which set the watermark.
  (30, 3, 'out_for_delivery', 'Out for delivery', null, '2026-10-02T06:33:34Z', '2026-10-02T07:00Z', 'paack:out',
    '{"time":"2026-10-02T06:33:34.000Z","stage_source":"carrier_map"}'),
  (31, 3, 'out_for_delivery', 'With the driver', 'FR', '2026-10-02T08:33:34Z', '2026-10-02T08:40Z', 'unknown:out',
    '{"time":"2026-10-02T08:33:34.000Z","stage_source":"wording"}'),
  -- Left alone: times to the minute, stages that disagree, half an hour apart, two universal
  -- rows, a copy with a carrier twin at its own instant, an observed time, and two carrier
  -- rows a zone away from one copy.
  (20, 2, 'in_transit', 'Departed facility', 'FR', '2026-10-01T12:15:00Z', '2026-10-01T18:00Z', 'unknown:minute',
    '{"time":"2026-10-01T12:15:00.000Z"}'),
  (21, 2, 'in_transit', 'Arrived at hub', null, '2026-10-01T14:15:00Z', '2026-10-02T07:00Z', 'paack:minute',
    '{"time":"2026-10-01T14:15:00.000Z"}'),
  (22, 2, 'in_transit', 'Departed facility', 'FR', '2026-10-01T19:07:41Z', '2026-10-01T20:00Z', 'unknown:stage',
    '{"time":"2026-10-01T19:07:41.000Z"}'),
  (23, 2, 'failed_attempt', 'Delivery attempted', null, '2026-10-01T21:07:41Z', '2026-10-02T07:00Z', 'paack:stage',
    '{"time":"2026-10-01T21:07:41.000Z"}'),
  (24, 2, 'in_transit', 'Sorted', 'FR', '2026-10-01T11:20:12Z', '2026-10-01T18:00Z', 'unknown:half-hour',
    '{"time":"2026-10-01T11:20:12.000Z"}'),
  (25, 2, 'in_transit', 'Forwarded', null, '2026-10-01T11:50:12Z', '2026-10-02T07:00Z', 'paack:half-hour',
    '{"time":"2026-10-01T11:50:12.000Z"}'),
  (26, 2, 'pending', 'Label printed', 'FR', '2026-10-01T09:41:05Z', '2026-10-01T18:00Z', 'unknown:twin-a',
    '{"time":"2026-10-01T09:41:05.000Z"}'),
  (27, 2, 'in_transit', 'Collected', 'FR', '2026-10-01T11:41:05Z', '2026-10-01T18:00Z', 'unknown:twin-b',
    '{"time":"2026-10-01T11:41:05.000Z"}'),
  (28, 2, 'pending', 'Processed', 'FR', '2026-10-01T13:12:51Z', '2026-10-01T18:00Z', 'unknown:explained',
    '{"time":"2026-10-01T13:12:51.000Z"}'),
  (29, 2, 'in_transit', 'Processed at hub', null, '2026-10-01T13:12:51Z', '2026-10-02T07:00Z', 'paack:explained-twin',
    '{"time":"2026-10-01T13:12:51.000Z"}'),
  (32, 2, 'in_transit', 'Loaded', null, '2026-10-01T15:12:51Z', '2026-10-02T07:00Z', 'paack:explained',
    '{"time":"2026-10-01T15:12:51.000Z"}'),
  (33, 2, 'pending', 'Status changed', 'FR', '2026-10-01T18:12:33Z', '2026-10-01T18:13Z', 'unknown:observed',
    '{"time":"2026-10-01T18:12:33.000Z","observed_without_provider_timestamp":true}'),
  (34, 2, 'in_transit', 'In transit', null, '2026-10-01T20:12:33Z', '2026-10-02T07:00Z', 'paack:observed-twin',
    '{"time":"2026-10-01T20:12:33.000Z"}'),
  (40, 4, 'pending', 'Item received', 'FR', '2026-09-05T07:00:27Z', '2026-09-05T07:10Z', 'unknown:ambiguous',
    '{"time":"2026-09-05T07:00:27.000Z"}'),
  (41, 4, 'in_transit', 'Sorted', null, '2026-09-05T08:00:27Z', '2026-09-05T08:10Z', 'paack:ambiguous-a',
    '{"time":"2026-09-05T08:00:27.000Z"}'),
  (42, 4, 'in_transit', 'Loaded', null, '2026-09-05T09:00:27Z', '2026-09-05T09:10Z', 'paack:ambiguous-b',
    '{"time":"2026-09-05T09:00:27.000Z"}')
) as scans(id, package, stage, description, location, occurred, created, provider_event_id, raw);

create temporary table untouched_clock_scans as select * from public.tracking_events
where id::text like '94000000-%'
  and right(id::text, 12)::integer in (12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 40, 41, 42);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-clock-copies-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000001', repeat('a1', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment, subscribed_at)
values ('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000009', repeat('a2', 32), 'development', '2000-01-01');
insert into public.parcel_links (id, package_id, created_by)
values ('DEFGHJKMNPQR', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001');
insert into public.parcel_link_alerts (id, link_id, endpoint, p256dh, auth, locale, preset)
values ('94000000-0000-0000-0000-000000000050', 'DEFGHJKMNPQR', 'https://fcm.googleapis.com/fcm/send/synthetic-link-clock-copies-fixture', 'test', 'test', 'en', 'all');

-- The pending copies were never announced; the carrier's rows and the late copy were.
insert into public.push_deliveries (subscription_id, event_id, sent_at) values
  ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000011', '2026-10-02T07:00Z'),
  ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000012', '2026-10-01T17:00Z'),
  ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000030', '2026-10-02T07:00Z'),
  ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000031', '2026-10-02T08:40Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at)
values ('94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000031', '2026-10-02T08:40Z');
insert into public.live_activity_event_deliveries (device_id, event_id, package_id, delivery_kind, event_created_at, sent_at)
values ('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000011',
  '94000000-0000-0000-0000-000000000002', 'update', '2026-10-02T07:00Z', '2026-10-02T07:00Z');
insert into public.parcel_link_alert_deliveries (alert_id, event_id)
values ('94000000-0000-0000-0000-000000000050', '94000000-0000-0000-0000-000000000011');
insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('e', 64), 'unknown', 'in the distribution centre', 'none', 'pending', '94000000-0000-0000-0000-000000000013');
insert into public.delivery_emails (user_id, package_id, event_id, status, sent_at)
values ('94000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000003',
  '94000000-0000-0000-0000-000000000031', 'sent', '2026-10-02T08:40Z');

\ir ../migrations/20261008030000_universal_clock_copies.sql
create temporary table merged_clock_events as select * from public.tracking_events;
create temporary table merged_clock_packages as select * from public.packages;
\ir ../migrations/20261008030000_universal_clock_copies.sql

do $$
begin
  if exists (select * from public.tracking_events except select * from merged_clock_events)
    or exists (select * from merged_clock_events except select * from public.tracking_events)
    or exists (select * from public.packages except select * from merged_clock_packages) then
    raise exception 'Clock copy merge is not idempotent';
  end if;
  if exists (select * from untouched_clock_scans except select * from public.tracking_events) then
    raise exception 'Clock copy merge changed a scan without evidence';
  end if;
  if exists (select 1 from public.tracking_events where id in ('94000000-0000-0000-0000-000000000011',
      '94000000-0000-0000-0000-000000000013', '94000000-0000-0000-0000-000000000031')) then
    raise exception 'Clock copy merge kept a second row';
  end if;
  if not exists (select 1 from public.tracking_events where id = '94000000-0000-0000-0000-000000000010'
      and occurred_at = '2026-10-01T10:50:30Z'::timestamptz and created_at = '2026-10-01T09:00Z'::timestamptz
      and provider_event_id = 'paack:registered' and stage = 'registered' and description = 'Shipment registered'
      and location is null and raw_data = '{"time":"2026-10-01T10:50:30.000Z","stage_source":"carrier_map"}'::jsonb) then
    raise exception 'Clock copy merge did not give the first row the carrier''s scan';
  end if;

  if not exists (select 1 from public.packages where id = '94000000-0000-0000-0000-000000000002'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-01T21:07:41.000Z')
    or not exists (select 1 from public.packages where id = '94000000-0000-0000-0000-000000000003'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-02T06:33:34.000Z'
      and carrier_data->'routing'->>'keep' = 'true' and carrier_data->>'last_update' = '2026-10-02T08:33:34.000Z')
    or not exists (select 1 from public.packages where id = '94000000-0000-0000-0000-000000000004'
      and carrier_data->'routing'->>'last_event_at' = '2026-09-05T09:00:27.000Z') then
    raise exception 'Clock copy merge did not repair only the watermarks the copies set';
  end if;

  if not exists (select 1 from public.push_deliveries where event_id = '94000000-0000-0000-0000-000000000010'
      and sent_at = '2026-10-02T07:00Z'::timestamptz)
    or (select sent_at from public.push_deliveries where event_id = '94000000-0000-0000-0000-000000000012') <> '2026-10-01T17:00Z'::timestamptz
    or (select sent_at from public.push_deliveries where event_id = '94000000-0000-0000-0000-000000000030') <> '2026-10-02T07:00Z'::timestamptz
    or not exists (select 1 from public.native_push_deliveries where event_id = '94000000-0000-0000-0000-000000000030')
    or not exists (select 1 from public.live_activity_event_deliveries where event_id = '94000000-0000-0000-0000-000000000010'
      and event_created_at = '2026-10-01T09:00Z'::timestamptz)
    or not exists (select 1 from public.parcel_link_alert_deliveries where event_id = '94000000-0000-0000-0000-000000000010')
    or (select sample_event_id from public.tracking_status_observations where observation_key = repeat('e', 64)) <> '94000000-0000-0000-0000-000000000012'::uuid
    or not exists (select 1 from public.delivery_emails where event_id = '94000000-0000-0000-0000-000000000030' and status = 'sent') then
    raise exception 'Clock copy merge lost a receipt or reference';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id in ('94000000-0000-0000-0000-000000000010',
      '94000000-0000-0000-0000-000000000012', '94000000-0000-0000-0000-000000000030')) then
    raise exception 'Clock copy merge queued an announced scan again';
  end if;
end;
$$;
rollback;
