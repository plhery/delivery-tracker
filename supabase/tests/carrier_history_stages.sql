\set ON_ERROR_STOP on
begin;
set local role service_role;
create temporary table history_stage_cases (carrier text, description text, old_stage text, stage text);
insert into history_stage_cases values
    ('gls-de', 'The parcel was released by customs.', 'customs', 'in_transit'),
    ('gls-ch', 'The parcel was released by customs.', 'customs', 'in_transit'),
    ('gls-de', 'The parcel was handed over to GLS.', 'in_transit', 'accepted'),
    ('gls-ch', 'The parcel was handed over to GLS.', 'in_transit', 'accepted'),
    ('dhl', 'The customs clearance process for import into the destination country/region has been completed. Please find more information here.', 'customs', 'in_transit'),
    ('dhl', 'The shipment will be transported to the destination country/destination area and, from there, handed over to the delivery organization.', 'accepted', 'in_transit'),
    ('swiss-post', 'Sorting - forwarding', 'out_for_delivery', 'in_transit'),
    ('swiss-post', 'REPORTED', 'in_transit', 'registered'),
    ('swiss-post', 'Deposited in the MyPost24 machine', 'delivered', 'ready_for_pickup'),
    ('quickpac', 'Paket wurde elektronisch angekündigt', 'pending', 'registered'),
    ('ups', 'Shipper created a label, UPS has not received the package yet.', 'delivered', 'registered'),
    ('ups', 'Import Scan', 'delivered', 'in_transit'),
    ('ups', 'Your package is on the way', 'delivered', 'in_transit'),
    ('ups', 'Delivery will be delayed by one business day.', 'delivered', 'in_transit'),
    ('ups', 'Your package has been released by a government agency.', 'delivered', 'in_transit'),
    ('ups', 'Your package is pending release from a Government Agency. We''ll notify the receiver or sender if information is needed.', 'delivered', 'customs');

insert into public.packages (id, user_id, tracking_number, carrier, current_stage, sync_status, archived_at)
select md5('history-repair-' || carrier)::uuid, '10000000-0000-0000-0000-000000000001',
  'HISTORY1' || upper(replace(carrier, '-', '')), carrier, 'delivered', 'ok', now()
from history_stage_cases group by carrier;

insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
select md5('history-repair-' || carrier)::uuid, old_stage, description,
  case when stage = 'ready_for_pickup' then '2026-09-02T12:00:00Z'::timestamptz else '2026-09-01T12:00:00Z'::timestamptz end,
  carrier || ':' || description,
  case when description = 'REPORTED' then '{}'::jsonb else jsonb_build_object('description', description, 'stage', old_stage) end
from history_stage_cases;

-- Other parcels have a later, real delivery; the locker has not been collected.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id)
select md5('history-repair-' || carrier)::uuid, 'delivered', 'Delivered', '2026-09-03T12:00:00Z', carrier || ':delivery'
from history_stage_cases where carrier <> 'swiss-post' group by carrier;

-- Similar text from an app event, another carrier or mismatched raw evidence must stay untouched.
insert into public.tracking_events (package_id, stage, description, occurred_at, provider_event_id, raw_data)
values
  (md5('history-repair-ups')::uuid, 'delivered', 'Import Scan', '2026-08-01', 'app:control', '{"description":"Import Scan"}'),
  (md5('history-repair-ups')::uuid, 'delivered', 'Import Scan', '2026-08-01', 'dhl:control', '{"description":"Import Scan"}'),
  (md5('history-repair-ups')::uuid, 'delivered', 'Import Scan', '2026-08-01', 'ups:no-raw', '{}'),
  (md5('history-repair-ups')::uuid, 'delivered', 'Import Scan', '2026-08-01', 'ups:mismatch', '{"description":"Other scan"}');

create temporary table history_events_before as select * from public.tracking_events;
create temporary table history_packages_before as select * from public.packages;
create temporary view history_notification_rows as
select 'web' as channel, to_jsonb(n) as value from public.push_deliveries n
union all select 'native', to_jsonb(n) from public.native_push_deliveries n
union all select 'live', to_jsonb(n) from public.live_activity_event_deliveries n;
create temporary table history_notifications_before as select * from history_notification_rows;

\ir ../migrations/20260912090000_repair_carrier_history_stages.sql

do $$
begin
  if exists (
    select 1 from history_stage_cases c
    left join public.tracking_events e on e.package_id = md5('history-repair-' || c.carrier)::uuid
      and e.provider_event_id = c.carrier || ':' || c.description
    where e.stage is distinct from c.stage
  ) then raise exception 'Carrier history repair missed a known classification'; end if;
  if exists (
    select 1 from public.tracking_events e full join history_events_before b using (id)
    where (to_jsonb(e) - 'stage') is distinct from (to_jsonb(b) - 'stage')
      or (e.stage is distinct from b.stage and not exists (
        select 1 from history_stage_cases c where e.package_id = md5('history-repair-' || c.carrier)::uuid
          and e.provider_event_id = c.carrier || ':' || c.description
      ))
  ) then raise exception 'Repair changed unrelated events or raw evidence'; end if;
  if exists (
    select 1 from public.packages p full join history_packages_before b using (id)
    where (to_jsonb(p) - 'current_stage') is distinct from (to_jsonb(b) - 'current_stage')
      or (p.current_stage is distinct from b.current_stage
        and not (p.id = md5('history-repair-swiss-post')::uuid and p.current_stage = 'ready_for_pickup'))
  ) then raise exception 'Repair changed unrelated package state'; end if;
  if (select current_stage from public.packages where id = md5('history-repair-swiss-post')::uuid) <> 'ready_for_pickup'
    then raise exception 'Latest corrected stage was not applied to package'; end if;
  if exists (
    (select * from history_notification_rows except all select * from history_notifications_before)
    union all
    (select * from history_notifications_before except all select * from history_notification_rows)
  ) then raise exception 'Repair changed notification deliveries'; end if;
end;
$$;

create temporary table history_events_after as select id, ctid as row_location, to_jsonb(e) as value from public.tracking_events e;
create temporary table history_packages_after as select id, ctid as row_location, to_jsonb(p) as value from public.packages p;
\ir ../migrations/20260912090000_repair_carrier_history_stages.sql

do $$
begin
  if exists (
    select 1 from public.tracking_events e full join history_events_after b using (id)
    where to_jsonb(e) is distinct from b.value or e.ctid is distinct from b.row_location
  ) or exists (
    select 1 from public.packages p full join history_packages_after b using (id)
    where to_jsonb(p) is distinct from b.value or p.ctid is distinct from b.row_location
  ) then raise exception 'History repair is not idempotent'; end if;
end;
$$;
rollback;
select 'Carrier history repair assertions passed' as result;
