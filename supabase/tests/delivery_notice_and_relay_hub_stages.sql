\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('94000000-0000-0000-0000-000000000001', 'notice-stages@example.invalid');
-- The account hears about moving parcels only, so the old stages never told it anything.
insert into public.notification_preferences (user_id, enabled_stages)
values ('94000000-0000-0000-0000-000000000001', array['in_transit', 'out_for_delivery', 'delivered']);
insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
select ('94000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '94000000-0000-0000-0000-000000000001', number, carrier, stage
from (values
  (2, '09400000000002', 'dpd', 'delivered'),
  (3, '94000003', 'mondial-relay', 'accepted'),
  -- A stage the carrier's status gave, not the newest scan.
  (4, '94000004', 'mondial-relay', 'out_for_delivery'),
  (5, '09400000000005', 'dpd', 'registered')
) as parcels(id, number, carrier, stage);

insert into public.tracking_events (id, package_id, stage, description, occurred_at, created_at, provider_event_id, raw_data)
select ('94000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('94000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, stage, description,
  occurred::timestamptz, occurred::timestamptz + interval '5 minutes', provider || ':' || id,
  jsonb_strip_nulls(jsonb_build_object('description', coalesce(raw_description, description),
    'provider_code', code, 'stage', declared, 'stage_source', source))
from (values
  -- DPD's notices, one at the instant of the round that delivered the parcel.
  (10, 2, 'dpd', 'registered', 'We informed you via email that your parcel will be delivered on Monday, September 14, 2026 between 9:30 AM and 10:30 AM',
    null, 'MSDLO', null, 'wording:language', '2026-09-14T06:00Z'),
  (11, 2, 'dpd', 'out_for_delivery', 'Out for delivery', null, 'DEY', 'out_for_delivery', 'carrier_map', '2026-09-14T06:00Z'),
  (12, 2, 'dpd', 'delivered', 'Delivered', null, 'DLI', 'delivered', 'carrier_map', '2026-09-14T12:00Z'),
  (13, 2, 'dpd', 'registered', 'Your parcel delivery date has changed, it will be delivered on: Monday, September 14, 2026',
    null, 'SPE', null, 'wording:language', '2026-09-12T08:00Z'),
  (14, 2, 'dpd', 'registered', 'Your parcel will be delivered to a safe place according to your instructions',
    null, 'MIDLI', null, 'wording:language', '2026-09-13T08:00Z'),
  -- Left alone: other wording, the adapter's own stage, a row stored before provenance
  -- was kept, changed evidence, another carrier, a longer notice and another stage.
  (20, 2, 'dpd', 'registered', 'Your parcel is estimated to be delivered on: Friday, September 11, 2026',
    null, 'SPE', null, 'wording:language', '2026-09-10T08:00Z'),
  (21, 2, 'dpd', 'registered', 'We informed you via email that your parcel will be delivered on Monday, September 14, 2026',
    null, 'MSDLO', 'registered', 'wording:language', '2026-09-11T08:00Z'),
  (22, 2, 'dpd', 'registered', 'We informed you via email that your parcel will be delivered on Monday, September 14, 2026',
    null, 'MSDLO', null, null, '2026-09-11T08:00Z'),
  (23, 2, 'dpd', 'registered', 'We informed you via email that your parcel will be delivered on Monday, September 14, 2026',
    'Different', 'MSDLO', null, 'wording:language', '2026-09-11T08:00Z'),
  (24, 2, 'unknown', 'registered', 'We informed you via email that your parcel will be delivered on Monday, September 14, 2026',
    null, null, null, 'wording:language', '2026-09-11T08:00Z'),
  (25, 2, 'dpd', 'registered', 'Your parcel will be delivered to a safe place according to your instructions, if possible',
    null, 'MIDLI', null, 'wording:language', '2026-09-11T08:00Z'),
  (26, 2, 'dpd', 'pending', 'Your parcel will be delivered to a safe place according to your instructions',
    null, 'MIDLI', null, 'wording:language', '2026-09-11T08:00Z'),
  -- Mondial Relay's hand-in, then its hubs.
  (30, 3, 'mondial-relay', 'accepted', 'Colis pris en charge en Locker', null, null, 'accepted', 'carrier_map', '2026-09-20T08:00Z'),
  (31, 3, 'mondial-relay', 'accepted', 'Prise en charge de votre colis sur notre site logistique de Exampleville.',
    null, null, 'accepted', 'carrier_map', '2026-09-20T18:00Z'),
  (32, 3, 'mondial-relay', 'accepted', 'Prise en charge de votre colis sur notre site logistique de Example-sur-Mer.',
    null, null, 'accepted', 'carrier_map', '2026-09-21T04:00Z'),
  -- Left alone: another hand-in, the universal provider's copy and wording the adapter
  -- did not declare.
  (33, 3, 'mondial-relay', 'accepted', 'Prise en charge de votre colis en Point Relais.',
    null, null, 'accepted', 'carrier_map', '2026-09-20T09:00Z'),
  (34, 3, 'unknown', 'accepted', 'Prise en charge de votre colis sur notre site logistique de Exampleville.',
    null, null, 'accepted', 'carrier_map', '2026-09-20T18:00Z'),
  (35, 3, 'mondial-relay', 'accepted', 'Prise en charge de votre colis sur notre site logistique de Exampleville.',
    null, null, null, 'wording:language', '2026-09-20T17:00Z'),
  (40, 4, 'mondial-relay', 'accepted', 'Prise en charge de votre colis sur notre site logistique de Exampleville.',
    null, null, 'accepted', 'carrier_map', '2026-09-22T04:00Z'),
  (50, 5, 'dpd', 'registered', 'We informed you via email that your parcel will be delivered on Thursday, October 1, 2026',
    null, 'MSDLO', null, 'wording:language', '2026-09-30T16:00Z')
) as scans(id, package, provider, stage, description, raw_description, code, declared, source, occurred);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at) values
  ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000001',
    'https://fcm.googleapis.com/fcm/send/synthetic-notice-stages-fixture', 'test', 'test', '2000-01-01'),
  ('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000001',
    'https://fcm.googleapis.com/fcm/send/synthetic-notice-stages-later', 'test', 'test', '2026-09-25');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000001', repeat('94', 32), 'development', '2000-01-01');
