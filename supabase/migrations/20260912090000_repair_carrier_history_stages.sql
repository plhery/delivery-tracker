-- Repair observed classifier mistakes, including archived parcel histories.
-- Require carrier provenance and matching raw descriptions; the legacy REPORTED
-- summary predates raw payload storage. Keep raw evidence and event identities.
with stages(carrier, description, old_stage, stage) as (
  values
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
    ('ups', 'Your package is pending release from a Government Agency. We''ll notify the receiver or sender if information is needed.', 'delivered', 'customs')
), repaired as (
  update public.tracking_events as event
  set stage = stages.stage
  from stages, public.packages as package
  where package.id = event.package_id
    and package.carrier = stages.carrier
    and split_part(event.provider_event_id, ':', 1) = stages.carrier
    and event.description = stages.description
    and event.stage = stages.old_stage
    and (
      event.raw_data ->> 'description' = event.description
      or (stages.carrier = 'swiss-post' and event.description = 'REPORTED' and event.raw_data = '{}'::jsonb)
    )
  returning event.id, event.package_id, event.stage
), current_stages as (
  select affected.package_id, latest.stage
  from (select distinct package_id from repaired) as affected
  cross join lateral (
    -- Data-changing CTEs share a snapshot: overlay the repaired stages when
    -- selecting the same newest non-pending event used by the app and worker.
    select coalesce(repaired.stage, event.stage) as stage
    from public.tracking_events as event
    left join repaired on repaired.id = event.id
    where event.package_id = affected.package_id
      and coalesce(repaired.stage, event.stage) <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'],
        coalesce(repaired.stage, event.stage)) desc,
      event.id desc
    limit 1
  ) as latest
  left join lateral (
    select event.stage
    from public.tracking_events as event
    where event.package_id = affected.package_id and event.stage <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'], event.stage) desc,
      event.id desc
    limit 1
  ) as previous on true
  where latest.stage is distinct from previous.stage
)
update public.packages as package
set current_stage = current_stages.stage
from current_stages
where package.id = current_stages.package_id
  and package.current_stage is distinct from current_stages.stage;
