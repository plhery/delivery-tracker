\set ON_ERROR_STOP on
begin;
set local role service_role;
create temporary table refined_stage_cases (
  name text, provider text, description text, old_stage text, expected text
);
insert into refined_stage_cases values
  ('0', 'india-post', 'Out of Export Customs', 'customs', 'in_transit'),
  ('1', 'la-poste', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.', 'out_for_delivery', 'in_transit'),
  ('2', 'posti', 'Item delivered to the recipient.', 'pending', 'delivered'),
  ('3', 'posti', 'Item has arrived to destination country', 'pending', 'in_transit'),
  ('4', 'posti', 'Item has been registered', 'pending', 'in_transit'),
  ('5', 'posti', 'Item is on the way to the recipient', 'pending', 'in_transit'),
  ('6', 'posti', 'Item is ready for delivery in destination country', 'pending', 'in_transit'),
  ('7', 'postlogistics', 'Chargement pour livraison', 'in_transit', 'out_for_delivery'),
  ('8', 'postlogistics', 'Réception des marchandises Poste', 'in_transit', 'accepted'),
  ('9', 'postlogistics', 'réception données Poste', 'in_transit', 'registered'),
  ('10', 'spring-gds', 'The item has arrived at the domestic sorting centre', 'accepted', 'in_transit'),
  ('11', 'spring-gds', 'The item is at the local sorting centre', 'accepted', 'in_transit'),
  ('12', 'spring-gds', 'The item is released by customs', 'customs', 'in_transit'),
  ('13', 'tnt', 'Customs has released the goods', 'customs', 'in_transit'),
  ('14', 'unknown', 'Item accepted from transport', 'accepted', 'in_transit'),
  ('15', 'unknown', 'Item has been registered', 'pending', 'in_transit'),
  ('16', 'unknown', 'Item in process in office of exchange', 'pending', 'in_transit'),
  ('17', 'unknown', 'Item received for transport', 'pending', 'accepted'),
  ('18', 'unknown', 'Load Vehicle', 'pending', 'in_transit'),
  ('19', 'unknown', 'Scan Ok Gateway', 'pending', 'in_transit'),
  ('20', 'unknown', 'The item is on its way to the destination country.', 'pending', 'in_transit'),
  ('21', 'unknown', 'Your package has been dropped off by the sender at our postal partner in its country of origin.', 'pending', 'accepted');

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at)
select md5('refined-' || name)::uuid, '10000000-0000-0000-0000-000000000001',
  'REFINED1' || name, 'unknown', old_stage, 'ok', now()
from refined_stage_cases;
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
select md5('refined-' || name)::uuid, old_stage, description, '2026-01-02T12:00:00Z',
  provider || ':' || name, jsonb_build_object('description', description, 'stage', old_stage)
from refined_stage_cases;

-- The explanatory suffix does not change the meaning of Posti's handling label.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
values (md5('refined-4')::uuid, 'pending',
  'Item has been registered The item can be registered several times during delivery.',
  '2026-01-01', 'posti:reason', '{}');

-- Repairing a past customs scan cannot undo a later delivery.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id)
values (md5('refined-0')::uuid, 'delivered', 'Delivered', '2026-01-03', 'india-post:later-delivery');
update public.packages set current_stage = 'delivered' where id = md5('refined-0')::uuid;

-- Wrong provenance, changed evidence, other stages and electronic registration
-- must not match the handling refinements.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
values
  (md5('refined-4')::uuid, 'pending', 'Item has been registered', '2026-01-01', 'app:control', '{}'),
  (md5('refined-4')::uuid, 'pending', 'Item has been registered', '2026-01-01', 'dpd:control', '{}'),
  (md5('refined-4')::uuid, 'pending', 'Item has been registered', '2026-01-01', 'posti:changed', '{"description":"Different"}'),
  (md5('refined-4')::uuid, 'registered', 'Item has been registered', '2026-01-01', 'posti:other-stage', '{}'),
  (md5('refined-4')::uuid, 'pending', 'Item has been registered electronically', '2026-01-01', 'posti:electronic', '{}'),
  (md5('refined-4')::uuid, 'pending', 'Item has been registered. Electronic notification only.', '2026-01-01', 'posti:other-suffix', '{}');

create temporary table refined_events_before as select * from public.tracking_events;
create temporary table refined_packages_before as select * from public.packages;
\ir ../migrations/20261004200000_tracking_stage_refinements.sql

do $$
begin
  if exists (
    select 1 from refined_stage_cases c
    left join public.tracking_events e on e.package_id = md5('refined-' || c.name)::uuid
      and e.provider_event_id = c.provider || ':' || c.name
    where e.stage is distinct from c.expected
  ) then raise exception 'Missed refined milestone repair'; end if;
  if (select stage from public.tracking_events where provider_event_id = 'posti:reason') <> 'in_transit'
    then raise exception 'Missed explanatory suffix'; end if;
  if exists (
    select 1 from refined_stage_cases c join public.packages p on p.id = md5('refined-' || c.name)::uuid
    where p.current_stage is distinct from case when c.name = '0' then 'delivered' else c.expected end
  ) then raise exception 'Selected the wrong current milestone'; end if;
  if exists (
    select 1 from public.tracking_events e full join refined_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and e.provider_event_id <> 'posti:reason' and not exists (
        select 1 from refined_stage_cases c where e.package_id = md5('refined-' || c.name)::uuid
          and e.provider_event_id = c.provider || ':' || c.name
      ))
  ) then raise exception 'Changed unrelated events or original evidence'; end if;
  if exists (
    select 1 from public.packages p full join refined_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
      or (p.current_stage is distinct from b.current_stage and not exists (
        select 1 from refined_stage_cases c where p.id = md5('refined-' || c.name)::uuid
      ))
  ) then raise exception 'Changed unrelated package state'; end if;
end $$;
create temporary table refined_events_after as select * from public.tracking_events;
create temporary table refined_packages_after as select * from public.packages;
\ir ../migrations/20261004200000_tracking_stage_refinements.sql

do $$
begin
  if exists (
    (select * from public.tracking_events except all select * from refined_events_after)
    union all (select * from refined_events_after except all select * from public.tracking_events)
  ) or exists (
    (select * from public.packages except all select * from refined_packages_after)
    union all (select * from refined_packages_after except all select * from public.packages)
  ) then raise exception 'Repair is not idempotent'; end if;
end $$;
rollback;
