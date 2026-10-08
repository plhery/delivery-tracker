\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('91300000-0000-0000-0000-000000000001', 'round-sort-stage@example.invalid');
-- The account hears about rounds and deliveries only, so the in-transit scans never told it anything.
insert into public.notification_preferences (user_id, enabled_stages)
values ('91300000-0000-0000-0000-000000000001', array['out_for_delivery', 'delivered']);
insert into public.packages (id, user_id, tracking_number, carrier, current_stage)
select ('91300000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  '91300000-0000-0000-0000-000000000001', number, 'la-poste', stage
from (values
  (2, '91300000000002', 'delivered'),
  (3, '91300000000003', 'in_transit'),
  -- A stage the carrier's status gave, not the newest scan.
  (4, '91300000000004', 'exception')
) as parcels(id, number, stage);

insert into public.tracking_events (id, package_id, stage, description, occurred_at, created_at, provider_event_id, raw_data)
select ('91300000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('91300000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, stage, description,
  occurred::timestamptz, occurred::timestamptz + interval '5 minutes', provider || ':' || id,
  jsonb_strip_nulls(jsonb_build_object('description', coalesce(raw_description, description),
    'provider_code', code, 'stage', declared, 'stage_source', source))
from (values
  -- The letter's sort into the round, stored out for delivery by the scraper and moved
  -- to in transit by the 2026-10-04 refinement, then the delivery that followed.
  (10, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-15T06:00Z'),
  (11, 2, 'la-poste', 'delivered', 'Votre courrier a été distribué.', null, 'DESTIN/DI1', 'delivered', 'carrier_map', '2026-09-15T10:00Z'),
  -- An earlier round, stored before the app kept the source.
  (12, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', null, '2026-09-14T06:00Z'),
  -- Left alone: the parcel wording, wording a classifier staged, changed evidence, the
  -- universal provider's copy, another code, a pending scan, a row stored without the
  -- scraper's stage and a longer sentence.
  (20, 2, 'la-poste', 'out_for_delivery', 'Votre colis est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-13T06:00Z'),
  (21, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'in_transit', 'wording:language', '2026-09-12T06:00Z'),
  (22, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    'Différent', 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-12T07:00Z'),
  (23, 2, 'unknown', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-12T08:00Z'),
  (24, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISARR/MD1', 'out_for_delivery', 'carrier_map', '2026-09-12T09:00Z'),
  (25, 2, 'la-poste', 'pending', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-12T10:00Z'),
  (26, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', null, 'carrier_map', '2026-09-12T11:00Z'),
  (27, 2, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison. Merci.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-12T12:00Z'),
  -- The newest scan of a letter, stored while the scraper held the wording back.
  (30, 3, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'in_transit', 'carrier_map', '2026-09-20T06:00Z'),
  (40, 4, 'la-poste', 'in_transit', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.',
    null, 'DISTOU/MD1', 'out_for_delivery', 'carrier_map', '2026-09-30T06:00Z')
) as scans(id, package, provider, stage, description, raw_description, code, declared, source, occurred);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at) values
  ('91300000-0000-0000-0000-000000000006', '91300000-0000-0000-0000-000000000001',
    'https://fcm.googleapis.com/fcm/send/synthetic-round-sort-fixture', 'test', 'test', '2000-01-01'),
  ('91300000-0000-0000-0000-000000000008', '91300000-0000-0000-0000-000000000001',
    'https://fcm.googleapis.com/fcm/send/synthetic-round-sort-later', 'test', 'test', '2026-09-25');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('91300000-0000-0000-0000-000000000007', '91300000-0000-0000-0000-000000000001', repeat('91', 32), 'development', '2000-01-01');
insert into public.push_deliveries (subscription_id, event_id, sent_at)
values ('91300000-0000-0000-0000-000000000006', '91300000-0000-0000-0000-000000000010', '2026-09-15T06:10Z');

create temporary table round_events_before as select * from public.tracking_events;
create temporary table round_packages_before as select * from public.packages;
\ir ../migrations/20261008200000_la_poste_round_sort_stage.sql

do $$
declare
  restaged constant uuid[] := array(select ('91300000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid
    from unnest(array[10, 12, 30, 40]) as id);
begin
  if exists (select 1 from public.tracking_events where id = any(restaged) and stage <> 'out_for_delivery') then
    raise exception 'Missed a sort into the round';
  end if;
  if exists (
    select 1 from public.tracking_events e full join round_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and not e.id = any(restaged))
  ) then raise exception 'Changed unrelated scans or original evidence'; end if;

  if exists (
    select 1 from public.packages p join round_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
  ) or exists (
    select 1 from public.packages p join (values
      ('91300000-0000-0000-0000-000000000002'::uuid, 'delivered'),
      ('91300000-0000-0000-0000-000000000003'::uuid, 'out_for_delivery'),
      ('91300000-0000-0000-0000-000000000004'::uuid, 'exception')
    ) as expected(id, stage) using (id)
    where p.current_stage <> expected.stage
  ) then raise exception 'Moved a parcel''s stage its newest scan did not set'; end if;

  if (select count(*) from public.push_deliveries
      where subscription_id = '91300000-0000-0000-0000-000000000006' and event_id = any(restaged)) <> 4
    or (select count(*) from public.native_push_deliveries where event_id = any(restaged)) <> 4
    or (select sent_at from public.push_deliveries where subscription_id = '91300000-0000-0000-0000-000000000006'
      and event_id = '91300000-0000-0000-0000-000000000010')
      <> '2026-09-15T06:10Z'::timestamptz then
    raise exception 'Restaged scans lack a receipt';
  end if;
  -- The later subscription predates only the last round.
  if (select array_agg(event_id) from public.push_deliveries
      where subscription_id = '91300000-0000-0000-0000-000000000008') <> array['91300000-0000-0000-0000-000000000040'::uuid]
    or exists (select 1 from public.push_deliveries where subscription_id in ('91300000-0000-0000-0000-000000000006',
      '91300000-0000-0000-0000-000000000008') and not event_id = any(restaged))
    or exists (select 1 from public.native_push_deliveries
      where device_id = '91300000-0000-0000-0000-000000000007' and not event_id = any(restaged)) then
    raise exception 'Recorded a receipt for a scan nobody could be told about again';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id = any(restaged))
    or exists (select 1 from public.pending_native_push_notifications where event_id = any(restaged)) then
    raise exception 'A restaged scan would be announced';
  end if;
  if not exists (select 1 from public.pending_push_notifications where event_id = '91300000-0000-0000-0000-000000000011') then
    raise exception 'The fixture announces nothing';
  end if;
end $$;

create temporary table round_events_after as select * from public.tracking_events;
create temporary table round_packages_after as select * from public.packages;
create temporary table round_side_tables_after as
select 'push' as source, to_jsonb(r) as row from public.push_deliveries r
union all select 'native', to_jsonb(r) from public.native_push_deliveries r;
\ir ../migrations/20261008200000_la_poste_round_sort_stage.sql

do $$
begin
  if exists (
    (select * from public.tracking_events except all select * from round_events_after)
    union all (select * from round_events_after except all select * from public.tracking_events)
  ) or exists (
    (select * from public.packages except all select * from round_packages_after)
    union all (select * from round_packages_after except all select * from public.packages)
  ) or exists (
    (select 'push', to_jsonb(r) from public.push_deliveries r
      union all select 'native', to_jsonb(r) from public.native_push_deliveries r)
    except all select * from round_side_tables_after
  ) then raise exception 'Round sort repair is not idempotent'; end if;
end $$;
rollback;
