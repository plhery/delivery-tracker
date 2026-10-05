\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email)
values ('97000000-0000-0000-0000-000000000001', 'retimed@example.invalid');
insert into auth.sessions (id, user_id)
values ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001');
insert into public.packages (id, user_id, tracking_number, carrier, current_stage) values
  ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'DOFR0000000000001HD', 'aliexpress', 'in_transit'),
  ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'PH00ZZ000000001X', 'correos-spain', 'in_transit'),
  ('97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001', 'PH00ZZ000000002D', 'correos-spain', 'in_transit'),
  ('97000000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000001', 'PH00ZZ000000003N', 'correos-spain', 'in_transit');

-- Identities of the Cainiao rows are the ones the sync computes for their strings.
insert into public.tracking_events (id, package_id, stage, description, location, occurred_at, created_at, provider_event_id, raw_data)
select ('97000000-0000-0000-0000-' || lpad(id::text, 12, '0'))::uuid,
  ('97000000-0000-0000-0000-' || lpad(package::text, 12, '0'))::uuid, stage, description,
  location, occurred_at::timestamptz, created_at::timestamptz, provider_event_id, raw_data::jsonb
from (values
  -- A notice whose second row has not come back yet.
  (10, 2, 'in_transit', 'Carrier update', null, '2026-06-10T07:40:16Z', '2026-06-10T08:00Z',
    'aliexpress:0fb2615652952e9d783ee71da0588e0ed075741d1d6362b507cc33357455af46', '{"time":"2026-06-10 07:40:16","instant":null,"description":"Carrier update"}'),
  -- A notice stored twice: read as UTC, then on the Beijing clock.
  (11, 2, 'in_transit', 'Carrier update', null, '2026-06-11T08:00:00Z', '2026-06-11T09:00Z',
    'aliexpress:42ebd70d02a1584f4fbfa8621c812a2477efe097156e0670ee3ae223cae3e724', '{"time":"2026-06-11 08:00:00"}'),
  (12, 2, 'in_transit', 'Carrier update', null, '2026-06-11T00:00:00Z', '2026-06-20T12:00Z',
    'aliexpress:153763d1ee55ccb1f5db068645b13be85d2392b6aa1abcdfb447e884947b99f8', '{"time":"2026-06-11T08:00:00+08:00","second":true}'),
  -- Left alone: another wording, a scan with its own zone, an identity another scan gave the row.
  (13, 2, 'in_transit', 'Departed from warehouse', null, '2026-06-12T09:00:00Z', '2026-06-12T10:00Z',
    'aliexpress:3f07f8f590dc10c9ea1ac0aec01fa17af97dcb79666608b1652fda33acdce976', '{"time":"2026-06-12 09:00:00"}'),
  (14, 2, 'in_transit', 'Departed from warehouse', null, '2026-06-09T06:00:14Z', '2026-06-09T07:00Z',
    'aliexpress:77c5c2923337d1c03f32ef839270ff0707345aa8d9a53e4a6121cfed0f1f4e9e', '{"time":"2026-06-09T14:00:14+08:00"}'),
  (15, 2, 'in_transit', 'Carrier update', null, '2026-06-13T10:00:00Z', '2026-06-13T11:00Z',
    'aliexpress:taken-over', '{"time":"2026-06-13 10:00:00"}'),
  -- A provider's copies on the Madrid clock labelled UTC, then Correos' own scans.
  (20, 3, 'out_for_delivery', 'Out for delivery. Shipment is out for delivery', '0000000', '2026-07-02T18:30:00Z', '2026-07-02T19:00Z',
    'unknown:summer-copy', '{"time":"2026-07-02T18:30:00.000Z"}'),
  (21, 3, 'out_for_delivery', 'En reparto', null, '2026-07-02T16:30:00Z', '2026-07-05T12:00Z',
    'correos-spain:summer-own', '{"time":"2026-07-02T18:30:00+02:00","own":true}'),
  (22, 3, 'registered', 'Pre-registered. Shipment pre-registered', null, '2026-01-14T09:15:00Z', '2026-01-14T10:00Z',
    'unknown:winter-copy', '{"time":"2026-01-14T09:15:00.000Z"}'),
  (23, 3, 'registered', 'Prerregistrado', null, '2026-01-14T08:15:00Z', '2026-07-05T12:00Z',
    'correos-spain:winter-own', '{"time":"2026-01-14T09:15:00+01:00","own":true}'),
  -- Correos' scan stored first, the provider's copy later.
  (24, 3, 'delivered', 'Entregado', null, '2026-07-03T09:00:00Z', '2026-07-03T09:30Z',
    'correos-spain:first-own', '{"time":"2026-07-03T11:00:00+02:00","own":true}'),
  (25, 3, 'delivered', 'Delivered. Shipment delivered', null, '2026-07-03T11:00:00Z', '2026-07-04T12:00Z',
    'unknown:later-copy', '{"time":"2026-07-03T11:00:00.000Z"}'),
  -- Left alone: a copy with no Correos scan, and one two hours from a scan in winter.
  (26, 3, 'in_transit', 'Sorted in Logistics Center', null, '2026-07-01T20:00:00Z', '2026-07-01T21:00Z',
    'unknown:lone-copy', '{"time":"2026-07-01T20:00:00.000Z"}'),
  (27, 3, 'in_transit', 'Clasificado', null, '2026-01-10T06:00:00Z', '2026-07-05T12:00Z',
    'correos-spain:winter-two-hours-own', '{"time":"2026-01-10T07:00:00+01:00"}'),
  (28, 3, 'in_transit', 'Classified', null, '2026-01-10T08:00:00Z', '2026-01-10T09:00Z',
    'unknown:winter-two-hours-copy', '{"time":"2026-01-10T08:00:00.000Z"}'),
  -- Left alone: this parcel's provider reports real instants, so a scan two hours later is another scan.
  (30, 4, 'in_transit', 'Admitted', null, '2026-07-02T08:00:00Z', '2026-07-02T09:00Z',
    'unknown:real-instant-copy', '{"time":"2026-07-02T08:00:00.000Z"}'),
  (31, 4, 'in_transit', 'Admitido', null, '2026-07-02T08:00:00Z', '2026-07-05T12:00Z',
    'correos-spain:real-instant-own', '{"time":"2026-07-02T10:00:00+02:00"}'),
  (32, 4, 'in_transit', 'Arrived', null, '2026-07-02T10:00:00Z', '2026-07-02T11:00Z',
    'unknown:two-hours-later', '{"time":"2026-07-02T10:00:00.000Z"}'),
  -- Left alone: two Correos scans at the instant the copy points to.
  (40, 5, 'in_transit', 'Classified', null, '2026-07-02T12:00:00Z', '2026-07-02T13:00Z',
    'unknown:ambiguous-copy', '{"time":"2026-07-02T12:00:00.000Z"}'),
  (41, 5, 'in_transit', 'Clasificado', null, '2026-07-02T10:00:00Z', '2026-07-05T12:00Z',
    'correos-spain:ambiguous-own-a', '{"time":"2026-07-02T12:00:00+02:00"}'),
  (42, 5, 'in_transit', 'En tránsito', null, '2026-07-02T10:00:00Z', '2026-07-05T12:00Z',
    'correos-spain:ambiguous-own-b', '{"time":"2026-07-02T12:00:00+02:00"}')
) as scans(id, package, stage, description, location, occurred_at, created_at, provider_event_id, raw_data);

insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, subscribed_at)
values ('97000000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000001',
  'https://fcm.googleapis.com/fcm/send/retimed-fixture', 'test', 'test', '2000-01-01');
insert into public.native_push_devices (id, user_id, token, environment, subscribed_at)
values ('97000000-0000-0000-0000-000000000007', '97000000-0000-0000-0000-000000000001',
  repeat('97', 32), 'development', '2000-01-01');

-- The second row was announced on one channel, both rows on the other.
insert into public.push_deliveries (subscription_id, event_id, sent_at) values
  ('97000000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000012', '2026-06-20T12:00Z'),
  ('97000000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000021', '2026-07-05T12:00Z');
insert into public.native_push_deliveries (device_id, event_id, sent_at) values
  ('97000000-0000-0000-0000-000000000007', '97000000-0000-0000-0000-000000000020', '2026-07-02T19:00Z'),
  ('97000000-0000-0000-0000-000000000007', '97000000-0000-0000-0000-000000000021', '2026-07-05T12:00Z');
insert into public.tracking_status_observations (observation_key, carrier, description_normalized, stage_source, chosen_stage, sample_event_id)
values (repeat('b', 64), 'correos-spain', 'prerregistrado', 'wording', 'registered', '97000000-0000-0000-0000-000000000023');

\ir ../migrations/20261006000000_merge_retimed_scans.sql
\ir ../migrations/20261006000000_merge_retimed_scans.sql

do $$
declare
  scan record;
