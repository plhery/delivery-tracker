\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('93000000-0000-0000-0000-000000000001', 'remaining-scan-copies@example.invalid');
insert into auth.sessions (id, user_id)
values ('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage, carrier_data)
select ('93000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '93000000-0000-0000-0000-000000000001', number, carrier, stage, data::jsonb
from (values
  (2, 'EXAMPLE0000000011', 'india-post', 'in_transit', '{"routing":{"last_event_at":"2026-10-03T21:20:00.000Z","keep":true}}'),
  (3, 'EXAMPLE0000000012', 'chronopost', 'out_for_delivery', '{"routing":{"last_event_at":"2026-10-08T06:15:30.000Z"}}'),
  (4, 'EXAMPLE0000000013', 'ups', 'in_transit', '{"routing":{"last_event_at":"2026-09-14T17:21:00.000Z"}}'),
  (5, 'EXAMPLE0000000014', 'la-poste', 'ready_for_pickup', '{"routing":{"last_event_at":"2026-09-17T06:24:00.000Z"}}'),
  (6, 'EXAMPLE0000000015', 'india-post', 'in_transit', '{"routing":{"last_event_at":"2026-10-04T19:31:00.000Z"}}')
) as parcels(id, number, carrier, stage, data);

insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('93000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('93000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, stage, description, location,
  occurred::timestamptz, created::timestamptz, provider_event_id, raw::jsonb
from (values
  -- India Post's take-offs on the airport's clock, and 17TRACK's, which read that clock as UTC.
  -- The carrier's row stored first: the copy goes.
  (10, 2, 'in_transit', 'Flight XX0001 departed: Mumbai Airport (BOM) → Frankfurt Airport (FRA)', 'Mumbai Airport (BOM), India',
    '2026-10-02T21:25:00Z', '2026-10-03T00:00Z', 'india-post:bom',
    '{"time":"2026-10-03T02:55:00+05:30","provider_code":"AircraftTakeOff","stage_source":"carrier_map"}'),
  (11, 2, 'in_transit', 'Aircraft Departure', null, '2026-10-03T02:55:00Z', '2026-10-07T17:00Z', 'unknown:bom',
    '{"time":"2026-10-03T02:55:00.000Z","provider_code":"InTransit_Other","provider_time_iso":"2026-10-03T08:25:00+05:30","reporting_carrier":"India Post","reporting_carrier_key":9021,"time_provenance":"provider_inferred"}'),
  -- The copy stored first, two hours late, which set the watermark: its row takes India Post's scan.
  (12, 2, 'in_transit', 'Flight XX0002 departed: Frankfurt Airport (FRA) → Paris Charles de Gaulle Airport (CDG)', 'Frankfurt Airport (FRA), Germany',
    '2026-10-03T19:20:00Z', '2026-10-08T06:00Z', 'india-post:fra',
    '{"time":"2026-10-03T21:20:00+02:00","provider_code":"AircraftTakeOff","stage_source":"carrier_map"}'),
  (13, 2, 'in_transit', 'UPLIFT', null, '2026-10-03T21:20:00Z', '2026-10-07T17:00Z', 'unknown:fra',
    '{"time":"2026-10-03T21:20:00.000Z","provider_code":"InTransit_Other","provider_time_iso":"2026-10-04T02:50:00+05:30","reporting_carrier":"India Post","time_provenance":"provider_inferred"}'),
  -- Left alone: a take-off no India Post take-off shares a clock with, an India Post arrival on
  -- that clock, and another operator's row on the first take-off's clock.
  (16, 2, 'in_transit', 'Aircraft Departure', null, '2026-10-01T10:00:00Z', '2026-10-07T17:00Z', 'unknown:unmatched',
    '{"time":"2026-10-01T10:00:00.000Z","provider_time_iso":"2026-10-01T15:30:00+05:30","reporting_carrier":"India Post"}'),
  (17, 2, 'in_transit', 'Mail arrived', 'Office - BOM 00000000', '2026-10-01T04:30:00Z', '2026-10-02T00:00Z', 'india-post:arrived',
    '{"time":"2026-10-01T10:00:00+05:30","provider_code":"MailArrived"}'),
  (18, 2, 'in_transit', 'Aircraft Departure', null, '2026-10-03T02:55:00Z', '2026-10-07T17:00Z', 'unknown:other-operator',
    '{"time":"2026-10-03T02:55:00.000Z","provider_time_iso":"2026-10-03T08:25:00+05:30","reporting_carrier":"Example Post"}'),

  -- A carrier's history read to the minute through another feed, then to the second.
  (20, 3, 'registered', 'Colis en cours de préparation chez l''expéditeur', null, '2026-09-28T09:51:00Z', '2026-10-07T20:20Z', 'chronopost:prepared-minute',
    '{"time":"2026-09-28T11:51:00+02:00","provider_code":"DR1","stage_source":"carrier_map"}'),
  (21, 3, 'registered', 'Colis en cours de préparation chez l''expéditeur', 'Web Services', '2026-09-28T09:51:21Z', '2026-10-07T22:53Z', 'chronopost:prepared',
    '{"time":"2026-09-28T11:51:21+02:00","provider_code":"DC","stage_source":"carrier_map"}'),
  (22, 3, 'in_transit', 'Colis en cours d''acheminement', null, '2026-10-03T13:01:00Z', '2026-10-07T20:20Z', 'chronopost:transit-minute',
    '{"time":"2026-10-03T15:01:00+02:00","provider_code":"ET1","stage_source":"carrier_map"}'),
  (23, 3, 'in_transit', 'Colis  en cours d''acheminement', 'EXAMPLE HUB', '2026-10-03T13:01:15Z', '2026-10-07T22:53Z', 'chronopost:transit',
    '{"time":"2026-10-03T15:01:15+02:00","provider_code":"TS","stage_source":"carrier_map"}'),
  -- Left alone: the same wording in another minute; two scans of one reply in a minute (sorted
  -- twice); a minute two rows fall in; and two carriers' scans of a handoff.
  (24, 3, 'in_transit', 'Colis en cours d''acheminement', 'EXAMPLE HUB', '2026-10-03T13:06:15Z', '2026-10-07T22:53Z', 'chronopost:transit-later',
    '{"time":"2026-10-03T15:06:15+02:00","provider_code":"O"}'),
  (25, 3, 'in_transit', 'Sorted for delivery', 'EXAMPLE CENTRE', '2026-10-05T07:10:00Z', '2026-10-05T08:00Z', 'chronopost:sorted-a',
    '{"time":"2026-10-05T09:10:00+02:00","provider_code":"S1"}'),
  (26, 3, 'in_transit', 'Sorted for delivery', 'EXAMPLE CENTRE', '2026-10-05T07:10:28Z', '2026-10-05T08:00Z', 'chronopost:sorted-b',
    '{"time":"2026-10-05T09:10:28+02:00","provider_code":"S2"}'),
  (27, 3, 'in_transit', 'Colis trié', null, '2026-10-04T09:00:00Z', '2026-10-04T10:00Z', 'chronopost:sorted-minute',
    '{"time":"2026-10-04T11:00:00+02:00"}'),
  (28, 3, 'in_transit', 'Colis trié', 'EXAMPLE HUB', '2026-10-04T09:00:10Z', '2026-10-05T10:00Z', 'chronopost:sorted-first',
    '{"time":"2026-10-04T11:00:10+02:00"}'),
  (29, 3, 'in_transit', 'Colis trié', 'EXAMPLE HUB', '2026-10-04T09:00:40Z', '2026-10-05T10:00Z', 'chronopost:sorted-second',
    '{"time":"2026-10-04T11:00:40+02:00"}'),
  (31, 3, 'out_for_delivery', 'Out for delivery', 'Example City, DE', '2026-10-08T06:15:00Z', '2026-10-08T14:00Z', 'dpd-de:out',
    '{"time":"2026-10-08T08:15:00+02:00"}'),
  (32, 3, 'out_for_delivery', 'Out for delivery', 'EXAMPLE DEPOT', '2026-10-08T06:15:30Z', '2026-10-08T07:50Z', 'chronopost:out',
    '{"time":"2026-10-08T08:15:30+02:00"}'),

  -- A universal provider's copy to the minute, stored first: its row takes the carrier's scan.
  (40, 4, 'registered', 'Shipper created a label, UPS has not received the package yet.', 'US', '2026-09-10T21:25:00Z', '2026-09-10T21:30Z', 'unknown:label',
    '{"time":"2026-09-10T21:25:00.000Z","stage_source":"carrier_map"}'),
  (41, 4, 'registered', 'Shipper created a label, UPS has not received the package yet.', null, '2026-09-10T21:25:25Z', '2026-09-11T08:00Z', 'ups:label',
    '{"time":"2026-09-10T21:25:25.000Z","stage_source":"wording:language"}'),
  -- Left alone: a minute row whole hours from a carrier's scan worded otherwise, and another wording in the minute.
  (42, 4, 'in_transit', 'Item has departed from country of origin', 'US', '2026-09-14T14:21:00Z', '2026-09-14T15:00Z', 'unknown:departed',
    '{"time":"2026-09-14T14:21:00.000Z"}'),
  (43, 4, 'in_transit', 'Ready to leave the country', null, '2026-09-14T17:21:00Z', '2026-09-14T18:00Z', 'ups:ready',
    '{"time":"2026-09-14T17:21:00.000Z"}'),
  (44, 4, 'in_transit', 'Arrived at facility', 'US', '2026-09-12T10:00:00Z', '2026-09-12T11:00Z', 'unknown:arrived',
    '{"time":"2026-09-12T10:00:00.000Z"}'),
  (45, 4, 'in_transit', 'Departed facility', null, '2026-09-12T10:00:30Z', '2026-09-13T11:00Z', 'ups:departed',
    '{"time":"2026-09-12T10:00:30.000Z"}'),

  -- A stage the sync observed, stored with the dated scan a later re-staging gave that stage.
  (50, 5, 'ready_for_pickup', 'Votre colis vous attend dans votre point de retrait.', 'EXAMPLE TOWN', '2026-09-17T06:24:00Z', '2026-09-17T07:40Z', 'la-poste:ready',
    '{"time":"2026-09-17T08:24:00+02:00","stage_source":"carrier_map"}'),
  (51, 5, 'ready_for_pickup', 'Votre colis vous attend dans votre point de retrait.', null, '2026-09-17T07:40:00Z', '2026-09-17T07:40Z', 'la-poste:observed',
    '{"observed_without_provider_timestamp":true}'),
  -- Left alone: an observation worded otherwise, and one stored apart from its scan.
  (52, 5, 'in_transit', 'Status changed', null, '2026-09-15T07:00:00Z', '2026-09-15T07:00Z', 'la-poste:observed-other',
    '{"observed_without_provider_timestamp":true}'),
  (53, 5, 'in_transit', 'Votre colis est en transit.', 'EXAMPLE TOWN', '2026-09-15T05:00:00Z', '2026-09-15T07:00Z', 'la-poste:transit',
    '{"time":"2026-09-15T07:00:00+02:00"}'),
  (54, 5, 'accepted', 'Votre colis a été déposé.', null, '2026-09-14T09:00:00Z', '2026-09-14T09:00Z', 'la-poste:observed-apart',
    '{"observed_without_provider_timestamp":true}'),
  (55, 5, 'accepted', 'Votre colis a été déposé.', 'EXAMPLE TOWN', '2026-09-14T08:00:00Z', '2026-09-14T10:00Z', 'la-poste:accepted',
    '{"time":"2026-09-14T10:00:00+02:00"}'),

  -- One scan stored under an identity rewritten in place, then under its current one.
  (60, 6, 'in_transit', 'Flight XX0003 arrived: Frankfurt Airport (FRA) → Paris Charles de Gaulle Airport (CDG)',
    'Paris Charles de Gaulle Airport (CDG), France', '2026-10-04T19:31:00Z', '2026-10-04T20:00Z', 'india-post:arrived-old',
    '{"time":"2026-10-04T19:31:00Z","provider_code":"MailArrived"}'),
  (61, 6, 'in_transit', 'Flight XX0003 arrived: Frankfurt Airport (FRA) → Paris Charles de Gaulle Airport (CDG)',
    'Paris Charles de Gaulle Airport (CDG), France', '2026-10-04T19:31:00Z', '2026-10-05T11:20Z', 'india-post:arrived-new',
    '{"time":"2026-10-04T19:31:00Z","provider_code":"MailArrived","stage_source":"carrier_map"}'),
  -- Left alone: two places, two codes, and three rows alike.
  (62, 6, 'in_transit', 'Bag unloaded', 'Office - FRA 00000001', '2026-10-04T19:40:00Z', '2026-10-04T20:00Z', 'india-post:unloaded-a',
    '{"provider_code":"BagUnloaded"}'),
  (63, 6, 'in_transit', 'Bag unloaded', 'Office - FRA 00000002', '2026-10-04T19:40:00Z', '2026-10-05T11:20Z', 'india-post:unloaded-b',
    '{"provider_code":"BagUnloaded"}'),
  (64, 6, 'in_transit', 'Item received', 'Office - FRA 00000001', '2026-10-04T19:50:00Z', '2026-10-04T20:00Z', 'india-post:received-a',
    '{"provider_code":"ItemReceived"}'),
  (65, 6, 'in_transit', 'Item received', 'Office - FRA 00000001', '2026-10-04T19:50:00Z', '2026-10-05T11:20Z', 'india-post:received-b',
    '{"provider_code":"BagReceived"}'),
  (66, 6, 'in_transit', 'Bag opened', 'Office - FRA 00000001', '2026-10-04T19:55:00Z', '2026-10-04T20:00Z', 'india-post:opened-a',
    '{"provider_code":"BagOpened"}'),
  (67, 6, 'in_transit', 'Bag opened', 'Office - FRA 00000001', '2026-10-04T19:55:00Z', '2026-10-05T11:20Z', 'india-post:opened-b',
    '{"provider_code":"BagOpened"}'),
  (68, 6, 'in_transit', 'Bag opened', 'Office - FRA 00000001', '2026-10-04T19:55:00Z', '2026-10-06T11:20Z', 'india-post:opened-c',
    '{"provider_code":"BagOpened"}')
) as scans(id, package, stage, description, location, occurred, created, provider_event_id, raw);

create temporary table untouched_copy_scans as select * from public.tracking_events
where id::text like '93000000-%'
  and right(id::text, 12)::integer in (10, 16, 17, 18, 24, 25, 26, 27, 28, 29, 31, 32, 42, 43, 44, 45, 50, 52, 53, 54, 55,
    62, 63, 64, 65, 66, 67, 68);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-remaining-copies-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('93000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000001', repeat('b1', 32), 'development', '2000-01-01');
insert into public.live_activity_devices (id, session_id, user_id, installation_id, token, environment, subscribed_at)
values ('93000000-0000-0000-0000-000000000008', '93000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000009', repeat('b2', 32), 'development', '2000-01-01');
insert into public.parcel_links (id, package_id, created_by)
values ('EFGHJKMNPQRS', '93000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000001');
insert into public.parcel_link_alerts (id, link_id, endpoint, p256dh, auth, locale, preset)
values ('93000000-0000-0000-0000-000000000070', 'EFGHJKMNPQRS', 'https://fcm.googleapis.com/fcm/send/synthetic-link-remaining-copies-fixture', 'test', 'test', 'en', 'all');

insert into public.push_deliveries (subscription_id, event_id, sent_at) values
  ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000010', '2026-10-03T00:00Z'),
  ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000011', '2026-10-07T17:00Z'),
  ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000012', '2026-10-08T06:00Z'),
  ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000013', '2026-10-07T17:00Z'),
  ('93000000-0000-0000-0000-000000000006', '93000000-0000-0000-0000-000000000051', '2026-09-17T07:40Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at)
values ('93000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000061', '2026-10-05T11:20Z');
insert into public.live_activity_event_deliveries (device_id, event_id, package_id, delivery_kind, event_created_at, sent_at)
values ('93000000-0000-0000-0000-000000000008', '93000000-0000-0000-0000-000000000023',
  '93000000-0000-0000-0000-000000000003', 'update', '2026-10-07T22:53Z', '2026-10-07T22:53Z');
insert into public.parcel_link_alert_deliveries (alert_id, event_id)
values ('93000000-0000-0000-0000-000000000070', '93000000-0000-0000-0000-000000000041');
insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('f', 64), 'chronopost', 'colis en cours de préparation chez l''expéditeur', 'carrier_map', 'registered',
  '93000000-0000-0000-0000-000000000021');
insert into public.delivery_emails (user_id, package_id, event_id, stage, status, sent_at)
values ('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000005',
  '93000000-0000-0000-0000-000000000051', 'ready_for_pickup', 'sent', '2026-09-17T07:41Z');

\ir ../migrations/20261008200100_remaining_scan_copies.sql
create temporary table merged_copy_events as select * from public.tracking_events;
create temporary table merged_copy_packages as select * from public.packages;
\ir ../migrations/20261008200100_remaining_scan_copies.sql

do $$
begin
  if exists (select * from public.tracking_events except select * from merged_copy_events)
    or exists (select * from merged_copy_events except select * from public.tracking_events)
    or exists (select * from public.packages except select * from merged_copy_packages) then
    raise exception 'Remaining copy merge is not idempotent';
  end if;
  if exists (select * from untouched_copy_scans except select * from public.tracking_events) then
    raise exception 'Remaining copy merge changed a scan without evidence';
  end if;
  if exists (select 1 from public.tracking_events where id in ('93000000-0000-0000-0000-000000000011',
      '93000000-0000-0000-0000-000000000012', '93000000-0000-0000-0000-000000000021', '93000000-0000-0000-0000-000000000023',
      '93000000-0000-0000-0000-000000000041', '93000000-0000-0000-0000-000000000051', '93000000-0000-0000-0000-000000000061')) then
    raise exception 'Remaining copy merge kept a second row';
  end if;
  if (select count(*) from public.tracking_events where id::text like '93000000-%') <> 40 - 7 then
    raise exception 'Remaining copy merge removed a row it should keep';
  end if;

  if not exists (select 1 from public.tracking_events where id = '93000000-0000-0000-0000-000000000013'
      and occurred_at = '2026-10-03T19:20:00Z'::timestamptz and created_at = '2026-10-07T17:00Z'::timestamptz
      and provider_event_id = 'india-post:fra' and location = 'Frankfurt Airport (FRA), Germany'
      and description like 'Flight XX0002 departed:%'
      and raw_data = '{"time":"2026-10-03T21:20:00+02:00","provider_code":"AircraftTakeOff","stage_source":"carrier_map"}'::jsonb)
    or not exists (select 1 from public.tracking_events where id = '93000000-0000-0000-0000-000000000020'
      and occurred_at = '2026-09-28T09:51:21Z'::timestamptz and created_at = '2026-10-07T20:20Z'::timestamptz
      and provider_event_id = 'chronopost:prepared' and location = 'Web Services' and raw_data->>'provider_code' = 'DC')
    or not exists (select 1 from public.tracking_events where id = '93000000-0000-0000-0000-000000000022'
      and occurred_at = '2026-10-03T13:01:15Z'::timestamptz and provider_event_id = 'chronopost:transit'
      and location = 'EXAMPLE HUB')
    or not exists (select 1 from public.tracking_events where id = '93000000-0000-0000-0000-000000000040'
      and occurred_at = '2026-09-10T21:25:25Z'::timestamptz and created_at = '2026-09-10T21:30Z'::timestamptz
      and provider_event_id = 'ups:label' and location is null and raw_data->>'stage_source' = 'wording:language')
    or not exists (select 1 from public.tracking_events where id = '93000000-0000-0000-0000-000000000060'
      and created_at = '2026-10-04T20:00Z'::timestamptz and provider_event_id = 'india-post:arrived-new'
      and raw_data->>'stage_source' = 'carrier_map') then
    raise exception 'Remaining copy merge did not give the first row the scan';
  end if;

  if not exists (select 1 from public.packages where id = '93000000-0000-0000-0000-000000000002'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-03T19:20:00.000Z' and carrier_data->'routing'->>'keep' = 'true')
    or not exists (select 1 from public.packages where id = '93000000-0000-0000-0000-000000000003'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-08T06:15:30.000Z')
    or not exists (select 1 from public.packages where id = '93000000-0000-0000-0000-000000000004'
      and carrier_data->'routing'->>'last_event_at' = '2026-09-14T17:21:00.000Z')
    or not exists (select 1 from public.packages where id = '93000000-0000-0000-0000-000000000005'
      and carrier_data->'routing'->>'last_event_at' = '2026-09-17T06:24:00.000Z')
    or not exists (select 1 from public.packages where id = '93000000-0000-0000-0000-000000000006'
      and carrier_data->'routing'->>'last_event_at' = '2026-10-04T19:31:00.000Z') then
    raise exception 'Remaining copy merge did not repair only the watermarks the copies set';
  end if;

  if (select sent_at from public.push_deliveries where event_id = '93000000-0000-0000-0000-000000000010') <> '2026-10-03T00:00Z'::timestamptz
    or (select sent_at from public.push_deliveries where event_id = '93000000-0000-0000-0000-000000000013') <> '2026-10-07T17:00Z'::timestamptz
    or not exists (select 1 from public.push_deliveries where event_id = '93000000-0000-0000-0000-000000000050'
      and sent_at = '2026-09-17T07:40Z'::timestamptz)
    or not exists (select 1 from public.native_push_deliveries where event_id = '93000000-0000-0000-0000-000000000060')
    or not exists (select 1 from public.live_activity_event_deliveries where event_id = '93000000-0000-0000-0000-000000000022'
      and event_created_at = '2026-10-07T20:20Z'::timestamptz)
    or not exists (select 1 from public.parcel_link_alert_deliveries where event_id = '93000000-0000-0000-0000-000000000040')
    or (select sample_event_id from public.tracking_status_observations where observation_key = repeat('f', 64)) <> '93000000-0000-0000-0000-000000000020'::uuid
    or not exists (select 1 from public.delivery_emails where event_id = '93000000-0000-0000-0000-000000000050' and status = 'sent') then
    raise exception 'Remaining copy merge lost a receipt or reference';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id in ('93000000-0000-0000-0000-000000000010',
      '93000000-0000-0000-0000-000000000013', '93000000-0000-0000-0000-000000000050')) then
    raise exception 'Remaining copy merge queued an announced scan again';
  end if;
end;
$$;
rollback;
