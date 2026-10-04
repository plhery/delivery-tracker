-- Refine stored carrier milestones after overloaded categories and unmapped
-- postal labels have been resolved. Only the original wording, provenance and
-- old stage select a row; raw evidence and event identities remain intact.
-- Recompute a parcel's current stage only when its newest milestone changes.
with stages(provider, description, old_stage, stage, prefix_match) as (
  values
    ('india-post', 'Out of Export Customs', 'customs', 'in_transit', false),
    ('la-poste', 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.', 'out_for_delivery', 'in_transit', false),
    ('posti', 'Item delivered to the recipient.', 'pending', 'delivered', false),
    ('posti', 'Item has arrived to destination country', 'pending', 'in_transit', true),
    ('posti', 'Item has been registered', 'pending', 'in_transit', true),
    ('posti', 'Item is on the way to the recipient', 'pending', 'in_transit', false),
    ('posti', 'Item is ready for delivery in destination country', 'pending', 'in_transit', false),
    ('postlogistics', 'Chargement pour livraison', 'in_transit', 'out_for_delivery', false),
    ('postlogistics', 'Réception des marchandises Poste', 'in_transit', 'accepted', false),
    ('postlogistics', 'réception données Poste', 'in_transit', 'registered', false),
    ('spring-gds', 'The item has arrived at the domestic sorting centre', 'accepted', 'in_transit', false),
    ('spring-gds', 'The item is at the local sorting centre', 'accepted', 'in_transit', false),
    ('spring-gds', 'The item is released by customs', 'customs', 'in_transit', false),
    ('tnt', 'Customs has released the goods', 'customs', 'in_transit', false),
    ('unknown', 'Item accepted from transport', 'accepted', 'in_transit', false),
    ('unknown', 'Item has been registered', 'pending', 'in_transit', true),
    ('unknown', 'Item in process in office of exchange', 'pending', 'in_transit', true),
    ('unknown', 'Item received for transport', 'pending', 'accepted', false),
    ('unknown', 'Load Vehicle', 'pending', 'in_transit', false),
    ('unknown', 'Scan Ok Gateway', 'pending', 'in_transit', false),
    ('unknown', 'The item is on its way to the destination country.', 'pending', 'in_transit', false),
    ('unknown', 'Your package has been dropped off by the sender at our postal partner in its country of origin.', 'pending', 'accepted', false)
), repaired as (
  update public.tracking_events as event
  set stage = stages.stage
  from stages
  where split_part(event.provider_event_id, ':', 1) = stages.provider
    and event.stage = stages.old_stage
    and case when stages.prefix_match then event.description = stages.description
      or event.description = stages.description || '.'
      or starts_with(event.description, stages.description || ' The item ')
      or starts_with(event.description, stages.description || '. The item ')
      else event.description = stages.description end
    -- Older rows kept no raw description; a present one must be the original.
    and coalesce(event.raw_data ->> 'description', event.description) = event.description
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
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'],
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
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'], event.stage) desc,
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
