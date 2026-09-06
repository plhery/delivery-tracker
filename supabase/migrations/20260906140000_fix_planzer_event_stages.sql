-- Older Quickpac/Planzer milestones inherited the shipment's final status.
-- Repair only identified carrier events with their original raw description.
-- Preserve raw evidence, event identity/timestamps, package state and notifications.
with stages(description, stage) as (
  values
    ('Recorded', 'registered'),
    ('Transferred', 'in_transit'),
    ('Shipment on the way', 'in_transit'),
    ('In delivery', 'out_for_delivery'),
    ('Shipment out for delivery', 'out_for_delivery'),
    ('Delivered', 'delivered'),
    ('Shipment delivered', 'delivered'),
    ('Shipped', 'delivered'),
    ('Not delivered', 'failed_attempt')
)
update public.tracking_events as event
set stage = stages.stage
from stages, public.packages as package
where package.id = event.package_id
  and package.carrier in ('quickpac', 'planzer')
  and split_part(event.provider_event_id, ':', 1) in ('quickpac', 'planzer')
  and event.description = stages.description
  and event.raw_data ->> 'description' = event.description
  and event.stage is distinct from stages.stage;
