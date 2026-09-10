\set ON_ERROR_STOP on
begin;
set local role service_role;
create temporary table audited_stage_cases (
  name text, carrier text, provider text, description text, old_stage text, expected text
);
insert into audited_stage_cases values
  ('being-delivered', 'dhl', 'dhl', 'Being delivered.', 'in_transit', 'out_for_delivery'),
  ('vehicle-handoff', 'swiss-post', 'dhl', 'The shipment has been loaded onto the delivery vehicle. Delivery is expected to take place today.', 'in_transit', 'out_for_delivery'),
  ('collected', 'dhl', 'dhl', 'Pick-up was successful.', 'in_transit', 'accepted'),
  ('bag', 'dhl-ecommerce', 'dhl-ecommerce', 'CLOSE BAG', 'pending', 'in_transit'),
  ('sack', 'dhl-ecommerce', 'dhl-ecommerce', 'SCANNED INTO SACK/CONTAINER', 'pending', 'in_transit'),
  ('failed', 'la-poste', 'la-poste', 'Votre colis n''a pas pu vous être remis. Il sera mis en livraison demain (hors dimanche et jours fériés).', 'in_transit', 'failed_attempt'),
  ('forwarding', 'dhl', 'unknown', 'The shipment will be transported to the destination country/destination area and, from there, handed over to the delivery organization', 'accepted', 'in_transit'),
  ('electronic', 'dhl', 'unknown', 'The instruction data for this shipment have been provided by the sender to DHL electronically', 'pending', 'registered'),
  ('ecommerce-received', 'dhl-ecommerce', 'unknown', 'Package received at DHL eCommerce distribution center', 'pending', 'accepted'),
  ('universal-collected', 'dhl', 'unknown', 'Pick-up was successful.', 'pending', 'accepted'),
  ('clearance-completed', 'dhl-ecommerce', 'unknown', 'Clearance processing completed - Import', 'customs', 'in_transit'),
  ('origin-processed', 'dhl-ecommerce', 'unknown', 'Processing completed at origin', 'pending', 'in_transit'),
  ('preadvice', 'mondial-relay', 'unknown', 'Colis en préparation chez l''expéditeur', 'pending', 'registered'),
  ('accepted', 'mondial-relay', 'unknown', 'Prise en charge de votre colis sur notre site logistique de [location].', 'pending', 'accepted');

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at, carrier_data)
select md5('audited-' || name)::uuid, '10000000-0000-0000-0000-000000000001',
  'AUDIT1' || upper(replace(name, '-', '')), carrier, old_stage, 'ok', now(),
  case when provider = 'unknown' then '{"tracking_provider":"ParcelsApp"}'::jsonb else '{}'::jsonb end
from audited_stage_cases;
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
select md5('audited-' || name)::uuid, old_stage, description, '2026-01-02T12:00:00Z',
  provider || ':' || name, jsonb_build_object('description', description, 'stage', old_stage)
from audited_stage_cases;

-- Preserve a genuinely later delivery when only the older collection is repaired.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id)
values (md5('audited-collected')::uuid, 'delivered', 'Delivered', '2026-01-03', 'dhl:later-delivery');
update public.packages set current_stage = 'delivered' where id = md5('audited-collected')::uuid;

-- Wrong provenance and missing/mismatched raw evidence must remain unchanged.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
values
  (md5('audited-bag')::uuid, 'pending', 'CLOSE BAG', '2026-01-01', 'app:control', '{"description":"CLOSE BAG"}'),
  (md5('audited-bag')::uuid, 'pending', 'CLOSE BAG', '2026-01-01', 'dhl-ecommerce:no-raw', '{}'),
  (md5('audited-bag')::uuid, 'pending', 'CLOSE BAG', '2026-01-01', 'dhl-ecommerce:mismatch', '{"description":"Different"}');

create temporary table audited_events_before as select * from public.tracking_events;
create temporary table audited_packages_before as select * from public.packages;
\ir ../migrations/20260912180000_repair_audited_tracking_stages.sql

do $$
begin
  if exists (
    select 1 from audited_stage_cases c
    left join public.tracking_events e on e.package_id = md5('audited-' || c.name)::uuid
      and e.provider_event_id = c.provider || ':' || c.name
    where e.stage is distinct from c.expected
  ) then raise exception 'Missed audited event repair'; end if;
  if exists (
    select 1 from audited_stage_cases c
    join public.packages p on p.id = md5('audited-' || c.name)::uuid
    where p.current_stage is distinct from case when c.name = 'collected' then 'delivered' else c.expected end
  ) then raise exception 'Latest repaired status was not selected correctly'; end if;
  if exists (
    select 1 from public.tracking_events e full join audited_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and not exists (
        select 1 from audited_stage_cases c where e.package_id = md5('audited-' || c.name)::uuid
          and e.provider_event_id = c.provider || ':' || c.name
      ))
  ) then raise exception 'Changed unrelated events or original evidence'; end if;
  if exists (
    select 1 from public.packages p full join audited_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
      or (p.current_stage is distinct from b.current_stage
        and not exists (select 1 from audited_stage_cases c where p.id = md5('audited-' || c.name)::uuid))
  ) then raise exception 'Changed unrelated package state'; end if;
end $$;
create temporary table audited_after as select * from public.tracking_events;
\ir ../migrations/20260912180000_repair_audited_tracking_stages.sql
do $$
begin
  if exists (
    (select * from public.tracking_events except all select * from audited_after)
    union all (select * from audited_after except all select * from public.tracking_events)
  ) then raise exception 'Repair is not idempotent'; end if;
end $$;
rollback;
