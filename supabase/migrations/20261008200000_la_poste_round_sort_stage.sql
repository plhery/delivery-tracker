-- La Poste's DISTOU/MD1 is out for delivery for letters as well as parcels. It reads
-- "Votre colis est sur son site de distribution. Nous le préparons pour le mettre en
-- livraison." for a parcel and "Votre envoi ..." for a tracked letter, and both are the
-- sort into the morning's round: the delivery or a failed attempt follows the same day
-- with no scan between, and La Poste sends no other round scan.
-- 20261004200000_tracking_stage_refinements.sql moved the letter wording to in transit
-- while the parcel wording stayed out for delivery; the scraper now stages both out for
-- delivery.
--
-- A parcel still synced restages its rows itself; this repairs the rest. A row matches on
-- its carrier, old stage, the stage and provenance the scraper declared, its code and its
-- original wording, and keeps its raw evidence and identity. No review observation
-- samples it: a carrier map staged it. The scan moves between stages an account can
-- switch off, so every subscription that could have been told gets a receipt and none
-- announces an old scan. A parcel's stage moves only where its newest scan set it.
do $$
begin
  create temporary table restaged_scans as
  select event.id, event.package_id, event.created_at, event.stage as old_stage,
    'out_for_delivery'::text as stage
  from public.tracking_events event
  where split_part(event.provider_event_id, ':', 1) = 'la-poste'
    and event.stage = 'in_transit'
    -- Declared out for delivery before the scraper held the letter wording back, in
    -- transit while it did.
    and event.raw_data->>'stage' in ('out_for_delivery', 'in_transit')
    and coalesce(event.raw_data->>'stage_source', 'carrier_map') = 'carrier_map'
    and event.raw_data->>'provider_code' = 'DISTOU/MD1'
    and event.raw_data->>'description' = event.description
    and event.description = 'Votre envoi est sur son site de distribution. Nous le préparons pour le mettre en livraison.';

  update public.tracking_events event set stage = scan.stage
  from restaged_scans scan where event.id = scan.id;

  insert into public.push_deliveries (subscription_id, event_id)
  select subscription.id, scan.id
  from restaged_scans scan
  join public.packages parcel on parcel.id = scan.package_id
  join public.push_subscriptions subscription on subscription.user_id = parcel.user_id
    and subscription.subscribed_at < scan.created_at
  on conflict (subscription_id, event_id) do nothing;
  insert into public.native_push_deliveries (device_id, event_id)
  select device.id, scan.id
  from restaged_scans scan
  join public.packages parcel on parcel.id = scan.package_id
  join public.native_push_devices device on device.user_id = parcel.user_id
    and device.subscribed_at < scan.created_at
  on conflict (device_id, event_id) do nothing;

  -- The newest non-pending scan, as the app and worker select it, before and after.
  update public.packages parcel set current_stage = latest.stage
  from (select distinct package_id from restaged_scans) affected
  cross join lateral (
    select event.stage from public.tracking_events event
    where event.package_id = affected.package_id and event.stage <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'], event.stage) desc,
      event.id desc
    limit 1
  ) latest
  cross join lateral (
    select coalesce(scan.old_stage, event.stage) as stage
    from public.tracking_events event left join restaged_scans scan on scan.id = event.id
    where event.package_id = affected.package_id and coalesce(scan.old_stage, event.stage) <> 'pending'
    order by event.occurred_at desc,
      array_position(array['pending', 'registered', 'accepted', 'in_transit', 'customs',
        'exception', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'],
        coalesce(scan.old_stage, event.stage)) desc,
      event.id desc
    limit 1
  ) previous
  where parcel.id = affected.package_id
    and parcel.current_stage = previous.stage
    and latest.stage <> previous.stage;

  drop table restaged_scans;
end;
$$;

insert into public.applied_migrations (name) values ('20261008200000_la_poste_round_sort_stage') on conflict do nothing;
