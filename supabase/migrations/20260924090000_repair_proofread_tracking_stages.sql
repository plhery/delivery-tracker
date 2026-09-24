-- Correct stages that earlier wording rules and carrier maps saved, using the
-- stage the current rules assign to the same wording. Raw evidence, event
-- identities, timestamps and notification receipts are unchanged. Delivered
-- and returned parcels no longer refresh, so their histories would otherwise
-- keep the old stages. A row is repaired only when its provenance, wording and
-- old stage all match.
with stages(provider, description, old_stage, stage, prefix_match) as (
  values
    ('chronopost', 'Colis mis à disposition au point de retrait', 'in_transit', 'ready_for_pickup', false),
    ('dhl', 'Delivery successful.', 'in_transit', 'delivered', false),
    ('dpd-fr', 'Le destinataire est informé par SMS de la livraison de son colis ce jour', 'in_transit', 'out_for_delivery', false),
    ('dpd-fr', 'Le destinataire est informé par e-mail de la livraison de son colis ce jour', 'in_transit', 'out_for_delivery', false),
    ('la-poste', 'Les formalités import/export sont en cours sur votre colis.', 'in_transit', 'customs', false),
    ('la-poste', 'Nous sommes passés mais nous n''avons pu vous remettre votre colis. Il va être acheminé vers votre point de retrait.', 'in_transit', 'failed_attempt', false),
    ('la-poste', 'Votre Colissimo vous attend dans votre point de retrait.', 'out_for_delivery', 'ready_for_pickup', true),
    ('la-poste', 'Votre colis est disponible dans votre point de retrait', 'out_for_delivery', 'ready_for_pickup', true),
    ('mondial-relay', 'Colis en préparation chez l''expéditeur', 'in_transit', 'registered', false),
    ('mondial-relay', '5 jours restants pour retirer le colis en Locker', 'in_transit', 'ready_for_pickup', false),
    ('ups', 'Drop-Off', 'in_transit', 'accepted', false),
    ('ups', 'Pickup Scan', 'in_transit', 'accepted', false),
    ('ups', 'The UPS Access Point™ location has prepared the package for return to UPS or pickup by UPS.', 'in_transit', 'accepted', false),
    ('unknown', 'Les formalités import/export sont en cours sur votre colis.', 'pending', 'customs', false),
    ('unknown', 'At local FedEx facility', 'pending', 'in_transit', false),
    ('unknown', 'Left FedEx origin facility', 'pending', 'in_transit', false),
    ('unknown', 'Delivery option requested', 'pending', 'in_transit', false),
    ('unknown', 'Parcel is leaving Airport, Parcel Leaving Port', 'pending', 'in_transit', false),
    ('unknown', 'Parcel Data Received', 'pending', 'registered', false),
    -- The notice goes on to name the relay point; match its fixed opening only.
    ('unknown', 'Destinataire informé par SMS ou mail. Type du message : Le message de mise à disposition en point relais a été reçu par le destinataire.', 'pending', 'ready_for_pickup', true)
), repaired as (
  update public.tracking_events as event
  set stage = stages.stage
  from stages
  where split_part(event.provider_event_id, ':', 1) = stages.provider
    and event.stage = stages.old_stage
    and case when stages.prefix_match then starts_with(event.description, stages.description)
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
