\set ON_ERROR_STOP on
begin;
set local role service_role;
create temporary table proofread_stage_cases (
  name text, carrier text, provider text, description text, old_stage text, expected text, raw boolean
);
insert into proofread_stage_cases values
  ('dhl-delivery', 'dhl', 'dhl', 'Delivery successful.', 'in_transit', 'delivered', true),
  ('missed', 'la-poste', 'la-poste', 'Nous sommes passés mais nous n''avons pu vous remettre votre colis. Il va être acheminé vers votre point de retrait.', 'in_transit', 'failed_attempt', true),
  -- Older rows kept no raw description.
  ('waiting', 'la-poste', 'la-poste', 'Votre Colissimo vous attend dans votre point de retrait. Le délai de retrait est de [days].', 'out_for_delivery', 'ready_for_pickup', false),
  ('countdown', 'mondial-relay', 'mondial-relay', '5 jours restants pour retirer le colis en Locker', 'in_transit', 'ready_for_pickup', true),
  ('drop-off', 'ups', 'ups', 'Drop-Off', 'in_transit', 'accepted', true),
  ('today', 'dpd-fr', 'dpd-fr', 'Le destinataire est informé par SMS de la livraison de son colis ce jour', 'in_transit', 'out_for_delivery', true),
  ('facility', 'fedex', 'unknown', 'At local FedEx facility', 'pending', 'in_transit', true),
  ('relay-notice', 'chronopost', 'unknown', 'Destinataire informé par SMS ou mail. Type du message : Le message de mise à disposition en point relais a été reçu par le destinataire. Point de livraison : [relay point]', 'pending', 'ready_for_pickup', true),
  ('data', 'unknown', 'unknown', 'Parcel Data Received', 'pending', 'registered', true);

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at, carrier_data)
select md5('proofread-' || name)::uuid, '10000000-0000-0000-0000-000000000001',
  'PROOF1' || upper(replace(name, '-', '')), carrier, old_stage, 'ok', now(),
  case when provider = 'unknown' then '{"tracking_provider":"ParcelsApp"}'::jsonb else '{}'::jsonb end
from proofread_stage_cases;
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
select md5('proofread-' || name)::uuid, old_stage, description, '2026-01-02T12:00:00Z',
  provider || ':' || name,
  case when raw then jsonb_build_object('description', description, 'stage', old_stage) else '{}'::jsonb end
from proofread_stage_cases;

-- Preserve a genuinely later delivery when only the older collection is repaired.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id)
values (md5('proofread-drop-off')::uuid, 'delivered', 'Delivered', '2026-01-03', 'ups:later-delivery');
update public.packages set current_stage = 'delivered' where id = md5('proofread-drop-off')::uuid;

-- Wrong provenance, rewritten descriptions, other stages and longer exact
-- wordings must remain unchanged.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
values
  (md5('proofread-drop-off')::uuid, 'in_transit', 'Drop-Off', '2026-01-01', 'app:control', '{"description":"Drop-Off"}'),
  (md5('proofread-drop-off')::uuid, 'in_transit', 'Drop-Off', '2026-01-01', 'dhl:other-carrier', '{"description":"Drop-Off"}'),
  (md5('proofread-drop-off')::uuid, 'in_transit', 'Drop-Off', '2026-01-01', 'ups:mismatch', '{"description":"Different"}'),
  (md5('proofread-drop-off')::uuid, 'delivered', 'Drop-Off', '2026-01-01', 'ups:other-stage', '{"description":"Drop-Off"}'),
  (md5('proofread-drop-off')::uuid, 'in_transit', 'Drop-Off at a service point', '2026-01-01', 'ups:longer', '{"description":"Drop-Off at a service point"}');

create temporary table proofread_events_before as select * from public.tracking_events;
create temporary table proofread_packages_before as select * from public.packages;
\ir ../migrations/20260924090000_repair_proofread_tracking_stages.sql

do $$
begin
  if exists (
    select 1 from proofread_stage_cases c
    left join public.tracking_events e on e.package_id = md5('proofread-' || c.name)::uuid
      and e.provider_event_id = c.provider || ':' || c.name
    where e.stage is distinct from c.expected
  ) then raise exception 'Missed proofread event repair'; end if;
  if exists (
    select 1 from proofread_stage_cases c
    join public.packages p on p.id = md5('proofread-' || c.name)::uuid
    where p.current_stage is distinct from case when c.name = 'drop-off' then 'delivered' else c.expected end
  ) then raise exception 'Latest repaired status was not selected correctly'; end if;
  if exists (
    select 1 from public.tracking_events e full join proofread_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and not exists (
        select 1 from proofread_stage_cases c where e.package_id = md5('proofread-' || c.name)::uuid
          and e.provider_event_id = c.provider || ':' || c.name
      ))
  ) then raise exception 'Changed unrelated events or original evidence'; end if;
  if exists (
    select 1 from public.packages p full join proofread_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
      or (p.current_stage is distinct from b.current_stage
        and not exists (select 1 from proofread_stage_cases c where p.id = md5('proofread-' || c.name)::uuid))
  ) then raise exception 'Changed unrelated package state'; end if;
end $$;
create temporary table proofread_after as select * from public.tracking_events;
\ir ../migrations/20260924090000_repair_proofread_tracking_stages.sql
do $$
begin
  if exists (
    (select * from public.tracking_events except all select * from proofread_after)
    union all (select * from proofread_after except all select * from public.tracking_events)
  ) then raise exception 'Repair is not idempotent'; end if;
end $$;
rollback;
