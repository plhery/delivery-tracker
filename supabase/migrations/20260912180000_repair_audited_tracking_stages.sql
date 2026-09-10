-- Correct the September history audit findings without changing raw evidence,
-- event identities, timestamps or notification receipts. Provenance follows the
-- event, including histories retained after a carrier handoff.
with stages(provider, description, old_stage, stage, prefix_match) as (
  values
    ('dhl', 'Being delivered.', 'in_transit', 'out_for_delivery', false),
    ('dhl', 'The shipment has been loaded onto the delivery vehicle. Delivery is expected to take place today.', 'in_transit', 'out_for_delivery', false),
    ('dhl', 'Pick-up was successful.', 'in_transit', 'accepted', false),
    ('dhl-ecommerce', 'CLOSE BAG', 'pending', 'in_transit', false),
    ('dhl-ecommerce', 'SCANNED INTO SACK/CONTAINER', 'pending', 'in_transit', false),
    ('la-poste', 'Votre colis n''a pas pu vous être remis. Il sera mis en livraison demain (hors dimanche et jours fériés).', 'in_transit', 'failed_attempt', false),
    ('unknown', 'The shipment will be transported to the destination country/destination area and, from there, handed over to the delivery organization', 'accepted', 'in_transit', false),
    ('unknown', 'The instruction data for this shipment have been provided by the sender to DHL electronically', 'pending', 'registered', false),
    ('unknown', 'Package received at DHL eCommerce distribution center', 'pending', 'accepted', false),
    ('unknown', 'Pick-up was successful.', 'pending', 'accepted', false),
    ('unknown', 'Clearance processing completed - Import', 'customs', 'in_transit', false),
    ('unknown', 'Processing completed at origin', 'pending', 'in_transit', false),
    ('unknown', 'Colis en préparation chez l''expéditeur', 'pending', 'registered', false),
    ('unknown', 'Prise en charge de votre colis sur notre site logistique de ', 'pending', 'accepted', true)
), repaired as (
  update public.tracking_events as event
  set stage = stages.stage
  from stages, public.packages as package
  where package.id = event.package_id
    and split_part(event.provider_event_id, ':', 1) = stages.provider
    and (
      (not stages.prefix_match and event.description = stages.description)
      or (stages.prefix_match and starts_with(event.description, stages.description)
          and right(event.description, 1) = '.')
    )
    and event.stage = stages.old_stage
    and event.raw_data ->> 'description' = event.description
    and (stages.provider <> 'unknown' or (
      package.carrier_data ->> 'tracking_provider' in ('ParcelsApp', '17TRACK', 'Ship24', 'Postal Ninja')
    ))
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
