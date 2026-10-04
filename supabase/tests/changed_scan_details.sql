\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('98000000-0000-0000-0000-000000000001', 'scans@example.invalid');
insert into auth.sessions (id, user_id)
values ('98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
values ('98000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-000000000001',
  'JN067614884IN', 'india-post', 'in_transit');

insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('98000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '98000000-0000-0000-0000-000000000002', stage, description,
  location, occurred_at::timestamptz, created_at::timestamptz, provider_event_id, raw_data::jsonb
from (values
  (10, 'in_transit', 'Inducted', 'Example GPO 000000', '2026-07-11T18:05Z', '2026-07-11T19:00Z', 'india-post:old-label', '{"provider_code":"ItemInducted"}'),
  (11, 'in_transit', 'Item inducted', 'Example GPO 000001', '2026-07-11T18:05Z', '2026-07-12T12:00Z', 'india-post:new-label', '{"provider_code":"ItemInducted"}'),
  (12, 'in_transit', 'Inducted', 'Other GPO 000000', '2026-07-11T18:05Z', '2026-07-12T12:00Z', 'india-post:other-office', '{"provider_code":"ItemInducted"}'),
  (13, 'in_transit', 'Item received', 'Example GPO 000001', '2026-07-11T18:05Z', '2026-07-12T12:00Z', 'india-post:other-code', '{"provider_code":"ItemReceived"}'),
  (14, 'customs', 'Sent to Export Customs', 'Example GPO 000000', '2026-07-11T19:00Z', '2026-07-11T19:30Z', 'india-post:customs-in', '{"provider_code":"ExportCustoms"}'),
  (15, 'customs', 'Out of Export Customs', 'Example GPO 000001', '2026-07-11T19:00Z', '2026-07-12T12:00Z', 'india-post:customs-out', '{"provider_code":"ExportCustoms"}'),
  (16, 'in_transit', 'Item received', 'Example GPO 000000', '2026-07-11T20:00Z', '2026-07-11T20:30Z', 'india-post:same-check-a', '{"provider_code":"ItemReceived"}'),
  (17, 'in_transit', 'Item received', 'Example GPO 000001', '2026-07-11T20:00Z', '2026-07-11T20:30Z', 'india-post:same-check-b', '{"provider_code":"ItemReceived"}'),
  (18, 'accepted', 'Package collected', null, '2026-07-11T22:00Z', '2026-07-11T22:30Z', 'ups:without-location', '{}'),
  (19, 'accepted', 'Package collected', 'Example City, France', '2026-07-11T22:00Z', '2026-07-12T12:00Z', 'ups:with-location', '{}'),
  (20, 'in_transit', 'Package departed', null, '2026-07-11T22:00Z', '2026-07-12T12:00Z', 'ups:departure', '{}'),
  (21, 'in_transit', 'Package arrived', 'Example City, France', '2026-07-11T23:00Z', '2026-07-11T23:30Z', 'ups:place-a', '{}'),
  (22, 'in_transit', 'Package arrived', 'Another City, France', '2026-07-11T23:00Z', '2026-07-12T12:00Z', 'ups:place-b', '{}'),
  (23, 'in_transit', 'Package arrived', null, '2026-07-12T00:00Z', '2026-07-12T00:30Z', 'ups:same-check-a', '{}'),
  (24, 'in_transit', 'Package arrived', 'Example City, France', '2026-07-12T00:00Z', '2026-07-12T00:30Z', 'ups:same-check-b', '{}'),
  (25, 'in_transit', 'Package arrived', null, '2026-07-12T01:00Z', '2026-07-12T01:30Z', 'ups:observation', '{"observed_without_provider_timestamp":true}'),
  (26, 'in_transit', 'Package arrived', 'Example City, France', '2026-07-12T01:00Z', '2026-07-12T12:00Z', 'ups:dated-scan', '{}'),
  (27, 'in_transit', 'Package arrived', null, '2026-07-12T02:00Z', '2026-07-12T02:30Z', 'dhl:arrival', '{}'),
  (28, 'in_transit', 'Package departed', null, '2026-07-12T02:00Z', '2026-07-12T12:00Z', 'dhl:departure', '{}'),
  (29, 'in_transit', 'Item inducted', 'Example GPO 000002', '2026-07-11T18:05Z', '2026-07-13T12:00Z', 'india-post:third-label', '{"provider_code":"ItemInducted"}')
) as scans(id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data);

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

insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('a', 64), 'india-post', 'item inducted', 'wording', 'in_transit', '98000000-0000-0000-0000-000000000011');

\ir ../migrations/20261004170000_deduplicate_changed_scan_details.sql
\ir ../migrations/20261004170000_deduplicate_changed_scan_details.sql

do $$
begin
  if (select count(*) from public.tracking_events where package_id = '98000000-0000-0000-0000-000000000002'
      and provider_event_id not like 'app:%') <> 17 then
    raise exception 'Scan repair removed distinct scans or kept a copy';
  end if;
  if exists (
    select 1 from generate_series(10, 29) expected(id)
    where expected.id not in (11, 19, 29) and not exists (
      select 1 from public.tracking_events
      where id = ('98000000-0000-0000-0000-' || lpad(expected.id::text, 12, '0'))::uuid
    )
  ) then
    raise exception 'Scan repair removed a separate event';
  end if;
  if not exists (select 1 from public.tracking_events where id = '98000000-0000-0000-0000-000000000010'
      and provider_event_id = 'india-post:old-label' and created_at = '2026-07-11T19:00Z'::timestamptz
      and description = 'Item inducted' and location = 'Example GPO 000002') then
    raise exception 'Scan repair lost the original identity or latest details';
  end if;
  if not exists (select 1 from public.tracking_events where id = '98000000-0000-0000-0000-000000000018'
      and provider_event_id = 'ups:without-location' and location = 'Example City, France'
      and created_at = '2026-07-11T22:30Z'::timestamptz) then
    raise exception 'Scan repair lost the enriched UPS scan';
  end if;
  if (select sample_event_id from public.tracking_status_observations where observation_key = repeat('a', 64))
      <> '98000000-0000-0000-0000-000000000010'::uuid then
    raise exception 'Scan repair lost an observation reference';
  end if;
  if not exists (select 1 from public.push_deliveries where subscription_id = '98000000-0000-0000-0000-000000000003'
      and event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Scan repair lost browser receipts';
  end if;
  if (select sent_at from public.native_push_deliveries where device_id = '98000000-0000-0000-0000-000000000004'
      and event_id = '98000000-0000-0000-0000-000000000010') <> '2026-07-11T19:00Z'::timestamptz then
    raise exception 'Scan repair lost the earliest native receipt';
  end if;
  if not exists (select 1 from public.live_activity_event_deliveries where device_id = '98000000-0000-0000-0000-000000000005'
      and event_id = '98000000-0000-0000-0000-000000000010' and event_created_at = '2026-07-11T19:00Z'::timestamptz) then
    raise exception 'Scan repair lost the live activity receipt';
  end if;
  if not exists (select 1 from public.parcel_link_alert_deliveries where alert_id = '98000000-0000-0000-0000-000000000007'
      and event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Scan repair lost parcel link receipts';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id = '98000000-0000-0000-0000-000000000010')
      or exists (select 1 from public.pending_native_push_notifications where event_id = '98000000-0000-0000-0000-000000000010') then
    raise exception 'Scan repair queued a duplicate notification';
  end if;
end;
$$;
rollback;