insert into public.push_deliveries (subscription_id, event_id, sent_at)
values ('94000000-0000-0000-0000-000000000006', '94000000-0000-0000-0000-000000000031', '2026-09-20T18:05Z');
insert into public.tracking_status_observations (observation_key, carrier, provider_code, description_normalized, stage_source, chosen_stage, sample_event_id)
values
  (repeat('a', 64), 'dpd', 'MSDLO', 'we informed you via email that your parcel will be delivered on monday, september 14, 2026 between 9:30 am and 10:30 am',
    'wording:language', 'registered', '94000000-0000-0000-0000-000000000010'),
  (repeat('b', 64), 'dpd', 'SPE', 'your parcel is estimated to be delivered on: friday, september 11, 2026',
    'wording:language', 'registered', '94000000-0000-0000-0000-000000000020');

create temporary table notice_events_before as select * from public.tracking_events;
create temporary table notice_packages_before as select * from public.packages;
\ir ../migrations/20261008040000_delivery_notice_and_relay_hub_stages.sql

do $$
declare
  restaged constant uuid[] := array(select ('94000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid
    from unnest(array[10, 13, 14, 31, 32, 40, 50]) as id);
begin
  if exists (select 1 from public.tracking_events where id = any(restaged) and stage <> 'in_transit') then
    raise exception 'Missed a delivery notice or relay hub scan';
  end if;
  if exists (
    select 1 from public.tracking_events e full join notice_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and not e.id = any(restaged))
  ) then raise exception 'Changed unrelated scans or original evidence'; end if;

  if exists (
    select 1 from public.packages p join notice_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
  ) or exists (
    select 1 from public.packages p join (values
      ('94000000-0000-0000-0000-000000000002'::uuid, 'delivered'),
      ('94000000-0000-0000-0000-000000000003'::uuid, 'in_transit'),
      ('94000000-0000-0000-0000-000000000004'::uuid, 'out_for_delivery'),
      ('94000000-0000-0000-0000-000000000005'::uuid, 'in_transit')
    ) as expected(id, stage) using (id)
    where p.current_stage <> expected.stage
  ) then raise exception 'Moved a parcel''s stage its newest scan did not set'; end if;

  if (select chosen_stage || '/' || stage_source from public.tracking_status_observations
      where observation_key = repeat('a', 64)) <> 'in_transit/none'
    or (select chosen_stage || '/' || stage_source from public.tracking_status_observations
      where observation_key = repeat('b', 64)) <> 'registered/wording:language' then
    raise exception 'Observations do not follow their sampled scans';
  end if;

  if (select count(*) from public.push_deliveries
      where subscription_id = '94000000-0000-0000-0000-000000000006' and event_id = any(restaged)) <> 7
    or (select count(*) from public.native_push_deliveries where event_id = any(restaged)) <> 7
    or (select sent_at from public.push_deliveries where subscription_id = '94000000-0000-0000-0000-000000000006'
      and event_id = '94000000-0000-0000-0000-000000000031')
      <> '2026-09-20T18:05Z'::timestamptz then
    raise exception 'Restaged scans lack a receipt';
  end if;
  -- The later subscription predates only the last notice.
  if (select array_agg(event_id) from public.push_deliveries
      where subscription_id = '94000000-0000-0000-0000-000000000008') <> array['94000000-0000-0000-0000-000000000050'::uuid]
    or exists (select 1 from public.push_deliveries where subscription_id in ('94000000-0000-0000-0000-000000000006',
      '94000000-0000-0000-0000-000000000008') and not event_id = any(restaged))
    or exists (select 1 from public.native_push_deliveries
      where device_id = '94000000-0000-0000-0000-000000000007' and not event_id = any(restaged)) then
    raise exception 'Recorded a receipt for a scan nobody could be told about again';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id = any(restaged))
    or exists (select 1 from public.pending_native_push_notifications where event_id = any(restaged)) then
    raise exception 'A restaged scan would be announced';
  end if;
  if not exists (select 1 from public.pending_push_notifications where event_id = '94000000-0000-0000-0000-000000000012') then
    raise exception 'The fixture announces nothing';
  end if;
end $$;

create temporary table notice_events_after as select * from public.tracking_events;
create temporary table notice_packages_after as select * from public.packages;
create temporary table notice_side_tables_after as
select 'push' as source, to_jsonb(r) as row from public.push_deliveries r
union all select 'native', to_jsonb(r) from public.native_push_deliveries r
union all select 'observation', to_jsonb(r) from public.tracking_status_observations r;
\ir ../migrations/20261008040000_delivery_notice_and_relay_hub_stages.sql

do $$
begin
  if exists (
    (select * from public.tracking_events except all select * from notice_events_after)
    union all (select * from notice_events_after except all select * from public.tracking_events)
  ) or exists (
    (select * from public.packages except all select * from notice_packages_after)
    union all (select * from notice_packages_after except all select * from public.packages)
  ) or exists (
    (select 'push', to_jsonb(r) from public.push_deliveries r
      union all select 'native', to_jsonb(r) from public.native_push_deliveries r
      union all select 'observation', to_jsonb(r) from public.tracking_status_observations r)
    except all select * from notice_side_tables_after
  ) then raise exception 'Notice and hub repair is not idempotent'; end if;
end $$;
rollback;