begin
  if (select count(*) from public.tracking_events where package_id in (
      '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000003',
      '97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000005')
      and provider_event_id not like 'app:%') <> 17 then
    raise exception 'Retimed scan repair removed a separate scan or kept a second row';
  end if;
  if exists (select 1 from public.tracking_events where id in (
      '97000000-0000-0000-0000-000000000012', '97000000-0000-0000-0000-000000000021',
      '97000000-0000-0000-0000-000000000023', '97000000-0000-0000-0000-000000000025')) then
    raise exception 'Retimed scan repair kept a second row';
  end if;

  -- The notices keep their rows and take the Beijing instant and the identity the sync computes.
  if not exists (select 1 from public.tracking_events where id = '97000000-0000-0000-0000-000000000010'
      and occurred_at = '2026-06-09T23:40:16Z'::timestamptz and created_at = '2026-06-10T08:00Z'::timestamptz
      and provider_event_id = 'aliexpress:102f889856eafcbbec24db392154f6a996e93fef660c24ac2e7ee09d4832a13d'
      and raw_data = '{"time":"2026-06-10T07:40:16+08:00","instant":"2026-06-10T07:40:16+08:00","description":"Carrier update"}'::jsonb) then
    raise exception 'Retimed scan repair did not move a lone Cainiao notice';
  end if;
  if not exists (select 1 from public.tracking_events where id = '97000000-0000-0000-0000-000000000011'
      and occurred_at = '2026-06-11T00:00:00Z'::timestamptz and created_at = '2026-06-11T09:00Z'::timestamptz
      and provider_event_id = 'aliexpress:153763d1ee55ccb1f5db068645b13be85d2392b6aa1abcdfb447e884947b99f8'
      and raw_data->>'second' = 'true') then
    raise exception 'Retimed scan repair did not merge a Cainiao notice stored twice';
  end if;

  -- The first Correos row stored keeps its id and takes Correos' own scan.
  if not exists (select 1 from public.tracking_events where id = '97000000-0000-0000-0000-000000000020'
      and occurred_at = '2026-07-02T16:30:00Z'::timestamptz and created_at = '2026-07-02T19:00Z'::timestamptz
      and provider_event_id = 'correos-spain:summer-own' and description = 'En reparto' and location is null
      and raw_data->>'own' = 'true') then
    raise exception 'Retimed scan repair did not merge a summer Correos pair';
  end if;
  if not exists (select 1 from public.tracking_events where id = '97000000-0000-0000-0000-000000000022'
      and occurred_at = '2026-01-14T08:15:00Z'::timestamptz and provider_event_id = 'correos-spain:winter-own'
      and description = 'Prerregistrado') then
    raise exception 'Retimed scan repair did not merge a winter Correos pair';
  end if;
  if not exists (select 1 from public.tracking_events where id = '97000000-0000-0000-0000-000000000024'
      and occurred_at = '2026-07-03T09:00:00Z'::timestamptz and created_at = '2026-07-03T09:30Z'::timestamptz
      and provider_event_id = 'correos-spain:first-own' and description = 'Entregado') then
    raise exception 'Retimed scan repair did not keep the Correos row stored first';
  end if;

  -- Every row the repair has no evidence for is as it was.
  for scan in select * from (values
    (13, '2026-06-12T09:00:00Z', 'aliexpress:3f07f8f590dc10c9ea1ac0aec01fa17af97dcb79666608b1652fda33acdce976'),
    (14, '2026-06-09T06:00:14Z', 'aliexpress:77c5c2923337d1c03f32ef839270ff0707345aa8d9a53e4a6121cfed0f1f4e9e'),
    (15, '2026-06-13T10:00:00Z', 'aliexpress:taken-over'),
    (26, '2026-07-01T20:00:00Z', 'unknown:lone-copy'),
    (27, '2026-01-10T06:00:00Z', 'correos-spain:winter-two-hours-own'),
    (28, '2026-01-10T08:00:00Z', 'unknown:winter-two-hours-copy'),
    (30, '2026-07-02T08:00:00Z', 'unknown:real-instant-copy'),
    (31, '2026-07-02T08:00:00Z', 'correos-spain:real-instant-own'),
    (32, '2026-07-02T10:00:00Z', 'unknown:two-hours-later'),
    (40, '2026-07-02T12:00:00Z', 'unknown:ambiguous-copy'),
    (41, '2026-07-02T10:00:00Z', 'correos-spain:ambiguous-own-a'),
    (42, '2026-07-02T10:00:00Z', 'correos-spain:ambiguous-own-b')
  ) as untouched(id, occurred_at, provider_event_id) loop
    if not exists (select 1 from public.tracking_events
        where id = ('97000000-0000-0000-0000-' || lpad(scan.id::text, 12, '0'))::uuid
        and occurred_at = scan.occurred_at::timestamptz and provider_event_id = scan.provider_event_id) then
      raise exception 'Retimed scan repair changed row % without evidence', scan.id;
    end if;
  end loop;

  if not exists (select 1 from public.push_deliveries where subscription_id = '97000000-0000-0000-0000-000000000006'
      and event_id = '97000000-0000-0000-0000-000000000011' and sent_at = '2026-06-20T12:00Z'::timestamptz)
      or not exists (select 1 from public.push_deliveries where subscription_id = '97000000-0000-0000-0000-000000000006'
      and event_id = '97000000-0000-0000-0000-000000000020') then
    raise exception 'Retimed scan repair lost browser receipts';
  end if;
  if (select sent_at from public.native_push_deliveries where device_id = '97000000-0000-0000-0000-000000000007'
      and event_id = '97000000-0000-0000-0000-000000000020') <> '2026-07-02T19:00Z'::timestamptz then
    raise exception 'Retimed scan repair lost the earliest native receipt';
  end if;
  if (select sample_event_id from public.tracking_status_observations where observation_key = repeat('b', 64))
      <> '97000000-0000-0000-0000-000000000022'::uuid then
    raise exception 'Retimed scan repair lost an observation reference';
  end if;
  if exists (select 1 from public.pending_push_notifications where event_id in (
      '97000000-0000-0000-0000-000000000011', '97000000-0000-0000-0000-000000000020')) then
    raise exception 'Retimed scan repair queued a duplicate notification';
  end if;
end;
$$;
rollback;
