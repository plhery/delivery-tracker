\set ON_ERROR_STOP on

begin;
set local role service_role;

insert into public.packages (
  id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at
) values
  ('96000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'PLANZERSTAGES1', 'quickpac', 'delivered', 'ok', null),
  ('96000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'PLANZERSTAGES2', 'planzer', 'delivered', 'ok', now()),
  ('96000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'PLANZERSTAGES3', 'swiss-post', 'delivered', 'ok', null);

create temporary table expected_planzer_stages (description text, stage text);
insert into expected_planzer_stages values
  ('Recorded', 'registered'),
  ('Transferred', 'in_transit'),
  ('Shipment on the way', 'in_transit'),
  ('In delivery', 'out_for_delivery'),
  ('Shipment out for delivery', 'out_for_delivery'),
  ('Delivered', 'delivered'),
  ('Shipment delivered', 'delivered'),
  ('Shipped', 'delivered'),
  ('Not delivered', 'failed_attempt');

insert into public.tracking_events (
  package_id, stage, description, occurred_at, provider_event_id, raw_data
)
select package.id, 'delivered', expected.description, '2026-09-01T12:00:00Z',
  package.carrier || ':' || expected.description,
  jsonb_build_object('description', expected.description, 'time', '2026-09-01T12:00:00Z')
from public.packages as package
cross join expected_planzer_stages as expected
where package.tracking_number like 'PLANZERSTAGES%';

-- Same text without carrier provenance, or without matching raw evidence, is not enough.
insert into public.tracking_events (
  package_id, stage, description, provider_event_id, raw_data
) values
  ('96000000-0000-0000-0000-000000000001', 'delivered', 'Recorded', 'app:control', '{"description":"Recorded"}'),
  ('96000000-0000-0000-0000-000000000001', 'delivered', 'Recorded', 'swiss-post:control', '{"description":"Recorded"}'),
  ('96000000-0000-0000-0000-000000000001', 'delivered', 'Recorded', 'quickpac:no-raw', '{}'),
  ('96000000-0000-0000-0000-000000000001', 'delivered', 'Recorded', 'quickpac:mismatch', '{"description":"Unrelated"}'),
  ('96000000-0000-0000-0000-000000000003', 'delivered', 'Recorded', 'quickpac:other-carrier', '{"description":"Recorded"}');

create temporary table packages_before_planzer_repair as select * from public.packages;
create temporary table events_before_planzer_repair as select * from public.tracking_events;

\ir ../migrations/20260906140000_fix_planzer_event_stages.sql

do $$
begin
  if (
    select count(*) from public.tracking_events as event
    join public.packages as package on package.id = event.package_id
    join expected_planzer_stages as expected on event.description = expected.description
    where package.tracking_number in ('PLANZERSTAGES1', 'PLANZERSTAGES2')
      and event.provider_event_id = package.carrier || ':' || expected.description
      and event.stage = expected.stage
  ) <> 18 then
    raise exception 'Quickpac/Planzer event stages were not repaired (including archived parcels)';
  end if;

  if exists (
    select 1 from public.tracking_events as event
    full join events_before_planzer_repair as original on original.id = event.id
    where (to_jsonb(event) - 'stage') is distinct from (to_jsonb(original) - 'stage')
  ) then
    raise exception 'Planzer repair changed raw evidence, event identity or other event metadata';
  end if;

  if exists (
    select 1 from public.tracking_events as event
    join events_before_planzer_repair as original on original.id = event.id
    where event.stage is distinct from original.stage
      and not (
        event.package_id in ('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002')
        and event.provider_event_id in (
          select carrier || ':' || description
          from expected_planzer_stages cross join (values ('quickpac'), ('planzer')) as carriers(carrier)
        )
      )
  ) then
    raise exception 'Planzer repair changed unrelated or insufficiently evidenced events';
  end if;

  if exists (
    select 1 from public.packages as package
    full join packages_before_planzer_repair as original on original.id = package.id
    where to_jsonb(package) is distinct from to_jsonb(original)
  ) then
    raise exception 'Planzer repair changed package state';
  end if;
end;
$$;

create temporary table events_after_planzer_repair as
select id, ctid as row_location, to_jsonb(event) as value from public.tracking_events as event;

\ir ../migrations/20260906140000_fix_planzer_event_stages.sql

do $$
begin
  if exists (
    select 1 from public.tracking_events as event
    full join events_after_planzer_repair as original on original.id = event.id
    where to_jsonb(event) is distinct from original.value
      or event.ctid is distinct from original.row_location
  ) then
    raise exception 'Planzer repair is not idempotent';
  end if;
end;
$$;

rollback;
select 'Quickpac/Planzer event stage repair assertions passed' as result;
