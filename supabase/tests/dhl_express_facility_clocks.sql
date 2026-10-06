\set ON_ERROR_STOP on
begin;

create function pg_temp.dhl_identity(source text, clock text, location text, description text)
returns text language sql as $$
  select source || ':' || encode(sha256(convert_to('[' || to_json(source)::text || ','
    || to_json(clock)::text || ',' || to_json(location)::text || ',' || to_json(description)::text || ']', 'UTF8')), 'hex');
$$;

insert into auth.users (id, email)
values ('96000000-0000-0000-0000-000000000001', 'clocks@example.invalid');
insert into auth.sessions (id, user_id)
values ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage, carrier_data)
select ('96000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '96000000-0000-0000-0000-000000000001', number, 'dhl-express', 'in_transit', data::jsonb
from (values
  (2, '9876000046', '{"tracking_provider":"ParcelsApp","last_update":"2026-06-20T16:00:00.000Z","routing":{"last_event_at":"2026-06-20T15:30:00.000Z","keep":true},"direct_local_history":{"carrier":"dhl-express","number":"9876000046","events":[{"time":"2026-06-20T16:00:00","description":"Departed facility","location":"Synthetic Hub - FRANCE"},{"local_time":"2026-01-10T06:00:00","description":"Shipment processed","location":"Synthetic Hub - BELGIUM"}]}}'),
  (3, '9876000047', '{"tracking_provider":"Ship24","direct_local_history":{"carrier":"dhl-express","number":"9876000047","events":[{"time":"2026-01-10T06:00:00","description":"Shipment processed","location":"Synthetic Hub - BELGIUM"}]}}'),
  (4, '9876000048', '{"tracking_provider":"ParcelsApp","direct_local_history":{"carrier":"dhl-express","number":"9876000049","events":[{"time":"2026-01-10T06:00:00","description":"Shipment processed","location":"Synthetic Hub - BELGIUM"}]}}'),
  (5, '9876000049', '{"last_update":"2026-06-22T12:00:00+02:00","routing":{"last_event_at":"2026-06-22T10:00:00.000Z"}}')
) as parcels(id, number, data);

insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('96000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('96000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, 'in_transit', description, location,
  occurred::timestamptz, created::timestamptz,
  pg_temp.dhl_identity(source, clock, location, description), jsonb_build_object('time', clock) || extra::jsonb
from (values
  -- Lone direct scan, winter pair, and a pair whose corrected row was stored first.
  (10, 2, 'dhl-express', '2026-06-10T10:00:00', 'Synthetic Hub - NETHERLANDS, THE', 'Shipment processed', '2026-06-10T10:00Z', '2026-06-10T11:00Z', '{"instant":null}'),
  (11, 2, 'dhl-express', '2026-01-10T12:00:00', 'Synthetic Hub - BELGIUM', 'Shipment processed', '2026-01-10T12:00Z', '2026-01-10T13:00Z', '{}'),
  (12, 2, 'dhl-express', '2026-01-10T12:00:00+01:00', 'Synthetic Hub - BELGIUM', 'Shipment processed', '2026-01-10T11:00Z', '2026-01-11T13:00Z', '{"provider_code":"PL"}'),
  (13, 2, 'dhl-express', '2026-06-12T10:00:00+02:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-06-12T08:00Z', '2026-06-12T11:00Z', '{}'),
  (14, 2, 'dhl-express', '2026-06-12T10:00:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-06-12T10:00Z', '2026-06-13T11:00Z', '{}'),
  -- Bound carrier evidence confirms these ParcelsApp copies' wall clocks.
  (20, 2, 'unknown', '2026-06-20T16:00:00.000Z', 'Synthetic Hub - FRANCE', 'Departed facility', '2026-06-20T16:00Z', '2026-06-20T17:00Z', '{}'),
  (21, 2, 'unknown', '2026-01-10T06:00:00Z', 'Synthetic Hub - BELGIUM', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  -- Unknown zone, explicit offset, observed time, non-UTC row and missing evidence stand.
  (30, 2, 'dhl-express', '2026-01-10T01:00:00', 'Synthetic Hub - USA', 'Shipment processed', '2026-01-10T01:00Z', '2026-01-10T02:00Z', '{}'),
  (31, 2, 'dhl-express', '2026-01-10T02:00:00+01:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T01:00Z', '2026-01-10T02:00Z', '{}'),
  (32, 2, 'dhl-express', '2026-01-10T03:00:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T03:00Z', '2026-01-10T04:00Z', '{"observed_without_provider_timestamp":true}'),
  (33, 2, 'dhl-express', '2026-01-10T04:00:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T03:00Z', '2026-01-10T04:00Z', '{}'),
  (34, 2, 'unknown', '2026-01-10T05:00:00.000Z', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T05:00Z', '2026-01-10T06:00Z', '{}'),
  (35, 2, 'unknown', '2026-01-10T06:00:00.000Z', 'Other Hub - BELGIUM', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (36, 2, 'unknown', '2026-01-10T06:00:00.000Z', 'Synthetic Hub - BELGIUM', 'Another scan', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (37, 3, 'unknown', '2026-01-10T06:00:00.000Z', 'Synthetic Hub - BELGIUM', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (38, 4, 'unknown', '2026-01-10T06:00:00.000Z', 'Synthetic Hub - BELGIUM', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (39, 2, 'dhl-express', '2026-01-10T06:00:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (40, 2, 'dhl-express', 'invalid', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-01-10T06:00Z', '2026-01-10T07:00Z', '{}'),
  (41, 5, 'dhl-express', '2026-06-21T08:00:00', 'Synthetic Hub - FRANCE', 'Shipment processed', '2026-06-21T08:00Z', '2026-06-21T09:00Z', '{}')
) as scans(id, package, source, clock, location, description, occurred, created, extra);

-- A reused identity must not be recomputed from strings it no longer hashes.
update public.tracking_events set provider_event_id = 'dhl-express:taken-over'
where id = '96000000-0000-0000-0000-000000000039';
create temporary table untouched_dhl_scans as select * from public.tracking_events
where id::text like '96000000-%' and right(id::text, 12)::integer between 30 and 40;

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('96000000-0000-0000-0000-000000000006', '96000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-clock-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('96000000-0000-0000-0000-000000000007', '96000000-0000-0000-0000-000000000001', repeat('96', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment, subscribed_at)
values ('96000000-0000-0000-0000-000000000008', '96000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000009', repeat('95', 32), 'development', '2000-01-01');
insert into public.parcel_links (id, package_id, created_by)
values ('BCDEFGHJKMNP', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001');
insert into public.parcel_link_alerts (id, link_id, endpoint, p256dh, auth, locale, preset)
values ('96000000-0000-0000-0000-000000000050', 'BCDEFGHJKMNP', 'https://fcm.googleapis.com/fcm/send/synthetic-link-clock-fixture', 'test', 'test', 'en', 'all');
insert into public.push_deliveries (subscription_id, event_id, sent_at)
values ('96000000-0000-0000-0000-000000000006', '96000000-0000-0000-0000-000000000012', '2026-01-11T13:00Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at) values
  ('96000000-0000-0000-0000-000000000007', '96000000-0000-0000-0000-000000000011', '2026-01-10T13:00Z'),
  ('96000000-0000-0000-0000-000000000007', '96000000-0000-0000-0000-000000000012', '2026-01-11T13:00Z');
insert into public.live_activity_event_deliveries (device_id, event_id, package_id, delivery_kind, event_created_at, sent_at)
values ('96000000-0000-0000-0000-000000000008', '96000000-0000-0000-0000-000000000012',
  '96000000-0000-0000-0000-000000000002', 'update', '2026-01-11T13:00Z', '2026-01-11T13:00Z');
insert into public.parcel_link_alert_deliveries (alert_id, event_id)
values ('96000000-0000-0000-0000-000000000050', '96000000-0000-0000-0000-000000000012');
insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('c', 64), 'dhl-express', 'shipment processed', 'wording', 'in_transit', '96000000-0000-0000-0000-000000000012');
insert into public.delivery_emails (user_id, package_id, event_id, status, sent_at)
values ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002',
  '96000000-0000-0000-0000-000000000012', 'sent', '2026-01-11T13:00Z');

\ir ../migrations/20261006020000_dhl_express_facility_clocks.sql
create temporary table repaired_dhl_events as select * from public.tracking_events;
create temporary table repaired_dhl_packages as select * from public.packages;
\ir ../migrations/20261006020000_dhl_express_facility_clocks.sql

do $$
begin
  if exists (select * from public.tracking_events except select * from repaired_dhl_events)
    or exists (select * from repaired_dhl_events except select * from public.tracking_events)
    or exists (select * from public.packages except select * from repaired_dhl_packages) then
    raise exception 'DHL repair is not idempotent';
  end if;
  if exists (select * from untouched_dhl_scans except select * from public.tracking_events) then
    raise exception 'DHL repair changed a scan without evidence';
  end if;
  if not exists (select 1 from public.tracking_events where id = '96000000-0000-0000-0000-000000000010'
    and occurred_at = '2026-06-10T08:00Z'::timestamptz and created_at = '2026-06-10T11:00Z'::timestamptz
    and provider_event_id = 'dhl-express:a1f31c9fec9ba885cda4b89a6b6f541945bf34cba210be208f07ad3a709a5709'
    and raw_data->>'time' = '2026-06-10T10:00:00+02:00' and raw_data->>'instant' = '2026-06-10T10:00:00+02:00') then
    raise exception 'DHL repair did not correct the summer clock and identity';
  end if;
  if not exists (select 1 from public.tracking_events where id = '96000000-0000-0000-0000-000000000011'
    and occurred_at = '2026-01-10T11:00Z'::timestamptz and created_at = '2026-01-10T13:00Z'::timestamptz
    and raw_data->>'time' = '2026-01-10T12:00:00+01:00' and raw_data->>'provider_code' = 'PL')
    or exists (select 1 from public.tracking_events where id in (
      '96000000-0000-0000-0000-000000000012', '96000000-0000-0000-0000-000000000014'))
    or not exists (select 1 from public.tracking_events where id = '96000000-0000-0000-0000-000000000013'
      and created_at = '2026-06-12T11:00Z'::timestamptz) then
    raise exception 'DHL repair did not keep the first row of each pair';
  end if;
  if not exists (select 1 from public.tracking_events where id = '96000000-0000-0000-0000-000000000020'
    and occurred_at = '2026-06-20T14:00Z'::timestamptz
    and provider_event_id = 'unknown:9b3b0fe97b7308a53c94c3bbd7e3d58e62054b8ec380fc7ef0f30fab80e89adf')
    or not exists (select 1 from public.tracking_events where id = '96000000-0000-0000-0000-000000000021'
      and occurred_at = '2026-01-10T05:00Z'::timestamptz) then
    raise exception 'DHL repair did not correct the confirmed provider clocks';
  end if;
  if not exists (select 1 from public.packages where id = '96000000-0000-0000-0000-000000000002'
    and carrier_data->>'last_update' = '2026-06-20T16:00:00+02:00'
    and carrier_data->'routing'->>'last_event_at' = '2026-06-20T14:00:00.000Z'
    and carrier_data->'routing'->>'keep' = 'true')
    or not exists (select 1 from public.packages where id = '96000000-0000-0000-0000-000000000005'
      and carrier_data->>'last_update' = '2026-06-22T12:00:00+02:00'
      and carrier_data->'routing'->>'last_event_at' = '2026-06-22T10:00:00.000Z') then
    raise exception 'DHL repair lost the summary or watermark';
  end if;
  if not exists (select 1 from public.push_deliveries where event_id = '96000000-0000-0000-0000-000000000011')
    or (select sent_at from public.native_push_deliveries where event_id = '96000000-0000-0000-0000-000000000011') <> '2026-01-10T13:00Z'::timestamptz
    or not exists (select 1 from public.live_activity_event_deliveries where event_id = '96000000-0000-0000-0000-000000000011'
      and event_created_at = '2026-01-10T13:00Z'::timestamptz)
    or not exists (select 1 from public.parcel_link_alert_deliveries where event_id = '96000000-0000-0000-0000-000000000011')
    or (select sample_event_id from public.tracking_status_observations where observation_key = repeat('c', 64)) <> '96000000-0000-0000-0000-000000000011'::uuid
    or not exists (select 1 from public.delivery_emails where event_id = '96000000-0000-0000-0000-000000000011' and status = 'sent') then
    raise exception 'DHL repair lost a receipt or reference';
  end if;
end;
$$;
rollback;
