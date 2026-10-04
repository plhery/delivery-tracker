\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('98000000-0000-0000-0000-000000000001', 'flights@example.invalid');
insert into auth.sessions (id, user_id)
values ('98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
values ('98000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000001',
  'JN067614884IN', 'india-post', 'in_transit');

insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select id::uuid, '98000000-0000-0000-0000-000000000002', 'in_transit', description,
  location, occurred_at::timestamptz, created_at::timestamptz, provider_event_id, raw_data::jsonb
from (values
  ('98000000-0000-0000-0000-000000000010', 'UPLIFT', 'Office - FRA 000000', '2026-07-11T18:05Z', '2026-07-11T19:00Z', 'india-post:uplift', '{"provider_code":"AircraftTakeOff"}'),
  ('98000000-0000-0000-0000-000000000011', 'Aircraft Departure', 'Office - FRA 000000', '2026-07-11T18:05Z', '2026-07-12T12:00Z', 'india-post:departure', '{"provider_code":"AircraftTakeOff"}'),
  ('98000000-0000-0000-0000-000000000012', 'UPLIFT', 'Office - DEL 000001', '2026-07-11T18:05Z', '2026-07-11T19:00Z', 'india-post:other-office', '{"provider_code":"AircraftTakeOff"}'),
  ('98000000-0000-0000-0000-000000000013', 'Aircraft Departure', 'Office - FRA 000000', '2026-07-11T18:05Z', '2026-07-11T19:00Z', 'india-post:other-code', '{"provider_code":"ItemReceived"}')
) as scans(id, description, location, occurred_at, created_at, provider_event_id, raw_data);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/flight-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('98000000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-000000000001',
  repeat('98', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment, subscribed_at)
values ('98000000-0000-0000-0000-000000000005', '98000000-0000-0000-0000-000000000001',
  '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000006',
  repeat('99', 32), 'development', '2000-01-01');

insert into public.parcel_links (id, package_id, created_by)
values ('ABCDEFGHJKMN', '98000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000001');
insert into public.parcel_link_alerts (id, link_id, endpoint, p256dh, auth, locale, preset)
values ('98000000-0000-0000-0000-000000000007', 'ABCDEFGHJKMN', 'https://fcm.googleapis.com/fcm/send/flight-link-fixture', 'test', 'test', 'en', 'all');

-- One channel handled only the copy; another already handled both rows.
insert into public.push_deliveries (subscription_id, event_id, sent_at)
values ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-000000000011', '2026-07-12T12:00Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at)
values ('98000000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-000000000010', '2026-07-11T19:00Z'),
  ('98000000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-000000000011', '2026-07-12T12:00Z');
insert into public.live_activity_event_deliveries (device_id, event_id, package_id, delivery_kind, event_created_at, sent_at)
values ('98000000-0000-0000-0000-000000000005', '98000000-0000-0000-0000-000000000011',
  '98000000-0000-0000-0000-000000000002', 'update', '2026-07-12T12:00Z', '2026-07-12T12:00Z');
insert into public.parcel_link_alert_deliveries (alert_id, event_id)
values ('98000000-0000-0000-0000-000000000007', '98000000-0000-0000-0000-000000000011');

\ir ../migrations/20261004150000_deduplicate_india_post_flights.sql

do $$
begin
  if (select count(*) from public.tracking_events where package_id = '98000000-0000-0000-0000-000000000002'
      and provider_event_id like 'india-post:%') <> 3 then
    raise exception 'Flight repair removed distinct scans or kept a copy';
  end if;
  if (select created_at from public.tracking_events where id = '98000000-0000-0000-0000-000000000010') <> '2026-07-11T19:00Z'::timestamptz then
    raise exception 'Flight repair reset the notification cursor';
  end if;
  if not exists (select 1 from public.push_deliveries where subscription_id = '98000000-0000-0000-0000-000000000003'
      and event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Flight repair lost browser receipts';
  end if;
  if (select sent_at from public.native_push_deliveries where device_id = '98000000-0000-0000-0000-000000000004'
      and event_id = '98000000-0000-0000-0000-000000000010') <> '2026-07-11T19:00Z'::timestamptz then
    raise exception 'Flight repair lost the earliest native receipt';
  end if;
  if not exists (select 1 from public.live_activity_event_deliveries where device_id = '98000000-0000-0000-0000-000000000005'
      and event_id = '98000000-0000-0000-0000-000000000010' and event_created_at = '2026-07-11T19:00Z'::timestamptz) then
    raise exception 'Flight repair lost the live activity receipt';
  end if;
  if not exists (select 1 from public.parcel_link_alert_deliveries where alert_id = '98000000-0000-0000-0000-000000000007'
      and event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Flight repair lost parcel link receipts';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id = '98000000-0000-0000-0000-000000000010')
      or exists (select 1 from public.pending_native_push_notifications where event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Flight repair queued a duplicate notification';
  end if;
end;
$$;
rollback;
